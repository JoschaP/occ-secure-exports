//! Download + decrypt orchestration with bounded memory and atomic, fail-closed
//! writes.
//!
//! Flow: S3 `GetObject` body (async) → `SyncIoBridge` → age streaming decrypt
//! (sync, on a blocking worker) → `BufWriter` to a temp file in the destination
//! directory → `fsync` → atomic `rename` to the final name. On ANY error the
//! temp file is removed, so a wrong key or corrupt object never yields a
//! partial or plaintext file.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use aws_sdk_s3::Client;
use tokio_util::io::SyncIoBridge;

use crate::crypto::{self, Identity};
use crate::error::{AppError, AppResult};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Download `key` from `bucket`, decrypt it, and atomically write the plaintext
/// to `dest_path`. `progress(done, total)` is called as plaintext bytes land;
/// `total` is the *ciphertext* content length (a close-enough size hint).
pub async fn download_and_decrypt(
    client: &Client,
    bucket: &str,
    key: &str,
    dest_path: &Path,
    identities: Arc<Vec<Identity>>,
    progress: impl Fn(u64, u64) + Send + 'static,
) -> AppResult<u64> {
    let resp = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| AppError::S3(crate::s3::friendly_s3(&e)))?;

    let total = resp.content_length().unwrap_or(0).max(0) as u64;
    let body = resp.body.into_async_read();

    // Temp file lives next to the destination so the rename stays on one volume.
    let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = dest_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let tmp_path = dest_path.with_file_name(format!(".{file_name}.occ-part{counter}"));

    // `.age` objects are decrypted; everything else is passed through unchanged.
    let decrypt = key.to_ascii_lowercase().ends_with(".age");

    let mut bridge = SyncIoBridge::new(body);
    let dest = dest_path.to_path_buf();
    let tmp = tmp_path.clone();

    let result = tokio::task::spawn_blocking(move || -> AppResult<u64> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = std::fs::File::create(&tmp)?;
        let mut writer = std::io::BufWriter::new(file);

        let written = if decrypt {
            crypto::decrypt_stream(bridge, &mut writer, &identities, |done| {
                progress(done, total)
            })?
        } else {
            copy_stream(&mut bridge, &mut writer, |done| progress(done, total))?
        };

        let file = writer
            .into_inner()
            .map_err(|e| AppError::Io(e.to_string()))?;
        file.sync_all()?;
        std::fs::rename(&tmp, &dest)?;
        Ok(written)
    })
    .await
    .map_err(|e| AppError::Other(format!("Internal task error: {e}")))?;

    if result.is_err() {
        // Fail-closed: leave nothing behind.
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

/// Stream-copy `src` to `dst` in 64 KiB chunks, reporting progress. Used for
/// non-`.age` objects (passed through unchanged, no decryption).
fn copy_stream<R: std::io::Read, W: std::io::Write>(
    src: &mut R,
    dst: &mut W,
    mut on_progress: impl FnMut(u64),
) -> AppResult<u64> {
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = src
            .read(&mut buf)
            .map_err(|e| AppError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])?;
        total += n as u64;
        on_progress(total);
    }
    dst.flush()?;
    Ok(total)
}

/// Derive a SAFE output file name from an object key: take the last path
/// segment (splitting on both `/` and `\`), strip a single trailing `.age`,
/// and reject path-traversal / empty names. A malicious key like
/// `..\..\evil.age` can never escape the destination directory.
pub fn plaintext_file_name(key: &str) -> String {
    let last = key
        .rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or(key);
    let stripped = last.strip_suffix(".age").unwrap_or(last);
    // Drop any residual separators and reject "." / ".." which would traverse.
    let cleaned = stripped.replace(['/', '\\'], "").trim().to_string();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "download".to_string()
    } else {
        cleaned
    }
}

/// Join a frontend-supplied relative path onto `dest_dir`, preserving folder
/// structure while making escape impossible. Each segment is split on `/` and
/// `\`, and empty / `.` / `..` segments are dropped — so a malicious key such
/// as `../../etc/passwd` collapses to `etc/passwd` *under* `dest_dir` and can
/// never traverse outside it. If nothing survives, a safe fallback name is
/// used. The caller is responsible for `.age` stripping on the final segment.
pub fn safe_dest_path(dest_dir: &Path, rel_path: &str) -> PathBuf {
    let mut out = dest_dir.to_path_buf();
    let mut pushed = false;
    for raw in rel_path.split(['/', '\\']) {
        let seg = raw.trim();
        if seg.is_empty() || seg == "." || seg == ".." {
            continue;
        }
        out.push(seg);
        pushed = true;
    }
    if !pushed {
        out.push("download");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{plaintext_file_name, safe_dest_path};
    use std::path::Path;

    #[test]
    fn strips_age_and_keeps_last_segment() {
        assert_eq!(plaintext_file_name("a/b/log.json.age"), "log.json");
        assert_eq!(plaintext_file_name("report.age"), "report");
        assert_eq!(plaintext_file_name("plain.json"), "plain.json");
    }

    #[test]
    fn resists_path_traversal() {
        // Backslash and ../ segments must never escape the destination dir.
        assert_eq!(plaintext_file_name("a/..\\..\\evil.age"), "evil");
        assert_eq!(plaintext_file_name("../../etc/passwd.age"), "passwd");
        assert_eq!(plaintext_file_name(".."), "download");
        assert_eq!(plaintext_file_name("dir/"), "dir");
        assert_eq!(plaintext_file_name(""), "download");
    }

    #[test]
    fn safe_dest_path_preserves_structure() {
        let base = Path::new("/dest");
        assert_eq!(
            safe_dest_path(base, "backups/2026-06-20/db-snapshot.sql"),
            Path::new("/dest/backups/2026-06-20/db-snapshot.sql"),
        );
        assert_eq!(
            safe_dest_path(base, "report.json"),
            Path::new("/dest/report.json"),
        );
    }

    #[test]
    fn safe_dest_path_cannot_escape() {
        let base = Path::new("/dest");
        // .. and . segments are dropped, so the result stays under /dest.
        assert_eq!(
            safe_dest_path(base, "../../etc/passwd"),
            Path::new("/dest/etc/passwd"),
        );
        assert_eq!(
            safe_dest_path(base, "a/../../b/./c"),
            Path::new("/dest/a/b/c"),
        );
        assert_eq!(safe_dest_path(base, "x\\..\\y"), Path::new("/dest/x/y"),);
        // Nothing usable → safe fallback.
        assert_eq!(safe_dest_path(base, "../.."), Path::new("/dest/download"));
        assert_eq!(safe_dest_path(base, ""), Path::new("/dest/download"));
    }
}

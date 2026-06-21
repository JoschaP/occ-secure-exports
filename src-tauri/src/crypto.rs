//! age key generation, identity parsing and streaming decryption.
//!
//! Decryption is chunked: age's `STREAM` format is decrypted incrementally, so
//! a multi-GB artifact never sits fully in memory. We copy 64 KiB at a time
//! from the age reader to the destination writer, reporting progress.

use std::io::{Read, Write};

use secrecy::ExposeSecret;

use crate::error::{AppError, AppResult};

/// Identities must cross threads (decryption runs on a blocking worker), so we
/// require `Send + Sync`.
pub type Identity = Box<dyn age::Identity + Send + Sync>;

/// A freshly generated age key pair. The private key is sensitive.
pub struct KeyPair {
    pub public_key: String,
    pub private_key: String,
}

/// Generate a new native age (x25519) key pair.
pub fn generate_keypair() -> KeyPair {
    let identity = age::x25519::Identity::generate();
    let public_key = identity.to_public().to_string();
    let private_key = identity.to_string().expose_secret().to_string();
    KeyPair {
        public_key,
        private_key,
    }
}

/// Parse private key material into one or more age identities.
///
/// Accepts:
///   * native age secret keys (`AGE-SECRET-KEY-1…`)
///   * OpenSSH private keys (ed25519 / rsa), unencrypted
///
/// An identity *file* may contain several keys and `#` comment lines.
pub fn parse_identities(material: &str) -> AppResult<Vec<Identity>> {
    let trimmed = material.trim();
    if trimmed.is_empty() {
        return Err(AppError::Key("No private key provided.".into()));
    }

    // OpenSSH private key.
    if trimmed.contains("-----BEGIN") && trimmed.contains("PRIVATE KEY-----") {
        let ssh = age::ssh::Identity::from_buffer(trimmed.as_bytes(), None)
            .map_err(|e| AppError::Key(format!("Could not read the SSH key: {e}")))?;
        if let age::ssh::Identity::Encrypted(_) = ssh {
            return Err(AppError::Key(
                "This SSH key is passphrase-protected. Please use an unencrypted SSH key or an age key.".into(),
            ));
        }
        if let age::ssh::Identity::Unsupported(_) = ssh {
            return Err(AppError::Key(
                "This SSH key type is not supported. Use an ed25519 or rsa key, or an age key."
                    .into(),
            ));
        }
        return Ok(vec![Box::new(ssh)]);
    }

    // One or more native age secret keys (identity-file style).
    let mut identities: Vec<Identity> = Vec::new();
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let id = line
            .parse::<age::x25519::Identity>()
            .map_err(|e| AppError::Key(format!("This does not look like a valid age key: {e}")))?;
        identities.push(Box::new(id));
    }

    if identities.is_empty() {
        return Err(AppError::Key(
            "No usable key found in the provided material.".into(),
        ));
    }
    Ok(identities)
}

/// Derive the age public key (recipient) for stored private key material, if it
/// is a native age key. Returns `None` for SSH keys or unparseable input.
pub fn public_key_for(material: &str) -> Option<String> {
    for line in material.trim().lines() {
        let line = line.trim();
        if line.starts_with("AGE-SECRET-KEY-") {
            if let Ok(id) = line.parse::<age::x25519::Identity>() {
                return Some(id.to_public().to_string());
            }
        }
    }
    None
}

/// Check whether `identities` can decrypt an age file given only the start of
/// it (the header). `Some(true)` = a key matches, `Some(false)` = no matching
/// key, `None` = couldn't determine (not age / truncated header). The body is
/// never needed: the recipient stanzas live in the header.
pub fn matches_key(header_prefix: &[u8], identities: &[Identity]) -> Option<bool> {
    match age::Decryptor::new(header_prefix) {
        Ok(decryptor) => {
            match decryptor.decrypt(identities.iter().map(|i| i.as_ref() as &dyn age::Identity)) {
                Ok(_) => Some(true),
                Err(age::DecryptError::NoMatchingKeys) => Some(false),
                Err(_) => None,
            }
        }
        Err(_) => None,
    }
}

/// Stream-decrypt `src` into `dst`, invoking `on_progress` with the running
/// count of plaintext bytes written. Returns the total bytes written.
pub fn decrypt_stream<R, W>(
    src: R,
    dst: &mut W,
    identities: &[Identity],
    mut on_progress: impl FnMut(u64),
) -> AppResult<u64>
where
    R: Read,
    W: Write,
{
    let decryptor = age::Decryptor::new(src).map_err(|e| AppError::Decrypt(friendly(&e)))?;

    let mut reader = decryptor
        .decrypt(identities.iter().map(|i| i.as_ref() as &dyn age::Identity))
        .map_err(|e| AppError::Decrypt(friendly(&e)))?;

    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| AppError::Decrypt(e.to_string()))?;
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

/// Map age's decrypt errors to calm, non-technical wording.
fn friendly(e: &age::DecryptError) -> String {
    match e {
        age::DecryptError::NoMatchingKeys => {
            "This file was not encrypted for your key. Check that you are using the matching private key.".into()
        }
        age::DecryptError::InvalidHeader | age::DecryptError::UnknownFormat => {
            "This does not look like an age-encrypted file.".into()
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Encrypt for an age public key — the test counterpart to decryption.
    pub(super) fn encrypt_for(public_key: &str, plaintext: &[u8]) -> Vec<u8> {
        let recipient: age::x25519::Recipient = public_key.parse().expect("valid public key");
        let encryptor =
            age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
                .expect("encryptor");
        let mut out = Vec::new();
        let mut writer = encryptor.wrap_output(&mut out).unwrap();
        writer.write_all(plaintext).unwrap();
        writer.finish().unwrap();
        out
    }

    #[test]
    fn keygen_produces_well_formed_keys() {
        let kp = generate_keypair();
        assert!(
            kp.public_key.starts_with("age1"),
            "public: {}",
            kp.public_key
        );
        assert!(kp.private_key.starts_with("AGE-SECRET-KEY-1"));
    }

    #[test]
    fn parse_identities_accepts_age_and_rejects_garbage() {
        let kp = generate_keypair();
        assert_eq!(parse_identities(&kp.private_key).unwrap().len(), 1);
        assert!(parse_identities("not a key").is_err());
        assert!(parse_identities("").is_err());
    }

    #[test]
    fn decrypt_round_trip_matches_plaintext() {
        let kp = generate_keypair();
        let plaintext = b"controlled egress export \x00\x01\x02 payload";
        let ciphertext = encrypt_for(&kp.public_key, plaintext);
        let identities = parse_identities(&kp.private_key).unwrap();

        let mut out = Vec::new();
        let n = decrypt_stream(&ciphertext[..], &mut out, &identities, |_| {}).unwrap();
        assert_eq!(out, plaintext);
        assert_eq!(n, plaintext.len() as u64);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let alice = generate_keypair();
        let bob = generate_keypair();
        let ciphertext = encrypt_for(&alice.public_key, b"top secret");
        let bob_ids = parse_identities(&bob.private_key).unwrap();

        let mut out = Vec::new();
        let res = decrypt_stream(&ciphertext[..], &mut out, &bob_ids, |_| {});
        assert!(res.is_err(), "decryption with the wrong key must fail");
    }

    #[test]
    fn matches_key_detects_right_and_wrong_key() {
        let alice = generate_keypair();
        let bob = generate_keypair();
        let ct = encrypt_for(&alice.public_key, b"header probe payload");
        let alice_ids = parse_identities(&alice.private_key).unwrap();
        let bob_ids = parse_identities(&bob.private_key).unwrap();

        assert_eq!(matches_key(&ct, &alice_ids), Some(true));
        assert_eq!(matches_key(&ct, &bob_ids), Some(false));
        assert_eq!(matches_key(b"not an age file", &alice_ids), None);
    }
}

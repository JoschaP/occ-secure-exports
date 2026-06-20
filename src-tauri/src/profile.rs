//! Connection profiles and secure credential storage.
//!
//! Split by sensitivity:
//!   * Non-secret metadata (endpoint, region, bucket, access key *id*, flags)
//!     lives in a plain JSON file in the app config dir.
//!   * Secrets (the S3 *secret* access key and the private age key) live ONLY
//!     in the OS secure store via the `keyring` crate — Keychain on macOS,
//!     Credential Manager on Windows, Secret Service on Linux. They never touch
//!     the JSON file or any other plaintext on disk.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Keyring service name. Accounts are derived per profile + secret kind.
const KEYRING_SERVICE: &str = "de.occ-companion.app";
const PROFILES_FILE: &str = "profiles.json";

/// Which secret a keyring entry holds.
#[derive(Clone, Copy)]
pub enum SecretKind {
    S3Secret,
    AgeKey,
}

impl SecretKind {
    fn suffix(self) -> &'static str {
        match self {
            SecretKind::S3Secret => "s3-secret",
            SecretKind::AgeKey => "age-key",
        }
    }
}

/// A saved connection. Contains NO secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    #[serde(default)]
    pub path_style: bool,
    /// Optional prefix the browser starts at (e.g. a tenant base path).
    #[serde(default)]
    pub base_prefix: String,
    /// Whether the S3 secret is kept in the OS secure store.
    #[serde(default)]
    pub remember_secret: bool,
    /// Whether the private age key is kept in the OS secure store.
    #[serde(default)]
    pub remember_key: bool,
}

fn profiles_path(config_dir: &Path) -> PathBuf {
    config_dir.join(PROFILES_FILE)
}

/// Load all saved profiles. Missing file → empty list.
pub fn load_profiles(config_dir: &Path) -> AppResult<Vec<ConnectionProfile>> {
    let path = profiles_path(config_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&path)?;
    if data.trim().is_empty() {
        return Ok(Vec::new());
    }
    let profiles: Vec<ConnectionProfile> = serde_json::from_str(&data)?;
    Ok(profiles)
}

fn write_profiles(config_dir: &Path, profiles: &[ConnectionProfile]) -> AppResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let path = profiles_path(config_dir);
    let json = serde_json::to_string_pretty(profiles)?;
    std::fs::write(&path, json)?;
    Ok(())
}

/// Insert or update a profile (matched by id) and persist metadata.
pub fn upsert_profile(config_dir: &Path, profile: ConnectionProfile) -> AppResult<()> {
    let mut profiles = load_profiles(config_dir)?;
    match profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile,
        None => profiles.push(profile),
    }
    write_profiles(config_dir, &profiles)
}

/// Remove a profile and its associated secrets.
pub fn delete_profile(config_dir: &Path, id: &str) -> AppResult<()> {
    let mut profiles = load_profiles(config_dir)?;
    profiles.retain(|p| p.id != id);
    write_profiles(config_dir, &profiles)?;
    // Best-effort secret cleanup; ignore "not found".
    let _ = delete_secret(id, SecretKind::S3Secret);
    let _ = delete_secret(id, SecretKind::AgeKey);
    Ok(())
}

fn keyring_entry(id: &str, kind: SecretKind) -> AppResult<keyring::Entry> {
    let account = format!("{id}::{}", kind.suffix());
    keyring::Entry::new(KEYRING_SERVICE, &account).map_err(AppError::from)
}

/// Store a secret in the OS secure store.
pub fn set_secret(id: &str, kind: SecretKind, value: &str) -> AppResult<()> {
    keyring_entry(id, kind)?.set_password(value)?;
    Ok(())
}

/// Read a secret from the OS secure store, if present.
pub fn get_secret(id: &str, kind: SecretKind) -> AppResult<Option<String>> {
    match keyring_entry(id, kind)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}

/// Delete a secret from the OS secure store.
pub fn delete_secret(id: &str, kind: SecretKind) -> AppResult<()> {
    match keyring_entry(id, kind)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}

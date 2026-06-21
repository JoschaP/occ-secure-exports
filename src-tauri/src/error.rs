//! A single error type for the whole core, serialized to the frontend as a
//! `{ code, message }` object: `message` is the human-readable text (no
//! internal detail — keys, paths — beyond what the user already knows), and
//! `code` is a stable machine token the UI can branch on without string
//! matching (see `src/lib/errors.ts`).

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Storage connection error: {0}")]
    S3(String),

    #[error("Decryption failed: {0}")]
    Decrypt(String),

    #[error("Invalid key: {0}")]
    Key(String),

    #[error("Secure store error: {0}")]
    Keyring(String),

    #[error("File error: {0}")]
    Io(String),

    #[error("Configuration error: {0}")]
    Config(String),

    /// A saved connection has no stored secret/key, so the UI must collect it.
    /// Distinct from `Config` so the frontend can fall back to the form without
    /// matching on the message text.
    #[error("{0}")]
    MissingCredentials(String),

    #[error("Not connected. Open a connection first.")]
    NotConnected,

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Stable machine-readable code, mirrored by `src/lib/errors.ts`. Kept in
    /// sync with the variants; never change an existing value (the UI keys off
    /// it).
    pub fn code(&self) -> &'static str {
        match self {
            AppError::S3(_) => "s3",
            AppError::Decrypt(_) => "decrypt",
            AppError::Key(_) => "key",
            AppError::Keyring(_) => "keyring",
            AppError::Io(_) => "io",
            AppError::Config(_) => "config",
            AppError::MissingCredentials(_) => "missing_credentials",
            AppError::NotConnected => "not_connected",
            AppError::Other(_) => "other",
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Config(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_code_and_message() {
        let err = AppError::MissingCredentials("No private key available.".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "missing_credentials");
        assert_eq!(json["message"], "No private key available.");
    }

    #[test]
    fn codes_are_stable_per_variant() {
        assert_eq!(AppError::S3(String::new()).code(), "s3");
        assert_eq!(AppError::Decrypt(String::new()).code(), "decrypt");
        assert_eq!(AppError::Key(String::new()).code(), "key");
        assert_eq!(AppError::Keyring(String::new()).code(), "keyring");
        assert_eq!(AppError::Io(String::new()).code(), "io");
        assert_eq!(AppError::Config(String::new()).code(), "config");
        assert_eq!(
            AppError::MissingCredentials(String::new()).code(),
            "missing_credentials"
        );
        assert_eq!(AppError::NotConnected.code(), "not_connected");
        assert_eq!(AppError::Other(String::new()).code(), "other");
    }
}

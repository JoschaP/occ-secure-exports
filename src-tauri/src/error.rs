//! A single error type for the whole core, serialized to the frontend as a
//! human-readable string. No internal detail (keys, paths) is ever leaked into
//! these messages beyond what the user already knows.

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

    #[error("Not connected. Open a connection first.")]
    NotConnected,

    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
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

use thiserror::Error;

/// Errors shown to the user. Messages never carry the token or capture text.
#[derive(Debug, Error)]
pub enum Error {
    #[error("the server URL must use https (http is only allowed for localhost)")]
    InsecureUrl,
    #[error("the server URL is not valid (use https://host, without credentials, query or fragment)")]
    InvalidUrl,
    #[error("that is not a device token (it must start with nyd_; export tokens are refused)")]
    BadTokenFormat,
    #[error("no device token is stored yet")]
    NoToken,
    #[error("no server URL is set yet")]
    NoServer,
    #[error("the capture is empty")]
    EmptyText,
    #[error("the capture is longer than 300 characters")]
    TextTooLong,
    #[error("pick a block: the server files a capture under one")]
    NoBlock,
    #[error("storage error: {0}")]
    Storage(String),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("could not load options from the server: {0}")]
    Fetch(String),
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Storage(e.to_string())
    }
}

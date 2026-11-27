use std::fmt;
use std::sync::Mutex;

use crate::error::Error;

pub const TOKEN_PREFIX: &str = "nyd_";

/// A device token. `Debug` is redacted and there is no `Display`, so it cannot
/// end up in a log line by accident; `expose` is the one way to read it and is
/// called only when building the Authorization header.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    /// Validate shape: `nyd_` + base64url. Export tokens (`nyt_`) and anything
    /// else are refused here, before they reach the Keychain.
    pub fn new(raw: &str) -> Result<Self, Error> {
        let raw = raw.trim();
        let body = raw.strip_prefix(TOKEN_PREFIX).ok_or(Error::BadTokenFormat)?;
        let ok_len = (16..=128).contains(&body.len());
        let ok_chars = body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !(ok_len && ok_chars) {
            return Err(Error::BadTokenFormat);
        }
        Ok(Token(raw.to_string()))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token([redacted])")
    }
}

/// Where the token lives. The app uses the macOS Keychain; tests use [`MemoryStore`].
pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<Token>, Error>;
    fn set(&self, token: &Token) -> Result<(), Error>;
    fn delete(&self) -> Result<(), Error>;
}

/// In-memory fake for tests and for hosts without a keychain.
#[derive(Default)]
pub struct MemoryStore(Mutex<Option<Token>>);

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl TokenStore for MemoryStore {
    fn get(&self) -> Result<Option<Token>, Error> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn set(&self, token: &Token) -> Result<(), Error> {
        *self.0.lock().unwrap() = Some(token.clone());
        Ok(())
    }
    fn delete(&self) -> Result<(), Error> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

/// macOS Keychain via the `keyring` crate (generic password item).
#[cfg(feature = "keychain")]
pub struct KeychainStore {
    service: String,
    account: String,
}

#[cfg(feature = "keychain")]
impl KeychainStore {
    pub fn new(service: &str, account: &str) -> Self {
        Self { service: service.to_string(), account: account.to_string() }
    }

    fn entry(&self) -> Result<keyring::Entry, Error> {
        keyring::Entry::new(&self.service, &self.account).map_err(|e| Error::Keychain(e.to_string()))
    }
}

#[cfg(feature = "keychain")]
impl TokenStore for KeychainStore {
    fn get(&self) -> Result<Option<Token>, Error> {
        match self.entry()?.get_password() {
            Ok(secret) => Token::new(&secret).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }
    fn set(&self, token: &Token) -> Result<(), Error> {
        self.entry()?.set_password(token.expose()).map_err(|e| Error::Keychain(e.to_string()))
    }
    fn delete(&self) -> Result<(), Error> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "nyd_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

    #[test]
    fn accepts_a_device_token_and_trims() {
        assert!(Token::new(&format!("  {GOOD}\n")).is_ok());
    }

    #[test]
    fn refuses_export_tokens_and_junk() {
        for bad in ["nyt_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "nyd_short", "nyd_has space in it 0123456789", "", "Bearer x"] {
            assert!(matches!(Token::new(bad), Err(Error::BadTokenFormat)), "{bad}");
        }
    }

    #[test]
    fn debug_never_shows_the_token() {
        let t = Token::new(GOOD).unwrap();
        assert!(!format!("{t:?}").contains("AbCdEf"));
    }

    #[test]
    fn memory_store_round_trip() {
        let s = MemoryStore::new();
        assert!(s.get().unwrap().is_none());
        s.set(&Token::new(GOOD).unwrap()).unwrap();
        assert_eq!(s.get().unwrap().unwrap().expose(), GOOD);
        s.delete().unwrap();
        assert!(s.get().unwrap().is_none());
    }
}

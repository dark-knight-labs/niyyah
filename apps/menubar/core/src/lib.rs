//! Niyyah Capture core: everything the menu-bar app does except draw windows.
//!
//! Kept free of any GUI dependency so it builds and tests on Linux. The Tauri
//! shell (`../src-tauri`) is a thin layer over [`Capturer`].
//!
//! Rules this crate enforces (each has a test):
//! - a capture is written to disk before it is acknowledged and is removed only
//!   when the server confirms it (never dropped silently);
//! - the device token lives only in a [`TokenStore`] (the macOS Keychain in the
//!   app), is never written to a file, never logged, and is sent only to the
//!   configured Niyyah host over https (http only to localhost, for tests).

pub mod capturer;
pub mod client;
pub mod error;
pub mod options;
pub mod payload;
pub mod queue;
pub mod token;
pub mod url_guard;

pub use capturer::{Capturer, FlushReport};
pub use error::Error;
pub use options::{BlockOption, Options, ProductOption};
pub use payload::{Capture, ItemPayload, Lane};
pub use queue::{Entry, EntryState, Queue};
pub use token::{MemoryStore, Token, TokenStore};

#[cfg(feature = "keychain")]
pub use token::KeychainStore;

/// Wall-clock seconds since the Unix epoch. Passed into the core as a plain
/// number so tests control time.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

//! Focus-window state and the session log, on disk in the app data folder.
//!
//! `focus.json` holds the chosen window and the running session (so a restart resumes it).
//! `sessions.jsonl` gets one line per finished session: task, window, duration. It is the record that
//! will sync to Niyyah once the backend has timer fields. Both are owner-only (0600) and opaque JSON,
//! so the web layer can grow fields without a Rust change.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use crate::error::Error;
use crate::taskstore::write_atomic;

pub struct FocusStore {
    state: PathBuf,
    log: PathBuf,
    lock: Mutex<()>,
}

impl FocusStore {
    pub fn new(dir: &Path) -> Self {
        Self { state: dir.join("focus.json"), log: dir.join("sessions.jsonl"), lock: Mutex::new(()) }
    }

    pub fn load_state(&self) -> Result<Option<Value>, Error> {
        match fs::read(&self.state) {
            Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| Error::Storage(format!("focus.json: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save_state(&self, state: &Value) -> Result<(), Error> {
        let _guard = self.lock.lock().map_err(|e| Error::Storage(e.to_string()))?;
        write_atomic(&self.state, state).map_err(Error::from)
    }

    /// Append one finished session as a single JSON line.
    pub fn append_session(&self, session: &Value) -> Result<(), Error> {
        let _guard = self.lock.lock().map_err(|e| Error::Storage(e.to_string()))?;
        if let Some(dir) = self.log.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut opts = OpenOptions::new();
        opts.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&self.log)?;
        let mut line = serde_json::to_vec(session).map_err(|e| Error::Storage(e.to_string()))?;
        line.push(b'\n');
        file.write_all(&line)?;
        file.sync_all()?;
        Ok(())
    }

    /// Every readable session, oldest first. A damaged line (a torn write) is skipped, not fatal.
    pub fn sessions(&self) -> Result<Vec<Value>, Error> {
        match fs::read_to_string(&self.log) {
            Ok(text) => Ok(text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn state_round_trips_and_missing_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let store = FocusStore::new(dir.path());
        assert!(store.load_state().unwrap().is_none());
        let state = json!({"target": {"app": "Safari", "title": "Docs"}, "session": {"elapsedMs": 5000}});
        store.save_state(&state).unwrap();
        assert_eq!(store.load_state().unwrap().unwrap(), state);
    }

    #[test]
    fn sessions_append_in_order_and_skip_torn_lines() {
        let dir = tempfile::tempdir().unwrap();
        let store = FocusStore::new(dir.path());
        assert!(store.sessions().unwrap().is_empty());
        store.append_session(&json!({"task": "a", "durationMs": 1})).unwrap();
        let mut f = fs::OpenOptions::new().append(true).open(dir.path().join("sessions.jsonl")).unwrap();
        f.write_all(b"{\"torn\":\n").unwrap();
        drop(f);
        store.append_session(&json!({"task": "b", "durationMs": 2})).unwrap();
        let all = store.sessions().unwrap();
        assert_eq!(all.iter().map(|s| s["task"].as_str().unwrap()).collect::<Vec<_>>(), ["a", "b"]);
    }

    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = FocusStore::new(dir.path());
        store.save_state(&json!({})).unwrap();
        store.append_session(&json!({})).unwrap();
        for f in ["focus.json", "sessions.jsonl"] {
            assert_eq!(fs::metadata(dir.path().join(f)).unwrap().permissions().mode() & 0o777, 0o600, "{f}");
        }
    }
}

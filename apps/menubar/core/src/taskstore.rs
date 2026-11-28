//! The local task list (`tasks.json`): the fields Niyyah cannot store yet (link, timer, deadline
//! with a time) live here, next to each task's name and done flag.
//!
//! Tasks are kept as opaque JSON values so a newer web layer never loses a field this crate does
//! not know. Writes are atomic: temp file, fsync, rename, so a crash leaves the old list or the
//! new one, never half of one. The file is owner-only (mode 0600) on Unix.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use crate::error::Error;
use crate::queue::{create_private_dir, write_private_atomic};

pub struct TaskStore {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl TaskStore {
    pub fn new(dir: &Path) -> Self {
        Self { path: dir.join("tasks.json"), write_lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// `Ok(None)` when no list was saved yet. A corrupt file is an error (never silently replaced).
    pub fn load(&self) -> Result<Option<Vec<Value>>, Error> {
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| Error::Storage(format!("tasks.json: {e}"))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, tasks: &[Value]) -> Result<(), Error> {
        let _guard = self.write_lock.lock().map_err(|e| Error::Storage(e.to_string()))?;
        write_atomic(&self.path, tasks).map_err(Error::from)
    }
}

/// Atomic, owner-only (0600) JSON write: the same private-file path as the queue, so tasks.json and focus.json
/// are never world-readable.
pub(crate) fn write_atomic<T: serde::Serialize + ?Sized>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        create_private_dir(dir).map_err(|e| io::Error::other(e.to_string()))?;
    }
    let bytes = serde_json::to_vec(value)?;
    write_private_atomic(path, &bytes).map_err(|e| io::Error::other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn task() -> Value {
        json!({
            "id": "task-1", "name": "Review notes", "trackedMs": 12000, "startedAt": 10,
            "deadlineAt": 20, "link": "https://example.com", "done": false, "futureField": {"a": [1, 2]}
        })
    }

    #[test]
    fn missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(TaskStore::new(dir.path()).load().unwrap().is_none());
    }

    #[test]
    fn round_trip_keeps_every_field_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = TaskStore::new(&dir.path().join("nested"));
        store.save(&[task()]).unwrap();
        assert_eq!(store.load().unwrap().unwrap(), vec![task()]);
        store.save(&[]).unwrap();
        assert_eq!(fs::read_to_string(store.path()).unwrap(), "[]");
        assert_eq!(fs::read_dir(dir.path().join("nested")).unwrap().count(), 1, "no temp file left behind");
    }

    #[test]
    fn corrupt_file_is_an_error_and_is_not_replaced_by_load() {
        let dir = tempfile::tempdir().unwrap();
        let store = TaskStore::new(dir.path());
        fs::write(store.path(), b"{not json").unwrap();
        assert!(store.load().is_err());
        assert_eq!(fs::read(store.path()).unwrap(), b"{not json");
    }

    #[cfg(unix)]
    #[test]
    fn file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = TaskStore::new(dir.path());
        store.save(&[task()]).unwrap();
        assert_eq!(fs::metadata(store.path()).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn failed_write_keeps_the_old_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = TaskStore::new(dir.path());
        store.save(&[task()]).unwrap();
        // A directory where the temp file would go makes the write fail.
        let blocker = store.path().with_extension("tmp");
        fs::create_dir(&blocker).unwrap();
        assert!(store.save(&[]).is_err());
        assert_eq!(store.load().unwrap().unwrap(), vec![task()]);
    }
}

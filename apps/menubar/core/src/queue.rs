//! The offline capture queue: one JSON file in the app data folder (mode 0600).
//!
//! A capture is persisted before `push` returns and removed only by
//! `mark_sent` (the server confirmed it) or `discard` (an explicit user action).
//! A server refusal parks the entry as `Rejected` for the user to see; nothing
//! is ever dropped automatically.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Error;
use crate::payload::Capture;

pub const QUEUE_FILE: &str = "queue.json";
const FORMAT_VERSION: u32 = 1;
/// First retry after 5 s, then doubling, capped at 15 min.
const BACKOFF_BASE_SECS: u64 = 5;
const BACKOFF_CAP_SECS: u64 = 15 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryState {
    /// Waiting to be sent (or to be retried).
    Pending,
    /// The server refused it for good (HTTP 4xx other than auth/rate limit). Kept for the user.
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub created_at: u64,
    pub capture: Capture,
    pub attempts: u32,
    pub next_attempt_at: u64,
    pub state: EntryState,
    pub last_error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct QueueFile {
    version: u32,
    seq: u64,
    entries: Vec<Entry>,
}

/// Delay before the next attempt after `attempts` failures (1-based).
pub fn backoff_secs(attempts: u32) -> u64 {
    let shift = attempts.saturating_sub(1).min(20);
    BACKOFF_BASE_SECS.saturating_mul(1u64 << shift).min(BACKOFF_CAP_SECS)
}

pub struct Queue {
    path: PathBuf,
    file: QueueFile,
    recovered_from: Option<PathBuf>,
}

impl Queue {
    /// Open (or create) the queue in `dir`. The folder is created 0700.
    pub fn open(dir: &Path) -> Result<Self, Error> {
        create_private_dir(dir)?;
        let path = dir.join(QUEUE_FILE);
        let mut recovered_from = None;
        let file = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<QueueFile>(&bytes) {
                Ok(f) => f,
                Err(e) => {
                    // Never silently discard what might be a user's captures: keep the bytes beside it.
                    let aside = dir.join(format!("{QUEUE_FILE}.corrupt-{}", crate::now_secs()));
                    write_private(&aside, &bytes)?;
                    log::error!("queue file unreadable ({e}); kept as {}", aside.display());
                    recovered_from = Some(aside);
                    QueueFile { version: FORMAT_VERSION, ..Default::default() }
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => QueueFile { version: FORMAT_VERSION, ..Default::default() },
            Err(e) => return Err(e.into()),
        };
        let q = Queue { path, file, recovered_from };
        q.persist()?;
        Ok(q)
    }

    /// Set when the file on disk could not be parsed: where the original bytes were kept.
    pub fn recovered_from(&self) -> Option<&Path> {
        self.recovered_from.as_deref()
    }

    pub fn entries(&self) -> &[Entry] {
        &self.file.entries
    }

    /// Entries waiting to be sent whose retry time has come, oldest first.
    pub fn due(&self, now: u64) -> Vec<Entry> {
        self.file.entries.iter().filter(|e| e.state == EntryState::Pending && e.next_attempt_at <= now).cloned().collect()
    }

    /// The earliest time a pending entry becomes due, if any are pending.
    pub fn next_due_at(&self) -> Option<u64> {
        self.file.entries.iter().filter(|e| e.state == EntryState::Pending).map(|e| e.next_attempt_at).min()
    }

    /// Persist a new capture. Returns only after it is on disk.
    pub fn push(&mut self, capture: Capture, now: u64) -> Result<String, Error> {
        self.file.seq += 1;
        let id = format!("{now}-{}", self.file.seq);
        self.file.entries.push(Entry {
            id: id.clone(),
            created_at: now,
            capture,
            attempts: 0,
            next_attempt_at: now,
            state: EntryState::Pending,
            last_error: None,
        });
        if let Err(e) = self.persist() {
            self.file.entries.pop();
            return Err(e);
        }
        Ok(id)
    }

    /// The server confirmed this capture: only now is it removed.
    pub fn mark_sent(&mut self, id: &str) -> Result<(), Error> {
        self.file.entries.retain(|e| e.id != id);
        self.persist()
    }

    /// A transient failure: keep it, back off exponentially.
    pub fn mark_retry(&mut self, id: &str, now: u64, error: &str) -> Result<(), Error> {
        if let Some(e) = self.file.entries.iter_mut().find(|e| e.id == id) {
            e.attempts = e.attempts.saturating_add(1);
            e.next_attempt_at = now.saturating_add(backoff_secs(e.attempts));
            e.last_error = Some(error.to_string());
        }
        self.persist()
    }

    /// The server refused it for good. Kept, shown to the user, never retried automatically.
    pub fn mark_rejected(&mut self, id: &str, error: &str) -> Result<(), Error> {
        if let Some(e) = self.file.entries.iter_mut().find(|e| e.id == id) {
            e.state = EntryState::Rejected;
            e.last_error = Some(error.to_string());
        }
        self.persist()
    }

    /// User asked to try a rejected capture again.
    pub fn requeue(&mut self, id: &str, now: u64) -> Result<(), Error> {
        if let Some(e) = self.file.entries.iter_mut().find(|e| e.id == id) {
            e.state = EntryState::Pending;
            e.attempts = 0;
            e.next_attempt_at = now;
        }
        self.persist()
    }

    /// Explicit user action only (a "dismiss" button on a rejected capture).
    pub fn discard(&mut self, id: &str) -> Result<(), Error> {
        self.file.entries.retain(|e| e.id != id);
        self.persist()
    }

    /// Atomic write: temp file (0600) + fsync + rename, so a crash leaves the old or the new file, never half.
    fn persist(&self) -> Result<(), Error> {
        let bytes = serde_json::to_vec_pretty(&self.file).map_err(|e| Error::Storage(e.to_string()))?;
        write_private_atomic(&self.path, &bytes)
    }
}

/// Create `dir` (and parents) with mode 0700 on Unix.
pub fn create_private_dir(dir: &Path) -> Result<(), Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(dir)?;
    Ok(())
}

fn open_private(path: &Path) -> std::io::Result<fs::File> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

/// Write a new private file (0600). If it already exists its mode is forced back to 0600.
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let mut f = open_private(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

pub fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let tmp = path.with_extension("tmp");
    write_private(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    if let Some(parent) = path.parent() {
        if let Ok(d) = fs::File::open(parent) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cap(text: &str) -> Capture {
        Capture { text: text.into(), stream: "OT".into(), product: None, client_id: None }
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let v: Vec<u64> = (1..=10).map(backoff_secs).collect();
        assert_eq!(&v[..6], &[5, 10, 20, 40, 80, 160]);
        assert_eq!(v[9], 900);
        assert_eq!(backoff_secs(u32::MAX), 900);
    }

    #[test]
    fn a_capture_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let id = {
            let mut q = Queue::open(dir.path()).unwrap();
            q.push(cap("one"), 100).unwrap()
        };
        let q = Queue::open(dir.path()).unwrap();
        assert_eq!(q.entries().len(), 1);
        assert_eq!(q.entries()[0].id, id);
        assert_eq!(q.entries()[0].capture.text, "one");
    }

    #[test]
    fn retry_keeps_the_entry_and_delays_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut q = Queue::open(dir.path()).unwrap();
        let id = q.push(cap("x"), 1000).unwrap();
        assert_eq!(q.due(1000).len(), 1);
        q.mark_retry(&id, 1000, "network").unwrap();
        assert!(q.due(1004).is_empty());
        assert_eq!(q.due(1005).len(), 1);
        q.mark_retry(&id, 1005, "network").unwrap();
        assert_eq!(q.entries()[0].attempts, 2);
        assert_eq!(q.entries()[0].next_attempt_at, 1015);
    }

    #[test]
    fn only_mark_sent_or_discard_remove_an_entry() {
        let dir = tempfile::tempdir().unwrap();
        let mut q = Queue::open(dir.path()).unwrap();
        let a = q.push(cap("a"), 1).unwrap();
        let b = q.push(cap("b"), 1).unwrap();
        q.mark_rejected(&a, "HTTP 422").unwrap();
        q.mark_retry(&b, 1, "network").unwrap();
        assert_eq!(q.entries().len(), 2);
        assert!(q.due(u64::MAX).iter().all(|e| e.id != a), "rejected entries are not retried automatically");
        q.requeue(&a, 50).unwrap();
        assert!(q.due(50).iter().any(|e| e.id == a), "requeued entry is due again");
        q.mark_sent(&a).unwrap();
        q.discard(&b).unwrap();
        assert!(q.entries().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn files_are_0600_and_dir_0700() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("niyyah");
        let mut q = Queue::open(&data).unwrap();
        q.push(cap("x"), 1).unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&data), 0o700);
        assert_eq!(mode(&data.join(QUEUE_FILE)), 0o600);
        assert!(!data.join("queue.tmp").exists(), "temp file is renamed away");
    }

    #[test]
    fn a_corrupt_file_is_kept_aside_not_deleted() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(QUEUE_FILE), b"{not json").unwrap();
        let q = Queue::open(dir.path()).unwrap();
        let aside = q.recovered_from().expect("recovery reported").to_path_buf();
        assert_eq!(fs::read(aside).unwrap(), b"{not json");
        assert!(q.entries().is_empty());
    }

    #[test]
    fn ids_are_unique_within_one_second() {
        let dir = tempfile::tempdir().unwrap();
        let mut q = Queue::open(dir.path()).unwrap();
        let a = q.push(cap("a"), 7).unwrap();
        let b = q.push(cap("b"), 7).unwrap();
        assert_ne!(a, b);
    }
}

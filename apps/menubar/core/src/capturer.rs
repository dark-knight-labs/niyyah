//! The one object the app shell talks to: settings, token, options cache, queue, flush.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::client::{Client, SendOutcome};
use crate::error::Error;
use crate::options::Options;
use crate::payload::Capture;
use crate::queue::{create_private_dir, write_private_atomic, Entry, Queue};
use crate::token::{Token, TokenStore};
use crate::url_guard::parse_base_url;

pub const SETTINGS_FILE: &str = "settings.json";
pub const OPTIONS_FILE: &str = "options.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    server_url: Option<String>,
}

/// What one `flush` did.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct FlushReport {
    pub sent: usize,
    /// Still queued after a transient failure (network, 5xx, 429).
    pub retrying: usize,
    /// Parked because the server refused them for good.
    pub rejected: usize,
    /// The token was refused (401/403): nothing more is sent until the user fixes it.
    pub auth_failed: bool,
    /// Another flush was already running.
    pub busy: bool,
    /// No server URL or no token yet: captures wait in the queue.
    pub not_configured: bool,
}

pub struct Capturer {
    dir: PathBuf,
    store: Box<dyn TokenStore>,
    settings: Mutex<Settings>,
    queue: Mutex<Queue>,
    /// Session cache of the options reply.
    options: Mutex<Option<Options>>,
    flush_lock: Mutex<()>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl Capturer {
    /// `dir` is the app data folder (created 0700). The token lives in `store`, never under `dir`.
    pub fn open(dir: &Path, store: Box<dyn TokenStore>) -> Result<Self, Error> {
        create_private_dir(dir)?;
        let settings = match fs::read(dir.join(SETTINGS_FILE)) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_default(),
            Err(_) => Settings::default(),
        };
        Ok(Self {
            dir: dir.to_path_buf(),
            store,
            settings: Mutex::new(settings),
            queue: Mutex::new(Queue::open(dir)?),
            options: Mutex::new(None),
            flush_lock: Mutex::new(()),
        })
    }

    // ---- settings -------------------------------------------------------------------------------------------

    pub fn server_url(&self) -> Option<String> {
        lock(&self.settings).server_url.clone()
    }

    /// Validate (https, or http to localhost) and save the server URL. Drops the options cache.
    pub fn set_server_url(&self, raw: &str) -> Result<String, Error> {
        let url = parse_base_url(raw)?.to_string().trim_end_matches('/').to_string();
        let mut s = lock(&self.settings);
        s.server_url = Some(url.clone());
        let bytes = serde_json::to_vec_pretty(&*s).map_err(|e| Error::Storage(e.to_string()))?;
        write_private_atomic(&self.dir.join(SETTINGS_FILE), &bytes)?;
        *lock(&self.options) = None;
        Ok(url)
    }

    // ---- token ----------------------------------------------------------------------------------------------

    /// Validate and hand the token to the store. The caller clears its paste field afterwards.
    pub fn set_token(&self, raw: &str) -> Result<(), Error> {
        let token = Token::new(raw)?;
        self.store.set(&token)?;
        *lock(&self.options) = None;
        Ok(())
    }

    pub fn has_token(&self) -> Result<bool, Error> {
        Ok(self.store.get()?.is_some())
    }

    pub fn clear_token(&self) -> Result<(), Error> {
        self.store.delete()
    }

    // ---- queue ----------------------------------------------------------------------------------------------

    /// Validate and persist a capture; returns its id once it is on disk. Does no network I/O, so the popover can close at once.
    pub fn submit(&self, capture: Capture, now: u64) -> Result<String, Error> {
        let capture = capture.validated()?;
        let id = lock(&self.queue).push(capture, now)?;
        log::info!("capture {id} queued");
        Ok(id)
    }

    pub fn pending(&self) -> Vec<Entry> {
        lock(&self.queue).entries().to_vec()
    }

    pub fn next_due_at(&self) -> Option<u64> {
        lock(&self.queue).next_due_at()
    }

    pub fn requeue(&self, id: &str, now: u64) -> Result<(), Error> {
        lock(&self.queue).requeue(id, now)
    }

    pub fn discard(&self, id: &str) -> Result<(), Error> {
        lock(&self.queue).discard(id)
    }

    /// Send every due capture, oldest first. Stops at the first transient or auth failure so a
    /// dead network costs one timeout, not one per capture. Safe to call from a timer thread.
    pub fn flush(&self, now: u64) -> FlushReport {
        let mut report = FlushReport::default();
        let Ok(_running) = self.flush_lock.try_lock() else {
            report.busy = true;
            return report;
        };
        let (Some(url), Ok(Some(token))) = (self.server_url(), self.store.get()) else {
            report.not_configured = true;
            return report;
        };
        let client = match Client::new(&url) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("not sending: {e}");
                report.not_configured = true;
                return report;
            }
        };

        let due = lock(&self.queue).due(now);
        for entry in due {
            let outcome = client.post_item(&token, &entry.capture.to_item());
            let mut q = lock(&self.queue);
            let saved = match &outcome {
                SendOutcome::Created => {
                    report.sent += 1;
                    log::info!("capture {} sent", entry.id);
                    q.mark_sent(&entry.id)
                }
                SendOutcome::Retry(why) => {
                    report.retrying += 1;
                    log::warn!("capture {} will be retried: {why}", entry.id);
                    q.mark_retry(&entry.id, now, why)
                }
                SendOutcome::AuthFailed(code) => {
                    report.auth_failed = true;
                    log::warn!("capture {} not accepted: token refused (HTTP {code})", entry.id);
                    q.mark_retry(&entry.id, now, &format!("the token was refused (HTTP {code}); check Settings"))
                }
                SendOutcome::Rejected(why) => {
                    report.rejected += 1;
                    log::warn!("capture {} rejected: {why}", entry.id);
                    q.mark_rejected(&entry.id, why)
                }
            };
            if let Err(e) = saved {
                // The in-memory state is ahead of the disk; the next flush resends rather than loses.
                log::error!("could not save queue state: {e}");
            }
            if matches!(outcome, SendOutcome::Retry(_) | SendOutcome::AuthFailed(_)) {
                break;
            }
        }
        report
    }

    // ---- options --------------------------------------------------------------------------------------------

    /// Block and product choices. The session cache answers unless `refresh`; on a failed fetch the last
    /// good copy on disk is used so a capture can still be filed offline.
    pub fn options(&self, refresh: bool) -> Result<Options, Error> {
        if !refresh {
            if let Some(o) = lock(&self.options).clone() {
                return Ok(o);
            }
        }
        match self.fetch_options() {
            Ok(o) => {
                if let Ok(bytes) = serde_json::to_vec_pretty(&o) {
                    if let Err(e) = write_private_atomic(&self.dir.join(OPTIONS_FILE), &bytes) {
                        log::warn!("could not save the options copy: {e}");
                    }
                }
                *lock(&self.options) = Some(o.clone());
                Ok(o)
            }
            Err(e) => match self.options_from_disk() {
                Some(o) => {
                    log::warn!("using saved options: {e}");
                    *lock(&self.options) = Some(o.clone());
                    Ok(o)
                }
                None => Err(e),
            },
        }
    }

    fn fetch_options(&self) -> Result<Options, Error> {
        let url = self.server_url().ok_or(Error::NoServer)?;
        let token = self.store.get()?.ok_or(Error::NoToken)?;
        Client::new(&url)?.get_options(&token)
    }

    fn options_from_disk(&self) -> Option<Options> {
        serde_json::from_slice(&fs::read(self.dir.join(OPTIONS_FILE)).ok()?).ok()
    }
}

//! Awake-time counter for the task timer. The rule (what counts as awake) is `niyyah_capture_core::awake`;
//! this is the sampler thread and the macOS display-power query.
//!
//! Ported from Next Up (`awake_clock.rs`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use niyyah_capture_core::awake::WakeSamples;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Default)]
pub struct AwakeClock(Arc<AtomicU64>);

impl AwakeClock {
    pub fn start(&self) {
        let total = Arc::clone(&self.0);
        thread::spawn(move || {
            let mut previous = (Instant::now(), SystemTime::now(), display_awake());
            let mut wake = WakeSamples::default();
            loop {
                thread::sleep(SAMPLE_INTERVAL);
                let current = (Instant::now(), SystemTime::now(), display_awake());
                let elapsed = current.0 - previous.0;
                let wall = current.1.duration_since(previous.1).unwrap_or(elapsed);
                let credited = wake.record(elapsed, wall, previous.2 && current.2);
                total.fetch_add(credited.as_millis() as u64, Ordering::Relaxed);
                previous = current;
            }
        });
    }

    pub fn millis(&self) -> u64 {
        self.0.load(Ordering::Relaxed)
    }
}

#[cfg(target_os = "macos")]
fn display_awake() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayIsAsleep(display: u32) -> u32;
    }
    // Core Graphics allows display state queries from background threads.
    unsafe { CGDisplayIsAsleep(CGMainDisplayID()) == 0 }
}

#[cfg(not(target_os = "macos"))]
fn display_awake() -> bool {
    true
}

//! Awake time for the per-task timer: wall-clock time minus sleep, display-off time and the brief
//! maintenance wakes some systems do ("dark wakes"). The sampler thread and the macOS display query
//! live in the shell; the rule is here so it is tested on Linux.
//!
//! Ported from Next Up (`awake_clock.rs`).

use std::time::Duration;

/// A sample longer than this means the machine slept during it.
pub const MAX_SAMPLE: Duration = Duration::from_millis(2500);
/// Without display power info, time after a wake counts only once this much has passed.
const WAKE_SETTLE: Duration = Duration::from_secs(15);

#[derive(Default)]
pub struct WakeSamples {
    pending: Option<Duration>,
}

impl WakeSamples {
    /// How much of this sample counts. `elapsed` is monotonic time, `wall` is wall-clock time.
    pub fn record(&mut self, elapsed: Duration, wall: Duration, display_awake: bool) -> Duration {
        if !display_awake || elapsed > MAX_SAMPLE || wall > MAX_SAMPLE {
            self.pending = Some(Duration::ZERO);
            return Duration::ZERO;
        }
        if let Some(pending) = &mut self.pending {
            *pending += elapsed;
            // Filter brief maintenance wakes on systems where display power is unavailable.
            if !cfg!(target_os = "macos") && *pending < WAKE_SETTLE {
                return Duration::ZERO;
            }
            self.pending = None;
        }
        elapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: Duration = Duration::from_secs(1);

    #[test]
    fn counts_steady_time() {
        let mut wake = WakeSamples::default();
        for _ in 0..10 {
            assert_eq!(wake.record(SECOND, SECOND, true), SECOND);
        }
    }

    #[test]
    fn drops_sleep_and_brief_maintenance_wakes() {
        let mut wake = WakeSamples::default();
        let sleep = Duration::from_secs(8 * 3600);
        assert_eq!(wake.record(SECOND, SECOND, true), SECOND);
        assert_eq!(wake.record(SECOND, sleep, true), Duration::ZERO);
        for _ in 0..5 {
            assert_eq!(wake.record(SECOND, SECOND, false), Duration::ZERO);
        }
        assert_eq!(wake.record(sleep, sleep, true), Duration::ZERO);
        if !cfg!(target_os = "macos") {
            for _ in 0..14 {
                assert_eq!(wake.record(SECOND, SECOND, true), Duration::ZERO);
            }
        }
        assert_eq!(wake.record(SECOND, SECOND, true), SECOND);
    }

    #[test]
    fn display_off_time_never_counts() {
        let mut wake = WakeSamples::default();
        for _ in 0..30 {
            assert_eq!(wake.record(SECOND, SECOND, false), Duration::ZERO);
        }
    }

    #[test]
    fn a_wall_clock_jump_is_not_credited() {
        let mut wake = WakeSamples::default();
        // Monotonic clock paused (sleep) but wall clock moved: the sample is dropped.
        assert_eq!(wake.record(SECOND, Duration::from_secs(600), true), Duration::ZERO);
    }
}

//! Focus-switch reminder rules: when does leaving a window or switching a browser tab count as
//! "you may have drifted off your task". The OS watchers live in the shell; the decisions are here.
//!
//! Ported from Next Up (`focus_switch.rs`, `focus_switch/browser.rs`).

/// Remembers the last two windows. Moving between those two is not a drift; opening a third is.
#[derive(Default)]
pub struct RecentWindows {
    current: Option<usize>,
    previous: Option<usize>,
}

impl RecentWindows {
    /// Record the foreground window. True when it is new (not the current or previous one).
    pub fn visit(&mut self, next: usize) -> bool {
        if self.current == Some(next) {
            return false;
        }
        let is_new = self.current.is_some() && self.previous != Some(next);
        self.previous = self.current.replace(next);
        is_new
    }
}

/// The active tab of the front window of the work browser, as read by AppleScript.
#[derive(PartialEq, Eq, Debug)]
pub struct Tab {
    pid: i32,
    window: String,
    id: String,
}

impl Tab {
    /// Parse `"<window id>:<tab id>"` from osascript output.
    pub fn parse(pid: i32, output: &[u8]) -> Option<Self> {
        let (window, id) = std::str::from_utf8(output).ok()?.trim().split_once(':')?;
        if window.is_empty() || id.is_empty() {
            return None;
        }
        Some(Self { pid, window: window.to_owned(), id: id.to_owned() })
    }

    /// Same browser process and window, different tab.
    pub fn switched_from(&self, previous: &Self) -> bool {
        self.pid == previous.pid && self.window == previous.window && self.id != previous.id
    }
}

/// What the watcher saw this tick, relative to the window the user chose to stay on.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Observation {
    /// The chosen window (or its app, when titles are unavailable) is in front.
    OnTarget,
    /// This app (the panel or popover) is in front: neutral, so pausing the timer never counts as drifting.
    Own,
    /// Something else is in front.
    Away,
    /// The chosen window or its app no longer exists.
    Gone,
}

/// Where the user is relative to the chosen window.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FocusState {
    On,
    Away,
    Lost,
}

/// Debounces observations into state changes: away only after `grace` consecutive away ticks (a quick
/// Cmd-Tab and back is not a drift), lost at once, back on target at once.
pub struct FocusMonitor {
    state: FocusState,
    away_ticks: u32,
    grace: u32,
}

impl FocusMonitor {
    pub fn new(grace: u32) -> Self {
        Self { state: FocusState::On, away_ticks: 0, grace }
    }

    pub fn state(&self) -> FocusState {
        self.state
    }

    /// Back to "on target" for a newly chosen window.
    pub fn reset(&mut self) {
        self.state = FocusState::On;
        self.away_ticks = 0;
    }

    /// The new state when this observation changes it.
    pub fn observe(&mut self, seen: Observation) -> Option<FocusState> {
        let next = match seen {
            Observation::Own => return None,
            Observation::OnTarget => {
                self.away_ticks = 0;
                FocusState::On
            }
            Observation::Gone => FocusState::Lost,
            Observation::Away => {
                self.away_ticks += 1;
                match self.state {
                    FocusState::Lost => FocusState::Lost,
                    _ if self.away_ticks >= self.grace => FocusState::Away,
                    state => state,
                }
            }
        };
        (next != self.state).then(|| {
            self.state = next;
            next
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminds_only_when_leaving_the_current_pair() {
        let mut recent = RecentWindows::default();
        let reminders = [1, 1, 2, 1, 2, 2, 3, 2, 3, 1, 3].map(|window| recent.visit(window));
        assert_eq!(reminders, [false, false, true, false, false, false, true, false, false, true, false]);
    }

    #[test]
    fn first_window_never_reminds() {
        assert!(!RecentWindows::default().visit(7));
    }

    #[test]
    fn detects_only_a_different_tab_in_the_same_window() {
        let previous = Tab::parse(1, b"20:42\n").unwrap();
        assert!(Tab::parse(1, b"20:43").unwrap().switched_from(&previous));
        assert!(!Tab::parse(1, b"20:42").unwrap().switched_from(&previous));
        assert!(!Tab::parse(1, b"21:43").unwrap().switched_from(&previous));
        assert!(!Tab::parse(2, b"20:43").unwrap().switched_from(&previous));
    }

    #[test]
    fn unparseable_output_is_no_tab() {
        for bad in [&b""[..], b"\n", b"20", b":42", b"20:", b"\xff\xfe"] {
            assert!(Tab::parse(1, bad).is_none());
        }
    }

    #[test]
    fn away_needs_consecutive_ticks_and_back_is_immediate() {
        use Observation::*;
        let mut m = FocusMonitor::new(3);
        assert_eq!(m.observe(Away), None);
        assert_eq!(m.observe(Away), None);
        assert_eq!(m.observe(OnTarget), None, "a quick Cmd-Tab and back is not a drift");
        for _ in 0..2 {
            assert_eq!(m.observe(Away), None);
        }
        assert_eq!(m.observe(Away), Some(FocusState::Away));
        assert_eq!(m.observe(Away), None, "only the change is reported");
        assert_eq!(m.observe(OnTarget), Some(FocusState::On));
    }

    #[test]
    fn own_windows_are_neutral() {
        use Observation::*;
        let mut m = FocusMonitor::new(2);
        m.observe(Away);
        assert_eq!(m.observe(Own), None);
        assert_eq!(m.observe(Own), None);
        assert_eq!(m.observe(Away), Some(FocusState::Away), "own ticks did not reset or advance the count");
    }

    #[test]
    fn a_closed_window_is_lost_at_once_and_stays_lost_until_it_returns() {
        use Observation::*;
        let mut m = FocusMonitor::new(2);
        assert_eq!(m.observe(Gone), Some(FocusState::Lost));
        assert_eq!(m.observe(Away), None);
        assert_eq!(m.observe(Away), None);
        assert_eq!(m.state(), FocusState::Lost);
        assert_eq!(m.observe(OnTarget), Some(FocusState::On));
        m.observe(Gone);
        m.reset();
        assert_eq!(m.state(), FocusState::On);
    }
}

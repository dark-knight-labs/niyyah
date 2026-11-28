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

/// What the watcher saw this tick, relative to the focus session's windows.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Observation {
    /// The primary window (or its app, when titles are unavailable) is in front.
    Primary,
    /// An allowed (secondary) window is in front.
    Allowed,
    /// This app (the panel or popover) is in front: neutral, so pausing the timer never counts as drifting.
    Own,
    /// A window outside the set is in front.
    Other,
    /// The primary window or its app no longer exists.
    Gone,
}

/// Where the user is relative to the focus session's windows.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FocusState {
    Primary,
    Allowed,
    Away,
    Lost,
}

/// The only text allowed next to the tray icon: a timer such as `12:34` or `1:02:03`. Anything else (a window
/// title, task text) is dropped, so a bug or a hostile caller in the web layer cannot put a title in the menu bar.
pub fn tray_label(title: &str) -> String {
    if title.len() <= 8 && title.chars().all(|c| c.is_ascii_digit() || c == ':') {
        title.to_string()
    } else {
        String::new()
    }
}

/// Debounces observations into state changes: away only after `grace` consecutive "other" ticks (a quick
/// Cmd-Tab and back is not a drift); primary and allowed apply at once; a closed primary is lost at once.
pub struct FocusMonitor {
    state: FocusState,
    away_ticks: u32,
    grace: u32,
}

impl FocusMonitor {
    pub fn new(grace: u32) -> Self {
        Self { state: FocusState::Primary, away_ticks: 0, grace }
    }

    pub fn state(&self) -> FocusState {
        self.state
    }

    /// Back to "primary" for a newly started session or a changed primary window.
    pub fn reset(&mut self) {
        self.state = FocusState::Primary;
        self.away_ticks = 0;
    }

    /// The new state when this observation changes it.
    pub fn observe(&mut self, seen: Observation) -> Option<FocusState> {
        let next = match seen {
            Observation::Own => return None,
            Observation::Primary => {
                self.away_ticks = 0;
                FocusState::Primary
            }
            Observation::Allowed => {
                self.away_ticks = 0;
                FocusState::Allowed
            }
            Observation::Gone => FocusState::Lost,
            Observation::Other => {
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

/// How a focus state looks in the tray icon and the popup. One table, used by the shell and mirrored (and
/// tested against) by the web layer's `presentFor`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrayLook {
    /// Calm template icon.
    Calm,
    /// Subtle tint: on an allowed secondary window.
    Tint,
    /// Amber icon that blinks (the nudge).
    Blink,
    /// Amber icon, steady (the nudge under Reduce Motion).
    Steady,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Presentation {
    pub tray: TrayLook,
    /// Shake the popup (only the nudge does).
    pub shake: bool,
}

pub fn presentation(state: FocusState, reduce_motion: bool) -> Presentation {
    match state {
        FocusState::Primary => Presentation { tray: TrayLook::Calm, shake: false },
        FocusState::Allowed => Presentation { tray: TrayLook::Tint, shake: false },
        FocusState::Away | FocusState::Lost => {
            Presentation { tray: if reduce_motion { TrayLook::Steady } else { TrayLook::Blink }, shake: !reduce_motion }
        }
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
    fn away_needs_consecutive_other_ticks_and_back_is_immediate() {
        use Observation::*;
        let mut m = FocusMonitor::new(3);
        assert_eq!(m.observe(Other), None);
        assert_eq!(m.observe(Other), None);
        assert_eq!(m.observe(Primary), None, "a quick Cmd-Tab and back is not a drift");
        for _ in 0..2 {
            assert_eq!(m.observe(Other), None);
        }
        assert_eq!(m.observe(Other), Some(FocusState::Away));
        assert_eq!(m.observe(Other), None, "only the change is reported");
        assert_eq!(m.observe(Primary), Some(FocusState::Primary));
    }

    #[test]
    fn allowed_windows_never_nudge() {
        use Observation::*;
        let mut m = FocusMonitor::new(2);
        assert_eq!(m.observe(Allowed), Some(FocusState::Allowed));
        for _ in 0..10 {
            assert_eq!(m.observe(Allowed), None, "staying on a secondary window is quiet");
        }
        assert_eq!(m.observe(Primary), Some(FocusState::Primary));
        assert_eq!(m.observe(Allowed), Some(FocusState::Allowed));
        assert_eq!(m.observe(Other), None);
        assert_eq!(m.observe(Other), Some(FocusState::Away), "only a window outside the set nudges");
        assert_eq!(m.observe(Allowed), Some(FocusState::Allowed), "back to a secondary clears the nudge");
    }

    #[test]
    fn own_windows_are_neutral() {
        use Observation::*;
        let mut m = FocusMonitor::new(2);
        m.observe(Other);
        assert_eq!(m.observe(Own), None);
        assert_eq!(m.observe(Own), None);
        assert_eq!(m.observe(Other), Some(FocusState::Away), "own ticks did not reset or advance the count");
    }

    #[test]
    fn a_closed_primary_is_lost_at_once_and_stays_lost_until_it_returns() {
        use Observation::*;
        let mut m = FocusMonitor::new(2);
        assert_eq!(m.observe(Gone), Some(FocusState::Lost));
        assert_eq!(m.observe(Other), None);
        assert_eq!(m.observe(Other), None);
        assert_eq!(m.state(), FocusState::Lost);
        assert_eq!(m.observe(Primary), Some(FocusState::Primary));
        m.observe(Gone);
        m.reset();
        assert_eq!(m.state(), FocusState::Primary);
    }

    #[test]
    fn the_tray_label_is_a_timer_or_nothing() {
        for ok in ["", "0:00", "12:34", "1:02:03", "00:00:00"] {
            assert_eq!(tray_label(ok), ok);
        }
        for bad in ["chorki.net invalid response", "Safari", "12:34 · Task", "123456789", "12:34\n", "٣:٠٠", "1.5"] {
            assert_eq!(tray_label(bad), "", "{bad:?}");
        }
    }

    #[test]
    fn state_to_tray_and_popup_mapping() {
        use FocusState::*;
        assert_eq!(presentation(Primary, false), Presentation { tray: TrayLook::Calm, shake: false });
        assert_eq!(presentation(Allowed, false), Presentation { tray: TrayLook::Tint, shake: false });
        assert_eq!(presentation(Away, false), Presentation { tray: TrayLook::Blink, shake: true });
        assert_eq!(presentation(Lost, false), Presentation { tray: TrayLook::Blink, shake: true });
    }

    #[test]
    fn reduce_motion_means_static_highlights_and_no_shake() {
        use FocusState::*;
        for state in [Primary, Allowed, Away, Lost] {
            let p = presentation(state, true);
            assert_ne!(p.tray, TrayLook::Blink, "{state:?} must not blink");
            assert!(!p.shake, "{state:?} must not shake");
        }
        assert_eq!(presentation(Away, true).tray, TrayLook::Steady);
        assert_eq!(presentation(Allowed, true).tray, TrayLook::Tint);
    }
}

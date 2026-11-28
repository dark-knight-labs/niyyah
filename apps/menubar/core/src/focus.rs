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
}

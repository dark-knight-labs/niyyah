//! Browser-tab watcher (macOS): asks the work browser which tab is active, through AppleScript, and
//! pings the panel when the tab changes inside the same window. Needs the Automation permission.
//!
//! Ported from Next Up (`focus_switch/browser.rs`). The tab comparison is `niyyah_capture_core::focus::Tab`.

use std::process::Command;
use std::thread;
use std::time::Duration;

use niyyah_capture_core::focus::Tab;
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;

use super::{BrowserPreference, Notify, WorkBrowser};

const ACTIVE_TAB: &str = r#"
tell application "__BROWSER_PATH__"
    with timeout of 2 seconds
        if not running then return ""
        if (count of windows) is 0 then return ""
        set browserWindow to front window
        return ((id of browserWindow) as text) & ":" & ((__TAB__ of browserWindow) as text)
    end timeout
end tell
"#;

impl WorkBrowser {
    fn bundle_id(self) -> &'static str {
        match self {
            Self::Chrome => "com.google.Chrome",
            Self::Safari => "com.apple.Safari",
        }
    }

    fn tab_expression(self) -> &'static str {
        match self {
            Self::Chrome => "id of active tab",
            Self::Safari => "index of current tab",
        }
    }
}

fn foreground_browser(browser: WorkBrowser) -> Option<(i32, String)> {
    autoreleasepool(|_| {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let bundle = app.bundleIdentifier()?;
        if bundle.to_string() != browser.bundle_id() {
            return None;
        }
        Some((app.processIdentifier(), app.bundleURL()?.path()?.to_string()))
    })
}

pub(super) fn watch(notify: Notify, preference: BrowserPreference) {
    let mut previous = None;
    loop {
        let mut current = None;
        let mut wait = Duration::from_millis(650);
        let browser = preference.0.lock().ok().and_then(|guard| *guard);
        if let Some((browser, (pid, path))) =
            browser.and_then(|browser| foreground_browser(browser).map(|app| (browser, app)))
        {
            let path = path.replace('\\', "\\\\").replace('"', "\\\"");
            let script = ACTIVE_TAB.replace("__TAB__", browser.tab_expression()).replace("__BROWSER_PATH__", &path);
            match Command::new("/usr/bin/osascript").args(["-e", &script]).output() {
                Ok(result) if result.status.success() => {
                    if foreground_browser(browser).is_some_and(|(current_pid, _)| current_pid == pid) {
                        current = Tab::parse(pid, &result.stdout);
                    }
                }
                // Retry after a pause so a change in Automation settings takes effect.
                _ => wait = Duration::from_secs(15),
            }
        }
        if current.as_ref().zip(previous.as_ref()).is_some_and(|(tab, prior): (&Tab, &Tab)| tab.switched_from(prior)) {
            notify();
        }
        previous = current;
        thread::sleep(wait);
    }
}

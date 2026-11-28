//! Focus window: pick one window (app + title) to stay on, and watch whether you are still on it.
//!
//! Permissions, least first:
//! - the frontmost app (NSWorkspace) and the list of running apps need none;
//! - window titles of other apps need **Accessibility** (AXUIElement). Without it the picker lists apps
//!   only, and the watch works at app level;
//! - Screen Recording is never needed: window titles are read through Accessibility, not CGWindowList.
//!
//! The decisions (debounce, lost window) are `niyyah_capture_core::focus::FocusMonitor`; this file is the
//! macOS plumbing. Written for macOS; other systems get empty stubs.

use std::sync::{Arc, Mutex};

use niyyah_capture_core::focus::{FocusMonitor, Observation};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct Target {
    pub app: String,
    pub bundle_id: String,
    /// Empty = any window of the app.
    #[serde(default)]
    pub title: String,
}

#[derive(Serialize)]
pub struct WindowInfo {
    pub app: String,
    pub bundle_id: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct WindowList {
    /// Accessibility granted: titles are available.
    pub trusted: bool,
    pub windows: Vec<WindowInfo>,
}

pub struct Watch {
    /// The session's primary window.
    primary: Option<Target>,
    /// Extra windows that are fine to be on (secondary).
    allowed: Vec<Target>,
    monitor: FocusMonitor,
}

#[derive(Clone)]
pub struct WatchState(Arc<Mutex<Watch>>);

impl Default for WatchState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Watch { primary: None, allowed: Vec::new(), monitor: FocusMonitor::new(3) })))
    }
}

#[tauri::command]
pub fn list_focus_windows() -> WindowList {
    platform::list()
}

/// Ask macOS for Accessibility (shows the system prompt once). Returns whether it is granted now.
#[tauri::command]
pub fn request_accessibility() -> bool {
    platform::request_trust()
}

/// Set (or clear) the session's windows: one primary, any number of allowed. Window names stay in this
/// process and on this Mac; nothing here sends them anywhere.
#[tauri::command]
pub fn set_focus_targets(primary: Option<Target>, allowed: Vec<Target>, state: State<'_, WatchState>) {
    if let Ok(mut watch) = state.0.lock() {
        watch.primary = primary;
        watch.allowed = allowed;
        watch.monitor.reset();
    }
}

pub fn start(window: WebviewWindow, state: WatchState) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let Ok(mut watch) = state.0.lock() else { continue };
        let Some(primary) = watch.primary.clone() else { continue };
        let seen = classify(&primary, &watch.allowed);
        if let Some(changed) = watch.monitor.observe(seen) {
            if let Ok(detail) = serde_json::to_string(&changed) {
                let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('focus-state', {{ detail: {detail} }}))"));
            }
        }
    });
}

/// Primary, allowed, other, own or gone: what is in front relative to the session's windows.
fn classify(primary: &Target, allowed: &[Target]) -> Observation {
    match platform::observe(primary) {
        // Own and Gone are about the primary alone: our own windows are neutral, a closed primary is lost.
        Observation::Own => Observation::Own,
        Observation::Gone => Observation::Gone,
        Observation::Primary => Observation::Primary,
        _ if allowed.iter().any(|t| platform::observe(t) == Observation::Primary) => Observation::Allowed,
        _ => Observation::Other,
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, c_void, CString};

    use niyyah_capture_core::focus::Observation;
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};

    use super::{Target, WindowInfo, WindowList};

    type Ref = *const c_void;
    const UTF8: u32 = 0x0800_0100;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: Ref) -> u8;
        fn AXUIElementCreateApplication(pid: i32) -> Ref;
        fn AXUIElementCopyAttributeValue(element: Ref, attribute: Ref, value: *mut Ref) -> i32;
        static kAXTrustedCheckOptionPrompt: Ref;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(options: u32, relative_to: u32) -> Ref;
        static kCGWindowLayer: Ref;
        static kCGWindowOwnerPID: Ref;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: Ref, c: *const c_char, enc: u32) -> Ref;
        fn CFStringGetCString(s: Ref, buf: *mut c_char, size: isize, enc: u32) -> u8;
        fn CFStringGetLength(s: Ref) -> isize;
        fn CFStringGetMaximumSizeForEncoding(len: isize, enc: u32) -> isize;
        fn CFStringGetTypeID() -> usize;
        fn CFGetTypeID(v: Ref) -> usize;
        fn CFArrayGetCount(a: Ref) -> isize;
        fn CFArrayGetValueAtIndex(a: Ref, i: isize) -> Ref;
        fn CFDictionaryGetValue(d: Ref, key: Ref) -> Ref;
        fn CFNumberGetValue(n: Ref, kind: isize, out: *mut i64) -> u8;
        fn CFDictionaryCreate(alloc: Ref, keys: *const Ref, values: *const Ref, n: isize, kcb: *const c_void, vcb: *const c_void) -> Ref;
        fn CFRelease(v: Ref);
        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;
        static kCFBooleanTrue: Ref;
    }

    /// An owned CF object, released on drop.
    struct Cf(Ref);
    impl Drop for Cf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    fn cfstr(text: &str) -> Cf {
        let c = CString::new(text).unwrap_or_default();
        Cf(unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) })
    }

    fn string_of(value: Ref) -> Option<String> {
        unsafe {
            if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
                return None;
            }
            let size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(value), UTF8) + 1;
            let mut buf = vec![0u8; size.max(1) as usize];
            if CFStringGetCString(value, buf.as_mut_ptr() as *mut c_char, size, UTF8) == 0 {
                return None;
            }
            let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
            String::from_utf8(buf[..end].to_vec()).ok()
        }
    }

    fn attribute(element: &Cf, name: &str) -> Option<Cf> {
        let key = cfstr(name);
        let mut value: Ref = std::ptr::null();
        let status = unsafe { AXUIElementCopyAttributeValue(element.0, key.0, &mut value) };
        (status == 0 && !value.is_null()).then_some(Cf(value))
    }

    fn app_element(pid: i32) -> Cf {
        Cf(unsafe { AXUIElementCreateApplication(pid) })
    }

    fn title_of(window: &Cf) -> String {
        attribute(window, "AXTitle").and_then(|t| string_of(t.0)).unwrap_or_default()
    }

    /// Titles of every window of the app (also minimised ones). Needs Accessibility.
    fn titles(pid: i32) -> Vec<String> {
        let app = app_element(pid);
        let Some(list) = attribute(&app, "AXWindows") else { return Vec::new() };
        let mut out = Vec::new();
        unsafe {
            for i in 0..CFArrayGetCount(list.0) {
                let window = CFArrayGetValueAtIndex(list.0, i);
                if window.is_null() {
                    continue;
                }
                // The array owns the element: borrow it for the read, never release it.
                let borrowed = Cf(window);
                let title = attribute(&borrowed, "AXTitle").and_then(|t| string_of(t.0));
                std::mem::forget(borrowed);
                if let Some(title) = title {
                    out.push(title);
                }
            }
        }
        out
    }

    fn focused_title(pid: i32) -> Option<String> {
        let app = app_element(pid);
        let window = attribute(&app, "AXFocusedWindow")?;
        Some(title_of(&window))
    }

    fn trusted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    pub fn request_trust() -> bool {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanTrue];
            let options = Cf(CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const u8 as *const c_void,
                &kCFTypeDictionaryValueCallBacks as *const u8 as *const c_void,
            ));
            AXIsProcessTrustedWithOptions(options.0) != 0
        }
    }

    fn bundle_of(app: &NSRunningApplication) -> Option<String> {
        app.bundleIdentifier().map(|b| b.to_string())
    }

    /// pids of apps with an on-screen, normal-layer window, front to back.
    fn visible_pids() -> Vec<i32> {
        let mut pids = Vec::new();
        unsafe {
            let windows = Cf(CGWindowListCopyWindowInfo(1 | 16, 0));
            if windows.0.is_null() {
                return pids;
            }
            for i in 0..CFArrayGetCount(windows.0) {
                let w = CFArrayGetValueAtIndex(windows.0, i);
                let number = |key: Ref| {
                    let mut v = 0i64;
                    let n = CFDictionaryGetValue(w, key);
                    (!n.is_null() && CFNumberGetValue(n, 4, &mut v) != 0).then_some(v)
                };
                if number(kCGWindowLayer) != Some(0) {
                    continue;
                }
                if let Some(pid) = number(kCGWindowOwnerPID) {
                    let pid = pid as i32;
                    if !pids.contains(&pid) && pid as u32 != std::process::id() {
                        pids.push(pid);
                    }
                }
            }
        }
        pids
    }

    pub fn list() -> WindowList {
        let trusted = trusted();
        let mut windows = Vec::new();
        autoreleasepool(|_| {
            for pid in visible_pids() {
                let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else { continue };
                let (Some(bundle_id), Some(name)) = (bundle_of(&app), app.localizedName().map(|n| n.to_string())) else { continue };
                let mut found = if trusted { titles(pid) } else { Vec::new() };
                found.retain(|t| !t.is_empty());
                if found.is_empty() {
                    windows.push(WindowInfo { app: name, bundle_id, title: String::new() });
                } else {
                    for title in found {
                        windows.push(WindowInfo { app: name.clone(), bundle_id: bundle_id.clone(), title });
                    }
                }
            }
        });
        WindowList { trusted, windows }
    }

    pub fn observe(target: &Target) -> Observation {
        autoreleasepool(|_| {
            let workspace = NSWorkspace::sharedWorkspace();
            let running: Vec<i32> = workspace
                .runningApplications()
                .iter()
                .filter(|a| bundle_of(a).as_deref() == Some(target.bundle_id.as_str()))
                .map(|a| a.processIdentifier())
                .collect();
            if running.is_empty() {
                return Observation::Gone;
            }
            let Some(front) = workspace.frontmostApplication() else { return Observation::Other };
            let front_pid = front.processIdentifier();
            if front_pid as u32 == std::process::id() {
                return Observation::Own;
            }
            let by_title = !target.title.is_empty() && trusted();
            if running.contains(&front_pid) {
                if !by_title {
                    return Observation::Primary;
                }
                if focused_title(front_pid).as_deref() == Some(target.title.as_str()) {
                    return Observation::Primary;
                }
                // Another window of the same app is in front: away, unless the chosen one was closed.
                return if titles(front_pid).contains(&target.title) { Observation::Other } else { Observation::Gone };
            }
            if by_title && !running.iter().any(|pid| titles(*pid).contains(&target.title)) {
                return Observation::Gone;
            }
            Observation::Other
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use niyyah_capture_core::focus::Observation;

    use super::{Target, WindowList};

    pub fn list() -> WindowList {
        WindowList { trusted: false, windows: Vec::new() }
    }
    pub fn request_trust() -> bool {
        false
    }
    pub fn observe(_: &Target) -> Observation {
        Observation::Own
    }
}

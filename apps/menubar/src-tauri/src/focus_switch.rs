//! Focus-switch reminder: while a task runs, leaving your window (or switching tab in the work
//! browser) flashes the task's name over the screen and pulses it in the panel.
//!
//! Ported from Next Up (`focus_switch.rs`), macOS only. The when-to-remind rules and their tests are
//! `niyyah_capture_core::focus`; this file is the OS plumbing (window list, overlay window).

use std::sync::{Arc, Mutex};

use tauri::{Manager, WebviewWindow};

#[cfg(target_os = "macos")]
mod browser;

#[derive(Clone, Copy, PartialEq, Eq)]
enum WorkBrowser {
    Chrome,
    Safari,
}

#[derive(Clone, Default)]
pub struct BrowserPreference(Arc<Mutex<Option<WorkBrowser>>>);

#[tauri::command]
pub fn set_work_browser(browser: &str, preference: tauri::State<'_, BrowserPreference>) {
    let selected = match browser {
        "chrome" => Some(WorkBrowser::Chrome),
        "safari" => Some(WorkBrowser::Safari),
        _ => None,
    };
    if let Ok(mut current) = preference.0.lock() {
        *current = selected;
    }
}

type Notify = Arc<dyn Fn() + Send + Sync>;

#[cfg(target_os = "macos")]
pub fn start(window: WebviewWindow) {
    use std::thread;
    use std::time::{Duration, Instant};

    let preference = window.state::<BrowserPreference>().inner().clone();
    let window_switch: Notify = Arc::new({
        let window = window.clone();
        move || {
            let _ = window.eval("window.dispatchEvent(new Event('desktop-window-switch'))");
        }
    });
    let last_pulse = Mutex::new(None::<Instant>);
    let notify: Notify = Arc::new(move || {
        let Ok(mut last) = last_pulse.lock() else {
            return;
        };
        let now = Instant::now();
        if last.is_some_and(|time| now.duration_since(time) < Duration::from_millis(750)) {
            return;
        }
        *last = Some(now);
        let _ = window.eval("window.dispatchEvent(new Event('desktop-focus-switch'))");
    });
    thread::spawn(move || browser::watch(notify, preference));
    thread::spawn(move || watch_windows(window_switch));
}

#[cfg(not(target_os = "macos"))]
pub fn start(_window: WebviewWindow) {}

pub fn create_overlay(app: &tauri::App) -> tauri::Result<()> {
    let overlay = tauri::WebviewWindowBuilder::new(app, "task-reminder", tauri::WebviewUrl::App("reminder.html".into()))
        .visible(false)
        .focused(false)
        .focusable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()?;
    if let Err(error) = overlay.set_ignore_cursor_events(true) {
        let _ = overlay.destroy();
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn show_task_reminder(window: WebviewWindow, title: String) -> Result<(), String> {
    let Some(overlay) = window.get_webview_window("task-reminder") else {
        return Ok(());
    };
    let monitor = window
        .cursor_position()
        .ok()
        .and_then(|point| window.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = area.size.width.min((1100.0 * scale) as u32);
        let height = area.size.height.min((300.0 * scale) as u32);
        overlay.set_size(tauri::PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
        overlay
            .set_position(tauri::PhysicalPosition::new(
                area.position.x + ((area.size.width - width) / 2) as i32,
                area.position.y + ((area.size.height - height) / 2) as i32,
            ))
            .map_err(|e| e.to_string())?;
    }
    // The title is a task name: pass it as a JSON string, never spliced into script text.
    let title = serde_json::to_string(&title).map_err(|e| e.to_string())?;
    overlay.eval(format!("window.showReminder({title})")).map_err(|e| e.to_string())?;
    overlay.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_task_reminder(window: WebviewWindow) -> Result<(), String> {
    if window.label() == "task-reminder" {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn watch_windows(notify: Notify) {
    use niyyah_capture_core::focus::RecentWindows;
    use std::thread;
    use std::time::Duration;

    let mut recent = RecentWindows::default();
    loop {
        if let Some(current) = foreground_window() {
            if recent.visit(current) {
                notify();
            }
        }
        thread::sleep(Duration::from_millis(350));
    }
}

#[cfg(target_os = "macos")]
fn foreground_window() -> Option<usize> {
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSWorkspace;
    use std::ffi::c_void;
    type Ref = *const c_void;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(options: u32, relative_to: u32) -> Ref;
        static kCGWindowLayer: Ref;
        static kCGWindowNumber: Ref;
        static kCGWindowOwnerPID: Ref;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: Ref) -> isize;
        fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
        fn CFDictionaryGetValue(dictionary: Ref, key: Ref) -> Ref;
        fn CFNumberGetValue(number: Ref, number_type: isize, value: *mut i64) -> u8;
        fn CFRelease(value: Ref);
    }
    fn number(dictionary: Ref, key: Ref) -> Option<i64> {
        let mut value = 0;
        // kCFNumberSInt64Type
        unsafe {
            let number = CFDictionaryGetValue(dictionary, key);
            (!number.is_null() && CFNumberGetValue(number, 4, &mut value) != 0).then_some(value)
        }
    }
    let active_pid = autoreleasepool(|_| Some(NSWorkspace::sharedWorkspace().frontmostApplication()?.processIdentifier()))?;
    if active_pid as u32 == std::process::id() {
        return None;
    }
    unsafe {
        // On-screen windows, front to back, excluding desktop elements.
        let windows = CGWindowListCopyWindowInfo(1 | 16, 0);
        if windows.is_null() {
            return None;
        }
        let front = (0..CFArrayGetCount(windows)).find_map(|index| {
            let window = CFArrayGetValueAtIndex(windows, index);
            if number(window, kCGWindowLayer)? != 0 || number(window, kCGWindowOwnerPID)? != i64::from(active_pid) {
                return None;
            }
            number(window, kCGWindowNumber).map(|id| id as usize)
        });
        CFRelease(windows);
        front
    }
}

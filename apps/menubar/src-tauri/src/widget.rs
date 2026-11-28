//! Commands for the focus panel (the "main" window): placement, pinning, check-in timer, task shortcuts,
//! opening task links, and the local task file.
//!
//! Ported from Next Up (`main.rs`, `task_store.rs`), macOS first.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use std::sync::Arc;
use std::time::Duration;

use niyyah_capture_core::link::validate_web_link;
use niyyah_capture_core::{FocusStore, TaskStore};
use serde_json::Value;
use tauri::Rect;
use tauri::{AppHandle, Manager, LogicalSize, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::awake_clock::AwakeClock;

/// Reserved for the quick-capture popover (Option+Command+N).
pub fn capture_shortcut() -> Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers};
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::KeyN)
}

#[tauri::command]
pub fn awake_millis(clock: State<'_, AwakeClock>) -> u64 {
    clock.millis()
}

#[tauri::command]
pub fn load_tasks(store: State<'_, TaskStore>) -> Result<Option<Vec<Value>>, String> {
    store.load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_tasks(store: State<'_, TaskStore>, tasks: Vec<Value>) -> Result<(), String> {
    store.save(&tasks).map_err(|e| e.to_string())
}

/// Open a task link in the default browser. The link is re-validated here: the web layer is not trusted.
#[tauri::command]
pub async fn open_task_link(url: String) -> Result<(), String> {
    let url = validate_web_link(&url).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let status = std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" })
            .arg(url.as_str())
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("The browser launcher returned {status}."))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The panel is a menu-bar popup: it opens under the tray icon and, unless pinned, closes when you click
/// elsewhere.
#[derive(Default)]
pub struct PanelState {
    /// "Stay open when I click elsewhere".
    pub pinned: AtomicBool,
    /// When the panel was last hidden by a blur, so the tray click that caused the blur does not reopen it.
    last_blur_hide: Mutex<Option<Instant>>,
}

/// Put the panel's top edge just under the tray icon, centred on it, inside the monitor.
fn anchor_under(window: &WebviewWindow, rect: &Rect) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let pos: PhysicalPosition<f64> = rect.position.to_physical(scale);
    let size: tauri::PhysicalSize<f64> = rect.size.to_physical(scale);
    let win = window.outer_size()?;
    let mut x = pos.x + size.width / 2.0 - f64::from(win.width) / 2.0;
    let y = pos.y + size.height + 6.0 * scale;
    if let Some(monitor) = window.monitor_from_point(pos.x, pos.y)?.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let (left, right) = (f64::from(area.position.x), f64::from(area.position.x) + f64::from(area.size.width));
        x = x.min(right - f64::from(win.width) - 8.0 * scale).max(left + 8.0 * scale);
    }
    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
}

/// Hide the panel after a click elsewhere (not pinned).
pub fn hide_on_blur(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<PanelState>();
    if state.pinned.load(Ordering::Relaxed) || !window.is_visible().unwrap_or(false) {
        return;
    }
    if let Ok(mut last) = state.last_blur_hide.lock() {
        *last = Some(Instant::now());
    }
    let _ = window.hide();
    let _ = window.eval("window.dispatchEvent(new Event('desktop-hidden'))");
}

/// Tray click: open the panel under the icon, or close it.
pub fn toggle_panel(app: &AppHandle, rect: Option<&Rect>) {
    let Some(window) = app.get_webview_window("main") else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = window.eval("window.dispatchEvent(new Event('desktop-hidden'))");
        return;
    }
    let state = app.state::<PanelState>();
    let just_closed = state.last_blur_hide.lock().ok().and_then(|l| *l).is_some_and(|t| t.elapsed().as_millis() < 300);
    if !just_closed {
        open_panel(app, rect, false);
    }
}

/// Show and focus the panel, anchored under the tray icon.
pub fn open_panel(app: &AppHandle, rect: Option<&Rect>, settings: bool) {
    let Some(window) = app.get_webview_window("main") else { return };
    let tray_rect = app.tray_by_id("main").and_then(|t| t.rect().ok().flatten());
    if let Some(rect) = rect.or(tray_rect.as_ref()) {
        let _ = anchor_under(&window, rect);
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.eval("window.dispatchEvent(new Event('desktop-show'))");
    if settings {
        let _ = window.eval("window.dispatchEvent(new Event('desktop-settings'))");
    }
}

#[tauri::command]
pub fn resize_widget(window: WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    let position = window.outer_position().ok();
    let monitor = window.current_monitor().ok().flatten();
    let width = width.clamp(336, 420);
    let height = height.clamp(76, 540);
    if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
        if size == LogicalSize::new(width, height).to_physical::<u32>(scale) {
            return Ok(());
        }
    }
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    if let (Some(position), Some(monitor)) = (position, monitor) {
        // Under the tray icon the top edge stays put and the panel grows downwards, unless it would leave the screen.
        let area = monitor.work_area();
        let new_height = (f64::from(height) * monitor.scale_factor()).round() as i32;
        let bottom = area.position.y + area.size.height as i32;
        let y = position.y.min(bottom - new_height).max(area.position.y);
        let _ = window.set_position(PhysicalPosition::new(position.x, y));
    }
    Ok(())
}

#[tauri::command]
pub fn start_widget_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_widget(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    // Hidden: open it under the tray icon rather than wherever it was last.
    open_panel(&app, None, false);
    Ok(())
}

#[tauri::command]
pub fn hide_widget(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pin_widget(window: WebviewWindow, pinned: bool, state: State<'_, PanelState>) -> Result<(), String> {
    state.pinned.store(pinned, Ordering::Relaxed);
    // The popup always floats above other windows while it is open; "pinned" only decides whether a click
    // elsewhere closes it.
    window.set_always_on_top(true).map_err(|e| e.to_string())
}

/// Fire `desktop-checkin` in the panel every `seconds` (60 s to 1 h); a new call replaces the old schedule.
#[tauri::command]
pub fn schedule_checkin(window: WebviewWindow, generation: State<'_, Arc<AtomicU64>>, seconds: u64) {
    let generation = Arc::clone(generation.inner());
    let ticket = generation.fetch_add(1, Ordering::Relaxed) + 1;
    if seconds == 0 {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(seconds.clamp(60, 3600)));
        if generation.load(Ordering::Relaxed) != ticket {
            break;
        }
        if window.eval("window.dispatchEvent(new Event('desktop-checkin'))").is_err() {
            break;
        }
    });
}

/// Register (or move) a global shortcut that sends an action to the panel.
#[tauri::command]
pub async fn set_task_shortcut(
    window: WebviewWindow,
    action: String,
    binding: String,
    previous: Option<String>,
) -> Result<bool, String> {
    let detail = match action.as_str() {
        "previous" => "-1",
        "next" => "1",
        "compose" => "0",
        "pause" => "'pause'",
        _ => return Err("Unknown shortcut action".into()),
    };
    let shortcut = binding.parse::<Shortcut>().map_err(|e| e.to_string())?;
    if shortcut == capture_shortcut() {
        return Err("Option+Command+N opens the quick capture popover.".into());
    }
    let previous = previous.map(|value| value.parse::<Shortcut>()).transpose().map_err(|e| e.to_string())?;
    if previous == Some(shortcut) {
        return Ok(true);
    }
    let manager = window.global_shortcut();
    let focus = action == "compose";
    let script = format!("window.dispatchEvent(new CustomEvent('desktop-shortcut', {{ detail: {detail} }}))");
    let target = window.clone();
    manager
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                if focus {
                    let _ = show_widget(app.clone(), target.clone());
                    let _ = target.set_focus();
                }
                let _ = target.eval(&script);
            }
        })
        .map_err(|e| e.to_string())?;
    if let Some(previous) = previous {
        if let Err(error) = manager.unregister(previous) {
            let _ = manager.unregister(shortcut);
            return Err(error.to_string());
        }
    }
    Ok(true)
}

/// Bring the panel forward (tray menu, popover): anchored under the tray icon.
pub fn show_panel(app: &AppHandle, settings: bool) {
    open_panel(app, None, settings);
}

#[tauri::command]
pub fn load_focus_state(store: State<'_, FocusStore>) -> Result<Option<Value>, String> {
    store.load_state().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_focus_state(store: State<'_, FocusStore>, state: Value) -> Result<(), String> {
    store.save_state(&state).map_err(|e| e.to_string())
}

/// Append a finished focus session (task, window, duration) to the local log.
#[tauri::command]
pub fn log_focus_session(store: State<'_, FocusStore>, session: Value) -> Result<(), String> {
    store.append_session(&session).map_err(|e| e.to_string())
}

/// Menu-bar text next to the tray icon (the running timer and task). Empty clears it.
#[tauri::command]
pub fn set_tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
}

#[tauri::command]
pub fn open_panel_settings(app: AppHandle) {
    show_panel(&app, true);
}

/// Tray attention: 0 off, 1 blink, 2 steady highlight (used with Reduce Motion).
#[derive(Default, Clone)]
pub struct Attention(pub Arc<AtomicU8>);

#[tauri::command]
pub fn set_tray_attention(mode: String, state: State<'_, Attention>) {
    let value = match mode.as_str() {
        "blink" => 1,
        "steady" => 2,
        _ => 0,
    };
    state.0.store(value, Ordering::Relaxed);
}

/// Alternate the tray icon between the normal template image and the amber alert image.
pub fn start_attention(app: AppHandle, attention: Attention) {
    use tauri::image::Image;
    let normal = Image::from_bytes(include_bytes!("../icons/tray@2x.png"));
    let alert = Image::from_bytes(include_bytes!("../icons/tray-alert@2x.png"));
    let (Ok(normal), Ok(alert)) = (normal, alert) else { return };
    std::thread::spawn(move || {
        let mut phase = false;
        let mut shown_alert: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(550));
            phase = !phase;
            let want_alert = match attention.0.load(Ordering::Relaxed) {
                1 => phase,
                2 => true,
                _ => false,
            };
            if shown_alert == Some(want_alert) {
                continue;
            }
            shown_alert = Some(want_alert);
            if let Some(tray) = app.tray_by_id("main") {
                let _ = tray.set_icon(Some(if want_alert { alert.clone() } else { normal.clone() }));
                // The alert image is coloured on purpose: a template image would be tinted grey.
                let _ = tray.set_icon_as_template(!want_alert);
            }
        }
    });
}

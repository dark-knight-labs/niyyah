//! Commands for the focus panel (the "main" window): placement, pinning, check-in timer, task shortcuts,
//! opening task links, and the local task file.
//!
//! Ported from Next Up (`main.rs`, `task_store.rs`), macOS first.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use niyyah_capture_core::link::validate_web_link;
use niyyah_capture_core::{FocusStore, TaskStore};
use serde_json::Value;
use tauri::{AppHandle, LogicalSize, PhysicalPosition, State, WebviewWindow};
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

pub fn place_widget(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let size = window.outer_size()?;
        let inset = (16.0 * monitor.scale_factor()).round() as i32;
        let y = (area.size.height as i32 - size.height as i32 - inset).max(0);
        window.set_position(PhysicalPosition::new(area.position.x + inset, area.position.y + y))?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_widget(window: WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    let position = window.outer_position().ok();
    let previous_size = window.outer_size().ok();
    let monitor = window.current_monitor().ok().flatten();
    let width = width.clamp(336, 420);
    let height = height.clamp(76, 540);
    if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
        if size == LogicalSize::new(width, height).to_physical::<u32>(scale) {
            return Ok(());
        }
    }
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    if let (Some(position), Some(previous_size), Some(monitor)) = (position, previous_size, monitor) {
        let area = monitor.work_area();
        let new_height = (f64::from(height) * monitor.scale_factor()).round() as i32;
        let new_width = (f64::from(width) * monitor.scale_factor()).round() as i32;
        if previous_size.height as i32 != new_height || previous_size.width as i32 != new_width {
            // Keep the bottom edge where it was, so the panel grows upwards.
            let bottom = (position.y + previous_size.height as i32).min(area.position.y + area.size.height as i32);
            let y = (bottom - new_height).max(area.position.y);
            let right = area.position.x + area.size.width as i32;
            let x = position.x.min(right - new_width).max(area.position.x);
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_widget_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_widget(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_widget(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pin_widget(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
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
        .on_shortcut(shortcut, move |_, _, event| {
            if event.state() == ShortcutState::Pressed {
                if focus {
                    let _ = show_widget(target.clone());
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

/// Bring the panel forward and tell it to open (used by the tray menu and the popover).
pub fn show_panel(app: &AppHandle, settings: bool) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("window.dispatchEvent(new Event('desktop-show'))");
        if settings {
            let _ = window.eval("window.dispatchEvent(new Event('desktop-settings'))");
        }
    }
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

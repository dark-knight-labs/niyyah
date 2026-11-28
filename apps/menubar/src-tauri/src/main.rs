//! Niyyah Capture: the Tauri shell. Tray icon, global shortcuts, the capture popover, the focus panel
//! (ported from Next Up, see `widget.rs`), and the commands the web layer calls. All real work (queue, network, token) is in `niyyah-capture-core`.
//!
//! Not compiled or run on the Linux jump host (no webview there): see README.md, "What is verified".

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;

use chrono::Timelike;
use niyyah_capture_core::options::{current_block, PickerBlock};
use niyyah_capture_core::queue::Entry;
use niyyah_capture_core::{now_secs, Capture, Capturer, FocusStore, KeychainStore, TaskStore};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod awake_clock;
mod focus_switch;
mod widget;
mod window_focus;

use awake_clock::AwakeClock;

const KEYCHAIN_SERVICE: &str = "bd.burak.niyyah.menubar";
const KEYCHAIN_ACCOUNT: &str = "device-token";
const POPOVER: &str = "popover";
const PANEL: &str = "main";

type Shared = Arc<Capturer>;

#[derive(Serialize)]
struct OptionsReply {
    /// Blocks for the picker, each with its own products.
    picker: Vec<PickerBlock>,
    /// The block to pre-select (the one covering the current time, when the server sends times).
    current_stream: Option<String>,
}

#[derive(Serialize)]
struct SettingsReply {
    server_url: Option<String>,
    has_token: bool,
}

fn popover(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(POPOVER)
}

fn show_popover(app: &AppHandle) {
    if let Some(w) = popover(app) {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("popover-shown", ());
    }
}

fn toggle_popover(app: &AppHandle) {
    match popover(app) {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
        }
        _ => show_popover(app),
    }
}

/// Send whatever is due, off the UI thread.
fn flush_in_background(capturer: &Shared) {
    let c = capturer.clone();
    std::thread::spawn(move || {
        let report = c.flush(now_secs());
        log::info!("flush: sent={} retrying={} rejected={}", report.sent, report.retrying, report.rejected);
    });
}

// ---- commands ----------------------------------------------------------------------------------------------

#[tauri::command]
async fn load_options(state: State<'_, Shared>, refresh: bool) -> Result<OptionsReply, String> {
    let c = state.inner().clone();
    let options = tauri::async_runtime::spawn_blocking(move || c.options(refresh))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let now = chrono::Local::now();
    let minutes = now.hour() * 60 + now.minute();
    let current_stream = current_block(&options.blocks, minutes).map(|b| b.stream_slug().to_string());
    Ok(OptionsReply { picker: options.picker(), current_stream })
}

#[tauri::command]
fn submit_capture(state: State<'_, Shared>, capture: Capture) -> Result<String, String> {
    let id = state.submit(capture, now_secs()).map_err(|e| e.to_string())?;
    flush_in_background(state.inner());
    Ok(id)
}

#[tauri::command]
fn pending(state: State<'_, Shared>) -> Vec<Entry> {
    state.pending()
}

#[tauri::command]
fn requeue(state: State<'_, Shared>, id: String) -> Result<(), String> {
    state.requeue(&id, now_secs()).map_err(|e| e.to_string())?;
    flush_in_background(state.inner());
    Ok(())
}

#[tauri::command]
fn discard(state: State<'_, Shared>, id: String) -> Result<(), String> {
    state.discard(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, Shared>) -> Result<SettingsReply, String> {
    Ok(SettingsReply { server_url: state.server_url(), has_token: state.has_token().map_err(|e| e.to_string())? })
}

/// Store the server URL and, if one was pasted, the token. The token goes straight to the Keychain.
#[tauri::command]
fn save_settings(state: State<'_, Shared>, server_url: String, token: String) -> Result<(), String> {
    state.set_server_url(&server_url).map_err(|e| e.to_string())?;
    if !token.trim().is_empty() {
        state.set_token(&token).map_err(|e| e.to_string())?;
    }
    flush_in_background(state.inner());
    Ok(())
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    if let Some(w) = popover(&app) {
        let _ = w.hide();
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let clock = AwakeClock::default();
    clock.start();
    tauri::Builder::default()
        .manage(Arc::new(AtomicU64::new(0)))
        .manage(focus_switch::BrowserPreference::default())
        .manage(clock)
        .manage(widget::PanelState::default())
        .manage(widget::Attention::default())
        .manage(window_focus::WatchState::default())
        // No global handler: each shortcut carries its own (quick capture here, panel actions in widget.rs).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // A menu-bar utility: no Dock icon, no app menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let dir = app.path().app_data_dir()?;
            let store = KeychainStore::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
            let capturer: Shared = Arc::new(Capturer::open(&dir, Box::new(store))?);
            app.manage(capturer.clone());
            app.manage(TaskStore::new(&dir));
            app.manage(FocusStore::new(&dir));

            // Retry timer: wake every 5 s, send what is due.
            let timer = capturer.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(5));
                if timer.next_due_at().is_some_and(|due| due <= now_secs()) {
                    timer.flush(now_secs());
                }
            });
            flush_in_background(&capturer);

            // Option+Command+N: quick capture popover.
            app.global_shortcut().on_shortcut(widget::capture_shortcut(), |app, _, event| {
                if event.state() == ShortcutState::Pressed {
                    toggle_popover(app);
                }
            })?;

            widget::start_attention(app.handle().clone(), app.state::<widget::Attention>().inner().clone());

            // The focus panel: task list, timer, reminders. Hidden until the web layer has sized it.
            if let Err(error) = focus_switch::create_overlay(app) {
                log::warn!("could not create the task reminder overlay: {error}");
            }
            if let Some(window) = app.get_webview_window(PANEL) {
                window_focus::start(window.clone(), app.state::<window_focus::WatchState>().inner().clone());
                focus_switch::start(window);
            }

            // Tray icon: click opens the popover; the menu has Quit.
            let open = MenuItem::with_id(app, "open", "Capture (⌥⌘N)", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show tasks", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Niyyah Capture", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &show, &settings, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_popover(app),
                    "show" => widget::show_panel(app, false),
                    "settings" => widget::show_panel(app, true),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                        widget::toggle_panel(tray.app_handle(), Some(&rect));
                    }
                });
            // A monochrome template image: macOS tints it for light, dark and the selected state.
            tray = tray.icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?).icon_as_template(true);
            tray.build(app)?;
            Ok(())
        })
        // The popover behaves like a menu: it goes away when it loses focus.
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                match window.label() {
                    POPOVER => {
                        let _ = window.hide();
                    }
                    // A menu-bar popup: it collapses, and closes unless pinned, when you click elsewhere.
                    PANEL => {
                        if let Some(webview) = window.get_webview_window(PANEL) {
                            let _ = webview.eval("window.dispatchEvent(new Event('desktop-blur'))");
                        }
                        widget::hide_on_blur(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_options,
            submit_capture,
            pending,
            requeue,
            discard,
            get_settings,
            save_settings,
            hide_popover,
            widget::awake_millis,
            widget::load_tasks,
            widget::save_tasks,
            widget::open_task_link,
            widget::resize_widget,
            widget::start_widget_drag,
            widget::show_widget,
            widget::hide_widget,
            widget::pin_widget,
            widget::schedule_checkin,
            widget::set_task_shortcut,
            widget::load_focus_state,
            widget::save_focus_state,
            widget::log_focus_session,
            widget::set_tray_title,
            widget::set_tray_attention,
            widget::open_panel_settings,
            window_focus::list_focus_windows,
            window_focus::request_accessibility,
            window_focus::set_focus_target,
            focus_switch::set_work_browser,
            focus_switch::show_task_reminder,
            focus_switch::hide_task_reminder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Niyyah Capture");
}

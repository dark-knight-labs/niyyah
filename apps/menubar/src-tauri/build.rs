//! Build script. Registers every app command in an app manifest, so Tauri's ACL is enforced for them:
//! without a manifest, any local window may call any app command (tauri 2.12 `webview/mod.rs`: the ACL check
//! applies to app commands only when an app manifest exists). Each window then gets exactly the commands its
//! page uses (`capabilities/*.json`); `core/tests/acl.rs` checks that the two agree.

/// Keep this list equal to the `generate_handler!` list in `src/main.rs` (a test checks).
const COMMANDS: &[&str] = &[
    "load_options",
    "submit_capture",
    "pending",
    "requeue",
    "discard",
    "get_settings",
    "save_settings",
    "hide_popover",
    "awake_millis",
    "load_tasks",
    "save_tasks",
    "open_task_link",
    "resize_widget",
    "start_widget_drag",
    "show_widget",
    "hide_widget",
    "pin_widget",
    "schedule_checkin",
    "set_task_shortcut",
    "load_focus_state",
    "save_focus_state",
    "log_focus_session",
    "set_tray_title",
    "set_tray_attention",
    "open_panel_settings",
    "list_focus_windows",
    "request_accessibility",
    "set_focus_targets",
    "set_work_browser",
    "show_task_reminder",
    "hide_task_reminder",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}

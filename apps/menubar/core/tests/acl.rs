//! The Tauri ACL for app commands must match what each page really calls: no window gets a command its page
//! does not use, and no page calls a command its window is not allowed. Also the build manifest, the handler
//! list and the capability files must agree. (Independent of the Tauri runtime: it reads the source files.)

use std::collections::BTreeSet;
use std::path::PathBuf;

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read(rel: &str) -> String {
    std::fs::read_to_string(app_dir().join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

/// Command names a page calls: `invoke("x"` and `native('x'`.
fn invoked(js: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for marker in ["invoke(", "native("] {
        let mut rest = js;
        while let Some(at) = rest.find(marker) {
            rest = &rest[at + marker.len()..];
            let trimmed = rest.trim_start();
            if let Some(q) = trimmed.chars().next().filter(|c| *c == '"' || *c == '\'') {
                let name: String = trimmed[1..].chars().take_while(|c| *c != q).collect();
                if !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
                    out.insert(name);
                }
            }
        }
    }
    out
}

fn quoted(block: &str) -> BTreeSet<String> {
    block.split('"').skip(1).step_by(2).map(String::from).collect()
}

fn manifest_commands() -> BTreeSet<String> {
    let build = read("src-tauri/build.rs");
    let start = build.find("COMMANDS: &[&str] = &[").expect("COMMANDS list");
    let end = build[start..].find("];").unwrap() + start;
    quoted(&build[start..end])
}

fn handler_commands() -> BTreeSet<String> {
    let main = read("src-tauri/src/main.rs");
    let start = main.find("generate_handler![").expect("handler list");
    let end = main[start..].find("])").unwrap() + start;
    main[start + "generate_handler![".len()..end]
        .split(',')
        .map(|s| s.trim().rsplit("::").next().unwrap().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn allowed(capability: &str) -> (Vec<String>, BTreeSet<String>) {
    let v: serde_json::Value = serde_json::from_str(&read(&format!("src-tauri/capabilities/{capability}.json"))).unwrap();
    let windows = v["windows"].as_array().unwrap().iter().map(|w| w.as_str().unwrap().to_string()).collect();
    let cmds = v["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p.as_str()?.strip_prefix("allow-").map(|c| c.replace('-', "_")))
        .collect();
    (windows, cmds)
}

#[test]
fn the_manifest_and_the_handler_list_are_the_same_commands() {
    assert_eq!(manifest_commands(), handler_commands());
}

#[test]
fn each_window_may_call_exactly_what_its_page_calls() {
    // popover: index.html + app.js; panel: panel.html + panel.js; overlay: reminder.html + reminder.js.
    for (capability, window, scripts) in [("popover", "popover", vec!["ui/app.js"]), ("panel", "main", vec!["ui/panel.js"]), ("reminder", "task-reminder", vec!["ui/reminder.js"])] {
        let (windows, allow) = allowed(capability);
        assert_eq!(windows, vec![window.to_string()], "{capability} capability is for one window");
        let used: BTreeSet<String> = scripts.iter().flat_map(|s| invoked(&read(s))).collect();
        assert!(!used.is_empty(), "{capability}: found no invoke calls, the scanner is broken");
        let missing: Vec<_> = used.difference(&allow).collect();
        let extra: Vec<_> = allow.difference(&used).collect();
        assert!(missing.is_empty(), "{window} calls commands it is not allowed: {missing:?}");
        assert!(extra.is_empty(), "{window} is allowed commands its page never calls: {extra:?}");
        assert!(allow.is_subset(&manifest_commands()), "{capability}: unknown command in permissions");
    }
}

#[test]
fn every_command_is_allowed_somewhere_and_no_default_capability_remains() {
    let mut all = BTreeSet::new();
    for c in ["popover", "panel", "reminder"] {
        all.extend(allowed(c).1);
    }
    assert_eq!(all, manifest_commands(), "a command no window may call is dead code; a missing one breaks a page");
    let caps = std::fs::read_dir(app_dir().join("src-tauri/capabilities")).unwrap().count();
    assert_eq!(caps, 3, "only popover, panel and reminder");
}

#[test]
fn the_scanner_finds_both_call_styles() {
    let got = invoked(r#"invoke("a_b"); native('c'); desktop.invoke('d_e', {x: 1}); native( "f" ); other('g')"#);
    assert_eq!(got.into_iter().collect::<Vec<_>>(), ["a_b", "c", "d_e", "f"]);
}

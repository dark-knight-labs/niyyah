//! The web layer must be locked down: a strict CSP and no remote scripts or styles.

use std::path::PathBuf;

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn collect(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            collect(&p, out);
        } else {
            out.push(p);
        }
    }
}

fn csp() -> String {
    let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(app_dir().join("src-tauri/tauri.conf.json")).unwrap()).unwrap();
    conf["app"]["security"]["csp"].as_str().expect("app.security.csp is a string").to_string()
}

#[test]
fn csp_has_no_unsafe_directives_and_no_remote_host() {
    let csp = csp();
    for banned in ["unsafe-inline", "unsafe-eval", "http:", "https:", "ws:", "wss:", "data:", "blob:", "*"] {
        assert!(!csp.contains(banned), "CSP contains {banned}: {csp}");
    }
    let directive = |name: &str| csp.split(';').map(str::trim).find(|d| d.starts_with(name)).unwrap_or_else(|| panic!("no {name} in {csp}")).to_string();
    assert_eq!(directive("default-src"), "default-src 'none'");
    assert_eq!(directive("script-src"), "script-src 'self'");
    assert_eq!(directive("style-src"), "style-src 'self'");
    assert_eq!(directive("object-src"), "object-src 'none'");
    // The webview never talks to the network itself; the Rust core does. Only Tauri's IPC is allowed.
    assert_eq!(directive("font-src"), "font-src 'self'");
    assert_eq!(directive("img-src"), "img-src 'self'");
    assert_eq!(directive("connect-src"), "connect-src ipc:");
}

#[test]
fn ui_files_load_nothing_remote_and_have_no_inline_code() {
    let ui = app_dir().join("ui");
    let mut seen = 0;
    let mut files = Vec::new();
    collect(&ui, &mut files);
    for p in files {
        // Fonts are binary; every text asset (html, js, css, svg) is scanned.
        if !p.extension().is_some_and(|x| ["html", "js", "css", "svg"].iter().any(|t| x == *t)) {
            assert!(p.extension().is_some_and(|x| x == "woff2"), "unexpected asset type: {}", p.display());
            continue;
        }
        let text = std::fs::read_to_string(&p).unwrap();
        seen += 1;
        let name = p.display();
        for bad in ["src=\"http", "href=\"http", "src='http", "href='http", "url(http", "url(\"http", "@import", "//cdn", "eval(", "new Function", "<style", " style=", "onclick=", "onload=", "javascript:"] {
            assert!(!text.contains(bad), "{name} contains {bad}");
        }
        if p.extension().is_some_and(|x| x == "html") {
            // Every <script> must be an external same-origin file with a body-less tag.
            for chunk in text.split("<script").skip(1) {
                let tag_end = chunk.find('>').unwrap();
                assert!(chunk[..tag_end].contains("src=\""), "{name}: inline <script>");
                assert!(chunk[tag_end + 1..].trim_start().starts_with("</script>"), "{name}: script with inline body");
            }
        }
    }
    assert!(seen >= 3, "expected index.html, a script and a stylesheet in ui/");
}

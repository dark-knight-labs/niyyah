//! Own test binary: it installs a process-wide logger to capture every log line.

mod common;

use std::sync::Mutex;

use common::*;
use log::{Level, LevelFilter, Log, Metadata, Record};

struct Capture;
static LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

impl Log for Capture {
    fn enabled(&self, _: &Metadata) -> bool {
        true
    }
    fn log(&self, r: &Record) {
        LINES.lock().unwrap().push(format!("{} {}: {}", r.level(), r.target(), r.args()));
    }
    fn flush(&self) {}
}

fn read_all(dir: &std::path::Path, out: &mut Vec<(String, Vec<u8>)>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            read_all(&p, out);
        } else {
            out.push((p.display().to_string(), std::fs::read(&p).unwrap()));
        }
    }
}

const SECRET_TEXT: &str = "private thought about the loan";

#[test]
fn the_token_is_never_in_a_log_line_or_a_file_and_capture_text_is_not_logged() {
    log::set_logger(&Capture).unwrap();
    log::set_max_level(LevelFilter::Trace);

    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("app-data");

    // Drive every path that logs: success, retry, auth failure, rejection, bad inputs.
    let mock = Mock::start(vec![
        Resp::Json(201, "{}"),
        Resp::Json(503, "{}"),
        Resp::Json(401, r#"{"detail":"bad"}"#),
        Resp::Json(422, r#"{"detail":"x"}"#),
    ]);
    let c = capturer(&data, &mock.url);
    for i in 0..4 {
        c.submit(capture(&format!("{SECRET_TEXT} {i}")), 0).unwrap();
    }
    c.options(true).unwrap();
    let mut now = 0;
    for _ in 0..8 {
        c.flush(now);
        now += 1_000;
    }
    assert!(c.set_token("nyt_ExportTokenExportTokenExportToken12").is_err());
    assert!(c.set_server_url("http://insecure.example.com").is_err());
    let _ = capturer(tempfile::tempdir().unwrap().path(), "http://127.0.0.1:1").flush(0);

    // The run was real: the server saw the token.
    assert!(mock.seen().iter().any(|s| s.auth.as_deref() == Some(format!("Bearer {TOKEN}").as_str())));

    // 1. Logs.
    let lines = LINES.lock().unwrap().clone();
    assert!(lines.iter().any(|l| l.starts_with(&Level::Warn.to_string())), "the failure paths did log");
    let joined = lines.join("\n");
    let body = TOKEN.strip_prefix("nyd_").unwrap();
    assert!(!joined.contains(TOKEN) && !joined.contains(body), "token in a log line");
    assert!(!joined.contains(SECRET_TEXT), "capture text in a log line");

    // 2. Files under the app data folder.
    let mut files = Vec::new();
    read_all(&data, &mut files);
    assert!(files.iter().any(|(n, _)| n.ends_with("queue.json")));
    for (name, bytes) in &files {
        let text = String::from_utf8_lossy(bytes);
        assert!(!text.contains(body), "token found in {name}");
        assert!(!text.contains("nyd_"), "token prefix found in {name}");
    }

    // 3. Error messages shown to the user.
    for e in [c.set_token("nyt_x").unwrap_err(), c.set_server_url("http://x.example.com").unwrap_err()] {
        assert!(!e.to_string().contains(body));
    }
}

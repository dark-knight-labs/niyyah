//! A tiny scripted HTTP server on 127.0.0.1 (the only place http is allowed).
#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use tiny_http::{Header, Response, Server};

#[derive(Debug, Clone)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub auth: Option<String>,
    pub content_type: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone)]
pub enum Resp {
    Json(u16, &'static str),
    Redirect(String),
}

pub const OPTIONS_JSON: &str = r#"{"blocks":[{"block":"OT","start":"06:00","end":"16:03","what":"Outcome time","stream":"OT"}],"products":[{"slug":"alisha","name":"Alisha Noor","block":"OT"}]}"#;

pub struct Mock {
    pub url: String,
    pub seen: Arc<Mutex<Vec<Seen>>>,
    script: Arc<Mutex<VecDeque<Resp>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Mock {
    /// Start on a free port. Responses are taken from the script in order; once it is empty
    /// POST /api/v1/vault/items answers 201 and GET /api/v1/capture/options answers 200.
    pub fn start(script: Vec<Resp>) -> Self {
        let server = Server::http("127.0.0.1:0").expect("bind");
        let url = format!("http://{}", server.server_addr().to_ip().expect("ip"));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let script = Arc::new(Mutex::new(VecDeque::from(script)));
        let stop = Arc::new(AtomicBool::new(false));
        let (s2, sc2, st2) = (seen.clone(), script.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            while !st2.load(Ordering::Relaxed) {
                let Ok(Some(mut req)) = server.recv_timeout(Duration::from_millis(25)) else { continue };
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let header = |name: &str| req.headers().iter().find(|h| h.field.to_string().eq_ignore_ascii_case(name)).map(|h| h.value.to_string());
                let entry = Seen {
                    method: req.method().to_string(),
                    path: req.url().to_string(),
                    auth: header("Authorization"),
                    content_type: header("Content-Type"),
                    body,
                };
                let path = entry.path.clone();
                s2.lock().unwrap().push(entry);
                let resp = sc2.lock().unwrap().pop_front().unwrap_or_else(|| {
                    if path.starts_with("/api/v1/capture/options") {
                        Resp::Json(200, OPTIONS_JSON)
                    } else {
                        Resp::Json(201, r#"{"kind":"task","id":1}"#)
                    }
                });
                let json = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = match resp {
                    Resp::Json(code, body) => req.respond(Response::from_string(body).with_status_code(code).with_header(json)),
                    Resp::Redirect(to) => {
                        req.respond(Response::from_string("").with_status_code(302).with_header(Header::from_bytes("Location", to).unwrap()))
                    }
                };
            }
        });
        Mock { url, seen, script, stop, thread: Some(thread) }
    }

    pub fn push(&self, r: Resp) {
        self.script.lock().unwrap().push_back(r);
    }

    pub fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl Drop for Mock {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// A 43-character body, the length of 32 random bytes in base64url.
pub const TOKEN: &str = "nyd_Zk3Vq9Lw2Xe7Rt5Yb8Nc1Mh4Jd6Fg0Sa-_Ppu1QwErT";

pub fn capture(text: &str) -> niyyah_capture_core::Capture {
    niyyah_capture_core::Capture {
        text: text.into(),
        lane: niyyah_capture_core::Lane::Next,
        stream: "OT".into(),
        product: Some("alisha".into()),
        client_id: None,
    }
}

pub fn capturer(dir: &std::path::Path, server: &str) -> niyyah_capture_core::Capturer {
    let c = niyyah_capture_core::Capturer::open(dir, Box::new(niyyah_capture_core::MemoryStore::new())).unwrap();
    c.set_server_url(server).unwrap();
    c.set_token(TOKEN).unwrap();
    c
}

mod common;

use common::*;
use niyyah_capture_core::queue::EntryState;
use niyyah_capture_core::Error;
use serde_json::json;

/// A port nothing listens on: the "offline" case.
const DEAD: &str = "http://127.0.0.1:1";

#[test]
fn offline_then_online_sends_exactly_once_and_clears_the_queue() {
    let dir = tempfile::tempdir().unwrap();
    let c = capturer(dir.path(), DEAD);
    c.submit(capture("Call the bank"), 1_000).unwrap();

    // Offline: kept, not sent, backing off 5 s.
    let r = c.flush(1_000);
    assert_eq!((r.sent, r.retrying), (0, 1));
    assert_eq!(c.pending().len(), 1);
    assert_eq!(c.pending()[0].attempts, 1);
    assert!(c.pending()[0].last_error.is_some());
    assert_eq!(c.next_due_at(), Some(1_005));

    // Too early: nothing is attempted.
    assert_eq!(c.flush(1_004).retrying, 0);

    // Online: same capturer, server now reachable.
    let mock = Mock::start(vec![]);
    // A different host: the stored token is not carried over, so the user pastes one with the new address.
    c.save_settings(&mock.url, TOKEN).unwrap();
    let r = c.flush(1_005);
    assert_eq!(r.sent, 1);
    assert!(c.pending().is_empty());
    assert_eq!(c.next_due_at(), None);

    let seen = mock.seen();
    assert_eq!(seen.len(), 1, "exactly one POST");
    assert_eq!((seen[0].method.as_str(), seen[0].path.as_str()), ("POST", "/api/v1/vault/items"));
    assert_eq!(seen[0].auth.as_deref(), Some(format!("Bearer {TOKEN}").as_str()));
    assert!(seen[0].content_type.as_deref().unwrap().starts_with("application/json"));
    let body: serde_json::Value = serde_json::from_str(&seen[0].body).unwrap();
    assert_eq!(body, json!({"text": "Call the bank", "stream": "OT", "products": ["alisha"]}));
}

#[test]
fn a_422_is_a_real_error_shown_as_refused_and_never_retried() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![Resp::Json(422, r#"{"detail":"unknown stream"}"#)]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(capture("Call the bank"), 1_000).unwrap();
    let r = c.flush(1_001);
    assert_eq!((r.sent, r.rejected), (0, 1), "{r:?}");
    assert_eq!(mock.seen().iter().filter(|s| s.method == "POST").count(), 1, "one POST, no second try");
    let entry = &c.pending()[0];
    assert_eq!(format!("{:?}", entry.state), "Rejected", "parked as refused, visible in the popover list");
    let body: serde_json::Value = serde_json::from_str(&mock.seen()[0].body).unwrap();
    assert!(body.get("lane").is_none() && body.get("day").is_none(), "{body}");
    assert_eq!(body["stream"], "OT", "a capture always names its stream");
}

#[test]
fn queue_survives_a_restart_and_is_sent_by_the_new_process() {
    let dir = tempfile::tempdir().unwrap();
    {
        let c = capturer(dir.path(), DEAD);
        c.submit(capture("one"), 10).unwrap();
        c.submit(capture("two"), 11).unwrap();
        c.flush(20);
    } // dropped: the "app quit"
    let mock = Mock::start(vec![]);
    let c = capturer(dir.path(), &mock.url);
    assert_eq!(c.pending().len(), 2);
    let r = c.flush(10_000);
    assert_eq!(r.sent, 2);
    let texts: Vec<String> = mock.seen().iter().map(|s| serde_json::from_str::<serde_json::Value>(&s.body).unwrap()["text"].as_str().unwrap().to_string()).collect();
    assert_eq!(texts, ["one", "two"], "oldest first");
}

#[test]
fn transient_server_errors_keep_the_capture_and_back_off() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![Resp::Json(503, "{}"), Resp::Json(429, "{}")]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(capture("x"), 0).unwrap();
    assert_eq!(c.flush(0).retrying, 1);
    assert_eq!(c.next_due_at(), Some(5));
    assert_eq!(c.flush(5).retrying, 1);
    assert_eq!(c.next_due_at(), Some(15), "second failure waits 10 s");
    assert_eq!(c.flush(15).sent, 1, "then the default 201 lets it through");
    assert!(c.pending().is_empty());
}

#[test]
fn a_dead_network_costs_one_attempt_not_one_per_capture() {
    let dir = tempfile::tempdir().unwrap();
    let c = capturer(dir.path(), DEAD);
    for i in 0..5 {
        c.submit(capture(&format!("n{i}")), 0).unwrap();
    }
    let r = c.flush(0);
    assert_eq!(r.retrying, 1);
    assert_eq!(c.pending().iter().filter(|e| e.attempts == 0).count(), 4);
}

#[test]
fn a_refused_token_keeps_the_capture_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![Resp::Json(401, r#"{"detail":"Invalid token"}"#)]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(capture("x"), 0).unwrap();
    let r = c.flush(0);
    assert!(r.auth_failed);
    assert_eq!(r.sent, 0);
    let p = c.pending();
    assert_eq!(p.len(), 1);
    assert_eq!(p[0].state, EntryState::Pending);
    assert!(p[0].last_error.as_deref().unwrap().contains("401"));
}

#[test]
fn a_permanent_4xx_parks_the_capture_for_the_user_and_does_not_block_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![Resp::Json(422, r#"{"detail":"unknown stream"}"#)]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(capture("bad stream"), 0).unwrap();
    c.submit(capture("good"), 0).unwrap();
    let r = c.flush(0);
    assert_eq!((r.rejected, r.sent), (1, 1));
    let p = c.pending();
    assert_eq!(p.len(), 1, "the rejected one is still there");
    assert_eq!(p[0].state, EntryState::Rejected);
    assert!(p[0].last_error.as_deref().unwrap().contains("422"));
    // Not retried on its own ...
    assert_eq!(c.flush(u64::MAX / 2).sent, 0);
    // ... until the user asks.
    c.requeue(&p[0].id, 100).unwrap();
    assert_eq!(c.flush(100).sent, 1);
    assert!(c.pending().is_empty());
}

#[test]
fn nothing_is_sent_until_a_server_and_token_are_set() {
    let dir = tempfile::tempdir().unwrap();
    let c = niyyah_capture_core::Capturer::open(dir.path(), Box::new(niyyah_capture_core::MemoryStore::new())).unwrap();
    c.submit(capture("early"), 0).unwrap();
    assert!(c.flush(0).not_configured);
    assert_eq!(c.pending().len(), 1);
}

#[test]
fn a_non_https_server_url_is_refused_and_not_saved() {
    let dir = tempfile::tempdir().unwrap();
    let c = niyyah_capture_core::Capturer::open(dir.path(), Box::new(niyyah_capture_core::MemoryStore::new())).unwrap();
    for bad in ["http://niyyah.example.com", "http://192.168.1.10:8000", "ftp://x.example.com", "https://u:p@x.example.com"] {
        assert!(c.set_server_url(bad).is_err(), "{bad}");
    }
    assert!(c.server_url().is_none());
    assert!(matches!(c.set_server_url("http://niyyah.example.com"), Err(Error::InsecureUrl)));
    assert!(c.set_server_url("https://niyyah.example.com/").is_ok());
    assert_eq!(c.server_url().as_deref(), Some("https://niyyah.example.com"));
}

#[test]
fn only_device_tokens_are_accepted_in_settings() {
    let dir = tempfile::tempdir().unwrap();
    let c = niyyah_capture_core::Capturer::open(dir.path(), Box::new(niyyah_capture_core::MemoryStore::new())).unwrap();
    assert!(matches!(c.set_token("nyt_ExportTokenExportTokenExportToken12"), Err(Error::BadTokenFormat)));
    assert!(!c.has_token().unwrap());
    c.set_token(TOKEN).unwrap();
    assert!(c.has_token().unwrap());
    c.clear_token().unwrap();
    assert!(!c.has_token().unwrap());
}

#[test]
fn a_redirect_is_not_followed_so_the_token_stays_on_the_configured_host() {
    let elsewhere = Mock::start(vec![]);
    let configured = Mock::start(vec![Resp::Redirect(format!("{}/api/v1/vault/items", elsewhere.url))]);
    let dir = tempfile::tempdir().unwrap();
    let c = capturer(dir.path(), &configured.url);
    c.submit(capture("x"), 0).unwrap();
    let r = c.flush(0);
    assert_eq!((r.sent, r.retrying), (0, 1));
    assert_eq!(configured.seen().len(), 1);
    assert!(elsewhere.seen().is_empty(), "the redirect target never saw a request");
    assert_eq!(c.pending().len(), 1, "and the capture is still queued");
}

#[test]
fn options_are_fetched_once_per_session_and_fall_back_to_the_saved_copy() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![]);
    let c = capturer(dir.path(), &mock.url);
    let o = c.options(false).unwrap();
    assert_eq!(o.streams[0].slug, "OT");
    assert_eq!(o.picker()[0].products[0].slug, "alisha", "products are nested under their stream");
    c.options(false).unwrap();
    assert_eq!(mock.seen().iter().filter(|s| s.path == "/api/v1/capture/options").count(), 1, "second call is the cache");
    assert_eq!(mock.seen()[0].auth.as_deref(), Some(format!("Bearer {TOKEN}").as_str()));
    c.options(true).unwrap();
    assert_eq!(mock.seen().len(), 2, "refresh goes back to the server");

    // New session, server unreachable: the saved copy still lets a capture be filed.
    let c2 = capturer(dir.path(), DEAD);
    assert_eq!(c2.options(false).unwrap(), o);
    // No saved copy and no server: an error, not an empty list.
    let empty = tempfile::tempdir().unwrap();
    assert!(capturer(empty.path(), DEAD).options(false).is_err());
}

/// End to end against the real Niyyah API. Pending until Part A (paseo/capture-device-token) is merged
/// and deployed. Run with: NIYYAH_E2E_URL=https://... NIYYAH_E2E_TOKEN=nyd_... cargo test -- --ignored
#[test]
#[ignore = "pending: needs Part A (device token API) merged and deployed"]
fn e2e_against_the_real_api() {
    let url = std::env::var("NIYYAH_E2E_URL").expect("NIYYAH_E2E_URL");
    let token = std::env::var("NIYYAH_E2E_TOKEN").expect("NIYYAH_E2E_TOKEN");
    let dir = tempfile::tempdir().unwrap();
    let c = niyyah_capture_core::Capturer::open(dir.path(), Box::new(niyyah_capture_core::MemoryStore::new())).unwrap();
    c.set_server_url(&url).unwrap();
    c.set_token(&token).unwrap();
    let opts = c.options(true).expect("GET /api/v1/capture/options");
    let stream = opts.streams.first().expect("at least one stream");
    let mut cap = capture("menubar e2e capture (delete me)");
    cap.stream = stream.slug.clone();
    cap.products = vec![]; // optional
    c.submit(cap, niyyah_capture_core::now_secs()).unwrap();
    let r = c.flush(niyyah_capture_core::now_secs());
    assert_eq!(r.sent, 1, "{r:?}");
}

const KEY: &str = "3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11";

fn keyed(text: &str) -> niyyah_capture_core::Capture {
    let mut c = capture(text);
    c.client_id = Some(KEY.into());
    c
}

#[test]
fn a_retry_after_a_lost_reply_sends_the_same_client_id() {
    let dir = tempfile::tempdir().unwrap();
    // The server stored the task but the reply never arrived: the client only sees a 503.
    let mock = Mock::start(vec![Resp::Json(503, r#"{"detail":"upstream timeout"}"#)]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(keyed("Call the bank"), 1_000).unwrap();
    assert_eq!(c.flush(1_001).retrying, 1);
    // A new process (crash before the answer was saved) picks the capture up again.
    let c2 = capturer(dir.path(), &mock.url);
    assert_eq!(c2.flush(2_000).sent, 1);
    let bodies: Vec<serde_json::Value> = mock.seen().iter().filter(|s| s.method == "POST").map(|s| serde_json::from_str(&s.body).unwrap()).collect();
    assert_eq!(bodies.len(), 2);
    assert_eq!(bodies[0]["client_id"], KEY);
    assert_eq!(bodies[0]["client_id"], bodies[1]["client_id"], "the same key: the server answers 200 with the first task instead of making a second");
}

#[test]
fn not_found_and_method_not_allowed_keep_the_capture_and_name_the_server_url() {
    for code in [404u16, 405] {
        let dir = tempfile::tempdir().unwrap();
        let body: &'static str = Box::leak(format!(r#"{{"detail":"{code}"}}"#).into_boxed_str());
        let mock = Mock::start(vec![Resp::Json(code, body)]);
        let c = capturer(dir.path(), &mock.url);
        c.submit(capture("x"), 1_000).unwrap();
        let r = c.flush(1_001);
        assert_eq!((r.sent, r.retrying, r.rejected), (0, 1, 0), "{code}: {r:?}");
        let entry = &c.pending()[0];
        assert!(entry.last_error.as_deref().unwrap_or("").contains("check the server URL"), "{:?}", entry.last_error);
    }
}

#[test]
fn changing_the_server_host_without_a_new_token_is_refused_and_nothing_is_sent_there() {
    let dir = tempfile::tempdir().unwrap();
    let old = Mock::start(vec![]);
    let new = Mock::start(vec![]);
    let c = capturer(dir.path(), &old.url);
    c.submit(capture("Secret client work"), 1_000).unwrap();
    // Same origin, different path: fine without a token.
    c.save_settings(&format!("{}/api-prefix", old.url), "").unwrap();
    // Different origin, no token: refused, and everything stays as it was.
    let err = c.save_settings(&new.url, "").unwrap_err();
    assert!(matches!(err, niyyah_capture_core::Error::OriginChanged), "{err:?}");
    assert!(c.server_url().unwrap().starts_with(&old.url), "the old URL is kept");
    assert!(c.has_token().unwrap(), "the old token is kept, for the old host");
    assert!(matches!(c.set_server_url(&new.url), Err(niyyah_capture_core::Error::OriginChanged)), "the lower-level setter refuses too");
    c.flush(1_001);
    assert!(new.seen().is_empty(), "nothing, not even the queued text, reached the new host: {:?}", new.seen());
}

#[test]
fn changing_the_server_host_with_a_new_token_replaces_the_token_and_sends_only_the_new_one() {
    let dir = tempfile::tempdir().unwrap();
    let old = Mock::start(vec![]);
    let new = Mock::start(vec![]);
    let c = capturer(dir.path(), &old.url);
    c.submit(capture("x"), 1_000).unwrap();
    let fresh = "nyd_Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk-_Ll1Mm2Nn3Oo4P";
    c.save_settings(&new.url, fresh).unwrap();
    assert!(c.server_url().unwrap().starts_with(&new.url));
    assert_eq!(c.flush(1_001).sent, 1);
    assert!(old.seen().is_empty(), "the old host sees nothing after the move");
    assert_eq!(new.seen()[0].auth.as_deref(), Some(format!("Bearer {fresh}").as_str()));
    assert_ne!(new.seen()[0].auth.as_deref(), Some(format!("Bearer {TOKEN}").as_str()), "the old token never went to the new host");
}

#[test]
fn a_bad_pasted_token_saves_nothing_not_even_the_url() {
    let dir = tempfile::tempdir().unwrap();
    let old = Mock::start(vec![]);
    let c = capturer(dir.path(), &old.url);
    let before = c.server_url();
    assert!(c.save_settings("https://other.example", "nyt_an-export-token-is-refused").is_err());
    assert_eq!(c.server_url(), before, "the URL is validated with the token, before anything is saved");
    assert!(c.has_token().unwrap());
}

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
    c.set_server_url(&mock.url).unwrap();
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
fn a_server_that_demands_a_lane_gets_one_retry_with_backlog_and_the_capture_still_lands() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![Resp::Json(422, r#"{"detail":[{"msg":"Value error, send exactly one of `day` and `lane`"}]}"#)]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(capture("Call the bank"), 1_000).unwrap();
    let r = c.flush(1_001);
    assert_eq!(r.sent, 1, "{r:?}");
    let posts: Vec<_> = mock.seen().into_iter().filter(|s| s.method == "POST").collect();
    assert_eq!(posts.len(), 2);
    let first: serde_json::Value = serde_json::from_str(&posts[0].body).unwrap();
    let second: serde_json::Value = serde_json::from_str(&posts[1].body).unwrap();
    assert!(first.get("lane").is_none(), "the app itself sends no lane: {first}");
    assert_eq!(second["lane"], "backlog");
    assert_eq!(second["stream"], "OT");
}

#[test]
fn another_422_is_refused_without_a_lane_retry() {
    let dir = tempfile::tempdir().unwrap();
    let mock = Mock::start(vec![Resp::Json(422, r#"{"detail":"unknown stream"}"#)]);
    let c = capturer(dir.path(), &mock.url);
    c.submit(capture("x"), 1_000).unwrap();
    let r = c.flush(1_001);
    assert_eq!((r.sent, r.rejected), (0, 1), "{r:?}");
    assert_eq!(mock.seen().iter().filter(|s| s.method == "POST").count(), 1);
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
    assert_eq!(o.picker()[0].products[0].slug, "alisha");
    assert_eq!(o.products[0].slug, "alisha");
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
    cap.product = None; // optional
    c.submit(cap, niyyah_capture_core::now_secs()).unwrap();
    let r = c.flush(niyyah_capture_core::now_secs());
    assert_eq!(r.sent, 1, "{r:?}");
}

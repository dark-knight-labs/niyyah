use serde::{Deserialize, Serialize};

use crate::error::Error;

pub const MAX_TEXT_CHARS: usize = 300;

/// What the user typed in the popover. Filed under a stream; no lane (the server's default applies).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capture {
    pub text: String,
    /// The stream slug to file under. A capture always has one.
    pub stream: String,
    /// A product slug, if one was picked.
    #[serde(default)]
    pub product: Option<String>,
    /// The panel task's UUID: the retry key. Sent as `client_id` when it is a valid UUID.
    pub client_id: Option<String>,
}

impl Capture {
    /// Trim and check before anything is queued.
    pub fn validated(mut self) -> Result<Self, Error> {
        self.text = self.text.trim().to_string();
        self.stream = self.stream.trim().to_string();
        self.product = self.product.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
        if self.text.is_empty() {
            return Err(Error::EmptyText);
        }
        if self.text.chars().count() > MAX_TEXT_CHARS {
            return Err(Error::TextTooLong);
        }
        if self.stream.is_empty() {
            return Err(Error::NoBlock);
        }
        Ok(self)
    }

    pub fn to_item(&self) -> ItemPayload {
        ItemPayload {
            // Sent so a retry after a lost reply is the same task, not a second one (the server dedupes on it).
            // Only a real UUID: anything else would be a 422 and park the capture.
            client_id: self.client_id.clone().filter(|id| is_uuid(id)),
            text: self.text.clone(),
            stream: self.stream.clone(),
            products: self.product.as_ref().map(|p| vec![p.clone()]),
        }
    }
}

/// The JSON body of `POST /api/v1/vault/items`: text, stream, optional product. No `lane`, no `day`: the
/// server files a device-token task on today, under the stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ItemPayload {
    pub text: String,
    pub stream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub products: Option<Vec<String>>,
    /// The retry key (a UUID), when the capture has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
}

/// 8-4-4-4-12 hex, as the server's UUID field expects.
pub fn is_uuid(s: &str) -> bool {
    let groups: Vec<&str> = s.split('-').collect();
    groups.len() == 5
        && [8, 4, 4, 4, 12].iter().zip(&groups).all(|(n, g)| g.len() == *n && g.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cap(product: Option<&str>) -> Capture {
        Capture { text: "  Call the bank #errand ".into(), stream: "kahf".into(), product: product.map(String::from), client_id: None }
    }

    #[test]
    fn payload_is_text_stream_and_optional_product_only() {
        let item = cap(Some("dns")).validated().unwrap().to_item();
        assert_eq!(serde_json::to_value(&item).unwrap(), json!({"text": "Call the bank #errand", "stream": "kahf", "products": ["dns"]}));
        let bare = serde_json::to_value(cap(None).validated().unwrap().to_item()).unwrap();
        assert_eq!(bare, json!({"text": "Call the bank #errand", "stream": "kahf"}), "a stream alone is a capture");
    }

    const ID: &str = "3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11";

    #[test]
    fn a_valid_client_id_is_sent_as_the_retry_key() {
        let mut c = cap(Some("dns"));
        c.client_id = Some(ID.into());
        assert_eq!(
            serde_json::to_value(c.validated().unwrap().to_item()).unwrap(),
            json!({"text": "Call the bank #errand", "stream": "kahf", "products": ["dns"], "client_id": ID})
        );
    }

    #[test]
    fn a_client_id_that_is_not_a_uuid_is_not_sent() {
        for bad in ["7b1c-uuid", "", "3f2b8c1e6a0d4a5e9d571c2f0b7a9e11", "3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e1", "zzzzzzzz-6a0d-4a5e-9d57-1c2f0b7a9e11"] {
            let mut c = cap(None);
            c.client_id = Some(bad.into());
            let v = serde_json::to_value(c.validated().unwrap().to_item()).unwrap();
            assert!(v.get("client_id").is_none(), "{bad:?} would be a 422: {v}");
        }
    }

    #[test]
    fn no_lane_no_day_no_block_ever() {
        for product in [None, Some("dns")] {
            let v = serde_json::to_value(cap(product).validated().unwrap().to_item()).unwrap();
            for key in ["lane", "day", "block"] {
                assert!(v.get(key).is_none(), "{key} must not be sent: {v}");
            }
        }
    }

    #[test]
    fn old_queue_entries_with_a_lane_still_load() {
        let c: Capture = serde_json::from_value(json!({"text": "x", "lane": "next", "stream": "OT"})).unwrap();
        assert!(serde_json::to_value(c.to_item()).unwrap().get("lane").is_none(), "the stored lane is dropped");
    }

    #[test]
    fn validation_rules() {
        let mut c = cap(None);
        c.text = "   ".into();
        assert!(matches!(c.validated(), Err(Error::EmptyText)));
        let mut c = cap(None);
        c.text = "x".repeat(301);
        assert!(matches!(c.validated(), Err(Error::TextTooLong)));
        let mut c = cap(None);
        c.text = "é".repeat(300);
        assert!(c.validated().is_ok(), "300 characters, counted as characters not bytes");
        let mut c = cap(None);
        c.stream = " ".into();
        assert!(matches!(c.validated(), Err(Error::NoBlock)));
        assert!(cap(Some("  ")).validated().unwrap().product.is_none());
    }

    /// The focus panel sends the task's name, a stream and maybe a product. Link, timer, deadline and the
    /// focus window (app, title) stay on the Mac: even if the web layer passes them along, they must not
    /// reach the server.
    #[test]
    fn local_only_fields_never_reach_the_wire() {
        let from_panel = json!({
            "text": "Call the bank", "stream": "kahf", "product": "dns", "client_id": "3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11",
            "lane": "now", "link": "https://example.com", "deadlineAt": 1, "window": "Quarterly report",
            "title": "Quarterly report", "app": "Safari", "bundle_id": "com.apple.Safari",
            "trackedMs": 5, "startedAt": 2, "done": false,
            "primary": {"app": "Safari", "title": "Quarterly report"}, "allowed": [{"app": "Notes", "title": "Outline"}]
        });
        let capture: Capture = serde_json::from_value(from_panel).unwrap();
        let wire = serde_json::to_string(&capture.validated().unwrap().to_item()).unwrap();
        for key in ["link", "deadline", "tracked", "started", "done", "example.com", "window", "title", "app", "bundle", "Safari", "lane", "now", "Notes", "Outline", "primary", "allowed"] {
            assert!(!wire.contains(key), "{key} leaked into {wire}");
        }
        assert!(wire.contains("Call the bank") && wire.contains("kahf") && wire.contains("dns"));
        assert!(wire.contains("3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11"), "the retry key is the one id that goes out");
    }
}

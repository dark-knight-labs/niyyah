use serde::{Deserialize, Serialize};

use crate::error::Error;

pub const MAX_TEXT_CHARS: usize = 300;

/// The lane a capture lands in. The app says "Someday"; the API's word is `backlog`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    Now,
    #[default]
    Next,
    Someday,
}

impl Lane {
    pub fn wire(self) -> &'static str {
        match self {
            Lane::Now => "now",
            Lane::Next => "next",
            Lane::Someday => "backlog",
        }
    }
}

/// What the user typed in the popover.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capture {
    pub text: String,
    #[serde(default)]
    pub lane: Lane,
    /// The block's stream slug. The API files an undated item under a stream, so a capture needs one.
    pub stream: String,
    /// A product slug, if one was picked.
    #[serde(default)]
    pub product: Option<String>,
    /// The panel task's UUID. Kept in the queue but NOT sent yet: the server has no idempotency key or
    /// sync-back. When the backend contract lands, `to_item` is the one place that starts sending it.
    #[serde(default)]
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
            text: self.text.clone(),
            lane: self.lane.wire(),
            stream: self.stream.clone(),
            products: self.product.as_ref().map(|p| vec![p.clone()]),
        }
    }
}

/// The JSON body of `POST /api/v1/vault/items` (the API's `ItemCreateIn`, lane form:
/// exactly one of `day` and `lane`, so `day` is never sent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ItemPayload {
    pub text: String,
    pub lane: &'static str,
    pub stream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub products: Option<Vec<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cap(lane: Lane, product: Option<&str>) -> Capture {
        Capture { text: "  Call the bank #errand ".into(), lane, stream: "OT".into(), product: product.map(String::from), client_id: None }
    }

    #[test]
    fn payload_shape_matches_the_items_api() {
        let item = cap(Lane::Next, Some("alisha")).validated().unwrap().to_item();
        assert_eq!(
            serde_json::to_value(&item).unwrap(),
            json!({"text": "Call the bank #errand", "lane": "next", "stream": "OT", "products": ["alisha"]})
        );
    }

    #[test]
    fn no_product_means_no_products_key_and_no_day() {
        let v = serde_json::to_value(cap(Lane::Now, None).validated().unwrap().to_item()).unwrap();
        assert!(v.get("products").is_none());
        assert!(v.get("day").is_none());
        assert_eq!(v["lane"], "now");
    }

    #[test]
    fn someday_goes_out_as_backlog() {
        assert_eq!(cap(Lane::Someday, None).to_item().lane, "backlog");
    }

    #[test]
    fn default_lane_is_next() {
        let c: Capture = serde_json::from_value(json!({"text": "x", "stream": "OT"})).unwrap();
        assert_eq!(c.lane, Lane::Next);
    }

    #[test]
    fn validation_rules() {
        let mut c = cap(Lane::Next, None);
        c.text = "   ".into();
        assert!(matches!(c.validated(), Err(Error::EmptyText)));
        let mut c = cap(Lane::Next, None);
        c.text = "x".repeat(301);
        assert!(matches!(c.validated(), Err(Error::TextTooLong)));
        let mut c = cap(Lane::Next, None);
        c.text = "é".repeat(300);
        assert!(c.validated().is_ok(), "300 characters, counted as characters not bytes");
        let mut c = cap(Lane::Next, None);
        c.stream = " ".into();
        assert!(matches!(c.validated(), Err(Error::NoBlock)));
        assert!(cap(Lane::Next, Some("  ")).validated().unwrap().product.is_none());
    }
}

#[cfg(test)]
mod local_only_fields {
    use super::*;

    /// The focus panel sends the task's name plus block/product/lane. Link, timer and deadline stay on
    /// the Mac: even if the web layer passes them along, they must not reach the server.
    #[test]
    fn local_only_fields_never_reach_the_wire() {
        let from_panel = serde_json::json!({
            "text": "Call the bank", "lane": "next", "stream": "OT", "product": "alisha", "client_id": "7b1c-uuid",
            "link": "https://example.com", "deadlineAt": 1, "trackedMs": 5, "startedAt": 2, "done": false
        });
        let capture: Capture = serde_json::from_value(from_panel).unwrap();
        let wire = serde_json::to_string(&capture.validated().unwrap().to_item()).unwrap();
        for key in ["link", "deadline", "tracked", "started", "done", "example.com", "client"] {
            assert!(!wire.contains(key), "{key} leaked into {wire}");
        }
        assert!(wire.contains("Call the bank") && wire.contains("alisha"));
    }
}

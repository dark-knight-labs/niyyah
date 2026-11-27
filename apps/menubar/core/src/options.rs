//! `GET /api/v1/capture/options`: the user's products and the day's block list.
//!
//! Contract (Part A, read-only, device-token allowed):
//! ```json
//! { "blocks":   [{"block": "OT", "start": "06:00", "end": "16:03", "what": "...", "stream": "OT"}],
//!   "products": [{"slug": "alisha", "name": "Alisha Noor", "block": "OT"}] }
//! ```
//! `blocks` mirrors the schedule's block rows. A capture is filed under the block's
//! `stream` (or its `block` key if `stream` is null). Unknown fields are ignored.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    #[serde(default)]
    pub blocks: Vec<BlockOption>,
    #[serde(default)]
    pub products: Vec<ProductOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockOption {
    pub block: String,
    /// "HH:MM", local time of the day the list is for.
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub what: String,
    #[serde(default)]
    pub stream: Option<String>,
}

impl BlockOption {
    /// The value sent as `stream` when capturing under this block.
    pub fn stream_slug(&self) -> &str {
        self.stream.as_deref().filter(|s| !s.is_empty()).unwrap_or(&self.block)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductOption {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub block: Option<String>,
}

fn minutes(hhmm: &str) -> Option<u32> {
    let (h, m) = hhmm.split_once(':')?;
    let (h, m): (u32, u32) = (h.trim().parse().ok()?, m.trim().parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// The block covering `now_minutes` (minutes since local midnight), to pre-fill the select.
/// A block that ends at or before its start wraps past midnight.
pub fn current_block(blocks: &[BlockOption], now_minutes: u32) -> Option<&BlockOption> {
    blocks.iter().find(|b| {
        let (Some(s), Some(e)) = (minutes(&b.start), minutes(&b.end)) else { return false };
        if s < e {
            s <= now_minutes && now_minutes < e
        } else {
            now_minutes >= s || now_minutes < e
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(block: &str, start: &str, end: &str, stream: Option<&str>) -> BlockOption {
        BlockOption { block: block.into(), start: start.into(), end: end.into(), what: String::new(), stream: stream.map(String::from) }
    }

    #[test]
    fn picks_the_block_covering_now() {
        let blocks = vec![b("DW", "06:00", "10:00", None), b("OT", "10:00", "16:03", Some("OT")), b("N", "22:00", "02:00", None)];
        assert_eq!(current_block(&blocks, 6 * 60).unwrap().block, "DW");
        assert_eq!(current_block(&blocks, 10 * 60).unwrap().block, "OT", "end is exclusive, start inclusive");
        assert_eq!(current_block(&blocks, 23 * 60).unwrap().block, "N");
        assert_eq!(current_block(&blocks, 60).unwrap().block, "N", "wraps past midnight");
        assert!(current_block(&blocks, 18 * 60).is_none());
    }

    #[test]
    fn bad_times_never_match() {
        assert!(current_block(&[b("X", "25:00", "26:00", None)], 600).is_none());
        assert!(current_block(&[b("X", "soon", "later", None)], 600).is_none());
    }

    #[test]
    fn stream_falls_back_to_block() {
        assert_eq!(b("OT", "1:00", "2:00", None).stream_slug(), "OT");
        assert_eq!(b("OT", "1:00", "2:00", Some("")).stream_slug(), "OT");
        assert_eq!(b("OT", "1:00", "2:00", Some("deep")).stream_slug(), "deep");
    }

    #[test]
    fn parses_the_contract_and_ignores_extras() {
        let o: Options = serde_json::from_str(
            r#"{"blocks":[{"block":"OT","start":"06:00","end":"10:00","what":"w","stream":null,"extra":1}],
                "products":[{"slug":"a","name":"A"}],"date":"2026-11-27"}"#,
        )
        .unwrap();
        assert_eq!(o.blocks.len(), 1);
        assert_eq!(o.products[0].block, None);
        assert_eq!(serde_json::from_str::<Options>("{}").unwrap(), Options::default());
    }
}

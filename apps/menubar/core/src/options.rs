//! `GET /api/v1/capture/options`: the blocks to pick from and their products.
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

/// One block in the reply. Two shapes are understood and never crash on each other:
/// - **planner blocks** (the plan page's SOUL, BODY, ... tiles): `key`, `ring_name`, `label`, `color`, and
///   their own `products`;
/// - **schedule rows** (the first server version): `block`, `start`, `end`, `what`, `stream`, with products
///   listed at the top level and tied to a block through their `block` (a stream slug).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockOption {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub ring_name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub products: Vec<ProductOption>,
    // schedule-row shape
    #[serde(default)]
    pub block: String,
    /// "HH:MM", local time of the day the list is for.
    #[serde(default)]
    pub start: String,
    #[serde(default)]
    pub end: String,
    #[serde(default)]
    pub what: String,
    #[serde(default)]
    pub stream: Option<String>,
}

impl BlockOption {
    /// The value sent as `stream` when capturing under this block.
    pub fn stream_slug(&self) -> &str {
        [self.stream.as_deref().unwrap_or(""), &self.key, &self.block].into_iter().find(|s| !s.is_empty()).unwrap_or("")
    }

    /// The short caps name on the chip: the plan page's ring name, else the block key.
    pub fn tile(&self) -> String {
        [&self.ring_name, &self.block, &self.key].into_iter().find(|s| !s.is_empty()).map(|s| s.to_uppercase()).unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "ProductWire")]
pub struct ProductOption {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub block: Option<String>,
}

/// A product is an object, or just its slug.
#[derive(Deserialize)]
#[serde(untagged)]
enum ProductWire {
    Slug(String),
    Full {
        slug: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        block: Option<String>,
    },
}

impl From<ProductWire> for ProductOption {
    fn from(wire: ProductWire) -> Self {
        match wire {
            ProductWire::Slug(slug) => ProductOption { name: slug.clone(), slug, block: None },
            ProductWire::Full { slug, name, block } => ProductOption { name: name.filter(|n| !n.is_empty()).unwrap_or_else(|| slug.clone()), slug, block },
        }
    }
}

/// What the picker shows for one block: the chip and its products.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PickerBlock {
    /// The value filed as `stream`.
    pub value: String,
    /// SOUL, BODY, ... (monospace caps chip).
    pub tile: String,
    pub label: String,
    pub color: String,
    pub products: Vec<ProductOption>,
}

impl Options {
    /// Blocks for the picker, in server order, one per `value`, each with its own products.
    /// Planner blocks carry their products; schedule rows get the top-level products whose `block` is
    /// this block's stream slug.
    pub fn picker(&self) -> Vec<PickerBlock> {
        let mut out: Vec<PickerBlock> = Vec::new();
        for b in &self.blocks {
            let value = b.stream_slug().to_string();
            if value.is_empty() || out.iter().any(|p| p.value == value) {
                continue;
            }
            let products = if b.products.is_empty() {
                self.products.iter().filter(|p| p.block.as_deref() == Some(value.as_str())).cloned().collect()
            } else {
                b.products.clone()
            };
            let label = [&b.label, &b.what].into_iter().find(|s| !s.is_empty()).cloned().unwrap_or_default();
            out.push(PickerBlock { value, tile: b.tile(), label, color: b.color.clone(), products });
        }
        out
    }
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
        BlockOption { block: block.into(), start: start.into(), end: end.into(), stream: stream.map(String::from), ..Default::default() }
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

    #[test]
    fn planner_blocks_carry_their_products() {
        let o: Options = serde_json::from_str(
            r##"{"blocks":[
                 {"key":"soul","ring_name":"SOUL","label":"Soul","color":"#7c3aed","products":[{"slug":"quran","name":"Quran"},"dhikr"]},
                 {"key":"ops","ring_name":"OPS","label":"Operations","color":"#0ea5e9"}],
                "products":[{"slug":"alisha","name":"Alisha","block":"ops"}]}"##,
        )
        .unwrap();
        let p = o.picker();
        assert_eq!(p.iter().map(|b| b.tile.as_str()).collect::<Vec<_>>(), ["SOUL", "OPS"]);
        assert_eq!(p[0].value, "soul");
        assert_eq!(p[0].products.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), ["quran", "dhikr"]);
        assert_eq!(p[0].products[1].name, "dhikr", "a bare slug is its own name");
        assert_eq!(p[1].products[0].slug, "alisha", "falls back to top-level products tied by block");
        assert_eq!(p[0].color, "#7c3aed");
    }

    #[test]
    fn schedule_rows_still_work_and_dedupe() {
        let o: Options = serde_json::from_str(
            r#"{"blocks":[{"block":"OT","start":"06:00","end":"10:00","what":"Outcome time","stream":"OT"},
                          {"block":"OT2","start":"10:00","end":"12:00","what":"Again","stream":"OT"},
                          {"block":"DW","start":"12:00","end":"14:00","what":"Deep","stream":null}],
                "products":[{"slug":"alisha","name":"Alisha Noor","block":"OT"},{"slug":"x","name":"X","block":"DW"}]}"#,
        )
        .unwrap();
        let p = o.picker();
        assert_eq!(p.iter().map(|b| b.value.as_str()).collect::<Vec<_>>(), ["OT", "DW"]);
        assert_eq!(p[0].products[0].slug, "alisha");
        assert_eq!(p[1].products[0].slug, "x");
        assert_eq!(p[0].label, "Outcome time");
    }

    #[test]
    fn junk_never_crashes() {
        for body in ["{}", r#"{"blocks":[{}]}"#, r#"{"blocks":[{"key":""}],"products":[]}"#, r#"{"blocks":[],"products":["a"]}"#] {
            let o: Options = serde_json::from_str(body).unwrap();
            assert!(o.picker().is_empty());
        }
    }
}

//! `GET /api/v1/capture/options`: the user's streams to file under, and their products.
//!
//! A capture is filed under a **stream** (Kahf, Alisha Noor, ...). Products are an optional second pick.
//! Read tolerantly, so an older or newer server never crashes the picker:
//! ```json
//! { "streams":  [{"slug": "kahf", "name": "Kahf", "products": [{"slug": "dns", "name": "DNS"}]}],
//!   "products": [{"slug": "alisha", "name": "Alisha Noor", "block": "alisha"}] }
//! ```
//! A stream's products come from its own `products` list, else from the top-level `products` whose `block`
//! (the stream slug the planner stores a product under) is this stream. Products may also be bare slugs.
//! Unknown fields (the old schedule `blocks`, `day`) are ignored.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    #[serde(default)]
    pub streams: Vec<StreamOption>,
    #[serde(default)]
    pub products: Vec<ProductOption>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamOption {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub products: Vec<ProductOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "ProductWire")]
pub struct ProductOption {
    pub slug: String,
    pub name: String,
    /// The stream slug this product belongs to, when the server says.
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

/// What the picker shows for one stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PickerStream {
    /// The value filed as `stream`.
    pub value: String,
    /// The name on the chip.
    pub label: String,
    /// Optional second pick; empty when the stream has none.
    pub products: Vec<ProductOption>,
}

impl Options {
    /// Streams for the picker, in server order, one per slug, each with its own products.
    pub fn picker(&self) -> Vec<PickerStream> {
        let mut out: Vec<PickerStream> = Vec::new();
        for s in &self.streams {
            let value = s.slug.trim().to_string();
            if value.is_empty() || out.iter().any(|p| p.value == value) {
                continue;
            }
            let products = if s.products.is_empty() {
                self.products.iter().filter(|p| p.block.as_deref() == Some(value.as_str())).cloned().collect()
            } else {
                s.products.clone()
            };
            let label = if s.name.trim().is_empty() { value.clone() } else { s.name.trim().to_string() };
            out.push(PickerStream { value, label, products });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_with_their_products_from_either_place() {
        let o: Options = serde_json::from_str(
            r#"{"streams":[
                 {"slug":"kahf","name":"Kahf","products":[{"slug":"dns","name":"DNS"},"router"]},
                 {"slug":"alisha","name":"Alisha Noor"},
                 {"slug":"solo","name":""}],
                "products":[{"slug":"alisha-store","name":"Store","block":"alisha"},{"slug":"x","name":"X","block":"elsewhere"}]}"#,
        )
        .unwrap();
        let p = o.picker();
        assert_eq!(p.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(), ["Kahf", "Alisha Noor", "solo"]);
        assert_eq!(p[0].products.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), ["dns", "router"]);
        assert_eq!(p[0].products[1].name, "router", "a bare slug is its own name");
        assert_eq!(p[1].products[0].slug, "alisha-store", "tied by the top-level `block`");
        assert!(p[2].products.is_empty(), "products are optional");
    }

    #[test]
    fn duplicates_and_blank_slugs_are_dropped_and_order_is_kept() {
        let o: Options = serde_json::from_str(r#"{"streams":[{"slug":"b","name":"B"},{"slug":" ","name":"?"},{"slug":"a","name":"A"},{"slug":"b","name":"again"}]}"#).unwrap();
        assert_eq!(o.picker().iter().map(|s| s.value.as_str()).collect::<Vec<_>>(), ["b", "a"]);
    }

    #[test]
    fn the_old_reply_with_schedule_blocks_is_ignored_not_fatal() {
        let o: Options = serde_json::from_str(
            r#"{"blocks":[{"block":"OT","start":"06:00","end":"10:00","what":"w","stream":"OT"}],"day":"weekday",
                "streams":[{"slug":"ot","name":"One Thing"}],"products":[{"slug":"a","name":"A"}]}"#,
        )
        .unwrap();
        assert_eq!(o.picker().len(), 1);
    }

    #[test]
    fn junk_never_crashes() {
        for body in ["{}", r#"{"streams":[{}]}"#, r#"{"streams":[],"products":["a"]}"#, r#"{"blocks":[{}]}"#] {
            let o: Options = serde_json::from_str(body).unwrap();
            assert!(o.picker().is_empty());
        }
    }
}

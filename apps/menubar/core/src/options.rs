//! `GET /api/v1/capture/options`: the user's streams to file under, each with its optional products.
//!
//! Contract (niyyah `docs/capture-api.md`): every non-archived stream, products nested under each stream.
//! ```json
//! { "streams": [{"slug": "kahf", "name": "Kahf", "color": "violet", "products": []},
//!               {"slug": "alisha", "name": "Alisha Noor", "color": "rose", "products": [{"slug": "cart", "name": "Cart"}]}] }
//! ```
//! A stream has no short name: show `name`. The deprecated top-level `blocks`, `products` and `day` are ignored.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    #[serde(default)]
    pub streams: Vec<StreamOption>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamOption {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub name: String,
    /// A colour key ("violet", "rose", ...).
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub products: Vec<ProductOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductOption {
    pub slug: String,
    #[serde(default)]
    pub name: String,
}

/// What the picker shows for one stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PickerStream {
    /// The value filed as `stream`.
    pub value: String,
    /// The name on the chip.
    pub label: String,
    pub color: String,
    /// Optional second pick; empty when the stream has none.
    pub products: Vec<ProductOption>,
}

impl Options {
    /// Streams for the picker, in server order, one per slug.
    pub fn picker(&self) -> Vec<PickerStream> {
        let mut out: Vec<PickerStream> = Vec::new();
        for s in &self.streams {
            let value = s.slug.trim().to_string();
            if value.is_empty() || out.iter().any(|p| p.value == value) {
                continue;
            }
            let label = if s.name.trim().is_empty() { value.clone() } else { s.name.trim().to_string() };
            let products = s
                .products
                .iter()
                .filter(|p| !p.slug.trim().is_empty())
                .map(|p| ProductOption { slug: p.slug.clone(), name: if p.name.trim().is_empty() { p.slug.clone() } else { p.name.clone() } })
                .collect();
            out.push(PickerStream { value, label, color: s.color.clone(), products });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_products_and_names() {
        let o: Options = serde_json::from_str(
            r#"{"streams":[
                 {"slug":"kahf","name":"Kahf","color":"violet","products":[]},
                 {"slug":"alisha","name":"Alisha Noor","color":"rose","products":[{"slug":"cart","name":"Cart"},{"slug":"store"}]},
                 {"slug":"solo","name":""}]}"#,
        )
        .unwrap();
        let p = o.picker();
        assert_eq!(p.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(), ["Kahf", "Alisha Noor", "solo"], "the name is shown");
        assert!(p[0].products.is_empty(), "products are optional");
        assert_eq!(p[1].products.iter().map(|x| (x.slug.as_str(), x.name.as_str())).collect::<Vec<_>>(), [("cart", "Cart"), ("store", "store")]);
        assert_eq!(p[1].color, "rose");
    }

    #[test]
    fn deprecated_top_level_fields_are_ignored() {
        let o: Options = serde_json::from_str(
            r#"{"streams":[{"slug":"alisha","name":"Alisha Noor","products":[]}],
                "products":[{"slug":"old","name":"Old","block":"alisha"}],
                "blocks":[{"block":"OT","start":"06:00","end":"10:00","what":"w"}],"day":"weekday"}"#,
        )
        .unwrap();
        assert!(o.picker()[0].products.is_empty(), "the flat products list is no longer read");
    }

    #[test]
    fn duplicates_and_blank_slugs_are_dropped_and_order_is_kept() {
        let o: Options = serde_json::from_str(r#"{"streams":[{"slug":"b","name":"B"},{"slug":" ","name":"?"},{"slug":"a","name":"A"},{"slug":"b","name":"again"}]}"#).unwrap();
        assert_eq!(o.picker().iter().map(|s| s.value.as_str()).collect::<Vec<_>>(), ["b", "a"]);
    }

    #[test]
    fn junk_never_crashes() {
        for body in ["{}", r#"{"streams":[{}]}"#, r#"{"streams":[]}"#, r#"{"blocks":[{}]}"#] {
            let o: Options = serde_json::from_str(body).unwrap();
            assert!(o.picker().is_empty());
        }
    }
}

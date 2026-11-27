//! HTTP client for the two routes a device token may use.
//!
//! - `POST /api/v1/vault/items`
//! - `GET  /api/v1/capture/options`
//!
//! The token goes only in the `Authorization` header to the configured host.
//! Redirects are never followed, so a redirect cannot carry it to another host.

use std::time::Duration;

use url::Url;

use crate::error::Error;
use crate::options::Options;
use crate::payload::ItemPayload;
use crate::token::Token;
use crate::url_guard::{endpoint, parse_base_url};

pub const ITEMS_PATH: &str = "/api/v1/vault/items";
pub const OPTIONS_PATH: &str = "/api/v1/capture/options";

/// How one POST ended, in the terms the queue acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    /// 2xx: the server has it.
    Created,
    /// Network error, timeout, 408/425/429/5xx, or an unexpected redirect: try again later.
    Retry(String),
    /// 401/403: the token is wrong, revoked or not allowed. Keep the capture, tell the user.
    AuthFailed(u16),
    /// Another 4xx: the server will never accept this capture as is.
    Rejected(String),
}

pub struct Client {
    base: Url,
    agent: ureq::Agent,
}

impl Client {
    /// `base_url` must be https (http only to localhost).
    pub fn new(base_url: &str) -> Result<Self, Error> {
        let base = parse_base_url(base_url)?;
        let agent = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout_connect(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("niyyah-capture/", env!("CARGO_PKG_VERSION")))
            .build();
        Ok(Self { base, agent })
    }

    pub fn post_item(&self, token: &Token, item: &ItemPayload) -> SendOutcome {
        let url = endpoint(&self.base, ITEMS_PATH);
        let res = self
            .agent
            .post(&url)
            .set("Authorization", &format!("Bearer {}", token.expose()))
            .set("Accept", "application/json")
            .send_json(item);
        classify(res)
    }

    pub fn get_options(&self, token: &Token) -> Result<Options, Error> {
        let url = endpoint(&self.base, OPTIONS_PATH);
        let res = self
            .agent
            .get(&url)
            .set("Authorization", &format!("Bearer {}", token.expose()))
            .set("Accept", "application/json")
            .call();
        match res {
            Ok(resp) if (200..300).contains(&resp.status()) => resp.into_json::<Options>().map_err(|_| Error::Fetch("the options reply was not understood".into())),
            Ok(resp) => Err(Error::Fetch(format!("HTTP {}", resp.status()))),
            Err(ureq::Error::Status(code, _)) => Err(Error::Fetch(format!("HTTP {code}"))),
            Err(ureq::Error::Transport(t)) => Err(Error::Fetch(transport_kind(&t))),
        }
    }
}

fn classify(res: Result<ureq::Response, ureq::Error>) -> SendOutcome {
    match res {
        Ok(resp) => {
            let s = resp.status();
            if (200..300).contains(&s) {
                SendOutcome::Created
            } else {
                // 3xx (redirects are off): the server URL is probably wrong. Keep the capture.
                SendOutcome::Retry(format!("unexpected HTTP {s}; check the server URL"))
            }
        }
        Err(ureq::Error::Status(code, _)) => match code {
            401 | 403 => SendOutcome::AuthFailed(code),
            408 | 425 | 429 | 500..=599 => SendOutcome::Retry(format!("HTTP {code}")),
            _ => SendOutcome::Rejected(format!("the server refused this capture (HTTP {code})")),
        },
        Err(ureq::Error::Transport(t)) => SendOutcome::Retry(transport_kind(&t)),
    }
}

/// A short label for a transport failure. Deliberately not the full error text.
fn transport_kind(t: &ureq::Transport) -> String {
    format!("network: {:?}", t.kind())
}

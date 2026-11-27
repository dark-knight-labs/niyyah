use url::{Host, Url};

use crate::error::Error;

/// Parse and vet the configured server URL.
///
/// - https is accepted for any host;
/// - http only for `localhost` / loopback addresses (tests, local dev);
/// - credentials, query and fragment are refused (a token never belongs in a URL).
///
/// The returned URL has no trailing slash, so endpoints are `endpoint(&base, "/api/...")`.
pub fn parse_base_url(raw: &str) -> Result<Url, Error> {
    let mut url = Url::parse(raw.trim()).map_err(|_| Error::InvalidUrl)?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(Error::InvalidUrl);
    }
    let host = url.host().ok_or(Error::InvalidUrl)?;
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(&host) => {}
        "http" => return Err(Error::InsecureUrl),
        _ => return Err(Error::InvalidUrl),
    }
    let trimmed = url.path().trim_end_matches('/').to_string();
    url.set_path(&trimmed);
    Ok(url)
}

fn is_loopback(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(d) => d.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => ip.is_loopback(),
    }
}

/// Join an API path onto the vetted base URL.
pub fn endpoint(base: &Url, path: &str) -> String {
    format!("{}{}", base.as_str().trim_end_matches('/'), path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_is_accepted_and_trailing_slash_trimmed() {
        let u = parse_base_url("https://niyyah.example.com/").unwrap();
        assert_eq!(endpoint(&u, "/api/v1/vault/items"), "https://niyyah.example.com/api/v1/vault/items");
    }

    #[test]
    fn http_is_refused_except_for_loopback() {
        assert!(matches!(parse_base_url("http://niyyah.example.com"), Err(Error::InsecureUrl)));
        assert!(matches!(parse_base_url("http://10.0.0.5:8000"), Err(Error::InsecureUrl)));
        assert!(matches!(parse_base_url("http://localhost.evil.com"), Err(Error::InsecureUrl)));
        assert!(parse_base_url("http://localhost:8000").is_ok());
        assert!(parse_base_url("http://127.0.0.1:8000").is_ok());
        assert!(parse_base_url("http://[::1]:8000").is_ok());
    }

    #[test]
    fn other_schemes_credentials_query_fragment_refused() {
        for bad in [
            "ftp://x.example.com",
            "file:///etc/passwd",
            "https://user:pw@x.example.com",
            "https://user@x.example.com",
            "https://x.example.com/?token=abc",
            "https://x.example.com/#frag",
            "not a url",
            "",
        ] {
            assert!(parse_base_url(bad).is_err(), "{bad} must be refused");
        }
    }
}

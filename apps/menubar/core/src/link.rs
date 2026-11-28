//! Task links: only plain http(s) links without credentials may be opened.
//!
//! The web layer validates too (`ui/tasklogic.js`), but this is the check that counts: the shell
//! asks it before it hands anything to the system opener.

use url::Url;

use crate::error::Error;

/// Parse a task link. Accepts `http` and `https` with a host and no username or password.
pub fn validate_web_link(raw: &str) -> Result<Url, Error> {
    let url = Url::parse(raw.trim()).map_err(|_| Error::BadLink)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::BadLink);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_https() {
        assert_eq!(validate_web_link("https://example.com/a?b=1#c").unwrap().as_str(), "https://example.com/a?b=1#c");
        assert!(validate_web_link("http://localhost:8080").is_ok());
        assert!(validate_web_link("  https://example.com  ").is_ok());
    }

    #[test]
    fn refuses_other_schemes() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "ssh://host/x",
            "mailto:a@b.c",
            "tel:123",
            "x-apple.systempreferences:",
            "/Applications/Calculator.app",
        ] {
            assert!(validate_web_link(bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn refuses_credentials_and_hostless() {
        assert!(validate_web_link("https://user@example.com").is_err());
        assert!(validate_web_link("https://user:pw@example.com").is_err());
        assert!(validate_web_link("https://:pw@example.com").is_err());
        assert!(validate_web_link("https://").is_err());
        assert!(validate_web_link("").is_err());
        assert!(validate_web_link("not a url").is_err());
    }
}

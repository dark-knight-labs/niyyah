# Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab), not in a public issue. Include what you found, how to reproduce it and the version. You can expect an answer within a few days.

Supported: the latest release. Niyyah stores personal data, so please also tell us if you find a way to read another user's data, forge a login token, or reach the database or server through the app.

For operators: generate a long random `SECRET_KEY`, keep `.env` out of version control, run behind HTTPS, and set `TRUST_FORWARDED_FOR=true` only behind a proxy you control.

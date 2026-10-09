# Third-party licences

Niyyah is MIT licensed. Its dependencies were checked on 2026-10-09 (`pip-licenses` for the API, the lockfile for the web app).

**API (92 Python packages).** Almost all MIT, BSD, Apache-2.0, ISC or PSF. Exceptions worth knowing:

- `recurring-ical-events` and `x-wr-timezone` are LGPL-3.0-or-later. They are installed from PyPI, unmodified, and used as libraries, which the LGPL allows from an MIT project; anyone can replace them with another version.
- One MPL-2.0 package (file-level copyleft, unmodified).

**Web (486 npm packages).** 80% MIT, the rest Apache-2.0, ISC, BSD, MPL-2.0 (build tooling) and OFL-1.1 (the self-hosted fonts). The LGPL entries are the optional prebuilt `sharp`/`libvips` binaries that Next.js uses for image optimisation; they are linked dynamically and unmodified.

Nothing is licensed under a network-copyleft (AGPL/SSPL) or non-commercial licence. Re-check when adding a dependency; Dependabot keeps versions current.

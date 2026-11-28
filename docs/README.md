# Testing Portal (temporary solution)

A static web app for the service desk that checks pain.001 payment files (ISO 2009 `.03` and ISO 2019 `.09`) and shows all findings at once. Everything runs in the browser: the payment file never leaves the computer.

**Current milestone:** M3: fix the errors, runs and comparison, email for the customer (0.4.1-m3, with the Catalogue page). See `docs/specs/M3.md` and `docs/specs/M3-catalogue.md`. Generic ISO and catalogue rules; the country specifications follow as updates.

## Use it

- **Offline file:** open `dist/testing-portal.html` in Edge or Chrome. No installation, no internet needed.
- **Locally from the separate files:** `cd dist/site` and `python -m http.server`, then open `http://localhost:8000`.

## Change it

- Read `docs/ARCHITECTURE.md` first, then the spec of the current milestone in `docs/specs/`.
- Rules: `docs/RULES.md`.
- Build: `docs/BUILD.md`.
- What changed: `docs/CHANGELOG.md`. What it cannot do: `docs/LIMITS.md`.

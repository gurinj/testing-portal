# M3 addition – Catalogue page

**Status:** done · green light 2026-11-28
**Version:** 0.4.1-m3
**Source:** the catalogue document "Payments Validator – pain.001 Validation Catalogue (Phase 1)" in the Claude project, state of 2026-11-28 (with the "In the app" and "Built in" columns), and its HTML copy `claude/payments-validator-validation-catalogue.html`, whose design the screen follows.

## 1. Decisions (2026-11-28)

- A screen inside the app, not a separate HTML page: same header, styles, router and offline file.
- The whole document is shown, in its order: validation flow, stages 0–10 with their check tables, decisions after confirmation, result report, out of scope, open points, sources.
- Menu: Validate · Catalogue · About.
- About keeps This version, Limits, Settings, Third-party software and the link to the technical check. "What is checked" no longer lists the checks; it links to the Catalogue page (no duplicated information).
- Version 0.4.1-m3.

## 2. Screen

| Screen | Address | Contents |
|---|---|---|
| Catalogue | `#catalogue` | Title, lead and facts of the document (as of, checks, run, off, not built); where the content and the marks come from; links to the sections; the sections in the document's order. Around the stages: a strip to jump to a stage (checks per stage, how many do not run), a filter bar (sticky on wide screens) with status chips, severity chips, search and "N of 147 checks". Check tables: ID, check, severity, code, In the app (status tag and the rest of the text), Built in (engine tag and what the JavaScript does). |

- Section links are buttons that scroll (`data-act="cat-go"`): the address after `#` is the app's screen, so sections have no anchors of their own.
- On phones the tables become stacked cards with a label per value, as on the HTML copy.
- Links of the document open in a new tab; only `https` links become links.

## 3. Data

- `config/catalogue-doc.json` is made by `node tools/update-catalogue.js` from `docs/reference/validation-catalogue.md`, the Markdown export of the document. The document stays the original; the file is never edited by hand.
- Sections: `{ id, title, stage?, note?, blocks }`; blocks are `p`, `h3`, `ul`, `ol`, `tasks` (open points), `table`, and `checks` with rows `{ id, check, sev, code, app, status, built }`. Text keeps the document's inline Markdown (links, `code`, bold); the screen turns it into HTML.
- The status of a row comes from the "In the app" text: Yes → runs, Off, Built but cannot fire, Covered by, Not built.
- Loaded when the page is first opened (`TP.assets`, so it also works in the offline file, which embeds it).

## 4. Settings in use

The document describes the app with its built-in settings. On top of that each row shows what `settings.checks` of the settings in use changes for the check or its parts (switched off, severity, reason code); this includes a settings file loaded on About for the session. A check switched off as a whole counts as Off in the chips and facts, with the document's status crossed out. Settings per country are not shown (the page is not about one country). Checks that are off because a limit or list is empty in the settings are shown as the document says.

## 5. Tests

`tests/features/catalogue.test.js`:

- `config/catalogue-doc.json` is the conversion of the Markdown export.
- The document's checks are the checks of `config/catalogue.json` (rules and not implemented), each once; "Not built" and "Covered by" match it.
- Severities, part severities and reason codes of the document are what the app reports with the built-in settings.
- "Built in" matches the code: the stage 0 and 1 files, the XSD worker, the Schematron rule files, and for "Schematron + JS: payment type" the payment-type functions.
- Screen: 147 rows, every section, no `#` anchors, counts with the built-in settings, the marks for 4.2, 4.30 and 7.13, a session settings file that switches a check off and changes a severity, escaping of text and links, the loading state.
- Menu order, scripts loaded before the app, the offline file embeds the data, About links to the Catalogue page and keeps its other panels, version 0.4.1-m3.

## 6. Checklist

- [x] Spec
- [x] `tools/update-catalogue.js`, `docs/reference/validation-catalogue.md`, `config/catalogue-doc.json`
- [x] `js/ui/catalogue.js`, `css/catalogue.css`, menu item, offline embedding
- [x] About: link instead of the list of checks
- [x] Tests, docs, changelog 0.4.1-m3
- [x] Build with all tests; Chrome check of site and offline file (desktop and phone)

# M3 – brief for the helpers

Written 2026-11-24 by the main session. Each helper builds one part in its **own copy** of the project and reports back; the main session merges the copies into `/home/claude/testing-portal`.

| Helper | Copy | Part | Owned files |
|---|---|---|---|
| c1 | `/home/claude/work/c1/testing-portal` | Run comparison | `js/compare/compare.js`, `js/ui/compare.js`, `css/compare.css`, `tests/features/compare.test.js` |
| e1 | `/home/claude/work/e1/testing-portal` | Email | `js/email/build.js`, `config/templates/email.en.json`, `js/ui/email.js`, `css/email.css`, `tests/features/email.test.js` |
| f1 | `/home/claude/work/f1/testing-portal` | Fix actions | `js/fix/actions/*.js`, `config/fixes.json`, `tests/features/fix-actions.test.js` |

## Read first

1. `docs/specs/M3.md`: the whole spec, especially section 1 (decisions) and the section of your part. The shapes in sections 3.2, 4, 5 and 6 are the contract between the parts: keep to them; if one does not work, say so in your report instead of changing it silently.
2. `docs/ARCHITECTURE.md` and the code you build on: `js/validation/findings/report.js` (the report object: `groups`, `items`, `blocks`, `facts`, `status`, `counts`), `js/app.js` (screens, `TP.ui.screens`, `TP.ui.actions`), `js/ui/common.js` (helpers `TP.ui.h`: `esc`, `ic`, `plural` …), `js/ui/report.js` and `js/ui/exports.js` (style of the screens, downloads through `TP.platform.download`), `css/base.css` and `css/app.css` (design tokens and existing classes: use them, add only what is missing in your own CSS file).
3. Prototype v2 is the design reference; the main session has read it. The relevant parts are described in `docs/specs/M3.md` section 2; follow them.

## Rules

- Plain browser JavaScript in the style of the existing files: an IIFE on `self`/`globalThis`, `'use strict'`, attaching to `TP`. No modules, no libraries, no network. The same files must run in Node for the tests (no DOM access at load time).
- User-facing text: plain English for service desk staff and corporate customers, short sentences, no jargon beyond the ISO element names the users know.
- Your screen registers itself: `TP.ui.screens.<name> = { view(state), mount(state), nav: 'start', title(state), hash: '#<name>', needs(state) }` and its buttons `TP.ui.actions['<act>'] = (dataset, state) => …`; navigate with `TP.app.go('<name>')`, re-render with `TP.app.render()`. Do not edit `js/app.js`, `js/ui/report.js` or `index.html`; list the script and CSS tags the main session must add (and the report buttons or links that lead to your screen) in your report.
- Nothing is stored (no localStorage for results or texts) and nothing is sent.

## Tests

`tests/features/<file>.test.js` exports `module.exports = async t => { … }` with `t` = `{ ok, head, gen, rules, xsd, validate, tally, sorted, contextFor, catalogue, TP, clean03, clean09, ROOT }` (see `docs/specs/M2-helpers.md` for `gen`, `validate`, `rules`). Call `head('M3 <part>: …')` first. Require your own files in the test (`require(path.join(t.ROOT, 'js/compare/compare.js'))`). `validate(xml, '03' | '09', country)` gives a report object like the page's (`TP.validation.validate` adds `fileName`, `country`, `version`, `text`, `app`, `at`; add what you need in the test).

`node tools/build.js` runs all tests and builds the offline file; it must pass in your copy. For a look at your screen in a real browser there is a headless Chrome with puppeteer-core in `/home/claude/devtools` (see `m2-ui.mjs` and `check-page.mjs` there); a screenshot of your screen is welcome but not required.

## Report (your final message)

1. What you built, file by file, in a few lines each, and anything the spec left open that you decided.
2. The script and CSS tags for `index.html`, the config files the offline build must embed (`tools/build.js`, function `add`), and how the report should lead to your screen.
3. Changes outside your owned files, as exact snippets (old → new).
4. Test count; anything not done and why.

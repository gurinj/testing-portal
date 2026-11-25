# Testing Portal – Architecture

**Status:** M3 (fix the errors, runs and comparison, email for the customer) · 2026-11-24
**Read this first** in every new working session, together with `docs/specs/` and `docs/CHANGELOG.md`.

The Testing Portal is a static web app: HTML, CSS and JavaScript only. A payment file is checked entirely in the browser and never leaves the user's computer.

## 1. How a file is checked

```
main thread                       XSD worker (libxml2, WebAssembly)     rules worker (SaxonJS)
-----------                       ---------------------------------     ----------------------
stage 0  intake: 0.1 empty, 0.2 size,
         0.3 not XML, 0.5 encoding,
         0.8 DOCTYPE / ENTITY
stage 1  identify: 1.1 Document, 1.2 namespace
         → .03 / .09, 1.3 CstmrCdtTrfInitn,
         1.4 version for the country
         ─────── both workers start at the same time ───────
                                  stage 0  0.7 well-formed, 0.9 content  parse once (SaxonJS)
                                           after the root (libxml2)      stages 3–10: every compiled
                                  stage 2  XSD 2.1–2.11, all errors      rule file that fits version
                                           with line, path, value;       and country, with the settings
                                                                         and reference data; SVRL → findings;
                                           checks again after an         one saxes pass for line,
                                           element out of place          column, value and the summary
                                                                         (blocks, transactions, payment type)
         ◄──────────────────── findings ────────────────────────────────
pipeline: not well-formed → stop with stage 0 findings; otherwise XSD + rule findings together
report (findings/report.js): settings.checks (off, severity, code) → catalogue texts → suppression → groups → status per file, block,
                             transaction → counts per module → facts and exact totals
status: RJCT (any error) · ACWC (only warnings) · ACTC
```

- `js/validation/pipeline.js` is the order of the stages. Each stage file returns `{ stop, findings }` and knows nothing about the others.
- Only stage 0 and stage 1 can stop the run. XSD errors never stop it: all findings are shown at once.

**Settings and context (M2).** At start the page loads `config/settings.json`, the country files and `config/reference/*.json` (`TP.reference`; also sent to the rules worker at init). For each file, `TP.functions.settingsFor(settings, countryConfig)` merges the country's `settings` over the general ones; the result goes to the rules worker as `context { country, countryConfig, settings }` (`TP.context` there) and to the report builder (`settings.checks`). A settings file loaded on the About page replaces the general settings for the session (`TP.validation.useSettings`, merged over the built-in ones). The rules read everything through the functions in `js/validation/functions/` (`settings.js` lists them); the time of the check is `TP.context.now` or the clock.

**Payment type (M2).** `functions/payment-type.js` derives one type per transaction (cached per node, block fields read once per block). The rules call `js:tpPaymentType(.)` / `js:tpBlockType(.)`; after the rules, `rules-core.js` classifies the summary's transactions with the same function, so the report shows the type the rules used.

**Fix, runs, comparison, email (M3).** Nothing here changes the validation: a fix makes a new text and validates it again through the same pipeline.

```
report ──► propose (js/fix/propose.js)   config/fixes.json: per check id(-part) the action, field, check of typed values,
            │                             changesPayment, options, sample; actions in js/fix/actions/*.js
            │  one saxes pass (locate.js) finds every element the proposals need, with exact text positions
            ▼
         fix screen (#fix) ──► apply (edit.js): selected rows → edits, sorted, one pass over the text;
                                               only the changed values differ, every other byte stays as sent
            ▼
         revalidate (app.js) ──► pipeline ──► TP.session.add: run 2, parent 1, changes ──► report with the runs strip
                                                                                     ├─► #compare (js/compare)
                                                                                     └─► #email (js/email)
```

- `TP.session` (`js/fix/session.js`) holds the runs of the browser session: number, file name, status, counts, parent, changes; text and full result for the last 3 runs only, the comparison keys for the others. Nothing is stored or sent.
- A run's chain goes back to the first upload of the file (a new version with the same MsgId or file name continues it). Changes and the corrected-file name count from the latest upload (`segment`): a new version from the customer is the customer's own file.
- Comparison (`js/compare/compare.js`): findings matched by check and place (PmtInfId, EndToEndId, else position), so inserted or removed payments do not shift the result.
- Email (`js/email/build.js`): texts from `config/templates/email.en.json`; never amounts, names or account numbers from the file (finding messages and old/new values are not used).
- Screens and buttons outside `app.js` register themselves: `TP.ui.screens.<name> = { view, mount, nav, title, hash, needs }` and `TP.ui.actions[act] = (dataset, state)`.

## 2. Files

| Folder | What is in it |
|---|---|
| `index.html`, `css/`, `fonts/` | The page and its design (tokens in `css/base.css`). |
| `js/platform.js` | Everything that differs between site, Claude artifact and offline file: loading files, starting workers, downloads, clipboard. |
| `js/validation/` | Pipeline, stages, workers, findings; `functions/` the JavaScript the rules call (settings, payment type, IBAN/BIC/LEI/RF, character sets, dates, guideline lists, and one file per stage for its own helpers); the list of function files is in `rules-worker.js` (the tests and tools read it from there). |
| `js/ui/` | Screens: `start.js`, `run.js`, `report.js`, `xml-viewer.js`, `about.js`, `technical-check.js`, `fix.js`, `compare.js`, `email.js`; `exports.js` (CSV, printable report, summary); `common.js` (icons, wording). `js/app.js` holds the state, the core screens and the events. |
| `js/fix/` | M3 fixes: `locate.js` (elements and exact positions, one saxes pass), `edit.js` (apply, preview), `checks.js` (checks of typed values), `propose.js`, `session.js` (runs), `actions/` (one file per kind of fix). |
| `js/compare/`, `js/email/` | M3 run comparison and email builder (no DOM, also used by the Node tests). |
| `js/dev/` | Test file generator (used by the check page and the Node tests). |
| `rules/` | Schematron sources: `stages/` (one file per catalogue stage, written for `.03`, compiled for `.03` and `.09`), `countries/` (11 files, empty until the country rules come). |
| `config/` | `app.json` (version, rules date, size limit, list of countries), `catalogue.json` (title, check, hint, reason code and module of every check id, `parts` with their own title, `coveredBy`), `settings.json` (limits, lists, guideline values, `checks`), `countries/<CC>.json` (currency, SEPA, character set, versions, holidays, cut-off, payment types, domestic codes, `settings`), `reference/` (ISO and EPC lists, see its README), `fixes.json` (what the Fix screen proposes per check), `templates/email.en.json` (texts of the email). |
| `schemas/` | Official ISO 20022 XSDs pain.001.001.03 and .09. |
| `lib/` | Third-party browser code (see section 8). |
| `tests/` | `run-tests.js` (general tests, then every `stages/*.test.js` and `features/*.test.js`), `expected/`, `lib/engine.js` (the engine in Node without workers) and `run-bank.js` (the bank's test files in `files/bank/`, never committed or zipped). |
| `tools/` | `build.js`, vendored build tools (`tools/vendor/`). |
| `dist/` | Build output, never edited. |

## 3. Three ways the app runs

| Mode | How | Workers | Files |
|---|---|---|---|
| site | `dist/site/` on a web server (python http.server now, GitHub Pages later) | rules: classic worker by path; XSD: module worker by path | `fetch()` by relative path |
| artifact | `dist/site/` published as a Claude artifact | as site | as site |
| offline | `dist/testing-portal.html` opened from disk | both classic workers from `blob:` URLs, source embedded by the build | embedded in `window.TP_EMBEDDED` |

Only `js/platform.js` knows the mode (`TP.platform.mode()`).

Learned in M0:
- A module worker cannot be started from a `blob:` URL on a page opened from disk, so the offline build wraps the libxml2 bundle in an async function and runs it as a classic worker.
- Workers post `{ type: 'loaded' }` before anything else; the page sends `init` only after it. The libxml2 module loads asynchronously and would otherwise lose the `init` message.
- In the Claude artifact, downloads go through the artifact's download feature, which accepts only some file types (csv, txt, json, html, zip, … — not xml), and printing is not allowed.

## 4. Finding format

Every stage returns raw findings in this shape:

```js
{
  source:   'intake' | 'identify' | 'xsd' | 'rules',
  rule:     '4.3',          // catalogue check id
  stage:    4,              // catalogue stage 0–10
  severity: 'E' | 'W' | 'I',
  code:     'AM19',         // ISO status reason code, or null
  level:    'file' | 'block' | 'tx',
  message:  'The number of transactions …',
  xpath:    '/Document[1]/CstmrCdtTrfInitn[1]/GrpHdr[1]/NbOfTxs[1]',
  line: 4, col: 5,          // position in the file, or null (libxml2 gives no column)
  actual:   '13',           // value of a leaf element, or null
  expected: 'YYYY-MM-DD',   // XSD findings only
  block: 1, tx: 7           // from the path
}
```

`findings/report.js` turns them into the report the screens use:

- **items** – each finding with the catalogue title, check and hint, `where` ("Block 2, transaction 7"), EndToEndId and creditor of its transaction;
- **suppression** – a rule finding on an element whose value already failed the XSD (2.6–2.11, same path) is not shown; the XSD finding lists it (`suppresses`);
- **groups** – one per rule and level (XSD: also per element and message pattern), with all places (`items`) and `count`;
- **status** – file: RJCT with any error, ACWC with only warnings, else ACTC. Transaction: RJCT if it, its block or the file has an error. Block: RJCT if it, the file or any of its transactions has an error. PART is not used until a country accepts files partly;
- **modules** – counts per module of the catalogue (intake, xsd, iso, guideline, types, consistency), `notRun` after a stop, `planned` when no rule file exists yet;
- **facts** – blocks, transactions and totals per currency, added exactly (BigInt, 5 decimals).

Check ids of stages 0–2 follow the catalogue: 0.1 empty, 0.2 too large, 0.3 not an XML file (archive, PDF, Office, text), 0.5 not UTF-8 or declared otherwise, 0.7 not well-formed, 0.8 DOCTYPE/ENTITY, 0.9 content after the root; 1.1 root is not Document, 1.2 namespace not pain.001.001.03/.09 (with a hint for pain.008, camt and others), 1.3 message element is not CstmrCdtTrfInitn, 1.4 version not accepted for the country; 2.1 order, 2.2 mandatory, 2.3 too often, 2.4 unknown, 2.5 choice, 2.6 length or empty, 2.7 pattern, 2.8 code list, 2.9 amount, 2.10 date, 2.11 true/false (`classify()` in `xsd-worker.mjs`). 0.4, 0.6, 0.10, 1.5 and 1.6 are not possible yet (`notImplemented` in the catalogue).

**All XSD errors at once.** libxml2 stops checking the rest of an element after a child that is out of place, repeated, unknown or after a missing mandatory element. The XSD worker then changes the parsed document and checks again (up to 8 passes): a child that does not belong there is removed; for a missing element, or one removed earlier but needed later (two elements swapped), an empty placeholder is put in its place. Element positions are mapped back to the original file; errors inside placeholders and errors caused only by a removal are dropped. Whether an element is out of place or a mandatory one is missing is decided by the following siblings: if none of the expected elements comes later, it is 2.2 (missing), otherwise 2.1 (order).

**Lines and columns.** libxml2 gives only a line (with `XML_PARSE_BIG_LINES`, also above 65,535). The XSD worker takes line and column from the text of the file instead (`locate()`, one pass), so a file without line breaks still has columns. Rule findings get their path from `js/validation/functions/location.js` (SchXslt's own location function counts all earlier siblings for every finding, which took 14 s for 10,000 findings), and line, column and value from `findings/scan.js`.

## 5. Workers

| Worker | Messages in | Messages out |
|---|---|---|
| XSD (`xsd-worker.mjs`) | `init {schemas: {'03': xsd, '09': xsd}}`, `validate {id, xml, version}` | `loaded`, `ready {info}`, `result {id, wellFormed, errors[], truncated, passes, ms}`, `error` |
| rules (`rules-worker.js`) | `init {ruleSets, reference}`, `validate {id, xml, version, country, context}` | `loaded`, `ready {info}`, `result {id, findings[], summary, timings, ran[]}`, `error` |

`js/validation/worker-client.js` handles request ids and the loaded → init → ready sequence.

The rules worker runs the **SaxonJS 2.7 Node build (`SaxonJS2N.js`) unchanged**, with small stand-ins for the Node features it refers to (`js/validation/saxon-node-shim.js`). The browser build of SaxonJS could not be downloaded in the build environment; the Node build works in a worker because it brings its own XML parser. Shared files must not write `module.exports` in the browser: they check for Node with `process.versions.node`.

## 6. Rule files

- Schematron, query binding `xslt2`, compiled by SchXslt 1.9.5 to XSLT and by the SaxonJS compiler to SEF (JSON) at build time.
- A processing instruction before `<sch:schema>` tells the build where the file applies: `<?testing-portal stage="4" versions="03 09" countries="*"?>`.
- Rule files are written for the `.03` namespace. The build compiles one variant per version in the processing instruction, replacing the namespace (ids like `stages/04-iso-business-rules@09`); the rules worker runs only the variant of the file's version. Rules must therefore work on both structures (for example `ReqdExctnDt` vs `ReqdExctnDt/Dt`).
- A file without `<sch:pattern>` is not compiled (the 11 country files for now).
- Conventions: `id="R<check>"`, `role` = error | warning | information, `flag` = reason code.
- Functions in JavaScript are called with `xmlns:js="http://saxonica.com/ns/globalJS"`, for example `js:tpIbanValid(string(.))` (`js/validation/functions/`).
- Performance rules are in `docs/RULES.md` and are mandatory: without them a 10,000-transaction file took minutes instead of seconds.
- Runtime compilation in the browser was tested in M0 and works (sch → xsl in 0.1 s, compile and run in 1.5 s). It is an option for changing rule files without a build; not used yet.

## 7. Build and tests

`node tools/build.js` (Node.js only, no downloads):
1. copies the site files to `dist/site/`;
2. compiles every `.sch` with rules in `rules/stages/` and `rules/countries/`, once per version, and writes `dist/site/rules/manifest.json`;
   The compiled XSLT is changed before the SEF step: elements only (no attribute or text visits), `js:tpLocation` for locations, and no `svrl:fired-rule` output (`slimReport`, about 40 % faster).
3. runs `tests/run-tests.js` (same code as the browser: stages 0–2, XSD worker functions, rules core, report builder), then `tests/run-bank.js` if the bank's test files are on this computer (lists changes, does not stop the build);
4. builds `dist/testing-portal.html` with everything embedded.

`node tools/build.js --no-tests` skips step 3. `node tools/speed-rules.js 10000` times each rule file on a generated file.

## 8. Screens

| Screen | Address | File |
|---|---|---|
| Start: file, detected format, country | `#` | `js/ui/start.js` |
| Run: one card per module with the real progress | – | `js/ui/run.js` |
| Report: status, facts, module strip, severity chips, search, findings by level, payment blocks and transactions | `#report` | `js/ui/report.js` |
| XML viewer: line markers, step through findings, go to line; only the lines in view are in the page | `#xml` | `js/ui/xml-viewer.js` |
| About: version, what is checked, limits, notices | `#about` | `js/ui/about.js` |
| Fix the errors: proposals per finding, before/after view, apply and validate again | `#fix` | `js/ui/fix.js` |
| Compare runs: resolved, still open, new | `#compare` | `js/ui/compare.js` |
| Email for the customer: To, subject, text, Copy, Open in email app, attachments | `#email` | `js/ui/email.js` |
| Technical check: engines, 10 built-in checks (one a whole fix round), speed, results to send | `#check` | `js/ui/technical-check.js` |

Exports (`js/ui/exports.js`): findings as CSV (one row per place, semicolon, UTF-8 with byte-order mark, cells starting with = + - @ get a leading apostrophe) and the printable report (one HTML file with a Print button; fonts embedded when the page has them embedded). M3: the CSV has a Run column; the printable report adds the runs, the original result, the sample values and the changes; the summary to share adds the counts per run (still no values).

## 9. Third-party components

| Component | Version | Where | Licence |
|---|---|---|---|
| SaxonJS (Node build, unchanged) | 2.7 | `lib/saxon/` | Saxonica licence: free of charge, redistribution in binary form allowed with the notice (`lib/saxon/LICENSE.txt`) |
| libxml2-wasm (bundled with esbuild) | 0.7.2 | `lib/libxml2/` | MIT; libxml2 itself MIT |
| saxes, xmlchars (bundled with esbuild) | 6.0.0 | `lib/saxes/` | ISC, MIT |
| SchXslt (build only) | 1.9.5 | `tools/vendor/schxslt-1.9.5/` | MIT |
| xslt3 (build only) | 2.7 | `tools/vendor/node_modules/` | Saxonica licence |
| ISO 20022 schemas pain.001.001.03 / .09 | 2009 / 2019 | `schemas/` | Official ISO 20022 schemas (generated by the ISO Standards Editor), free to download from iso20022.org; this copy comes from the sepaxml 2.7.0 package. Terms to be confirmed with the bank's usual source. |
| Figtree font | 5.3.0 (Fontsource) | `fonts/` | SIL Open Font License 1.1 |

The offline file carries all notices in a `<script type="text/plain" id="third-party-notices">` block.

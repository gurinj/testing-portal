# M2 – brief for the helpers writing the stage rules

Written 2026-11-18 by the main session. Each helper writes the rules of one or two catalogue stages in its **own copy** of the project and reports back; the main session merges the copies into `/home/claude/testing-portal`.

| Helper | Copy | Stages | Owned files |
|---|---|---|---|
| h1 | `/home/claude/work/h1/testing-portal` | 4 | `rules/stages/04-iso-business-rules.sch`, `tests/stages/04-iso.test.js` |
| h2 | `/home/claude/work/h2/testing-portal` | 5, 6 | `rules/stages/05-characters-and-formats.sch`, `rules/stages/06-cmiplus-guideline.sch` (new), `tests/stages/05-formats.test.js`, `tests/stages/06-guideline.test.js` |
| h3 | `/home/claude/work/h3/testing-portal` | 3, 7 | `rules/stages/03-country-context.sch` (new), `rules/stages/07-payment-types.sch`, `tests/stages/03-context.test.js`, `tests/stages/07-types.test.js` |
| h4 | `/home/claude/work/h4/testing-portal` | 9, 10 | `rules/stages/09-consistency.sch`, `rules/stages/10-warnings-and-hints.sch`, `tests/stages/09-consistency.test.js`, `tests/stages/10-hints.test.js` |

Also owned: the lines of your stages in `config/catalogue.json` (one line per check id; change only `title`, `hint`, and add `parts` where a check has several asserts). If you need a new JavaScript function, put it in a new file `js/validation/functions/stage<N>.js` and add it to the script list in `js/validation/rules-worker.js` (before `findings/from-svrl.js`) and to the file list at the top of `tests/run-tests.js`.

## Read first

1. `docs/specs/M2.md`: section 2 (payment types), 3 (settings), 4 (the table of your stages: this is what you build), 5 (conventions).
2. `docs/RULES.md`: conventions and the **performance rules (mandatory)**.
3. `docs/reference/validation-catalogue-2026-11-18.md`: the catalogue text of your stages (the user confirmed it).
4. The existing rule files in `rules/stages/` (style, comments, `.03`/`.09` handling) and the functions in `js/validation/functions/` (headers list what the rules can call: `js:tpSetting`, `js:tpAllowed`, `js:tpIn`, `js:tpCountry`, `js:tpToday`, `js:tpShiftToday`, `js:tpPaymentType`, `js:tpBlockType`, `js:tpCharsetFor`, `js:tpBadChars`, `js:tpTranslitChars`, `js:tpHasControl`, `js:tpIbanProblem`, `js:tpIbanUsed`, `js:tpBicCountryValid`, `js:tpLeiValid`, `js:tpRfValid`, `js:tpClearingProblem`, `js:tpNonBusinessDay`, `js:tpLimit`, `js:tpMissing`, `js:tpPresent`, `js:tpOccurs`, `js:tpCcyDecimals`).
5. `config/settings.json` and `config/countries/*.json`: the settings your rules read.

## Rules for the rules

- Written for the `.03` namespace, compiled for `.03` and `.09`; cover both where the structures differ (`p:BIC | p:BICFI`, `ReqdExctnDt` vs `ReqdExctnDt/Dt|DtTm`, `.09` has `UETR`, `LEI`, more `PstlAdr` elements).
- Assert ids `R<id>` or `R<id>-<part>` (parts are lowercase words, e.g. `R5.6-dbtr`); `role` = catalogue severity (`error`, `warning`, `information`), `flag` = catalogue reason code (none if "–"). Use `sch:report` for hints if that reads better.
- Never report what the XSD reports; test only values the XSD accepts. Never fail on invalid data (`castable as`, `[1]`).
- A setting that is `null` switches the check off. Read settings only through the functions; do not hard-code a value that the spec lists as a setting.
- Messages: one or two plain English sentences, what is wrong with the actual value, with the value through `sch:value-of`. Catalogue `title`: a short statement of the problem (like the existing ones); `hint`: what the customer changes in the file, one or two sentences.
- Rule contexts are elements, simple (no conditions on parents), keys for duplicates without positional predicates in `match`.

## Tests

`tests/stages/<file>.test.js` exports `module.exports = async t => { … }`. `t` has:

- `ok(cond, label, detail)`, `head(title)` (call `head('stage N: …')` first);
- `gen.generate({ version, transactions, blocks, defects, seed, country, type, uetr, lei })` – clean made-up files; `type` one of `gen.TYPES` (SEPA, SEPA_INST, DOMESTIC, DOMESTIC_URGENT, BUDGET, INTRA_BANK, CROSS_BORDER), `country` one of `gen.COUNTRIES`; read the header of `js/dev/test-file-generator.js`;
- `validate(xml, version, country = 'AT', over, now)` – the full run (XSD + rules + report) → the report: `groups` (`rule`, `part`, `severity`, `code`, `count`, `items` with `message`, `xpath`, `line`), `status`, `blocks` (with `type`), `facts`, `disabled`; `over` = settings changed for this test (merged over the country's settings), `now` = a fixed `Date` for the time of the check;
- `rules(xml, version, country, over, now)` – only the rules → `{ findings, summary }`;
- `xsd`, `tally`, `sorted`, `contextFor`, `catalogue`, `TP`, `clean03`, `clean09`.

For every check: at least one test that breaks it (the finding appears with the right id, part and severity) and the clean files that pass. Where `.03` and `.09` differ, test both. Make failing files by replacing text in a clean generated file (see the existing tests in `tests/run-tests.js`); **do not change the generator** (if you need it changed, say what and why in the report). For every check with a setting, test the default and a changed value (and `null` = off).

Clean files must stay clean: for every type in `gen.TYPES` with countries where it applies (at least AT, CZ, RO, UA), `.03` and `.09` (`.09` with `uetr: true, lei: true`), your stages give no error and no warning. List any information hints your stages give on clean files.

## Checks before you report

- `node tools/build.js` (compiles, runs all tests, builds the offline file) passes in your copy. If one of the existing tests in `tests/run-tests.js` or the expectation `tests/expected/defects.json` must change because your new checks now fire on a defect file, change it and say exactly what and why.
- `node tools/speed-rules.js 10000`: the time of each of your rule files on 10,000 transactions, `.03` and `.09`. Budget: 1.5 s per file (Node), no worse than linear.

## Report (your final message)

1. Checks implemented: id, part, severity, one line how (and anything the spec left open that you decided).
2. Checks not implemented or partly, and why.
3. Changes outside your owned files, as exact snippets (old → new): settings, country files, functions, worker script list, `tests/run-tests.js`, `tests/expected/defects.json`.
4. Test count of your files; the speed numbers; information hints on clean files.
5. Problems found in the shared code (functions, report, generator) – fix them in your copy only if needed for your rules, and list the change.

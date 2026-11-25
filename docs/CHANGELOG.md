# Changelog

## 0.4.0-m3 – 2026-11-24 – Fix the errors, runs and comparison, email

- **Fix the errors** (`#fix`, from the report band of a rejected file or one with warnings): one proposal per finding with all its places, current and new value, a type tag (Corrected, Sample value, Entered value, Chosen, To enter) and a "Changes the payment" mark; before/after view of the XML; Apply and validate again. Proposals come from `config/fixes.json` (158 check ids: 55 calculated, 1 choice, 7 sample values, 13 entries, 82 manual with what to do instead). Only safe calculated changes are ticked. Structural XSD errors, amounts, IBANs and BICs are never guessed; IBAN, BIC, LEI, RF and country entries are checked as typed.
- **Corrected file:** only the changed values differ, every other byte stays as sent (BOM, line endings, indentation, entities); inserted elements follow the file's layout. Named `<name>_corrected.xml`, then `_corrected2` …; downloaded from the report band.
- **Runs of the session:** each validation is a run; a fix or a new version of the same file (same MsgId or file name) continues the file's chain. Runs strip on the report (run 1 → run 2 …, findings resolved, new). Nothing is stored; the last 3 runs keep their file and full result.
- **Compare runs** (`#compare`): resolved, still open and new findings, matched by check and place (PmtInfId and EndToEndId, else position), so inserted or removed payments do not shift the result.
- **Email for the customer** (`#email`): subject and text per case (unreadable, unsupported, rejected, fixed, warnings, passed, incomplete) from `config/templates/email.en.json`; English, signed Payments Service Desk, To empty; Copy (main way) and Open in email app; the report and the corrected copy as attachments to add by hand. Never amounts, names or account numbers from the file.
- **Report and exports:** band buttons per status as in prototype v2; sample values to replace and the changes made; the printable report adds the runs, the original result, the sample values and the changes; the CSV has a Run column; the summary to share adds the counts per run.
- **Technical check:** a 10th built-in check runs a whole fix round and expects the corrected file to equal the clean file byte for byte.
- Built by the main session with three helpers in their own copies (comparison, email, fixes per check). Independent review (separate agent, 17 points, no blockers) and fixes: rows of one change made all or none (no remittance text lost), namespace prefix on inserted elements, unique ids in linear time (10,000 duplicates 0.6 s instead of 24 s), chains only for the same file name and debtor (another customer's file name never in a report), values with XML comments not rewritten, typed BICs checked per schema version and typed text per character set, Back/Forward/reload on the new screens, the fix run keeps the settings of the run it corrects, grey instead of faded unticked rows and announced input errors, id changes (5.2 on an EndToEndId) not ticked, corrected file names never reused.
- 1,588 Node tests (995 in M2); 10 built-in checks pass in Chrome, offline and site.

## 0.3.0-m2 – 2026-11-18 – All catalogue checks, settings

- All checks of stages 3–10 of the validation catalogue (confirmed 2026-11-18), except 5.9 and 9.9 (not possible in the browser): new rule files for stage 3 (country context and payment type) and stage 6 (CMIplus guideline); stages 4, 5, 7, 9 and 10 completed. Rule parts (e.g. 4.2-age, 7.6-name) where one check covers several things.
- Payment type per transaction (SEPA, SEPA Instant, budget, intra-bank, domestic urgent, domestic, cross-border), derived once and used by the rules and the report: per transaction and block in the report, in the CSV, the printable report and the facts.
- Settings (`config/settings.json`, per country `config/countries/<CC>.json`): limits, code lists, character sets, CMIplus guideline values, and per check on/off, severity and reason code. 4.2: a file older than one month (P1M) is a warning.
- Reference data in `config/reference/`: ISO countries and currencies, IBAN registry, external code lists, SEPA and EEA countries, clearing systems (`node tools/update-reference.js`).
- About: the settings in use, download, and a settings file loaded for one session; which checks are covered by others.
- "Summary to share (no payment data)" on the report: status and number of places per check.
- Bank test mode: `node tests/run-bank.js --record` and later builds compare (results without payment values).
- Speed: the compiled rules no longer write a fired-rule element per visited node (about 40 % faster); payment types are read once per block.
- Generator: clean files per payment type and country, UETR and LEI for .09; next business day skips TARGET closing days.
- Independent review (separate agent, 11 points) and fixes: intra-bank and budget payments do not make a block mixed; implicit SEPA only without service level; 7.18 for missing addresses of cross-border payments; report builder fast with many findings; wrong values in country files no longer stop the checks (and are found by the build); one problem, one finding (blank names, 3.4, non-ISO currencies, cheques); 7.13 a warning until confirmed; session settings win over country settings; checks of loaded settings files.
- 995 Node tests (102 in M1); 9 built-in checks pass in Chrome, offline and site.

## 0.2.0-m1 – 2026-11-17 – First working version

- Screens in the prototype design: start (file, detected format, 11 countries), run with the real progress per module, report (status, facts, module strip, severity chips, search, expand all, findings by level with all places, payment blocks and transactions with their status), XML viewer (virtual scrolling, line markers, step through findings, go to line), About with limits and third-party notices, technical check under About.
- Header line: Temporary tool · version · rules as of · draft rules.
- Stages 0–2 with catalogue ids: 0.1, 0.2, 0.3 (also ZIP, PDF, Office files), 0.5 (also UTF-16 and declared encoding), 0.7, 0.8, 0.9; 1.1–1.4; 2.1–2.11 with readable messages, actual and expected value.
- All XSD errors at once: the XSD worker checks again after an element out of place, repeated or unknown (libxml2 skips the rest of such an element).
- Rule files per catalogue stage (`rules/stages/`), compiled for `.03` and `.09`; the same defects give the same findings in both versions.
- Report builder: catalogue texts, suppression of rule findings on values that failed the XSD, grouping (100 places = one finding), status per file, block and transaction, exact totals.
- Exports: findings as CSV and the printable report as an HTML file.
- Config: `catalogue.json`, `countries/<CC>.json` for 11 countries; `rules/countries/<CC>.sch` empty.
- Independent review (separate agent, 17 points) and fixes: XSD check fast with thousands of errors (2,000 errors in 0.2 s instead of 49 s); missing mandatory element (2.2) told apart from order (2.1), placeholders keep the check going; two options of a choice (2.5); wrong namespace (2.4); line numbers above 65,535; columns for XSD findings; rules no longer stop on repeated elements; rules leave XSD-invalid values to the XSD (no double findings); SEPA with several service levels (.09); EqvtAmt counted; one ISO 4217 table for decimals; exact totals for every amount the XSD accepts; a run with failed checks is marked incomplete; intake fixes (two files, UTF-16 without BOM, UTF-32, empty, HTML, DOCTYPE in comments, > in attributes); rule locations 15 times faster with many findings.
- 102 Node tests; 9 built-in checks in the browser.
- Delivery: offline file only (decided 2026-11-17); the artifact mode stays in `js/platform.js` but is not published.

## 0.1.0-m0 – 2026-11-17 – Technical check

- File structure, build script, tests and docs as in the plan.
- XSD check: libxml2 (WebAssembly) in a background worker, all errors with line numbers.
- Rules: SaxonJS 2.7 in a background worker, Schematron compiled with SchXslt at build time; the 20 sample rules in an M0 version (keys for duplicates, IBAN as JavaScript function, simple contexts).
- Stages 0 and 1 on the main thread: size, UTF-8, DOCTYPE, message type and version.
- Technical check page: engines, 7 built-in checks, speed test, try a file, results to copy.
- Offline file and Claude artifact.
- 18 Node tests.

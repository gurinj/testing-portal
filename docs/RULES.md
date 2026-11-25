# Testing Portal – Writing and changing rules

**Status:** M3 · country rules follow with the bank's input.

## Where rules live

| What | File |
|---|---|
| Generic rules, one file per catalogue stage | `rules/stages/<nn>-<name>.sch` |
| Country rules (stage 8) | `rules/countries/<CC>.sch` (empty for now) and `config/countries/<CC>.json` |
| Title, check, hint, reason code of every check id | `config/catalogue.json` |
| Functions the rules call | `js/validation/functions/*.js` |
| The original 20 sample rules (reference only) | `docs/reference/` |

After a change: `node tools/build.js`. The build compiles the rules and stops if a test fails.

## Adding a generic rule

1. Find the check id in the catalogue (for example 4.12) and add or check its entry in `config/catalogue.json` (`stage`, `sev`, `code`, `check`, `title`, `hint`). The tests fail if a rule id is missing there.
2. Add an `sch:assert` (or `sch:report` for hints) with `id="R4.12"` to the stage file, in the pattern for its context (group header, payment block, transaction).
3. Write it for the `.03` namespace (prefix `p`). It must also work on `.09`: where the structures differ, cover both, as `ReqdExctnDt` does (`substring(normalize-space(string(p:ReqdExctnDt[1])), 1, 10)` reads the date of `.03` and of `.09` `Dt`).
4. Add a defect to `js/dev/test-file-generator.js` or a case to `tests/run-tests.js`, and the expected count to `tests/expected/defects.json` if it is in the defects file.
5. `node tools/build.js`.

## Adding a country rule

Put `sch:pattern` elements into `rules/countries/<CC>.sch` (ids `R8.<CC>.<n>`, catalogue entries with stage 8). The processing instruction already limits the file to its country. Accepted versions go into `config/countries/<CC>.json` (`versions`), which drives check 1.4.

After a change: `node tools/build.js`. The build compiles the rules and stops if a test fails.

## Settings

Most limits and lists are not in the rules but in the settings, so they can be changed after a test with the bank's files without touching a rule:

| What | File |
|---|---|
| General settings | `config/settings.json` |
| Per country: currency, SEPA, character set, holidays, cut-off, accepted versions, and `settings` (same structure as `config/settings.json`, merged over it) | `config/countries/<CC>.json` |
| Reference lists (ISO countries and currencies, IBAN registry, external code lists, SEPA and EEA countries, clearing systems) | `config/reference/*.json`, refreshed by `node tools/update-reference.js` |

Rules of thumb:

- Durations are ISO 8601: `P1M` one calendar month, `P30D` 30 days, `PT1H` one hour. Amounts are strings (`"999999999.99"`). `null` means "no limit / not set" and switches that check off.
- `checks` changes a check without touching its rule: `"4.2-age": { "severity": "W" }`, `"6.12": { "enabled": false }`, `"3.2": { "code": "NARR" }`. Keys are check ids, or id and part where a check has several asserts (the report shows them as "Rule 4.2-age"). Stages 0 and 1 cannot be changed (they stop the run).
- Country files override only what they list: objects are merged, values and lists replaced.
- After a change: `node tools/build.js` builds a new offline file with the new settings. To try a change first, open About in the app, "Load a settings file for this session": a JSON file with only the values that differ (for example `{ "limits": { "creationDateMaxAge": "P2M" } }`) is merged over the built-in settings until the page is reloaded. The report then says which settings it used.

In a rule, settings are read through JavaScript functions (`js/validation/functions/settings.js`): `js:tpSetting('limits.creationDateMaxAge')`, `js:tpAllowed('guideline.codes.purpose', $code)`, `js:tpShiftNow('limits.creationDateMaxAge', -1)`, `js:tpCountry('currency')`. The time of the check is `js:tpNow()` / `js:tpToday()` (fixed in the tests), never `current-date()`.

## Payment type

Every transaction gets one payment type (SEPA, SEPA Instant, budget, intra-bank, domestic urgent, domestic, cross-border), derived in `js/validation/functions/payment-type.js` from the service level, local instrument, category purpose, priority, currency and creditor country (`docs/specs/M2.md`, section 2). Rules ask for it with `js:tpPaymentType(.)` on a `p:CdtTrfTxInf` and `js:tpBlockType(.)` on a `p:PmtInf`; the report shows the same type per transaction and block, so a customer sees why a rule applied.

## The bank's test files

Put them into `tests/files/bank/` (never committed or zipped), named with the country first: `AT_salaries.xml`. `node tests/run-bank.js --record` writes per file the status and the number of places per check to `tests/expected/bank/`; later builds list what changed. These result files hold no values of the payment files. In the app, "Summary to share" on the report gives the same information for one file.

## Conventions

- First line after the comments: `<?testing-portal stage="4" versions="03 09" countries="*"?>`.
- `id="R4.3"` = catalogue check 4.3. `role` = `error` | `warning` | `information`. `flag` = ISO reason code.
- The message text is what the user reads: one or two plain sentences, with the actual value through `<sch:value-of>`.

## Performance rules (mandatory)

Found in M0 with files of 1,000 to 10,000 transactions. Breaking one of these makes a large file take minutes. Rules 6 to 9 are new in M1.

1. **Duplicates and look-ups use a key.** Declare `<xsl:key name="e2e" match="p:PmtId/p:EndToEndId" use="."/>` at schema level and test `count(key('e2e', $e2e)) = 1`. Never `count(//p:EndToEndId[. = $e2e])`: it reads the whole file again for every transaction.
2. **No condition on a parent in a rule context.** Not `context="p:PmtInf[p:PmtTpInf/p:SvcLvl/p:Cd = 'SEPA']/p:CdtTrfTxInf"`. Instead `context="p:CdtTrfTxInf"` with
   `<sch:let name="blk" value=".."/>` and `<sch:let name="is-sepa" value="$blk/p:PmtTpInf[1]/p:SvcLvl[1]/p:Cd[1] = 'SEPA'"/>`, and tests written as `not($is-sepa) or …`.
3. **From a transaction to its block, take the first element:** `$blk/p:ChrgBr[1]`, `$blk/p:PmtTpInf[1]`. Never `(p:ChrgBr | ../p:ChrgBr)`.
4. **Long numbers in JavaScript.** XPath in SaxonJS cannot compute mod 97 on a 30-digit number exactly. IBAN and other check digits are JavaScript functions (`js:tpIbanValid(string(.))`).
5. **Rule contexts are elements.** Then the build lets the rules visit elements only (about 10 % faster). A context on an attribute or text node switches this off for that file.

6. **No positional predicate in a key's `match`** (`match="p:PmtId[1]/p:EndToEndId[1]"` made a 1,000-transaction file take 30 s). Put `[1]` into `use` or the rule instead.
7. **Take single elements with `[1]`** (`p:CreDtTm[1]`, `p:Cdtr[1]/p:Nm[1]`). A repeated element is an XSD error (2.3); without `[1]`, `normalize-space()` gets two nodes and the whole rule file stops.
8. **Leave values the XSD rejects to the XSD.** Test only values the schema allows (4.9 fires on CHK and TRA, not on XXX; 7.1 only on a currency of 3 capital letters), so one problem is not reported twice.
9. **Never fail on invalid data.** A value that breaks the XSD still reaches the rules. Test with `castable as` before `xs:decimal(...)`, `xs:date(...)` or `xs:integer(...)`, so the rule says nothing (the XSD finding covers it) instead of stopping the whole stage with a dynamic error.
10. **No `\p{L}` or `\p{N}` in XPath regular expressions**: each call costs about 1 ms in SaxonJS (stage 4 took 23–34 s on 10,000 addresses). Use explicit ranges, or a JavaScript function for language-aware comparisons (`functions/stage4.js`).
11. **Few rules, many asserts**: every rule that fires costs time per node. Put the checks of one element into one rule (one rule per transaction), and point a finding at a child with `subject="..."` instead of writing a rule for the child.
12. **Strings to JavaScript**: SaxonJS passes nodes to JavaScript functions as nodes (`String(node)` is serialized XML). Pass `string(...)` or `normalize-space(...)` when the function expects a value.

Measured in M1 (headless Chrome, rules of stages 4–10, both workers at once): 1,000 transactions 0.6 s, 5,000 2.8 s, 10,000 5.3 s.

## Fixes for a check (M3)

What the Fix the errors screen proposes for a check is in `config/fixes.json`, keyed by the check id or id and part (`5.6-cdtr`; a part key wins). A new or changed rule needs an entry there: `{ "manual": "what to do instead" }` when nothing can be proposed safely, else one of the actions in `js/fix/actions/` (each file lists its actions in its header) with a `field` label. Never propose a guessed amount, IBAN or BIC; a calculated change that changes what the payment does gets `"changesPayment": true` (proposed, not ticked). `tests/features/fix-actions.test.js` runs a round trip (propose, apply, validate again) for every non-manual entry.

# Reference data

Static lists used by the rules and the report. They are data, not rules: refresh them when the source changes, then run `node tools/build.js`.

| File | Content | Source |
|---|---|---|
| `countries.json` | ISO 3166-1 alpha-2 codes, plus XK (Kosovo) | npm `i18n-iso-countries` 7.14.0 (MIT) |
| `currencies.json` | Active ISO 4217 codes with decimal places | ISO 4217 list one via npm `currency-codes` 2.2.0 (MIT), data of 2024-06-25; XCG added |
| `iban-registry.json` | IBAN length and BBAN structure per country | SWIFT IBAN registry via npm `ibantools` 4.5.4 (MIT or MPL-2.0) |
| `external-codes.json` | ISO 20022 external code lists: purpose, category purpose, service level, local instrument, clearing system, organisation and person id schemes | npm `@taprsvp/iso20022_external_codes` 1.0.1 (MIT) |
| `payment-areas.json` | SEPA scheme countries, EEA countries, EEA currencies | EPC409-09 v8.0 (24 December 2025); EEA membership |
| `clearing-systems.json` | Member id formats of common clearing systems | Collected for the Testing Portal; extend as needed |

TARGET closing days (1 January, Good Friday, Easter Monday, 1 May, 25 and 26 December) are calculated in `js/validation/functions/dates.js`. Country holidays go into `config/countries/<CC>.json` (`holidays`).

To refresh the ISO lists: `npm pack` the packages above into an empty folder, unpack them and run `node tools/update-reference.js <folder>`.

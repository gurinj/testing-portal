# Payments Validator – pain.001 Validation Catalogue (Phase 1)

Nov 28, 2026 · @Jaroslav Gurín

Updated on 28 Nov 2026 to match the Testing Portal 0.4.0-m3, whose rules follow this catalogue as confirmed on 18 Nov 2026. Of the 145 checks, the app builds 134, and 15 of those find nothing until a setting changes. Four are covered by other checks, 7 are not built, and the app adds 2.x and X.1.

## Validation flow

The validator runs 11 stages in a fixed order, and only Stages 0 and 1 stop the run. Without well-formed XML and a known pain.001 version nothing else can be evaluated. From Stage 2 onwards every check runs on the parsed file and all findings are returned in one report.

| Stage | What it checks | On failure |
| --- | --- | --- |
| 0 File intake | Size, encoding, well-formed XML, XML security | Stop, one fatal finding |
| 1 Message identification | Namespace, version, message type, version allowed for the selected country | Stop, one fatal finding |
| 2 XSD schema | Structure, order, cardinality, data types, code enumerations | Collect all, continue |
| 3 Country context and classification | Selected country vs file content, payment type of each transaction | Collect, continue |
| 4 Generic ISO business rules | Totals, dates, amounts, cross-field rules, external code lists | Collect, continue |
| 5 Character set and formats | Allowed characters, identifiers, IBAN, BIC, reference formats | Collect, continue |
| 6 CMIplus usage guideline | Bank rules stricter than XSD: mandatory, forbidden, lengths, limits | Collect, continue |
| 7 Payment-type rules | SEPA, SEPA Instant, domestic, cross-border | Collect, continue |
| 8 Country rule pack | Rules of the country the customer selected | Collect, continue |
| 9 In-file consistency | Duplicate IDs, self-transfers, mixed batches | Collect, continue |
| 10 Warnings and hints | Truncation, ignored fields, non-business days, recommendations | Warnings only |

How the report shows all findings at once:

- XSD errors do not stop the run. The business rules run on the same parsed document; a rule whose element is missing simply does not fire, which avoids most cascades.
- Consequential findings are suppressed and linked to their root. Example: an IBAN that already failed the XSD pattern is not checked again for checksum or country.
- Repeated findings are grouped: one rule failing on 4,000 transactions is one finding with a count and the list of locations.
- Every finding carries rule ID, severity, ISO status reason code, level (file, payment block, transaction), XPath plus line and column, actual value, expected value and a fix hint.
- Severity: Error means CMIplus would reject; Warning means it would be processed but changed, truncated, ignored or is risky; Info is advice.
- Known limit: after a structural XSD error the parser may skip the rest of that parent element, so findings inside a badly broken block can be incomplete. The report says so for that block. In the app the XSD check repairs the parsed file and checks it again, up to 8 times, so later errors are still found; it stops after 5,000 XSD errors.

In the tables below, Severity is the proposed default (E = Error, W = Warning, I = Info) and the code is the ISO 20022 status reason code proposed for the pain.002-like result. Both are to be confirmed against actual CMIplus behaviour.

The In the app column says what the Testing Portal does with each check. Yes: it runs, with the values it uses. Off: it is built, but finds nothing with the current settings. Covered by: another check reports the same problem. Not built: with the reason. Decisions made since 18 Nov are listed under Decisions after confirmation.

The Built in column says where the check is implemented in the app. JavaScript: in the app's own code. XML parser and XSD: by the libxml2 parser with the pain.001 XSD schema. Schematron: in the Schematron rule files; JavaScript only reads settings, code lists or the date. Schematron + JS: a Schematron rule that calls a JavaScript function for part of the check, named after the colon. The Schematron rules run in the browser with SaxonJS.

## Stage 0 – File intake (hard stop)

Stage 0 decides whether the upload can be parsed at all; any failure ends the run with one fatal finding that names the line and column.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 0.1 | File uploaded and not empty | E | FF01 | Yes | JavaScript |
| 0.2 | File size within the configured limit | E | FF01 | Yes, 20 MB (browser limit; the CMIplus limit is not known) | JavaScript |
| 0.3 | Single XML file, not an archive or other file type | E | FF01 | Yes, also detects ZIP, PDF, Office and HTML files | JavaScript |
| 0.4 | Malware scan passed | E | – | Not built: not possible in the browser | – |
| 0.5 | Encoding is UTF-8, the declared encoding matches the bytes, no invalid byte sequences | E | FF01 | Yes, also detects UTF-16 and UTF-32 | JavaScript |
| 0.6 | XML declaration and byte-order mark as CMIplus expects | W | – | Not built: needs what CMIplus expects | – |
| 0.7 | Well-formed XML: one root, matching tags, escaped &, < and quotes | E | FF01 | Yes | XML parser (libxml2) |
| 0.8 | No DOCTYPE, no external entities, entity expansion within limits (XXE protection) | E | FF01 | Yes | JavaScript |
| 0.9 | No content after the root element, such as two messages concatenated | E | FF01 | Yes | XML parser (libxml2) |
| 0.10 | Envelope or business application header only if CMIplus accepts one | E | FF01 | Not built: needs what CMIplus accepts | – |

The parser message is translated into a fix hint, for example "Unescaped & on line 245, column 31: replace with &".

## Stage 1 – Message identification (hard stop)

Stage 1 detects the message and version, which selects the XSD for Stage 2 and the rule-set variant for Stages 4–8.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Root element is Document | E | FF01 | Yes | JavaScript |
| 1.2 | Namespace is pain.001.001.03 (ISO 2009) or pain.001.001.09 (ISO 2019) | E | FF01 | Yes | JavaScript |
| 1.3 | Message element is CstmrCdtTrfInitn | E | FF01 | Yes | JavaScript |
| 1.4 | Detected version is accepted by CMIplus for the selected country | E | FF01 | Yes; .03 and .09 accepted for all 11 countries until confirmed | JavaScript |
| 1.5 | Namespace prefixes and xsi:schemaLocation used as CMIplus accepts | W | – | Not built: needs what CMIplus accepts | – |
| 1.6 | Version still supported but scheduled for retirement (if CMIplus announces one) | I | – | Not built: needs a CMIplus announcement | – |

Other recognised messages get a specific hint instead of a generic error, for example "This is a pain.008 direct debit file" or "This is pain.001.001.05, which is not supported".

## Stage 2 – XSD schema validation (collect all)

Stage 2 validates against the official ISO schema of the detected version and keeps going after each error, so all structural findings are listed together.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Elements appear in the order the schema defines | E | FF01 | Yes | XSD (libxml2) |
| 2.2 | Mandatory elements present (schema minimum occurrence) | E | CH21 | Yes | XSD (libxml2) |
| 2.3 | Maximum occurrences not exceeded | E | CH17 | Yes | XSD (libxml2) |
| 2.4 | No unknown, misspelled or wrong-namespace elements or attributes | E | CH17 | Yes | XSD (libxml2) |
| 2.5 | Exactly one option of each choice, e.g. IBAN or Othr, InstdAmt or EqvtAmt | E | CH16 | Yes | XSD (libxml2) |
| 2.6 | Text within the schema length (Max35Text, Max70Text, Max140Text) and not empty | E | CH16 | Yes | XSD (libxml2) |
| 2.7 | Pattern types valid: BIC, IBAN, country code, currency code; in .09 also UETR and LEI | E | CH16 | Yes | XSD (libxml2) |
| 2.8 | Schema enumerations valid: payment method, charge bearer, priority | E | CH16 | Yes | XSD (libxml2) |
| 2.9 | Amounts: max 18 digits and 5 decimals, not negative, currency attribute present | E | CH16 | Yes | XSD (libxml2) |
| 2.10 | Dates and date-times in ISO format | E | DT01 | Yes | XSD (libxml2) |
| 2.11 | Boolean values valid (e.g. BtchBookg) | E | CH16 | Yes | XSD (libxml2) |
| 2.x | Any other schema error that 2.1–2.11 do not name | E | FF01 | Yes, added in the app | XSD (libxml2) |

Version differences handled by the two schemas: .09 renames BIC to BICFI, makes the execution date a choice of Dt or DtTm, and adds structured address elements. External code lists (purpose, category purpose, service level, local instrument) are free text in the schema and are checked in Stage 4.

## Stage 3 – Country context and payment classification

Stage 3 checks that the file fits the country the customer selected and assigns a payment type to every transaction; that type decides which Stage 7 and Stage 8 rules run.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Selected country has a configured rule pack | E | – | Yes; always passes for the 11 countries | Schematron |
| 3.2 | Debtor account IBAN country matches the selected country | E | NARR | Yes | Schematron |
| 3.3 | Debtor agent BIC country (characters 5–6) matches the selected country | E | RC03 | Yes | Schematron |
| 3.4 | All payment blocks belong to the selected country, if CMIplus requires one country per file | E | NARR | Yes, one country per file; reported only when 3.2 and 3.3 are switched off | Schematron |
| 3.5 | Payment type can be determined for each transaction | E | FF03 | Yes | Schematron + JS: payment type |
| 3.6 | Payment type is supported in the selected country | E | FF03 | Yes; every type is offered, SEPA types only in SEPA countries | Schematron + JS: payment type |
| 3.7 | One payment type per payment block, if CMIplus requires it | E | FF03 | Yes, one type per block; intra-bank and budget payments do not make a block mixed | Schematron + JS: payment type |

Payment types: SEPA credit transfer, SEPA Instant, domestic standard, domestic urgent, cross-border (SWIFT), intra-bank transfer, budget or tax payment. They are derived from service level, local instrument, category purpose, currency, and the creditor account and agent country. The derived type is shown per transaction in the report, so a customer sees why a rule applied.

In the app a transaction gets the first type that applies, in this order:

1. SEPA Instant: local instrument INST.
2. SEPA credit transfer: service level SEPA.
3. Budget or tax payment: category purpose TAXS, GOVT, VATX, WHLD or SSBE, or a treasury account (RO: TREZ in the IBAN), with the creditor in the selected country or unknown.
4. Intra-bank transfer: creditor in the selected country and creditor agent BIC (first 8 characters) the same as the debtor agent's.
5. SEPA credit transfer: EUR between SEPA countries, without any service level and not urgent.
6. Domestic urgent: creditor in the selected country, with service level URGP or SDVA or priority HIGH.
7. Domestic standard: creditor in the selected country.
8. Cross-border (SWIFT): creditor country known and not the selected country.

A transaction that fits none of them gets finding 3.5. The creditor country comes from the creditor IBAN, else the creditor agent BIC, else the creditor address.

## Stage 4 – Generic ISO 20022 business rules

Stage 4 holds the cross-field rules that apply to every pain.001 regardless of country, ordered by message level.

### Group header

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 4.1 | MsgId not blank | E | CH16 | Yes | Schematron |
| 4.2 | CreDtTm valid, not in the future beyond a tolerance, not older than the configured number of days | E (age W) | DT02 | Yes: tolerance 1 hour; a file older than 1 month is a warning | Schematron |
| 4.3 | NbOfTxs equals the number of transactions in the file | E | AM19 | Yes | Schematron |
| 4.4 | CtrlSum equals the sum of all transaction amounts, regardless of currency | E | AM16 | Yes | Schematron |
| 4.5 | Initiating party has a name or an identification | E | CH21 | Yes | Schematron |

### Payment information (block)

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 4.6 | PmtInfId not blank | E | CH16 | Yes | Schematron |
| 4.7 | Block NbOfTxs, if given, equals the transactions in the block | E | AM18 | Yes | Schematron |
| 4.8 | Block CtrlSum, if given, equals the sum of the block | E | AM17 | Yes | Schematron |
| 4.9 | Payment method is TRF (CHK or TRA only if supported) | E | CH16 | Yes | Schematron |
| 4.10 | Requested execution date not in the past (or rolled to today, per CMIplus) | E | CH04 | Yes | Schematron |
| 4.11 | Requested execution date not beyond the maximum horizon | E | CH03 | Yes, 1 year ahead | Schematron |
| 4.12 | In .09, execution date-time (DtTm) used only where supported | E | CH17 | Yes; DtTm is not supported for now | Schematron |
| 4.13 | Payment type information at block or transaction level, not both | E | CH17 | Yes, reported on each transaction | Schematron |
| 4.14 | Charge bearer at block or transaction level, not both | E | CH17 | Yes, reported on each transaction | Schematron |
| 4.15 | Debtor name present | E | CH21 | Yes | Schematron |
| 4.16 | Debtor account has an IBAN or other ID; account currency, if given, is valid | E | AC02 | Yes | Schematron |
| 4.17 | Debtor agent identified by BIC and/or clearing member ID | E | RC03 | Yes; an agent given only as Othr/Id NOTPROVIDED is rejected | Schematron |
| 4.18 | Charges account valid; charges account agent is the debtor agent or its branch | E | AC01 | Yes; also a charges account agent without a charges account | Schematron + JS: IBAN |
| 4.19 | Ultimate debtor, if used, has a name or ID | E | CH21 | Yes | Schematron |

### Transaction

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 4.20 | EndToEndId present and not blank ("NOTPROVIDED" allowed) | E | FF08 | Yes; a missing EndToEndId is reported by 2.2 | Schematron |
| 4.21 | Amount greater than zero | E | AM01 | Yes | Schematron |
| 4.22 | Decimal places fit the currency (EUR 2, JPY 0, KWD 3) | E | CH20 | Yes | Schematron |
| 4.23 | Currency is an active ISO 4217 code | E | AM03 | Yes, for every currency in the transaction | Schematron |
| 4.24 | Equivalent amount has a valid currency of transfer and is supported | E | AM03 | Yes; equivalent amounts are supported for now | Schematron |
| 4.25 | Exchange rate information consistent with the currencies used | W | – | Yes; also an agreed rate (AGRD) without contract ID | Schematron |
| 4.26 | Creditor agent present where the payment type needs it | E | RC04 | Yes, for cross-border payments | Schematron + JS: payment type |
| 4.27 | Clearing system code from the ISO external list and member ID format valid for that system (e.g. USABA 9 digits) | E | RC08 | Yes | Schematron + JS: clearing id |
| 4.28 | Creditor name present | E | CH21 | Yes | Schematron |
| 4.29 | Creditor country is a valid ISO 3166 code | E | BE11 | Yes | Schematron |
| 4.30 | Any postal address is structured or hybrid: TwnNm and Ctry mandatory, max 2 AdrLine, no data repeated between them | E | CH16 | Yes, for addresses with structured elements. Fully unstructured ones get warnings 7.8 or 7.18; more than 2 AdrLine is reported by 6.3 | Schematron + JS: address lines |
| 4.31 | Creditor account present (except cheques), IBAN or other ID | E | AC03 | Yes | Schematron |
| 4.32 | Ultimate creditor, if used, has a name or ID | E | CH21 | Yes | Schematron |
| 4.33 | Instruction codes for agents valid (CHQB, HOLD, PHOB, TELB) and supported | E | CH16 | Yes; all four codes supported for now | Schematron |
| 4.34 | Purpose code in the ISO ExternalPurpose1Code list | E | FF07 | Yes | Schematron |
| 4.35 | Category purpose code in the ISO external list | E | FF06 | Yes | Schematron |
| 4.36 | Service level code in the ISO external list | E | FF04 | Yes | Schematron |
| 4.37 | Local instrument code in the ISO external list or an allowed proprietary value | E | FF05 | Yes; no proprietary value is allowed yet | Schematron |
| 4.38 | Remittance: unstructured and structured not combined unless allowed; occurrence limits | E | RR07 | Yes: not combined, max 1 Ustrd and max 1 Strd | Schematron |
| 4.39 | Structured creditor reference type SCOR with valid ISO 11649 RF check digits | E | RR09 | Yes, for references that start with RF | Schematron + JS: RF reference |
| 4.40 | Regulatory reporting indicator and codes valid and allowed | E | RR05 | Yes; regulatory reporting is allowed, its country code and code length are checked | Schematron |

## Stage 5 – Character set, identifiers and field formats

Stage 5 checks every text and identifier value against the character set of its payment type and the algorithmic formats (check digits, registries) that the XSD pattern cannot verify.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Text uses the allowed character set: SEPA Latin set (a–z A–Z 0–9 / - ? : ( ) . , ' + space), SWIFT X set for cross-border, local letters only where CMIplus allows | E | RR10 | Yes: SEPA Latin for SEPA, SWIFT X for cross-border, basic Latin for the other payments in all 11 countries; dates, amounts, IBANs, BICs and codes are left to the XSD | Schematron + JS: character set |
| 5.2 | Characters CMIplus would transliterate (e.g. ä to a) | W | RR10 | Yes | Schematron + JS: character set |
| 5.3 | No control characters, tabs or line breaks inside values | E | RR10 | Yes | Schematron + JS: control characters |
| 5.4 | No leading or trailing spaces, no whitespace-only values | E | CH16 | Yes; blank ids and creditor names are reported by 4.1, 4.6, 4.20 and 4.28 | Schematron |
| 5.5 | Reference IDs (MsgId, PmtInfId, InstrId, EndToEndId) do not start or end with "/" and contain no "//" | E | CH16 | Yes | Schematron |
| 5.6 | IBAN country known, length per IBAN registry, mod-97 check digits, national BBAN structure | E | AC01 | Yes: AC02 for the debtor, AC03 for the creditor; the charges account IBAN is reported by 4.18 | Schematron + JS: IBAN |
| 5.7 | BIC is 8 or 11 characters with a valid country code | E | RC01 | Yes | Schematron + JS: BIC country |
| 5.8 | Test BIC ("0" as second location character) used in a production file | W | RC01 | Yes | Schematron + JS: BIC country |
| 5.9 | BIC found in the BIC directory (static reference file) | W | RC01 | Not built: needs the licensed BIC directory | – |
| 5.10 | Country codes valid ISO 3166-1 alpha-2, plus XK where used for Kosovo | E | BE09 | Yes; the creditor country is reported by 4.29, the regulatory reporting country by 4.40 | Schematron |
| 5.11 | LEI (in .09) has 20 characters and valid ISO 17442 check digits | E | CH16 | Yes | Schematron + JS: LEI |
| 5.12 | Organisation and private ID scheme codes in the ISO external lists | W | – | Yes | Schematron |

The IBAN, BIC and country checks run on every party and agent: debtor, creditor, ultimate parties, charges account and intermediary agents. The reason code follows the party, e.g. AC02 for the debtor account and AC03 for the creditor account.

## Stage 6 – CMIplus usage guideline rules

Stage 6 applies RBI's own pain.001 guideline for CMIplus, which tightens the ISO schema; these rules come from the CMIplus usage guideline, not from ISO.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 6.1 | Elements mandatory in the CMIplus guideline but optional in the XSD | E | CH21 | Off: no mandatory elements set yet | Schematron + JS: element lists |
| 6.2 | Elements not supported by CMIplus: forbidden (error) or ignored (warning) | E/W | CH17 | Off: no forbidden or ignored elements set yet | Schematron + JS: element lists |
| 6.3 | Occurrence limits stricter than the XSD (e.g. 1 Ustrd, 2 AdrLine) | E | CH17 | Yes: max 2 AdrLine in every address; the number of Ustrd is checked by 4.38 | Schematron + JS: occurrence limits |
| 6.4 | Length limits stricter than the XSD (e.g. names 70, remittance 140) | E | CH16 | Yes: names max 70; 140 for remittance is the XSD limit | Schematron |
| 6.5 | Maximum payment blocks per file and transactions per file and per block | E | NARR | Off: no limits set yet | Schematron |
| 6.6 | Currency supported for the selected country and payment type | E | AM03 | Off: no currency lists in the country files; 7.1, 7.10 and 7.13 check the currency | Schematron + JS: payment type |
| 6.7 | Execution date horizon and past-date handling as configured in CMIplus | E | CH03 | Covered by 4.10 and 4.11 | – |
| 6.8 | Batch booking value allowed and its conditions met (e.g. one currency per block) | E | NARR | Yes: batch booking allowed, one currency per block | Schematron |
| 6.9 | Code values within the subset CMIplus supports (purpose, category purpose, service level, local instrument) | E | FF04–FF07 | Off: every ISO code is allowed until the CMIplus subset is set | Schematron |
| 6.10 | Initiating party identification in the format CMIplus expects | E | NARR | Off: no format set yet | Schematron + JS: pattern |
| 6.11 | Multiple debtor accounts or debtor agents in one file only if allowed | E | NARR | Off: both allowed for now; agents are compared by the first 8 characters of the BIC | Schematron |
| 6.12 | Ultimate debtor and ultimate creditor only where supported | W | CH17 | Off: both allowed for now | Schematron + JS: payment type |

Keep these rules in a separate module from the ISO rules so a guideline change never touches the ISO layer.

## Stage 7 – Payment-type rules

Stage 7 runs the scheme rules for the payment type assigned in Stage 3. Unstructured postal addresses stay accepted for now. The EPC postponed the SEPA end date of 15 November 2026 ([EPC](https://www.europeanpaymentscouncil.eu/node/28486)) and will set a new one by February 2027 ([Banking 4.0](https://banking40.ro/european-payments-council-defers-setting-new-end-date-for-unstructured-address-format-until-february-2027/)). Swift deferred the CBPR+ removal planned for 14 November 2026 and has not set a new date ([Swift](https://www.swift.com/insights/news/swift-accepts-community-request-extend-structured-address-migration-iso-20022-payment-messages)). Checks 7.8 and 7.18 are warnings until new end dates are set.

### SEPA credit transfer

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 7.1 | Currency is EUR | E | AM03 | Yes | Schematron + JS: payment type |
| 7.2 | Creditor account is an IBAN of a SEPA-scheme country | E | AC03 | Yes | Schematron + JS: payment type |
| 7.3 | Service level SEPA, if given | E | FF04 | Yes | Schematron + JS: payment type |
| 7.4 | Charge bearer SLEV, if given | E (W without service level) | CH16 | Yes; a EUR payment between SEPA countries without service level gets a warning | Schematron + JS: payment type |
| 7.5 | Amount between 0.01 and 999,999,999.99 | E | AM02 | Yes | Schematron + JS: payment type |
| 7.6 | Names max 70 characters; remittance one Ustrd of max 140 or one Strd | E | CH15 | Yes; with the current settings names are reported by 6.4 and remittance parts by 4.38 | Schematron + JS: payment type |
| 7.7 | BIC optional, valid if given | E | RC07 | Covered by 5.7 and the XSD (2.7) | – |
| 7.8 | Addresses structured or hybrid; unstructured still accepted until the EPC sets a new end date | W | – | Yes | Schematron + JS: payment type |
| 7.9 | Debtor address present when the creditor's bank is in a non-EEA SEPA country | E | CH21 | Yes | Schematron + JS: payment type |

### SEPA Instant

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 7.10 | Local instrument INST with currency EUR | E | FF05 | Yes | Schematron + JS: payment type |
| 7.11 | Execution date is today, or a future date only if CMIplus supports scheduled instant payments | E | NARR | Yes; scheduled instant payments are not supported for now | Schematron + JS: payment type |
| 7.12 | Amount within the configured bank or customer instant limit | E | AM02 | Off: no instant limit set yet | Schematron + JS: payment type |

### Domestic (local currency)

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 7.13 | Currency is the local currency of the selected country | W | AM03 | Yes; a warning instead of an error until confirmed with the bank's files | Schematron + JS: payment type |
| 7.14 | Creditor account is a local IBAN or valid local account format (Stage 8) | E | AC03 | Built, but cannot fire: a creditor IBAN of another country makes the payment cross-border | Schematron + JS: payment type |
| 7.15 | Urgent or standard indicated through service level or local instrument as the local scheme requires | E | FF04 | Off: no domestic codes in the country files yet | Schematron + JS: payment type |
| 7.16 | Amount above a local high-value threshold sent as standard, where a local rule exists | W | – | Off: no thresholds in the country files yet | Schematron + JS: payment type |

### Cross-border (SWIFT)

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 7.17 | Creditor agent identified by BIC, or by clearing code plus name and address | E | RC04 | Yes, for an agent that is present; a missing one is reported by 4.26 | Schematron + JS: payment type |
| 7.18 | Debtor and creditor addresses structured or hybrid, with TwnNm and Ctry; unstructured still accepted until Swift sets a new date | W | – | Yes; also a payment without debtor or creditor address | Schematron + JS: payment type |
| 7.19 | Charge bearer DEBT, SHAR or CRED; SLEV not allowed | E | CH16 | Yes | Schematron + JS: payment type |
| 7.20 | Both banks in the EEA and an EEA currency: SHAR only | E | CH16 | Yes | Schematron + JS: payment type |
| 7.21 | Creditor account is an IBAN for IBAN countries, plausible account number otherwise | E | AC03 | Yes | Schematron + JS: payment type, IBAN |
| 7.22 | Purpose or regulatory codes required by the destination country (configurable destination list) | E | RR05 | Off: no destinations listed yet | Schematron + JS: payment type |
| 7.23 | Currency plausible for the destination, e.g. BGN is no longer valid for Bulgaria since its [euro adoption on 1 January 2026](https://trade.ec.europa.eu/access-to-markets/en/news/bulgaria-adopts-euro-1-january-2026) | W | AM03 | Yes: BGN, HRK, LTL, LVL, EEK, SKK, SIT, CYP and MTL are retired | Schematron + JS: payment type |
| 7.24 | Intermediary agent, if given, has a valid BIC | E | RC11 | Yes | Schematron + JS: payment type |
| 7.25 | Text that a downstream format would truncate | W | RR08 | Yes: names and address lines over 35 characters | Schematron + JS: payment type |

### Other types

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 7.26 | Creditor account at an RBI bank in the same country: intra-bank transfer rules of the country pack apply | I | – | Yes | Schematron + JS: payment type |
| 7.27 | Budget, tax and customs payments: detected by creditor account or category purpose, checked in Stage 8 | I | – | Yes | Schematron + JS: payment type |

## Stage 8 – Country rule packs

The pack of the selected country runs on top of all generic rules and may only tighten them, never relax them. Its content comes from each network bank's local CMIplus guideline; every pack covers the same ten categories.

| Category | Typical checks |
| --- | --- |
| Local account numbers | Non-IBAN domestic account format and check digits; local IBAN length and BBAN structure |
| Local bank codes | Bank or sort code exists in the static local bank directory and matches the IBAN bank code and BIC |
| Currency and amounts | Local currency, decimals, maximum amounts, high-value thresholds |
| Local schemes and instruments | Allowed combinations of service level, local instrument and category purpose for standard, urgent and instant clearing |
| Mandatory local references | Payment codes, reference models with check digits, payment symbols |
| Budget, tax and customs payments | Payer tax ID, revenue type, municipality code, reference format; triggered by treasury creditor accounts |
| Regulatory reporting | Central bank codes for payments with non-residents, above thresholds |
| Character set and lengths | Local letters allowed or not; local length limits |
| Execution dates | Local clearing calendar from a static holiday file |
| Currency control | Restrictions on foreign-currency payments between residents |

Illustrative examples for the packs. They come from general market knowledge, not from the CMIplus guidelines, and must be confirmed with each network bank.

| Country | Examples |
| --- | --- |
| Austria (AT) | Domestic EUR follows SEPA rules; IBAN 20 characters |
| Czech Republic (CZ) | CZK domestic; local account "prefix-number/bank code" with mod-11 check; variable, constant and specific symbols numeric (max 10, 4, 10 digits) |
| Slovakia (SK) | EUR SEPA domestic; variable, specific and constant symbols numeric, carried in EndToEndId as /VS…/SS…/KS… |
| Hungary (HU) | HUF domestic; account 2×8 or 3×8 digits, each block with its own check digit; IBAN 28 |
| Romania (RO) | RON domestic; IBAN mandatory (24); payments to State Treasury accounts (TREZ in the IBAN) need the payer's fiscal code |
| Croatia (HR) | EUR SEPA domestic; HR reference models (HRnn) with model-specific check digits; IBAN 21 |
| Serbia (RS) | RSD domestic; 18-digit account with mod-97 control digits; 3-digit payment code mandatory; reference model 97 check digits |
| Bosnia and Herzegovina (BA) | BAM domestic; 16-digit account with check digits; public revenue payments need taxpayer ID, payment and revenue type, municipality and reference |
| Ukraine (UA) | UAH domestic; IBAN 29; beneficiary tax ID (8 or 10 digits) and purpose text mandatory; budget payments in a prescribed purpose format |
| Albania (AL) | ALL domestic; IBAN 28 |
| Kosovo (XK) | EUR domestic; IBAN 20 |

The country list itself needs confirming against the current CMIplus rollout.

In the app the country packs are still empty, so no Stage 8 rule runs yet. Each country file holds the currency, IBAN length, SEPA membership, character set (basic Latin for all 11) and accepted versions (.03 and .09 for all 11 until confirmed). SEPA membership set in the app: AL, AT, CZ, HR, HU, RO, RS and SK yes; BA, UA and XK no.

## Stage 9 – In-file consistency and duplicates

Stage 9 compares transactions and blocks with each other inside the uploaded file; it cannot see files already processed in production.

| ID | Check | Sev | Code | In the app | Built in |
| --- | --- | --- | --- | --- | --- |
| 9.1 | PmtInfId unique in the file | E | DU02 | Yes | Schematron |
| 9.2 | InstrId unique in the file | E | DU05 | Yes | Schematron + JS: duplicates |
| 9.3 | EndToEndId unique in the file, except NOTPROVIDED | W | DU04 | Yes | Schematron + JS: duplicates |
| 9.4 | UETR (in .09) unique in the file | E | NARR | Yes | Schematron + JS: duplicates |
| 9.5 | Possible duplicate transactions: same creditor account, amount, currency, date and remittance | W | AM05 | Yes, also across blocks | Schematron + JS: duplicates |
| 9.6 | Debtor account equal to creditor account | E | NARR | Yes; not when both account currencies are given and differ (sub-accounts of one IBAN) | Schematron |
| 9.7 | Same debtor account in blocks with different debtor names | W | – | Yes | Schematron |
| 9.8 | Same debtor account, date and payment type spread over several blocks | I | – | Yes | Schematron + JS: payment type |
| 9.9 | MsgId already used in a file this customer validated in the app before (app history only) | W | DU01 | Not built: the app keeps no history | – |
| 9.10 | Ultimate debtor identical to the debtor | I | – | Yes | Schematron |

## Stage 10 – Warnings and best-practice hints

Stage 10 never rejects; it tells the customer what CMIplus would change, ignore or handle sub-optimally.

| ID | Hint | Sev | In the app | Built in |
| --- | --- | --- | --- | --- |
| 10.1 | Execution date on a weekend or local holiday; CMIplus moves it to the next business day | W | Yes: weekends and TARGET closing days for EUR; no country holidays set yet; not for SEPA Instant or past dates | Schematron + JS: payment type, business days |
| 10.2 | Execution date is today and may miss the cut-off (indicative, from configured cut-off times) | I | Off: no cut-off times set yet | Schematron + JS: payment type, business days, cut-off time |
| 10.3 | Text will be truncated by CMIplus or a downstream scheme | W | Off: no CMIplus lengths set yet; downstream truncation is 7.25 | Schematron + JS: text length |
| 10.4 | Characters will be transliterated | W | Covered by 5.2 | – |
| 10.5 | Elements present but ignored by CMIplus | W | Covered by 6.2 (ignored part) | – |
| 10.6 | Recommended data missing: structured creditor address, purpose code, LEI, ultimate debtor for payments on behalf | I | Yes for the structured creditor address and the ultimate debtor; purpose code and LEI are off | Schematron + JS: payment type |
| 10.7 | Hybrid address used where fully structured is recommended | I | Yes | Schematron |
| 10.8 | pain.001.001.03 used; migration to .09 recommended if CMIplus plans to retire .03 | I | Yes, where the country also accepts .09 | Schematron |
| 10.9 | File close to the size or transaction limits | I | Off: no limits set yet; the file size is not checked because the CMIplus limit is not known | Schematron |
| 10.10 | Initiating party differs from debtor; check the ultimate debtor rules for payments on behalf | I | Yes, one hint per block | Schematron |
| X.1 | EndToEndId is NOTPROVIDED: send your own reference so the creditor gets one | I | Yes, added in the app | Schematron |

## Decisions after confirmation

This catalogue was confirmed on 18 Nov 2026 as the source of the app's rules; these decisions were made while the app was built and reviewed. Each is a setting or a rule change and is to be confirmed with the bank's files.

| Date | Checks | Decision |
| --- | --- | --- |
| 2026-11-19 | 7.13 | Warning instead of error: a payment between two accounts in one country in a foreign currency, such as USD in CZ, may be allowed. |
| 2026-11-19 | 7.18 | New case: a cross-border payment without a debtor or creditor postal address is a warning. |
| 2026-11-19 | 3.7 | Intra-bank and budget payments travel with the other payments of a block and do not make it mixed. |
| 2026-11-19 | 7.3, 7.4 | SEPA is derived from EUR and the countries only without any service level; EUR with G001, NURG or URGP is cross-border or domestic. |
| 2026-11-19 | 3.4, 4.15, 4.23, 4.31 | One problem, one finding: blank names only in 4.15 (and 4.5, 4.19, 4.32); 3.4 only when 3.2 and 3.3 are switched off; a currency that is not ISO only in 4.23; 4.31 not for cheques. |
| 2026-11-18 | 4.2 | A file older than one month is a warning; a creation time more than 1 hour ahead stays an error. |
| 2026-11-18 | 4.30, 7.8, 7.18 | Unstructured addresses are accepted with warnings 7.8 and 7.18; 4.30 rejects them only if that setting is switched off. An address with only Ctry and AdrLine counts as unstructured. |
| 2026-11-18 | 4.30, 6.3 | More than 2 address lines is reported by 6.3 only; the address-lines part of 4.30 is switched off. |
| 2026-11-18 | 7.4 | Error for SEPA by service level and for SEPA Instant; a warning for a EUR payment between SEPA countries without service level, which the bank may send another way. |
| 2026-11-18 | Payment type | An urgent EUR payment (URGP, SDVA or priority HIGH) is domestic urgent or cross-border, not SEPA. |
| 2026-11-18 | 4.18, 4.26, 4.40 | Reported once: the charges account IBAN by 4.18 (not 5.6), a missing creditor agent by 4.26 (not 7.17), the regulatory reporting country by 4.40 (not 5.10). |
| 2026-11-18 | 6.6, 7.6 | Left to other checks with the current settings: currencies to 7.1, 7.10 and 7.13; names to 6.4; remittance parts to 4.38. |
| 2026-11-18 | 7.14 | Cannot fire: a creditor IBAN of another country makes the payment cross-border. Kept as a guard. |
| 2026-11-18 | 10.9 | No file-size part: the CMIplus size limit is not known. |
| 2026-11-18 | All | Limits, code lists and CMIplus guideline values are settings with a default, changeable per country; an empty setting switches its check off. |
| 2026-11-17 | 2.x, X.1 | Added in the app's first version: 2.x for schema errors that 2.1–2.11 do not name, X.1 as a hint for EndToEndId NOTPROVIDED. |

Not built in the app: 0.4, 0.6, 0.10, 1.5 and 1.6 (need CMIplus input or are not possible in the browser), 5.9 (no BIC directory) and 9.9 (no history).

## Result report and status

The result mirrors a pain.002 technical check: a status per transaction, per payment block and for the file, each with the reason codes of its findings ([ISO status codes](https://cdn.jsdelivr.net/npm/@taprsvp/iso20022_external_codes@1.0.1/code_sets/external_payment_group_status_code.json)).

| Level | ACTC | ACWC | PART | RJCT |
| --- | --- | --- | --- | --- |
| Transaction | No errors | No errors, but CMIplus would change data (e.g. date moved) | – | At least one error on it or inherited from its block or file |
| Payment block | All transactions accepted | Accepted with changes | Some transactions rejected (only if CMIplus accepts partially) | Block-level error, or all transactions rejected |
| File | All blocks accepted | Accepted with changes | Some blocks or transactions rejected | Stage 0–2 structural error, group header error, or everything rejected |

Whether CMIplus accepts files partially or rejects them as a whole is a per-country setting of the status logic.

In the app there is no PART status yet: an error anywhere in a block rejects the block, and any error rejects the file. Exports are a CSV of findings and a printable HTML report, plus a summary to share without payment data; the pain.002-like XML is not built.

The report contains:

- Summary: file name, version, selected country, number of blocks and transactions, totals per currency, overall status, counts of errors, warnings and hints.
- Findings grouped by level and rule, filterable by severity and stage, with the derived payment type per transaction.
- Exports: pain.002-like XML with statuses and reason codes, a PDF or HTML report for the customer, and a CSV or Excel list of findings.
- Message texts from a translation catalogue keyed by rule ID: English first, local languages for phase 2.

## Out of scope for phase 1

These checks need production systems or customer data and stay out of phase 1; the report should say so, so customers do not read an ACTC as a guarantee of execution.

- Account existence and status (closed, blocked) and that the debtor account belongs to the customer
- Customer contract, entitlements, signatures and authorisation workflow
- Funds and customer-specific limits
- Sanctions, AML and fraud screening
- Verification of Payee for euro payments
- Duplicate check against files already processed in production
- Live reachability of the creditor bank for SEPA Instant
- Live FX rates and FX contract validation
- Binding cut-off times (only indicative in Stage 10)

Static reference data keeps phase 1 free of integrations: IBAN registry, BIC directory, ISO code lists, local bank directories and holiday calendars, versioned as configuration and refreshed by an admin process.

## Open points and assumptions

The selected country is the country the payments are sent to for processing; the RBI network bank operating there executes the file in CMIplus.

- [x] Confirm the meaning of the selected country. If it means the beneficiaries' country, Stage 8 would run per transaction by creditor country instead of once per file.
- [ ] Confirm per country whether CMIplus accepts files partially or rejects them as a whole.
- [ ] Align severities and reason codes with what CMIplus returns in its pain.002 today. Until then the app uses the proposals here, with the changes under Decisions after confirmation.
- [ ] Confirm which pain.001 versions each country accepts and any retirement date for .03. The app accepts .03 and .09 for all 11 countries until then.
- [ ] Confirm how CMIplus treats unstructured addresses in .03 and .09 files now that the November 2026 end dates are postponed. The app accepts them with warnings 7.8 and 7.18.
- [ ] Decide the character set policy per country (local letters allowed or transliterated). The app uses basic Latin for all 11 countries for now; local letters get warning 5.2.
- [ ] Set file size and transaction count limits. The app takes files up to 20 MB (browser limit); with no transaction or block limits set, 6.5 and 10.9 are off.
- [ ] Name the owner and refresh cycle of static reference data, including the BIC directory licence. The app keeps its reference lists as files refreshed by a script and has no BIC directory.
- [ ] Decide which warnings are shown to customers in phase 2.

## Sources

- [EPC: end date for unstructured addresses delayed](https://www.europeanpaymentscouncil.eu/node/28486), with a [new date due by February 2027](https://banking40.ro/european-payments-council-defers-setting-new-end-date-for-unstructured-address-format-until-february-2027/)
- [EPC guidance: provision of addresses under the EPC schemes](https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-11/EPC153-22%20v2.0%20EPC%20guidance%20document%20-%20Provision%20of%20Addresses%20under%20the%20EPC%20Payment%20Schemes.pdf)
- [Swift: structured address migration for CBPR+ extended](https://www.swift.com/insights/news/swift-accepts-community-request-extend-structured-address-migration-iso-20022-payment-messages)
- [ISO 20022 change request: status reason codes AM16–AM19, RR09, RR10](https://iso20022.org/milestone/12511/download)
- [ISO external payment group status codes](https://cdn.jsdelivr.net/npm/@taprsvp/iso20022_external_codes@1.0.1/code_sets/external_payment_group_status_code.json)
- [European Commission: Bulgaria adopts the euro on 1 January 2026](https://trade.ec.europa.eu/access-to-markets/en/news/bulgaria-adopts-euro-1-january-2026)
- [Testing Portal source, commit 03e1bce of 25 Nov 2026](https://github.com/gurinj/testing-portal/tree/03e1bcec4737c67a2a65d14787763adf2c4ce795): config/catalogue.json, config/settings.json, the country files, docs/specs/M2.md, the Schematron rules in rules/stages and the JavaScript in js/validation

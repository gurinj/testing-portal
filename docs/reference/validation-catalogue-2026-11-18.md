<!-- Copy of the validation catalogue (claude.ai doc https://claude.ai/artifact/7CGhXHsjQtCAdcHfpJVNw9, rev 26), confirmed by the user on 2026-11-18. Source of M2. Generated text copy; the doc is the original. -->

# Payments Validator – pain.001 Validation Catalogue (Phase 1)
 · 

## Validation flow
The validator runs 11 stages in a fixed order, and only Stages 0 and 1 stop the run. Without well-formed XML and a known pain.001 version nothing else can be evaluated. From Stage 2 onwards every check runs on the parsed file and all findings are returned in one report.
| Stage | What it checks | On failure |
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
- Known limit: after a structural XSD error the parser may skip the rest of that parent element, so findings inside a badly broken block can be incomplete. The report says so for that block.
In the tables below, Severity is the proposed default (E = Error, W = Warning, I = Info) and the code is the ISO 20022 status reason code proposed for the pain.002-like result. Both are to be confirmed against actual CMIplus behaviour.

## Stage 0 – File intake (hard stop)
Stage 0 decides whether the upload can be parsed at all; any failure ends the run with one fatal finding that names the line and column.
| ID | Check | Sev | Code |
| 0.1 | File uploaded and not empty | E | FF01 |
| 0.2 | File size within the configured limit | E | FF01 |
| 0.3 | Single XML file, not an archive or other file type | E | FF01 |
| 0.4 | Malware scan passed | E | – |
| 0.5 | Encoding is UTF-8, the declared encoding matches the bytes, no invalid byte sequences | E | FF01 |
| 0.6 | XML declaration and byte-order mark as CMIplus expects | W | – |
| 0.7 | Well-formed XML: one root, matching tags, escaped &, < and quotes | E | FF01 |
| 0.8 | No DOCTYPE, no external entities, entity expansion within limits (XXE protection) | E | FF01 |
| 0.9 | No content after the root element, such as two messages concatenated | E | FF01 |
| 0.10 | Envelope or business application header only if CMIplus accepts one | E | FF01 |
The parser message is translated into a fix hint, for example "Unescaped & on line 245, column 31: replace with &".

## Stage 1 – Message identification (hard stop)
Stage 1 detects the message and version, which selects the XSD for Stage 2 and the rule-set variant for Stages 4–8.
| ID | Check | Sev | Code |
| 1.1 | Root element is Document | E | FF01 |
| 1.2 | Namespace is pain.001.001.03 (ISO 2009) or pain.001.001.09 (ISO 2019) | E | FF01 |
| 1.3 | Message element is CstmrCdtTrfInitn | E | FF01 |
| 1.4 | Detected version is accepted by CMIplus for the selected country | E | FF01 |
| 1.5 | Namespace prefixes and xsi:schemaLocation used as CMIplus accepts | W | – |
| 1.6 | Version still supported but scheduled for retirement (if CMIplus announces one) | I | – |
Other recognised messages get a specific hint instead of a generic error, for example "This is a pain.008 direct debit file" or "This is pain.001.001.05, which is not supported".

## Stage 2 – XSD schema validation (collect all)
Stage 2 validates against the official ISO schema of the detected version and keeps going after each error, so all structural findings are listed together.
| ID | Check | Sev | Code |
| 2.1 | Elements appear in the order the schema defines | E | FF01 |
| 2.2 | Mandatory elements present (schema minimum occurrence) | E | CH21 |
| 2.3 | Maximum occurrences not exceeded | E | CH17 |
| 2.4 | No unknown, misspelled or wrong-namespace elements or attributes | E | CH17 |
| 2.5 | Exactly one option of each choice, e.g. IBAN or Othr, InstdAmt or EqvtAmt | E | CH16 |
| 2.6 | Text within the schema length (Max35Text, Max70Text, Max140Text) and not empty | E | CH16 |
| 2.7 | Pattern types valid: BIC, IBAN, country code, currency code; in .09 also UETR and LEI | E | CH16 |
| 2.8 | Schema enumerations valid: payment method, charge bearer, priority | E | CH16 |
| 2.9 | Amounts: max 18 digits and 5 decimals, not negative, currency attribute present | E | CH16 |
| 2.10 | Dates and date-times in ISO format | E | DT01 |
| 2.11 | Boolean values valid (e.g. BtchBookg) | E | CH16 |
Version differences handled by the two schemas: .09 renames BIC to BICFI, makes the execution date a choice of Dt or DtTm, and adds structured address elements. External code lists (purpose, category purpose, service level, local instrument) are free text in the schema and are checked in Stage 4.

## Stage 3 – Country context and payment classification
Stage 3 checks that the file fits the country the customer selected and assigns a payment type to every transaction; that type decides which Stage 7 and Stage 8 rules run.
| ID | Check | Sev | Code |
| 3.1 | Selected country has a configured rule pack | E | – |
| 3.2 | Debtor account IBAN country matches the selected country | E | NARR |
| 3.3 | Debtor agent BIC country (characters 5–6) matches the selected country | E | RC03 |
| 3.4 | All payment blocks belong to the selected country, if CMIplus requires one country per file | E | NARR |
| 3.5 | Payment type can be determined for each transaction | E | FF03 |
| 3.6 | Payment type is supported in the selected country | E | FF03 |
| 3.7 | One payment type per payment block, if CMIplus requires it | E | FF03 |
Payment types: SEPA credit transfer, SEPA Instant, domestic standard, domestic urgent, cross-border (SWIFT), intra-bank transfer, budget or tax payment. They are derived from service level, local instrument, category purpose, currency, and the creditor account and agent country. The derived type is shown per transaction in the report, so a customer sees why a rule applied.

## Stage 4 – Generic ISO 20022 business rules
Stage 4 holds the cross-field rules that apply to every pain.001 regardless of country, ordered by message level.

### Group header
| ID | Check | Sev | Code |
| 4.1 | MsgId not blank | E | CH16 |
| 4.2 | CreDtTm valid, not in the future beyond a tolerance, not older than the configured number of days | E | DT02 |
| 4.3 | NbOfTxs equals the number of transactions in the file | E | AM19 |
| 4.4 | CtrlSum equals the sum of all transaction amounts, regardless of currency | E | AM16 |
| 4.5 | Initiating party has a name or an identification | E | CH21 |

### Payment information (block)
| ID | Check | Sev | Code |
| 4.6 | PmtInfId not blank | E | CH16 |
| 4.7 | Block NbOfTxs, if given, equals the transactions in the block | E | AM18 |
| 4.8 | Block CtrlSum, if given, equals the sum of the block | E | AM17 |
| 4.9 | Payment method is TRF (CHK or TRA only if supported) | E | CH16 |
| 4.10 | Requested execution date not in the past (or rolled to today, per CMIplus) | E | CH04 |
| 4.11 | Requested execution date not beyond the maximum horizon | E | CH03 |
| 4.12 | In .09, execution date-time (DtTm) used only where supported | E | CH17 |
| 4.13 | Payment type information at block or transaction level, not both | E | CH17 |
| 4.14 | Charge bearer at block or transaction level, not both | E | CH17 |
| 4.15 | Debtor name present | E | CH21 |
| 4.16 | Debtor account has an IBAN or other ID; account currency, if given, is valid | E | AC02 |
| 4.17 | Debtor agent identified by BIC and/or clearing member ID | E | RC03 |
| 4.18 | Charges account valid; charges account agent is the debtor agent or its branch | E | AC01 |
| 4.19 | Ultimate debtor, if used, has a name or ID | E | CH21 |

### Transaction
| ID | Check | Sev | Code |
| 4.20 | EndToEndId present and not blank ("NOTPROVIDED" allowed) | E | FF08 |
| 4.21 | Amount greater than zero | E | AM01 |
| 4.22 | Decimal places fit the currency (EUR 2, JPY 0, KWD 3) | E | CH20 |
| 4.23 | Currency is an active ISO 4217 code | E | AM03 |
| 4.24 | Equivalent amount has a valid currency of transfer and is supported | E | AM03 |
| 4.25 | Exchange rate information consistent with the currencies used | W | – |
| 4.26 | Creditor agent present where the payment type needs it | E | RC04 |
| 4.27 | Clearing system code from the ISO external list and member ID format valid for that system (e.g. USABA 9 digits) | E | RC08 |
| 4.28 | Creditor name present | E | CH21 |
| 4.29 | Creditor country is a valid ISO 3166 code | E | BE11 |
| 4.30 | Any postal address is structured or hybrid: TwnNm and Ctry mandatory, max 2 AdrLine, no data repeated between them | E | CH16 |
| 4.31 | Creditor account present (except cheques), IBAN or other ID | E | AC03 |
| 4.32 | Ultimate creditor, if used, has a name or ID | E | CH21 |
| 4.33 | Instruction codes for agents valid (CHQB, HOLD, PHOB, TELB) and supported | E | CH16 |
| 4.34 | Purpose code in the ISO ExternalPurpose1Code list | E | FF07 |
| 4.35 | Category purpose code in the ISO external list | E | FF06 |
| 4.36 | Service level code in the ISO external list | E | FF04 |
| 4.37 | Local instrument code in the ISO external list or an allowed proprietary value | E | FF05 |
| 4.38 | Remittance: unstructured and structured not combined unless allowed; occurrence limits | E | RR07 |
| 4.39 | Structured creditor reference type SCOR with valid ISO 11649 RF check digits | E | RR09 |
| 4.40 | Regulatory reporting indicator and codes valid and allowed | E | RR05 |

## Stage 5 – Character set, identifiers and field formats
Stage 5 checks every text and identifier value against the character set of its payment type and the algorithmic formats (check digits, registries) that the XSD pattern cannot verify.
| ID | Check | Sev | Code |
| 5.1 | Text uses the allowed character set: SEPA Latin set (a–z A–Z 0–9 / - ? : ( ) . , ' + space), SWIFT X set for cross-border, local letters only where CMIplus allows | E | RR10 |
| 5.2 | Characters CMIplus would transliterate (e.g. ä to a) | W | RR10 |
| 5.3 | No control characters, tabs or line breaks inside values | E | RR10 |
| 5.4 | No leading or trailing spaces, no whitespace-only values | E | CH16 |
| 5.5 | Reference IDs (MsgId, PmtInfId, InstrId, EndToEndId) do not start or end with "/" and contain no "//" | E | CH16 |
| 5.6 | IBAN country known, length per IBAN registry, mod-97 check digits, national BBAN structure | E | AC01 |
| 5.7 | BIC is 8 or 11 characters with a valid country code | E | RC01 |
| 5.8 | Test BIC ("0" as second location character) used in a production file | W | RC01 |
| 5.9 | BIC found in the BIC directory (static reference file) | W | RC01 |
| 5.10 | Country codes valid ISO 3166-1 alpha-2, plus XK where used for Kosovo | E | BE09 |
| 5.11 | LEI (in .09) has 20 characters and valid ISO 17442 check digits | E | CH16 |
| 5.12 | Organisation and private ID scheme codes in the ISO external lists | W | – |
The IBAN, BIC and country checks run on every party and agent: debtor, creditor, ultimate parties, charges account and intermediary agents. The reason code follows the party, e.g. AC02 for the debtor account and AC03 for the creditor account.

## Stage 6 – CMIplus usage guideline rules
Stage 6 applies RBI's own pain.001 guideline for CMIplus, which tightens the ISO schema; these rules come from the CMIplus usage guideline, not from ISO.
| ID | Check | Sev | Code |
| 6.1 | Elements mandatory in the CMIplus guideline but optional in the XSD | E | CH21 |
| 6.2 | Elements not supported by CMIplus: forbidden (error) or ignored (warning) | E/W | CH17 |
| 6.3 | Occurrence limits stricter than the XSD (e.g. 1 Ustrd, 2 AdrLine) | E | CH17 |
| 6.4 | Length limits stricter than the XSD (e.g. names 70, remittance 140) | E | CH16 |
| 6.5 | Maximum payment blocks per file and transactions per file and per block | E | NARR |
| 6.6 | Currency supported for the selected country and payment type | E | AM03 |
| 6.7 | Execution date horizon and past-date handling as configured in CMIplus | E | CH03 |
| 6.8 | Batch booking value allowed and its conditions met (e.g. one currency per block) | E | NARR |
| 6.9 | Code values within the subset CMIplus supports (purpose, category purpose, service level, local instrument) | E | FF04–FF07 |
| 6.10 | Initiating party identification in the format CMIplus expects | E | NARR |
| 6.11 | Multiple debtor accounts or debtor agents in one file only if allowed | E | NARR |
| 6.12 | Ultimate debtor and ultimate creditor only where supported | W | CH17 |
Keep these rules in a separate module from the ISO rules so a guideline change never touches the ISO layer.

## Stage 7 – Payment-type rules
Stage 7 runs the scheme rules for the payment type assigned in Stage 3. Unstructured postal addresses stay accepted for now. The EPC postponed the SEPA end date of 15 November 2026 (EPC (https://www.europeanpaymentscouncil.eu/node/28486)) and will set a new one by February 2027 (Banking 4.0 (https://banking40.ro/european-payments-council-defers-setting-new-end-date-for-unstructured-address-format-until-february-2027/)). Swift deferred the CBPR+ removal planned for 14 November 2026 and has not set a new date (Swift (https://www.swift.com/insights/news/swift-accepts-community-request-extend-structured-address-migration-iso-20022-payment-messages)). Checks 7.8 and 7.18 are warnings until new end dates are set.

### SEPA credit transfer
| ID | Check | Sev | Code |
| 7.1 | Currency is EUR | E | AM03 |
| 7.2 | Creditor account is an IBAN of a SEPA-scheme country | E | AC03 |
| 7.3 | Service level SEPA, if given | E | FF04 |
| 7.4 | Charge bearer SLEV, if given | E | CH16 |
| 7.5 | Amount between 0.01 and 999,999,999.99 | E | AM02 |
| 7.6 | Names max 70 characters; remittance one Ustrd of max 140 or one Strd | E | CH15 |
| 7.7 | BIC optional, valid if given | E | RC07 |
| 7.8 | Addresses structured or hybrid; unstructured still accepted until the EPC sets a new end date | W | – |
| 7.9 | Debtor address present when the creditor's bank is in a non-EEA SEPA country | E | CH21 |

### SEPA Instant
| ID | Check | Sev | Code |
| 7.10 | Local instrument INST with currency EUR | E | FF05 |
| 7.11 | Execution date is today, or a future date only if CMIplus supports scheduled instant payments | E | NARR |
| 7.12 | Amount within the configured bank or customer instant limit | E | AM02 |

### Domestic (local currency)
| ID | Check | Sev | Code |
| 7.13 | Currency is the local currency of the selected country | E | AM03 |
| 7.14 | Creditor account is a local IBAN or valid local account format (Stage 8) | E | AC03 |
| 7.15 | Urgent or standard indicated through service level or local instrument as the local scheme requires | E | FF04 |
| 7.16 | Amount above a local high-value threshold sent as standard, where a local rule exists | W | – |

### Cross-border (SWIFT)
| ID | Check | Sev | Code |
| 7.17 | Creditor agent identified by BIC, or by clearing code plus name and address | E | RC04 |
| 7.18 | Debtor and creditor addresses structured or hybrid, with TwnNm and Ctry; unstructured still accepted until Swift sets a new date | W | – |
| 7.19 | Charge bearer DEBT, SHAR or CRED; SLEV not allowed | E | CH16 |
| 7.20 | Both banks in the EEA and an EEA currency: SHAR only | E | CH16 |
| 7.21 | Creditor account is an IBAN for IBAN countries, plausible account number otherwise | E | AC03 |
| 7.22 | Purpose or regulatory codes required by the destination country (configurable destination list) | E | RR05 |
| 7.23 | Currency plausible for the destination, e.g. BGN is no longer valid for Bulgaria since its euro adoption on 1 January 2026 (https://trade.ec.europa.eu/access-to-markets/en/news/bulgaria-adopts-euro-1-january-2026) | W | AM03 |
| 7.24 | Intermediary agent, if given, has a valid BIC | E | RC11 |
| 7.25 | Text that a downstream format would truncate | W | RR08 |

### Other types
| ID | Check | Sev | Code |
| 7.26 | Creditor account at an RBI bank in the same country: intra-bank transfer rules of the country pack apply | I | – |
| 7.27 | Budget, tax and customs payments: detected by creditor account or category purpose, checked in Stage 8 | I | – |

## Stage 8 – Country rule packs
The pack of the selected country runs on top of all generic rules and may only tighten them, never relax them. Its content comes from each network bank's local CMIplus guideline; every pack covers the same ten categories.
| Category | Typical checks |
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

## Stage 9 – In-file consistency and duplicates
Stage 9 compares transactions and blocks with each other inside the uploaded file; it cannot see files already processed in production.
| ID | Check | Sev | Code |
| 9.1 | PmtInfId unique in the file | E | DU02 |
| 9.2 | InstrId unique in the file | E | DU05 |
| 9.3 | EndToEndId unique in the file, except NOTPROVIDED | W | DU04 |
| 9.4 | UETR (in .09) unique in the file | E | NARR |
| 9.5 | Possible duplicate transactions: same creditor account, amount, currency, date and remittance | W | AM05 |
| 9.6 | Debtor account equal to creditor account | E | NARR |
| 9.7 | Same debtor account in blocks with different debtor names | W | – |
| 9.8 | Same debtor account, date and payment type spread over several blocks | I | – |
| 9.9 | MsgId already used in a file this customer validated in the app before (app history only) | W | DU01 |
| 9.10 | Ultimate debtor identical to the debtor | I | – |

## Stage 10 – Warnings and best-practice hints
Stage 10 never rejects; it tells the customer what CMIplus would change, ignore or handle sub-optimally.
| ID | Hint | Sev |
| 10.1 | Execution date on a weekend or local holiday; CMIplus moves it to the next business day | W |
| 10.2 | Execution date is today and may miss the cut-off (indicative, from configured cut-off times) | I |
| 10.3 | Text will be truncated by CMIplus or a downstream scheme | W |
| 10.4 | Characters will be transliterated | W |
| 10.5 | Elements present but ignored by CMIplus | W |
| 10.6 | Recommended data missing: structured creditor address, purpose code, LEI, ultimate debtor for payments on behalf | I |
| 10.7 | Hybrid address used where fully structured is recommended | I |
| 10.8 | pain.001.001.03 used; migration to .09 recommended if CMIplus plans to retire .03 | I |
| 10.9 | File close to the size or transaction limits | I |
| 10.10 | Initiating party differs from debtor; check the ultimate debtor rules for payments on behalf | I |

## Result report and status
The result mirrors a pain.002 technical check: a status per transaction, per payment block and for the file, each with the reason codes of its findings (ISO status codes (https://cdn.jsdelivr.net/npm/@taprsvp/iso20022_external_codes@1.0.1/code_sets/external_payment_group_status_code.json)).
| Level | ACTC | ACWC | PART | RJCT |
| Transaction | No errors | No errors, but CMIplus would change data (e.g. date moved) | – | At least one error on it or inherited from its block or file |
| Payment block | All transactions accepted | Accepted with changes | Some transactions rejected (only if CMIplus accepts partially) | Block-level error, or all transactions rejected |
| File | All blocks accepted | Accepted with changes | Some blocks or transactions rejected | Stage 0–2 structural error, group header error, or everything rejected |
Whether CMIplus accepts files partially or rejects them as a whole is a per-country setting of the status logic.
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
- Confirm the meaning of the selected country. If it means the beneficiaries' country, Stage 8 would run per transaction by creditor country instead of once per file.
- Confirm per country whether CMIplus accepts files partially or rejects them as a whole.
- Align severities and reason codes with what CMIplus returns in its pain.002 today.
- Confirm which pain.001 versions each country accepts and any retirement date for .03.
- Confirm how CMIplus treats unstructured addresses in .03 and .09 files now that the November 2026 end dates are postponed.
- Decide the character set policy per country (local letters allowed or transliterated).
- Set file size and transaction count limits.
- Name the owner and refresh cycle of static reference data, including the BIC directory licence.
- Decide which warnings are shown to customers in phase 2.

## Sources
- EPC:  (https://www.europeanpaymentscouncil.eu/node/28486)end date for  (https://www.europeanpaymentscouncil.eu/node/28486)unstructured address (https://www.europeanpaymentscouncil.eu/node/28486)es delayed (https://www.europeanpaymentscouncil.eu/node/28486), with a new date due by February (https://banking40.ro/european-payments-council-defers-setting-new-end-date-for-unstructured-address-format-until-february-2027/) 202 (https://banking40.ro/european-payments-council-defers-setting-new-end-date-for-unstructured-address-format-until-february-2027/)7 (https://banking40.ro/european-payments-council-defers-setting-new-end-date-for-unstructured-address-format-until-february-2027/)
- EPC guidance: provision of addresses under the EPC schemes (https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-11/EPC153-22%20v2.0%20EPC%20guidance%20document%20-%20Provision%20of%20Addresses%20under%20the%20EPC%20Payment%20Schemes.pdf)
- Swift:  (https://www.swift.com/insights/news/swift-accepts-community-request-extend-structured-address-migration-iso-20022-payment-messages)structured address migration for CBPR+ extended (https://www.swift.com/insights/news/swift-accepts-community-request-extend-structured-address-migration-iso-20022-payment-messages)
- ISO 20022 change request: status reason codes AM16–AM19, RR09, RR10 (https://iso20022.org/milestone/12511/download)
- ISO external payment group status codes (https://cdn.jsdelivr.net/npm/@taprsvp/iso20022_external_codes@1.0.1/code_sets/external_payment_group_status_code.json)
- European Commission: Bulgaria adopts the euro on 1 January 2026 (https://trade.ec.europa.eu/access-to-markets/en/news/bulgaria-adopts-euro-1-january-2026)

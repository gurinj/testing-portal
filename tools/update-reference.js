#!/usr/bin/env node
/*
 * Testing Portal – refresh the ISO reference lists in config/reference/.
 *   mkdir /tmp/ref && cd /tmp/ref
 *   npm pack currency-codes i18n-iso-countries ibantools @taprsvp/iso20022_external_codes
 *   for f in *.tgz; do mkdir -p "x-${f%.tgz}" && tar -xzf "$f" -C "x-${f%.tgz}"; done
 *   node tools/update-reference.js /tmp/ref
 * payment-areas.json and clearing-systems.json are maintained by hand.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/update-reference.js <folder with the unpacked packages>'); process.exit(1); }
const OUT = path.resolve(__dirname, '../config/reference');
const find = prefix => { const d = fs.readdirSync(dir).find(f => f.startsWith('x-' + prefix)); if (!d) throw new Error(`package ${prefix} not found in ${dir}`); return path.join(dir, d, 'package'); };
const write = (f, o) => { fs.writeFileSync(path.join(OUT, f), JSON.stringify(o, null, 1) + '\n'); console.log('wrote', f); };

const cur = require(path.join(find('currency-codes'), 'data.js'));
const ccy = {};
for (const c of cur) ccy[c.code] = typeof c.digits === 'number' ? c.digits : null;
if (!('XCG' in ccy)) ccy.XCG = 2;
write('currencies.json', { source: 'ISO 4217 list one via npm currency-codes', note: 'code: decimal places; null where ISO gives none', currencies: ccy });

const cs = require(path.join(find('i18n-iso-countries'), 'codes.json')).map(r => r[0]);
if (!cs.includes('XK')) cs.push('XK');
write('countries.json', { source: 'ISO 3166-1 alpha-2 via npm i18n-iso-countries; XK added for Kosovo', countries: cs.sort() });

const ib = require(path.join(find('ibantools'), 'build/ibantools.cjs')).countrySpecs;
const reg = {};
for (const [k, v] of Object.entries(ib)) if (v.chars && v.IBANRegistry) reg[k] = { length: v.chars, bban: v.bban_regexp };
write('iban-registry.json', { source: 'SWIFT IBAN registry via npm ibantools', countries: reg });

const E = path.join(find('taprsvp'), 'code_sets');
const lists = { purpose: 'external_purpose_code', categoryPurpose: 'external_category_purpose_code', serviceLevel: 'external_service_level_code',
  localInstrument: 'external_local_instrument_code', clearingSystem: 'external_clearing_system_identification_code',
  organisationId: 'external_organisation_identification_code', personId: 'external_person_identification_code' };
const out = { source: 'ISO 20022 external code sets via npm @taprsvp/iso20022_external_codes', lists: {} };
for (const [k, f] of Object.entries(lists)) out.lists[k] = Object.keys(JSON.parse(fs.readFileSync(path.join(E, f + '.json'), 'utf8')).codes).sort();
write('external-codes.json', out);

/*
 * Testing Portal – identifiers with check digits: IBAN (ISO 13616) with the
 * IBAN registry, BIC country, LEI (ISO 17442), creditor reference RF
 * (ISO 11649) and clearing member ids. JavaScript, because XPath in SaxonJS
 * cannot compute mod 97 on a 30-digit number exactly (found in M0).
 * Called from the rules with xmlns:js="http://saxonica.com/ns/globalJS".
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  // letters A=10 … Z=35, then mod 97 digit by digit
  function mod97(s) {
    let r = 0;
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (c >= 65 && c <= 90) r = (r * 100 + (c - 55)) % 97;
      else if (c >= 48 && c <= 57) r = (r * 10 + (c - 48)) % 97;
      else return -1;
    }
    return r;
  }

  function ibanValid(value) {
    const x = String(value == null ? '' : value).replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(x)) return false;
    return mod97(x.slice(4) + x.slice(0, 4)) === 1;
  }

  /* '' if the IBAN is fine, otherwise what is wrong (5.6) */
  function ibanProblem(value) {
    const x = String(value == null ? '' : value).toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(x)) return 'it is not an IBAN (2 letters, 2 check digits, then letters and digits)';
    const reg = TP.reference.iban && TP.reference.iban.countries;
    const spec = reg && reg[x.slice(0, 2)];
    if (reg && !spec) return `${x.slice(0, 2)} is not a country of the IBAN registry`;
    if (spec && x.length !== spec.length) return `it has ${x.length} characters; an IBAN of ${x.slice(0, 2)} has ${spec.length}`;
    if (mod97(x.slice(4) + x.slice(0, 4)) !== 1) return 'the check digits are wrong';
    if (spec && spec.bban && !new RegExp(spec.bban).test(x.slice(4))) return `the account part does not have the structure of an IBAN of ${x.slice(0, 2)}`;
    return '';
  }
  const ibanUsed = country => !!(TP.reference.iban && TP.reference.iban.countries[String(country || '').toUpperCase()]);

  /* BIC: characters 5–6 are a country code (5.7) */
  function bicCountryValid(bic) {
    const c = String(bic || '').slice(4, 6).toUpperCase();
    return TP.functions.list('countries').has(c);
  }

  /* LEI: 18 characters plus 2 check digits, mod 97 = 1 (5.11) */
  function leiValid(v) {
    const x = String(v || '').toUpperCase();
    return /^[A-Z0-9]{18}[0-9]{2}$/.test(x) && mod97(x) === 1;
  }

  /* RF creditor reference: RF, 2 check digits, up to 21 characters, mod 97 = 1 (4.39) */
  function rfValid(v) {
    const x = String(v || '').replace(/\s/g, '').toUpperCase();
    return /^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(x) && mod97(x.slice(4) + x.slice(0, 4)) === 1;
  }

  /* clearing member id: '' if fine or the system has no known format, else the expected format (4.27) */
  function clearingProblem(system, id) {
    const f = TP.reference.clearing && TP.reference.clearing.formats[String(system || '').toUpperCase()];
    if (!f) return '';
    return new RegExp(f.pattern).test(String(id || '')) ? '' : f.text;
  }

  const fns = { tpIbanValid: ibanValid, tpIbanProblem: ibanProblem, tpIbanUsed: ibanUsed, tpBicCountryValid: bicCountryValid, tpLeiValid: leiValid, tpRfValid: rfValid, tpClearingProblem: clearingProblem };
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns, { ibanValid, ibanProblem, mod97 });
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { ibanValid, ibanProblem, leiValid, rfValid, mod97 };
})(typeof self !== 'undefined' ? self : globalThis);

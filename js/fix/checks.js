/*
 * Testing Portal – checks of the values the user types or chooses on the fix screen (M3).
 *
 *   TP.fix.checks[name](value, c) → '' if the value can be used, else a short message
 *     c (optional, the proposal): c.version ('03' / '09') for the BIC pattern of the schema,
 *     c.allowed(ch) the character set of the payment type (5.1), so a typed value passes the rules
 *
 * Names are used in config/fixes.json ("check"). The IBAN and BIC checks use the same
 * functions as the rules (js/validation/functions/iban.js), so a value accepted here
 * passes 5.6 and 5.7 when the file is validated again.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.fix = TP.fix || {};
  const F = () => TP.functions || {};
  const s = v => String(v == null ? '' : v);
  const CONTROL = /[\x00-\x1F\x7F]/;

  function charsetProblem(x, c) {
    if (!c || typeof c.allowed !== 'function') return '';
    const bad = [...new Set([...x].filter(ch => !c.allowed(ch)))];
    return bad.length ? `${bad.slice(0, 5).map(ch => `“${ch}”`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not in the character set of this payment.` : '';
  }
  function text(max) {
    return (v, c) => {
      const x = s(v);
      if (!x.trim()) return 'Enter a value.';
      if (CONTROL.test(x)) return 'Remove the line breaks and tabs.';
      if (x !== x.trim()) return 'Remove the spaces at the start and end.';
      if ([...x].length > max) return `Use at most ${max} characters (now ${[...x].length}).`;
      return charsetProblem(x, c);
    };
  }
  function id(max) {
    const t = text(max);
    return (v, c) => t(v, c) || (/^\/|\/$|\/\//.test(s(v)) ? 'An id must not start or end with "/" or contain "//".' : '');
  }
  // the BIC patterns of the schemas: .03 BICIdentifier, .09 BICFIDec2014Identifier
  const BIC = { '03': /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/, '09': /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/ };

  const checks = {
    text35: text(35), text70: text(70), text140: text(140),
    id35: id(35),
    iban: v => {
      const x = s(v).replace(/\s+/g, '').toUpperCase();
      if (!x) return 'Enter the IBAN.';
      if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(x)) return 'An IBAN has 2 letters, 2 digits and up to 30 letters or digits.';
      const p = F().tpIbanProblem ? F().tpIbanProblem(x) : '';
      return p ? p.replace(/^The IBAN [^ ]+ /, 'This IBAN ') : '';
    },
    bic: (v, c) => {
      const x = s(v).trim().toUpperCase();
      if (!x) return 'Enter the BIC.';
      if (!/^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(x)) return 'A BIC has 8 or 11 letters and digits, for example DEUTDEFF or DEUTDEFF500.';
      if (c && c.version === '03' && !BIC['03'].test(x)) return 'This BIC does not fit the pain.001.001.03 schema (characters 1–6 letters, 7th not 0 or 1, 8th not O).';
      if (F().tpBicCountryValid && !F().tpBicCountryValid(x)) return `${x.slice(4, 6)} (characters 5 and 6) is not a country code.`;
      return '';
    },
    date: v => {
      const x = s(v).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
      if (!m) return 'Use the form YYYY-MM-DD, for example 2026-12-01.';
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? '' : 'This date does not exist.';
    },
    // a production BIC: not a test BIC with "0" as 8th character (5.8)
    bicLive: (v, c) => checks.bic(v, c) || (s(v).trim().toUpperCase()[7] === '0' ? 'This is a test BIC (8th character 0): use the production BIC of the bank.' : ''),
    lei: v => {
      const x = s(v).trim().toUpperCase();
      if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(x)) return 'An LEI has 18 letters or digits and 2 check digits.';
      return F().tpLeiValid && !F().tpLeiValid(x) ? 'The check digits of this LEI are wrong.' : '';
    },
    rf: v => {
      const x = s(v).replace(/\s+/g, '').toUpperCase();
      if (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(x)) return 'An RF reference has RF, 2 check digits and up to 21 letters or digits.';
      return F().tpRfValid && !F().tpRfValid(x) ? 'The check digits of this RF reference are wrong.' : '';
    },
    country: v => (/^[A-Z]{2}$/.test(s(v)) && (!F().tpIn || F().tpIn('countries', s(v))) ? '' : 'Use a two-letter ISO country code, for example AT.'),
    currency: v => (/^[A-Z]{3}$/.test(s(v)) && (!F().tpIn || F().tpIn('currencies', s(v))) ? '' : 'Use a three-letter ISO currency code, for example EUR.'),
    code4: v => (/^[A-Z0-9]{1,4}$/.test(s(v)) ? '' : 'Use 1 to 4 capital letters or digits.'),
    any: v => (s(v).trim() ? '' : 'Enter a value.')
  };
  /* how a value is written into the file: IBAN and BIC without spaces, in capitals */
  const normalise = { iban: v => s(v).replace(/\s+/g, '').toUpperCase(), bic: v => s(v).trim().toUpperCase(), bicLive: v => s(v).trim().toUpperCase(), country: v => s(v).trim().toUpperCase(), currency: v => s(v).trim().toUpperCase(),
    lei: v => s(v).trim().toUpperCase(), rf: v => s(v).replace(/\s+/g, '').toUpperCase() };

  TP.fix.checks = checks;
  TP.fix.normalise = (name, v) => (normalise[name] ? normalise[name](v) : v);
})(typeof self !== 'undefined' ? self : globalThis);

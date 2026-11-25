/*
 * Testing Portal – settings, country and reference data for the rules.
 *
 * The rules call these functions through xmlns:js="http://saxonica.com/ns/globalJS":
 *   js:tpSetting('limits.creationDateMaxAge')      a value of the merged settings
 *   js:tpAllowed('guideline.codes.purpose', $code) true if the list is null or contains the value
 *   js:tpIn('currencies', $ccy)                    true if the value is in a reference list
 *   js:tpCountry('currency')                       a value of the selected country's file
 *   js:tpNow(), js:tpToday()                       the time of the check (fixed in tests)
 *   js:tpShiftNow('limits.creationDateMaxAge', -1) now minus the duration of that setting
 *   js:tpShiftToday('limits.executionDateMaxAhead', 1)
 *
 * TP.context is set before every validation (rules worker, tests):
 *   { country, countryConfig, settings (merged), now (Date) }
 * TP.reference is set once (config/reference/*.json).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  TP.context = TP.context || { country: null, countryConfig: {}, settings: {}, now: null };
  TP.reference = TP.reference || {};

  /* objects merged, values and lists replaced (null too: it switches a check off); keys starting with _ are notes */
  function merge(base, over) {
    if (over === undefined) return base;
    if (over === null || typeof base !== 'object' || base === null || Array.isArray(base) || typeof over !== 'object' || Array.isArray(over)) return over;
    const out = {};
    for (const k of Object.keys(base)) if (k[0] !== '_') out[k] = base[k];
    for (const k of Object.keys(over)) if (k[0] !== '_') out[k] = k in out ? merge(out[k], over[k]) : over[k];
    return out;
  }
  function settingsFor(general, countryConfig) {
    return merge(merge({}, general || {}), (countryConfig && countryConfig.settings) || {});
  }
  function get(obj, path) {
    let v = obj;
    for (const k of String(path).split('.')) { if (v == null || typeof v !== 'object') return null; v = v[k]; }
    return v === undefined ? null : v;
  }

  const sets = new Map(); // cache of reference lists as Sets
  function list(name) {
    let s = sets.get(name);
    if (s) return s;
    const r = TP.reference;
    const raw = {
      countries: r.countries && r.countries.countries,
      currencies: r.currencies && Object.keys(r.currencies.currencies),
      sepa: r.areas && r.areas.sepaCountries.codes,
      eea: r.areas && r.areas.eeaCountries.codes,
      eeaCurrencies: r.areas && r.areas.eeaCurrencies.codes,
      ibanCountries: r.iban && Object.keys(r.iban.countries)
    }[name] || (r.codes && r.codes.lists[name]);
    s = new Set(raw || []);
    sets.set(name, s);
    return s;
  }
  function resetCaches() { sets.clear(); }

  /* ---- time ---- */
  const now = () => (TP.context.now ? new Date(TP.context.now) : new Date());
  const pad = n => String(n).padStart(2, '0');
  function localIso(d) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  }
  /* ISO 8601 duration "P1Y2M3DT4H5M6S" -> parts */
  function parseDuration(s) {
    const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || '').trim());
    if (!m || s === 'P' || /T$/.test(s)) return null;
    const n = i => +(m[i] || 0);
    return { y: n(1), mo: n(2), d: n(3) * 7 + n(4), h: n(5), mi: n(6), s: n(7) };
  }
  /* calendar-aware: 31 March minus one month is 28/29 February */
  function shift(date, dur, sign) {
    const d = new Date(date);
    if (dur.y || dur.mo) {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + sign * (dur.y * 12 + dur.mo));
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    }
    d.setDate(d.getDate() + sign * dur.d);
    d.setTime(d.getTime() + sign * ((dur.h * 60 + dur.mi) * 60 + dur.s) * 1000);
    return d;
  }

  const fns = {
    tpSetting: path => { const v = get(TP.context.settings, path); return v == null ? null : v; },
    tpAllowed: (path, value) => { const l = get(TP.context.settings, path); return l == null || (Array.isArray(l) && l.includes(String(value))); },
    tpIn: (name, value) => list(name).has(String(value)),
    tpCountry: key => { const v = get(TP.context.countryConfig || {}, key); return v == null ? null : v; },
    tpNow: () => localIso(now()),
    tpToday: () => localIso(now()).slice(0, 10),
    // '' if the setting is null or not a valid duration: the rule then does not check
    tpShiftNow: (path, sign) => { const dur = parseDuration(get(TP.context.settings, path)); return dur ? localIso(shift(now(), dur, +sign < 0 ? -1 : 1)) : ''; },
    tpShiftToday: (path, sign) => { const dur = parseDuration(get(TP.context.settings, path)); if (!dur) return ''; const t = now(); t.setHours(12, 0, 0, 0); return localIso(shift(t, dur, +sign < 0 ? -1 : 1)).slice(0, 10); },
    tpCcyDecimals: ccy => {
      const t = TP.reference.currencies && TP.reference.currencies.currencies;
      const c = String(ccy == null ? '' : ccy).trim().toUpperCase();
      return t && c in t ? (t[c] == null ? 0 : t[c]) : 2;
    }
  };
  Object.assign(g, fns);

  /*
   * Problems in a country file (config/countries/<CC>.json): the values the rules read,
   * with the type they need. Checked by every build (tests/run-tests.js); a wrong value
   * must not stop the checks of that country (review 2026-11-19).
   */
  function checkCountryConfig(cfg) {
    const out = [];
    if (!cfg || typeof cfg !== 'object') return ['not an object'];
    const isList = v => Array.isArray(v) && v.every(x => typeof x === 'string');
    const nullOr = (k, test, want) => { if (cfg[k] !== undefined && cfg[k] !== null && !test(cfg[k])) out.push(`${k}: ${JSON.stringify(cfg[k])} must be ${want}`); };
    if (typeof cfg.code !== 'string' || !/^[A-Z]{2}$/.test(cfg.code)) out.push('code: two capital letters');
    nullOr('currency', v => /^[A-Z]{3}$/.test(v), 'an ISO 4217 code');
    nullOr('sepa', v => typeof v === 'boolean', 'true or false');
    nullOr('versions', v => isList(v) && v.every(x => /^(03|09)$/.test(x)), 'a list of "03" and "09"');
    nullOr('paymentTypes', isList, 'a list of payment type ids or null');
    nullOr('bankBics', isList, 'a list of BICs');
    nullOr('holidays', v => isList(v) && v.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x)), 'a list of dates (YYYY-MM-DD)');
    nullOr('budgetIbanPattern', v => { try { new RegExp(v); return typeof v === 'string'; } catch (e) { return false; } }, 'a regular expression');
    nullOr('currencies', v => typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, l]) => k[0] === '_' || l === null || isList(l)), 'an object of lists per payment type');
    nullOr('cutOff', v => typeof v === 'string' ? /^\d{2}:\d{2}$/.test(v) : typeof v === 'object' && Object.entries(v).every(([k, t]) => k[0] === '_' || t === null || /^\d{2}:\d{2}$/.test(t)), 'a time "HH:MM" or times per payment type');
    nullOr('settings', v => typeof v === 'object' && !Array.isArray(v), 'an object');
    if (cfg.domestic != null) for (const k of ['serviceLevels', 'localInstruments']) if (cfg.domestic[k] != null && !isList(cfg.domestic[k])) out.push(`domestic.${k}: must be a list or null`);
    return out;
  }

  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns, { merge, settingsFor, get, parseDuration, shift, localIso, list, resetCaches, checkCountryConfig, ccyDecimals: fns.tpCcyDecimals });
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = TP.functions;
})(typeof self !== 'undefined' ? self : globalThis);

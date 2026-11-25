/*
 * Testing Portal – functions of stage 6 (CMIplus guideline), used by
 * rules/stages/06-cmiplus-guideline.sch. Element lists and limits by path are in
 * guideline.js (js:tpMissing, js:tpPresent, js:tpLimit).
 *
 *   js:tpLengthFlag(.)                  6.4, fast test of the rule context: a value over its
 *                                       guideline.maxLength limit (most specific key)
 *   js:tpTxFlag(.)                      fast test of the transaction rule: 6.1, 6.2, 6.3, 6.6 or 6.12
 *                                       may fail
 *   js:tpOccursBelow(.)                 6.3: the children over their guideline.maxOccurs limit below
 *                                       the group header, a block or a transaction, in words; '' if none
 *   js:tpCurrenciesFor(type)            6.6: the currencies supported for a payment type in the
 *                                       selected country, separated by spaces; '' = any
 *   js:tpTypeAllowed(path, type)        6.12: a setting that is true, false or a list of payment
 *                                       types; true if the type is allowed (null, true, [] = all)
 *   js:tpSubset(path, value)            6.9: true if the list is null or empty or contains the value
 *   js:tpPatternProblem(path, value)    6.10: '' if the setting is null or the regular expression
 *                                       (JavaScript syntax, ^…$ for the whole value) matches; 'no match';
 *                                       or 'invalid: …' if the setting is not a regular expression
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const F = () => TP.functions;
  const setting = p => F().get(TP.context.settings, p);
  const isLimit = v => typeof v === 'number';

  /* 6.4, the fast test of the rule context: a value longer than its guideline.maxLength limit */
  let lenIndex = { settings: null, min: -1 };
  function lengthFlag(el) {
    if (lenIndex.settings !== TP.context.settings) {
      const m = setting('guideline.maxLength');
      const v = m && typeof m === 'object' ? Object.entries(m).filter(([k, x]) => k[0] !== '_' && isLimit(x) && x > 0).map(([, x]) => x) : [];
      lenIndex = { settings: TP.context.settings, min: v.length ? Math.min(...v) : -1 };
    }
    if (lenIndex.min < 0 || !el || el.nodeType !== 1) return false;
    const v = String(el.textContent);
    if (v.length <= lenIndex.min || el.firstElementChild) return false;
    const lim = F().limitFor(el, 'guideline.maxLength');
    return lim > 0 && [...v].length > lim;
  }

  /* 6.3: the elements below a level node (GrpHdr, PmtInf without its transactions, CdtTrfTxInf) with a
     child over its guideline.maxOccurs limit (most specific key, the child's path),
     e.g. "RmtInf contains Ustrd 3 times (at most 1)"; '' if none. One walk in JavaScript per level node. */
  let occIndex = { settings: null, names: null };
  function occursBelow(node) {
    if (!node || node.nodeType !== 1) return '';
    if (occIndex.settings !== TP.context.settings) {
      const m = setting('guideline.maxOccurs');
      const names = new Set(m && typeof m === 'object' ? Object.entries(m).filter(([k, v]) => k[0] !== '_' && isLimit(v) && v > 0).map(([k]) => k.split('/').filter(Boolean).pop()) : []);
      occIndex = { settings: TP.context.settings, names };
    }
    const names = occIndex.names, out = [];
    if (!names.size) return '';
    const walk = (el, rel) => {
      const counts = new Map(), first = new Map();
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (names.has(c.localName)) { counts.set(c.localName, (counts.get(c.localName) || 0) + 1); if (!first.has(c.localName)) first.set(c.localName, c); }
        if (c.firstChild && !(c.localName === 'CdtTrfTxInf' && el.localName === 'PmtInf')) walk(c, rel ? `${rel}/${c.localName}` : c.localName);
      }
      for (const [name, n] of counts) {
        const max = F().limitFor(first.get(name), 'guideline.maxOccurs');
        if (max > 0 && n > max) out.push(`${rel || el.localName} contains ${name} ${n} times (at most ${max})`);
      }
    };
    walk(node, '');
    return out.join('; ');
  }

  /* the fast test of the transaction rule: true if one of 6.1, 6.2, 6.3, 6.6, 6.12 may fail (the asserts
     call the same functions); a transaction without a problem does not fire the rule */
  function txFlag(tx) {
    if (!tx || tx.nodeType !== 1) return false;
    const D = F().dom;
    if (['mandatory', 'forbidden', 'ignored'].some(k => { const l = setting(`guideline.${k}.transaction`); return Array.isArray(l) && l.length; })) {
      if (F().tpMissing(tx, 'transaction') || F().tpPresent(tx, 'transaction', 'forbidden') || F().tpPresent(tx, 'transaction', 'ignored')) return true;
    }
    if (occursBelow(tx)) return true;
    const type = F().paymentType(tx);
    const amt = D.kid(tx, 'Amt'), instd = D.kid(amt, 'InstdAmt');
    const ccy = String(instd ? instd.getAttribute('Ccy') || '' : D.text(D.path(amt, 'EqvtAmt', 'CcyOfTrf'))).trim();
    const ok = currenciesFor(type);
    if (type && ok && /^[A-Z]{3}$/.test(ccy) && !ok.split(' ').includes(ccy)) return true;
    if ((D.kid(tx, 'UltmtDbtr') || D.kid(tx, 'UltmtCdtr')) && !typeAllowed('guideline.ultimateParties', type)) return true;
    return false;
  }

  function currenciesFor(type) {
    if (!type) return '';
    const cfg = TP.context.countryConfig || {};
    const map = cfg.currencies && typeof cfg.currencies === 'object' && !Array.isArray(cfg.currencies) ? cfg.currencies : {};
    let list;
    // only what the country file lists: the currency of SEPA (EUR, 7.1), SEPA Instant (7.10) and
    // domestic payments (local currency, 7.13) is checked by stage 7 (decided at the merge, 2026-11-18)
    if (Object.prototype.hasOwnProperty.call(map, type)) list = map[type];
    else list = null;
    return Array.isArray(list) ? list.map(c => String(c).trim().toUpperCase()).filter(Boolean).join(' ') : '';
  }

  function typeAllowed(path, type) {
    const v = setting(path);
    if (v === false) return false;
    if (Array.isArray(v)) return !v.length || v.map(String).includes(String(type || ''));
    return true;
  }

  function subset(path, value) {
    const l = setting(path);
    return !Array.isArray(l) || !l.length || l.map(String).includes(String(value == null ? '' : value).trim());
  }

  const patterns = new Map();
  function patternProblem(path, value) {
    const p = setting(path);
    if (p == null || p === '') return '';
    let re = patterns.get(p);
    if (re === undefined) {
      try { re = new RegExp(p); } catch (err) { re = `invalid: ${err.message}`; }
      patterns.set(p, re);
    }
    if (typeof re === 'string') return re;
    return re.test(String(value == null ? '' : value)) ? '' : 'no match';
  }

  const fns = { tpLengthFlag: lengthFlag, tpTxFlag: txFlag, tpOccursBelow: occursBelow, tpCurrenciesFor: currenciesFor, tpTypeAllowed: typeAllowed, tpSubset: subset, tpPatternProblem: patternProblem };
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns);
})(typeof self !== 'undefined' ? self : globalThis);

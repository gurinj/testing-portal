/*
 * Testing Portal – functions for the stage-10 hints.
 *
 *   js:tpCutOff($block)       10.2: the earliest cut-off time ("14:00") that applies to the
 *                             payment types of the block, '' if none is configured
 *   js:tpTruncated($node)     10.3: the texts below the node that are longer than
 *                             hints.truncateLength allows, '' if none
 *
 * Cut-off times are in the country file (config/countries/<CC>.json), "cutOff":
 *   null                                  no cut-off (10.2 off)
 *   "14:00"                               one time for every payment type except SEPA Instant
 *   { "SEPA": "14:00", "DOMESTIC_URGENT": "11:30", "default": "15:00" }
 *                                         per payment type id (docs/specs/M2.md, section 2);
 *                                         "default" for the types not listed; SEPA Instant only
 *                                         if listed by name. A type set to null has no cut-off.
 * Times are "HH:MM" in the local time of the computer running the check (as js:tpNow()).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const F = () => TP.functions;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

  function cutOffFor(type) {
    const c = TP.context.countryConfig && TP.context.countryConfig.cutOff;
    if (c == null || !type) return '';
    let v = null;
    if (typeof c === 'string') v = type === 'SEPA_INST' ? null : c;
    else if (typeof c === 'object') v = type in c ? c[type] : type === 'SEPA_INST' ? null : c.default;
    v = v == null ? '' : String(v).trim();
    return TIME.test(v) ? v : '';
  }
  function tpCutOff(blk) {
    if (!blk || blk.nodeType !== 1) return '';
    let best = '';
    const seen = new Set();
    for (const tx of F().dom.kids(blk, 'CdtTrfTxInf')) {
      const t = F().paymentType(tx);
      if (seen.has(t)) continue;
      seen.add(t);
      const v = cutOffFor(t);
      if (v && (!best || v < best)) best = v;
    }
    return best;
  }

  /* texts below node (not below its CdtTrfTxInf children, which are checked on their own) */
  function tpTruncated(node) {
    const map = F().get(TP.context.settings, 'hints.truncateLength');
    if (!node || !map || typeof map !== 'object' || !Object.keys(map).some(k => k[0] !== '_' && typeof map[k] === 'number')) return '';
    const out = [];
    const walk = el => {
      let leaf = true;
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        leaf = false;
        if (c.localName !== 'CdtTrfTxInf') walk(c);
      }
      if (!leaf || el === node) return;
      const max = F().limitFor(el, 'hints.truncateLength');
      const v = String(el.textContent);
      if (max > 0 && v.length > max) out.push(`${el.parentNode.localName}/${el.localName} has ${v.length} characters, only the first ${max} are kept ("${v.slice(0, max)}")`);
    };
    walk(node);
    return out.join('; ');
  }

  Object.assign(g, { tpCutOff, tpTruncated });
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, { tpCutOff, tpTruncated, cutOffFor });
})(typeof self !== 'undefined' ? self : globalThis);

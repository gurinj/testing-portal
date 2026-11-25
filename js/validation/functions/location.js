/*
 * Testing Portal – element path of a rule finding, e.g.
 * "/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[2]/CdtTrfTxInf[7]".
 * Called from the compiled rules instead of SchXslt's own location function
 * (see fastLocation in tools/build.js). SchXslt counts the earlier siblings
 * for every finding, which is slow when thousands of transactions fail a rule;
 * here the positions of a parent's children are counted once.
 */
(function (g) {
  'use strict';
  let positions = new WeakMap();
  function posOf(el) {
    const parent = el.parentNode;
    if (!parent || parent.nodeType !== 1) return 1;
    let m = positions.get(parent);
    if (!m) {
      m = new Map();
      const counts = Object.create(null);
      for (let c = parent.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const n = c.localName;
        counts[n] = (counts[n] || 0) + 1;
        m.set(c, counts[n]);
      }
      positions.set(parent, m);
    }
    return m.get(el) || 1;
  }
  function tpLocation(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentNode;
    let path = '';
    for (; el && el.nodeType === 1; el = el.parentNode) path = `/${el.localName}[${posOf(el)}]` + path;
    return path || '/';
  }
  g.tpLocation = tpLocation;
  const TP = g.TP = g.TP || {};
  TP.functions = TP.functions || {};
  TP.functions.location = tpLocation;
  TP.functions.resetLocations = () => { positions = new WeakMap(); };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { tpLocation };
})(typeof self !== 'undefined' ? self : globalThis);

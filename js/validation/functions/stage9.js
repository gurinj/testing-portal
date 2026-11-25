/*
 * Testing Portal – duplicates of a transaction in the file (stage 9: 9.2–9.5).
 *
 *   js:tpDuplicateOf($tx, 'I')   another transaction of the file with the same value, or ()
 *
 * Kinds:
 *   "I" InstrId (9.2)   "E" EndToEndId (9.3, not NOTPROVIDED)   "U" UETR (9.4, .09)
 *   "D" creditor account | amount | currency | currency of transfer | execution date |
 *       remittance texts (9.5)
 * Only the first of a repeated element counts (a repetition is an XSD error).
 * Accounts without spaces in upper case; the amount as a decimal (100.0 = 100.00);
 * the execution date of .03 (text) or .09 (Dt, or the date of DtTm); the
 * remittance: every non-blank text of RmtInf, Ustrd and Strd, in order.
 *
 * Why not xsl:key (docs/RULES.md, rule 1): one index of the whole file, built
 * once in one pass, like a key, but about four times cheaper. In SaxonJS every
 * key entry costs about 25 microseconds; four duplicate keys on 10,000
 * transactions took 1.0–1.6 s, this index 0.1–0.3 s (measured in M2).
 * The block-level checks (9.1, 9.7, 9.8) keep their keys: few entries.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const kid = (n, name) => { if (!n) return null; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === name) return c; return null; };
  const path = (n, ...names) => { let x = n; for (const nm of names) { x = kid(x, nm); if (!x) return null; } return x; };
  const norm = n => (n ? String(n.textContent).replace(/\s+/g, ' ').trim() : '');
  const compact = n => (n ? String(n.textContent).replace(/\s+/g, '').toUpperCase() : '');

  // "0100.50" -> "100.5"; null if not a decimal the XSD accepts
  function decimal(s) {
    const m = /^\s*\+?(\d*)(?:\.(\d*))?\s*$/.exec(s);
    if (!m || (!m[1] && !m[2])) return null;
    const int = (m[1] || '').replace(/^0+(?=\d)/, '') || '0', frac = (m[2] || '').replace(/0+$/, '');
    return frac ? `${int}.${frac}` : int;
  }
  function execDate(blk) {
    const rd = kid(blk, 'ReqdExctnDt');
    if (!rd) return '';
    const tm = kid(rd, 'DtTm'), dt = kid(rd, 'Dt');
    return tm ? norm(tm).slice(0, 10) : dt ? norm(dt) : norm(rd);
  }
  function texts(n, out) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) texts(c, out);
      else if (c.nodeType === 3) { const t = String(c.nodeValue).replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
    }
    return out;
  }

  // per node: a new file has new nodes, so nothing needs to be reset
  const txCache = new WeakMap(), dateCache = new WeakMap(), indexCache = new WeakMap();
  function keysOf(tx) {
    let k = txCache.get(tx);
    if (k) return k;
    k = {};
    const id = kid(tx, 'PmtId');
    const instr = norm(kid(id, 'InstrId')), e2e = norm(kid(id, 'EndToEndId')), uetr = norm(kid(id, 'UETR')).toLowerCase();
    if (instr) k.I = instr;
    if (e2e && e2e !== 'NOTPROVIDED') k.E = e2e;
    if (uetr) k.U = uetr;
    const acctId = path(tx, 'CdtrAcct', 'Id');
    const acct = compact(kid(acctId, 'IBAN') || path(acctId, 'Othr', 'Id'));
    const amt = kid(tx, 'Amt');
    const a = kid(amt, 'InstdAmt') || path(amt, 'EqvtAmt', 'Amt');
    const value = a ? decimal(String(a.textContent)) : null;
    if (acct && value != null) {
      const blk = tx.parentNode;
      let date = dateCache.get(blk);
      if (date === undefined) { date = execDate(blk); dateCache.set(blk, date); }
      const rmt = kid(tx, 'RmtInf');
      k.D = [acct, value, (a.getAttribute('Ccy') || '').trim(), norm(path(amt, 'EqvtAmt', 'CcyOfTrf')), date, rmt ? texts(rmt, []).join('/') : ''].join('|');
    }
    txCache.set(tx, k);
    return k;
  }
  // kind -> value -> the first two transactions with that value
  function indexOf(tx) {
    let root = tx;
    while (root.parentNode) root = root.parentNode;
    let ix = indexCache.get(root);
    if (ix) return ix;
    ix = { I: new Map(), E: new Map(), U: new Map(), D: new Map() };
    const doc = root.nodeType === 9 ? kid(root, 'Document') : root;
    for (let b = kid(doc, 'CstmrCdtTrfInitn'), blk = b && b.firstChild; blk; blk = blk.nextSibling) {
      if (blk.nodeType !== 1 || blk.localName !== 'PmtInf') continue;
      for (let t = blk.firstChild; t; t = t.nextSibling) {
        if (t.nodeType !== 1 || t.localName !== 'CdtTrfTxInf') continue;
        const k = keysOf(t);
        for (const kind in k) {
          const m = ix[kind], l = m.get(k[kind]);
          if (!l) m.set(k[kind], [t]); else if (l.length < 2) l.push(t);
        }
      }
    }
    indexCache.set(root, ix);
    return ix;
  }
  function tpDuplicateOf(tx, kind) {
    if (!tx || tx.nodeType !== 1) return null;
    const v = keysOf(tx)[String(kind)];
    if (!v) return null;
    const l = indexOf(tx)[String(kind)].get(v);
    if (!l || l.length < 2) return null;
    return l[0] === tx ? l[1] : l[0];
  }

  Object.assign(g, { tpDuplicateOf });
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, { tpDuplicateOf, duplicateKeys: keysOf, decimalKey: decimal });
})(typeof self !== 'undefined' ? self : globalThis);

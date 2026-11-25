/*
 * Testing Portal – where in the message a finding is.
 * Element paths look like "/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[2]/CdtTrfTxInf[7]/Amt[1]".
 * Used in the rules worker, on the page and in the Node tests.
 */
(function (g) {
  'use strict';
  /* -> { block: 2, tx: 7 } */
  function placeOf(xpath) {
    const b = /\/PmtInf\[(\d+)\]/.exec(xpath || '');
    const t = /\/CdtTrfTxInf\[(\d+)\]/.exec(xpath || '');
    return { block: b ? +b[1] : null, tx: b && t ? +t[1] : null };
  }
  /* 'file', 'block' or 'tx' */
  function levelOf(xpath) {
    const p = placeOf(xpath);
    return p.tx ? 'tx' : p.block ? 'block' : 'file';
  }
  /* "Block 2, transaction 7" */
  function whereOf(block, tx) {
    if (!block) return 'File';
    return tx ? `Block ${block}, transaction ${tx}` : `Block ${block}`;
  }
  const TP = g.TP = g.TP || {};
  TP.findings = TP.findings || {};
  Object.assign(TP.findings, { placeOf, levelOf, whereOf });
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { placeOf, levelOf, whereOf };
})(typeof self !== 'undefined' ? self : globalThis);

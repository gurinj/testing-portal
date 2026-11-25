/*
 * Testing Portal – overall status of a run.
 * RJCT if there is at least one error, ACWC if there are only warnings,
 * ACTC otherwise (hints do not change the status).
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  function counts(findings) {
    const c = { E: 0, W: 0, I: 0 };
    for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
    return c;
  }
  function status(findings) {
    const c = counts(findings);
    return c.E ? 'RJCT' : c.W ? 'ACWC' : 'ACTC';
  }
  TP.findings = TP.findings || {};
  TP.findings.counts = counts;
  TP.findings.status = status;
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { counts, status };
})(typeof self !== 'undefined' ? self : globalThis);

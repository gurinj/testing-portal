/*
 * Testing Portal – turns a Schematron report (SVRL) into findings.
 * Runs inside the rules worker and in the Node tests. Needs TPSaxes.
 *
 * Each failed assert or successful report becomes one raw finding:
 *   { id, rule, severity, code, message, xpath }
 * The rule id comes from the assert's id ("R4.3" -> "4.3"), the severity
 * from its role, the reason code from its flag.
 */
(function (g) {
  'use strict';
  const SVRL = 'http://purl.oclc.org/dsdl/svrl';
  const SEVERITY = { error: 'E', fatal: 'E', warning: 'W', warn: 'W', information: 'I', info: 'I', hint: 'I' };

  /* "/Q{urn:...}Document[1]/Q{urn:...}GrpHdr[1]/@Ccy" -> "/Document[1]/GrpHdr[1]/@Ccy" */
  function normalizePath(location) {
    return String(location || '')
      .replace(/Q\{[^}]*\}/g, '')
      .replace(/\/\*:([A-Za-z0-9_.-]+)\[namespace-uri\(\)=[^\]]*\]/g, '/$1')
      .replace(/\/([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)(?=\[|\/|$)/g, '/$2');
  }

  function fromSvrl(svrl) {
    const Saxes = (g.TPSaxes && g.TPSaxes.SaxesParser) || g.TPSaxes;
    const parser = new Saxes({ xmlns: true });
    const out = [];
    let cur = null, inText = false, text = '';
    parser.on('opentag', node => {
      if (node.uri !== SVRL) return;
      if (node.local === 'failed-assert' || node.local === 'successful-report') {
        const a = name => (node.attributes[name] ? node.attributes[name].value : '');
        const id = a('id');
        cur = {
          id,
          rule: id.replace(/^R/, '').split('-')[0],
          part: id.includes('-') ? id.slice(id.indexOf('-') + 1) : null,
          kind: node.local === 'failed-assert' ? 'assert' : 'report',
          severity: SEVERITY[String(a('role')).toLowerCase()] || 'E',
          code: a('flag') || null,
          xpath: normalizePath(a('location')),
          message: ''
        };
      } else if (node.local === 'text' && cur) { inText = true; text = ''; }
    });
    parser.on('text', t => { if (inText) text += t; });
    parser.on('closetag', node => {
      if (node.uri !== SVRL) return;
      if (node.local === 'text' && cur) { cur.message = text.replace(/\s+/g, ' ').trim(); inText = false; }
      else if ((node.local === 'failed-assert' || node.local === 'successful-report') && cur) { out.push(cur); cur = null; }
    });
    parser.write(svrl).close();
    return out;
  }

  const TP = g.TP = g.TP || {};
  TP.findings = TP.findings || {};
  TP.findings.fromSvrl = fromSvrl;
  TP.findings.normalizePath = normalizePath;
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { fromSvrl, normalizePath };
})(typeof self !== 'undefined' ? self : globalThis);

/*
 * Testing Portal – stage 1, message identification (main thread).
 * Catalogue checks 1.1 root element Document, 1.2 namespace (pain.001.001.03
 * or .09), 1.3 message element CstmrCdtTrfInitn, 1.4 version accepted for the
 * country. 1.5 and 1.6 need the CMIplus expectation and are not checked yet.
 * Any finding here stops the run.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const NS = 'urn:iso:std:iso:20022:tech:xsd:';
  const SUPPORTED = { 'pain.001.001.03': '03', 'pain.001.001.09': '09' };
  const LABEL = { '03': 'pain.001.001.03 (ISO 2009)', '09': 'pain.001.001.09 (ISO 2019)' };
  const KNOWN = {
    'pain.008': 'a direct debit (pain.008), not a credit transfer',
    'pain.002': 'a payment status report (pain.002), not a payment file',
    'pain.007': 'a payment reversal (pain.007), not a payment file',
    'camt.053': 'an account statement (camt.053), not a payment file',
    'camt.052': 'an account report (camt.052), not a payment file',
    'camt.054': 'a debit or credit notification (camt.054), not a payment file',
    'pacs.008': 'an interbank credit transfer (pacs.008), not a customer payment file'
  };

  // first element of the file: its name, prefix, namespace and the line it is on
  function firstElements(text) {
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    const found = [];
    let m;
    while ((m = re.exec(text)) && found.length < 2) {
      if (!m[2]) continue;
      const prefix = m[1] ? m[1].slice(0, -1) : '';
      found.push({ prefix, name: m[2], attrs: m[3], index: m.index, line: text.slice(0, m.index).split('\n').length });
      if (/\/\s*$/.test(m[3])) break;
      if (m.index > 65536) break;
    }
    return found;
  }
  const nsOf = (el, prefix) => {
    if (!el) return null;
    const re = prefix ? new RegExp(`xmlns:${prefix.replace(/[.]/g, '\\.')}\\s*=\\s*["']([^"']+)["']`) : /xmlns\s*=\s*["']([^"']+)["']/;
    return (re.exec(el.attrs) || [])[1] || null;
  };

  function run({ text, country, countryConfig }) {
    const [root, msg] = firstElements(text);
    const ns = nsOf(root, root && root.prefix);
    const stop = (rule, message, extra) => ({ stop: true, version: null, ns, findings: [Object.assign({ source: 'identify', rule, stage: 1, severity: 'E', code: 'FF01', level: 'file', message, xpath: root ? '/' + root.name : null, line: root ? root.line : 1, col: null }, extra || {})] });
    if (!root) return stop('1.1', 'The file contains no XML element.');
    if (root.name !== 'Document') return stop('1.1', `The root element is ${root.name}. A pain.001 file starts with Document.`, { actual: root.name, expected: 'Document' });
    const type = ns && ns.startsWith(NS) ? ns.slice(NS.length) : null;
    if (!type) return stop('1.2', ns ? `The namespace ${ns} is not an ISO 20022 namespace.` : 'The Document element has no namespace. A pain.001 file declares xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" or .09.', { actual: ns, expected: `${NS}pain.001.001.03 or .09` });
    const family = type.split('.').slice(0, 2).join('.');
    if (KNOWN[family]) return stop('1.2', `This file is ${KNOWN[family]}. Only pain.001 credit transfer files can be checked.`, { actual: type, expected: 'pain.001.001.03 or pain.001.001.09' });
    const version = SUPPORTED[type];
    if (!version) {
      const why = family === 'pain.001' ? `The version ${type} is not supported.` : `This is a ${type} message, not a pain.001 credit transfer.`;
      return stop('1.2', `${why} Supported are ${Object.values(LABEL).join(' and ')}.`, { actual: type, expected: 'pain.001.001.03 or pain.001.001.09' });
    }
    const msgNs = msg ? (msg.prefix ? nsOf(msg, msg.prefix) || ns : ns) : null;
    if (!msg || msg.name !== 'CstmrCdtTrfInitn') {
      return stop('1.3', msg ? `The message element is ${msg.name}. A pain.001 Document contains CstmrCdtTrfInitn.` : 'The Document element is empty. A pain.001 Document contains CstmrCdtTrfInitn.',
        { actual: msg ? msg.name : null, expected: 'CstmrCdtTrfInitn', xpath: msg ? `/Document/${msg.name}` : '/Document', line: msg ? msg.line : root.line });
    }
    if (countryConfig && Array.isArray(countryConfig.versions) && !countryConfig.versions.includes(version)) {
      return stop('1.4', `${LABEL[version]} is not accepted for ${countryConfig.name || country}.`, { actual: LABEL[version], expected: countryConfig.versions.map(v => LABEL[v]).join(' or ') });
    }
    return { stop: false, version, label: LABEL[version], ns, msgNs, findings: [] };
  }

  TP.stages = TP.stages || {};
  TP.stages.identify = { run, LABEL };
})(typeof self !== 'undefined' ? self : globalThis);

/*
 * Testing Portal – stage 2, XSD schema (runs in the XSD worker).
 * libxml2 parses the file first, so this stage also reports the
 * well-formedness checks of stage 0 (0.7, 0.9); those stop the run.
 * Schema errors (2.1–2.11) do not stop the run.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const SEVERITY = { '2.2': 'CH21', '2.3': 'CH17', '2.4': 'CH17', '2.5': 'CH16', '2.6': 'CH16', '2.7': 'CH16', '2.8': 'CH16', '2.9': 'CH16', '2.10': 'DT01', '2.11': 'CH16' };

  /* libxml2 parser messages in plain words; the original stays in raw */
  const PARSER = [
    [/xmlParseEntityRef: no name|EntityRef: expecting ';'/, () => 'An & is not written as &amp;.'],
    [/Opening and ending tag mismatch: (\S+) line (\d+) and (\S+)/, m => `The closing tag </${m[3]}> does not match the opening tag <${m[1]}> on line ${m[2]}.`],
    [/Premature end of data in tag (\S+)|EndTag: '<\/' not found/, m => m[1] ? `The file ends before the element ${m[1]} is closed. It may be cut off.` : 'The file ends before all elements are closed. It may be cut off.'],
    [/StartTag: invalid element name/, () => 'A < is not written as &lt;, or a tag name is not valid.'],
    [/AttValue: " or ' expected|attributes construct error/, () => 'An attribute value is not in quotes.'],
    [/Document is empty|Start tag expected/, () => 'The file contains no XML element.'],
    [/invalid Char value|out of allowed range|Char 0x/, () => 'The file contains a control character that XML does not allow.'],
    [/Specification mandates value for attribute (\S+)/, m => `The attribute ${m[1]} has no value.`],
    [/Attribute (\S+) redefined/, m => `The attribute ${m[1]} appears twice in one element.`]
  ];
  function friendly(msg) {
    for (const [re, f] of PARSER) { const m = re.exec(msg || ''); if (m) return f(m); }
    return msg;
  }

  async function run(client, { text, version }) {
    const r = await client.request({ type: 'validate', xml: text, version });
    if (!r.wellFormed) {
      return {
        stop: true, ms: r.ms,
        findings: r.errors.slice(0, 20).map(e => ({
          source: 'xsd', rule: e.rule, stage: 0, severity: 'E', code: 'FF01', level: 'file',
          message: e.rule === '0.9' ? 'There is content after the end of the message, for example a second message.' : friendly(e.message),
          raw: e.raw, xpath: null, line: e.line, col: e.col, actual: null, expected: null
        }))
      };
    }
    const place = TP.findings && TP.findings.placeOf ? TP.findings.placeOf : () => ({});
    return {
      stop: false, ms: r.ms, truncated: !!r.truncated, passes: r.passes,
      findings: r.errors.map(e => {
        const p = place(e.xpath || '');
        return {
          source: 'xsd', rule: e.rule, stage: 2, severity: 'E', code: SEVERITY[e.rule] || 'FF01',
          level: TP.findings && TP.findings.levelOf ? TP.findings.levelOf(e.xpath || '') : 'file',
          message: e.message, raw: e.raw, element: e.element, attribute: e.attribute,
          xpath: e.xpath, line: e.line, col: e.col, actual: e.actual, expected: e.expected || null,
          block: p.block || null, tx: p.tx || null
        };
      })
    };
  }

  TP.stages = TP.stages || {};
  TP.stages.xsd = { run };
})(typeof self !== 'undefined' ? self : globalThis);

/*
 * Testing Portal – functions of stage 5 (character set and formats), used by
 * rules/stages/05-characters-and-formats.sch:
 *
 *   js:tpTextFlag(.)        true if a text value (leaf element) may break 5.1–5.4;
 *                           the fast test in the rule context
 *   js:tpTextSet(.)         the character set of a value ('' for typed values such as
 *                           dates, amounts, IBAN, BIC: left to the XSD): the set of its
 *                           transaction's payment type (js:tpCharsetFor); for a
 *                           value of a payment block the SEPA set if the block is
 *                           SEPA or SEPA Instant, else the country's set; for the
 *                           group header the country's set
 *   js:tpCharsetLabel(set)  the set in words, for messages
 *   js:tpCharsetChars(set)  the characters of the set, for messages
 *   js:tpControlChars(v)    the control characters of a value in words (5.3)
 *   js:tpWithoutControls(v) the value without its control characters (5.1 leaves them to 5.3)
 *
 * The fast test accepts at once a value made only of characters that every
 * set in use allows (worked out once per validation from the settings), with
 * no space at the start or the end. In a clean file that is nearly every
 * value, so the payment type is looked up only for the rest.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const F = () => TP.functions;

  // the sets 5.1 can use: SEPA payments, cross-border payments, the others (the country's set)
  const setsInUse = () => [...new Set(['SEPA', 'CROSS_BORDER', ''].map(t => F().tpCharsetFor(t)))];

  let quick = { settings: null, countryConfig: null, re: null };
  function quickRe() {
    const ctx = TP.context;
    if (quick.settings === ctx.settings && quick.countryConfig === ctx.countryConfig) return quick.re;
    const defs = (ctx.settings && ctx.settings.charsets) || {};
    const sets = setsInUse().map(n => defs[n]).filter(c => c != null).map(c => new RegExp(`^[${c}]$`));
    let chars = '';
    for (let c = 0x21; c <= 0x7e; c++) {
      const ch = String.fromCharCode(c);
      if (sets.every(r => r.test(ch))) chars += /[\\\]\[^-]/.test(ch) ? '\\' + ch : ch;
    }
    const space = sets.every(r => r.test(' '));
    const re = !chars ? null : space ? new RegExp(`^[${chars}](?:[${chars} ]*[${chars}])?$`) : new RegExp(`^[${chars}]+$`);
    quick = { settings: ctx.settings, countryConfig: ctx.countryConfig, re };
    return re;
  }

  const EDGE = /^[ \t\r\n]|[ \t\r\n]$/;   // 5.4: space or line break at the start or the end (also a value of spaces only)
  const CONTROL = /[\u0000-\u001F\u007F-\u009F]/; // 5.3, the same as \p{Cc} in the rules

  /* values whose characters the XSD types fix (dates, amounts, numbers, booleans, IBAN, BIC, LEI, UETR,
     country and currency codes, enumerations): 5.1 and 5.2 leave them to the XSD; 5.3 and 5.4 still apply */
  const TYPED = new Set(['CreDtTm', 'NbOfTxs', 'CtrlSum', 'ReqdExctnDt', 'Dt', 'DtTm', 'BirthDt', 'RltdDt', 'FrDt', 'ToDt', 'BtchBookg',
    'XchgRate', 'IBAN', 'BIC', 'BICFI', 'BICOrBEI', 'AnyBIC', 'LEI', 'UETR', 'Ctry', 'CtryOfBirth', 'CtryOfRes', 'Ccy', 'CcyOfTrf', 'UnitCcy',
    'PmtMtd', 'ChrgBr', 'InstrPrty', 'PhneNb', 'MobNb', 'FaxNb']);
  const typed = el => TYPED.has(el.localName) || /Amt$/.test(el.localName);

  let blockSets = new WeakMap();
  function textSet(el) {
    if (!el || typed(el)) return '';
    for (let x = el && el.parentNode; x && x.nodeType === 1; x = x.parentNode) {
      const n = x.localName;
      if (n === 'CdtTrfTxInf') return F().tpCharsetFor(F().paymentType(x));
      if (n === 'PmtInf') {
        let s = blockSets.get(x);
        if (s === undefined) {
          const t = F().blockType(x);
          s = F().tpCharsetFor(t === 'MIXED' ? '' : t); // the set of the block's payment type (cross-border: SWIFT X), the country's set if mixed (merge 2026-11-18)
          blockSets.set(x, s);
        }
        return s;
      }
    }
    return F().tpCharsetFor('');
  }

  function textFlag(el) {
    const v = el ? String(el.textContent) : '';
    if (!v) return false;
    const q = quickRe();
    if (q && q.test(v)) return false;
    if (EDGE.test(v) || CONTROL.test(v)) return true;
    const set = textSet(el);
    if (!set) return false;
    return F().tpBadChars(v, set) !== '' || F().tpTranslitChars(v, set) !== '';
  }

  const LABELS = { sepa: 'the SEPA character set', swiftX: 'the SWIFT X character set' };
  const charsetLabel = set => LABELS[set] || `the character set "${set}" of ${TP.context.country || 'the country'}`;

  /* "A-Za-z0-9/\-?:().,'+ " -> "A–Z a–z 0–9 / - ? : ( ) . , ' + and space" */
  let described = { settings: null, map: new Map() };
  function charsetChars(set) {
    if (described.settings !== TP.context.settings) described = { settings: TP.context.settings, map: new Map() };
    if (!described.map.has(set)) described.map.set(set, describe(set));
    return described.map.get(set);
  }
  function describe(set) {
    const cls = ((TP.context.settings && TP.context.settings.charsets) || {})[set];
    if (cls == null) return '';
    const hex = cp => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    const word = cp => (cp === 0x20 ? 'space' : cp > 0x20 && cp < 0x7f ? String.fromCharCode(cp) : hex(cp));
    // tokens of the class: { cp, dash } where dash marks an unescaped "-" (a range between its neighbours)
    const tokens = [];
    const re = /\\x([0-9A-Fa-f]{2})|\\u([0-9A-Fa-f]{4})|\\(.)|([^\\])/gy;
    for (let m; (m = re.exec(cls));) {
      if (m[1] || m[2]) tokens.push({ cp: parseInt(m[1] || m[2], 16), dash: false });
      else tokens.push({ cp: (m[3] || m[4]).codePointAt(0), dash: m[4] === '-' });
    }
    const items = [];
    let space = false;
    for (let i = 0; i < tokens.length; i++) {
      if (i + 2 < tokens.length && tokens[i + 1].dash) {
        // a–z, 0–9; other ranges as code points (U+0020–U+007E)
        const [x, y] = [tokens[i].cp, tokens[i + 2].cp];
        const alnum = c => /[A-Za-z0-9]/.test(String.fromCharCode(c));
        items.push(alnum(x) && alnum(y) ? `${word(x)}–${word(y)}` : `${hex(x)}–${hex(y)}`);
        i += 2; continue;
      }
      if (tokens[i].cp === 0x20) space = true; else items.push(word(tokens[i].cp));
    }
    return items.join(' ') + (space ? (items.length ? ' and space' : 'space') : '');
  }

  const CONTROL_NAMES = { 9: 'tab', 10: 'line break', 13: 'carriage return' };
  function controlChars(v) {
    const seen = new Set();
    for (const ch of String(v == null ? '' : v)) {
      const cp = ch.codePointAt(0);
      if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) seen.add(CONTROL_NAMES[cp] || `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    }
    return [...seen].join(', ');
  }

  const withoutControls = v => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  const fns = { tpWithoutControls: withoutControls, tpTextFlag: textFlag, tpTextSet: textSet, tpCharsetLabel: charsetLabel, tpCharsetChars: charsetChars, tpControlChars: controlChars };
  Object.assign(g, fns);
  TP.functions = TP.functions || {};
  Object.assign(TP.functions, fns, { resetStage5: () => { blockSets = new WeakMap(); quick = { settings: null, countryConfig: null, re: null }; } });
})(typeof self !== 'undefined' ? self : globalThis);

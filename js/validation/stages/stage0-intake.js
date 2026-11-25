/*
 * Testing Portal – stage 0, file intake (main thread).
 * Catalogue checks 0.1 empty, 0.2 size, 0.3 not an XML file, 0.5 encoding,
 * 0.8 DOCTYPE / ENTITY. Well-formedness (0.7) and content after the root
 * (0.9) are reported by the XSD worker (libxml2), which knows line and column.
 * 0.4 (malware scan), 0.6 and 0.10 are not possible or not defined yet.
 * Any finding here stops the run: nothing else can be checked.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};
  const f = (rule, message, extra) => Object.assign({ source: 'intake', rule, stage: 0, severity: 'E', code: 'FF01', level: 'file', message, xpath: null, line: null, col: null }, extra || {});
  const stop = finding => ({ stop: true, findings: [finding] });

  // first bytes of file types that are sometimes chosen by mistake
  const MAGIC = [
    { bytes: [0x50, 0x4B, 0x03, 0x04], what: 'a ZIP archive (or an Office file such as .xlsx or .docx)' },
    { bytes: [0x25, 0x50, 0x44, 0x46], what: 'a PDF document' },
    { bytes: [0xD0, 0xCF, 0x11, 0xE0], what: 'an old Office file (.xls or .doc)' },
    { bytes: [0x1F, 0x8B], what: 'a GZIP archive' },
    { bytes: [0x52, 0x61, 0x72, 0x21], what: 'a RAR archive' },
    { bytes: [0x37, 0x7A, 0xBC, 0xAF], what: 'a 7-Zip archive' },
    { bytes: [0x89, 0x50, 0x4E, 0x47], what: 'a PNG image' },
    { bytes: [0xFF, 0xD8, 0xFF], what: 'a JPEG image' }
  ];
  const startsWith = (u8, sig) => sig.every((b, i) => u8[i] === b);

  function run({ bytes, maxBytes }) {
    const u8 = bytes ? new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength) : null;
    if (!u8 || !u8.byteLength) return stop(f('0.1', 'The file is empty.'));
    if (maxBytes && u8.byteLength > maxBytes) {
      const mb = n => (n / 1048576).toFixed(1);
      return stop(f('0.2', `The file is ${mb(u8.byteLength)} MB. Files up to ${mb(maxBytes)} MB can be checked.`, { actual: `${mb(u8.byteLength)} MB`, expected: `at most ${mb(maxBytes)} MB` }));
    }
    const magic = MAGIC.find(m => startsWith(u8, m.bytes));
    if (magic) return stop(f('0.3', `The file is ${magic.what}, not an XML file.`));
    const wide = utf16or32(u8);
    if (wide) return stop(f('0.5', `The file is ${wide} encoded. Payment files must be UTF-8.`, { actual: wide, expected: 'UTF-8' }));
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (err) {
      const at = firstInvalidUtf8(u8);
      const line = at == null ? null : countLines(u8, at);
      return stop(f('0.5', `The file contains bytes that are not valid UTF-8${line ? ` (first at line ${line})` : ''}. It is probably saved as Windows-1252 or ISO-8859.`, { line, actual: at == null ? null : `byte 0x${u8[at].toString(16).toUpperCase()}`, expected: 'UTF-8' }));
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (!text.trim()) return stop(f('0.1', 'The file contains no content, only spaces or line breaks.'));
    const decl = /^\s*<\?xml\b[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(text);
    if (decl && !/^utf-?8$/i.test(decl[1])) {
      return stop(f('0.5', `The XML declaration says encoding="${decl[1]}". Payment files must be UTF-8 and say so.`, { line: 1, actual: decl[1], expected: 'UTF-8' }));
    }
    // the prolog: everything before the first element; a DOCTYPE only counts there
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(DOCTYPE|ENTITY)\b|<([A-Za-z_][\w.:-]*)/gi;
    let m, root = null, dtd = null;
    while ((m = re.exec(text))) {
      if (m[1]) { dtd = dtd || m; continue; }
      if (m[2]) { root = m; break; }
      if (m.index > 1048576) break;
    }
    const html = (dtd && /^\s*html\b/i.test(text.slice(dtd.index + 9, dtd.index + 20))) || (root && /^html$/i.test(root[2]));
    if (html) return stop(f('0.3', 'The file is an HTML page, not an XML payment file.', { line: 1 }));
    if (dtd) {
      const line = text.slice(0, dtd.index).split('\n').length;
      return stop(f('0.8', `The file contains a ${dtd[1].toUpperCase()} declaration. Payment files must not contain one.`, { line, actual: `<!${dtd[1].toUpperCase()}` }));
    }
    if (!/^\s*</.test(text)) {
      const first = text.trim().slice(0, 40);
      return stop(f('0.3', 'The file is not an XML file: it does not start with an XML tag.', { line: 1, actual: first.length ? first + (text.trim().length > 40 ? '…' : '') : null }));
    }
    return { stop: false, text, findings: [] };
  }

  /* 'UTF-16' or 'UTF-32' from the byte-order mark or from the zero bytes of ASCII text; null otherwise */
  function utf16or32(u8) {
    if (startsWith(u8, [0xFF, 0xFE, 0x00, 0x00]) || startsWith(u8, [0x00, 0x00, 0xFE, 0xFF])) return 'UTF-32';
    if (startsWith(u8, [0xFF, 0xFE]) || startsWith(u8, [0xFE, 0xFF])) return 'UTF-16';
    const n = Math.min(u8.length, 64) & ~3;
    if (n < 4) return null;
    let even = 0, odd = 0, quad = 0;
    for (let i = 0; i < n; i++) if (u8[i] === 0) { if (i % 2) odd++; else even++; if (i % 4 !== 0) quad++; }
    if (even + odd === 0) return null;
    if (quad > n / 2) return 'UTF-32';
    if ((even >= n / 4 && odd === 0) || (odd >= n / 4 && even === 0)) return 'UTF-16';
    return null;
  }

  function firstInvalidUtf8(u8) {
    for (let i = 0; i < u8.length;) {
      const b = u8[i];
      const n = b < 0x80 ? 1 : (b & 0xE0) === 0xC0 ? 2 : (b & 0xF0) === 0xE0 ? 3 : (b & 0xF8) === 0xF0 ? 4 : 0;
      if (!n || (n === 2 && b < 0xC2)) return i;
      for (let k = 1; k < n; k++) if (i + k >= u8.length || (u8[i + k] & 0xC0) !== 0x80) return i;
      i += n;
    }
    return null;
  }
  function countLines(u8, end) { let n = 1; for (let i = 0; i < end; i++) if (u8[i] === 0x0A) n++; return n; }

  TP.stages = TP.stages || {};
  TP.stages.intake = { run };
})(typeof self !== 'undefined' ? self : globalThis);

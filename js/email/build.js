/*
 * Testing Portal – the email for the customer (M3, docs/specs/M3.md section 6).
 * Plain functions, no DOM: used by the Email screen (js/ui/email.js) and the Node tests.
 *
 *   TP.email.build(session, run, ctx) → { to: '', subject, body, attachments: [{ kind: 'report' | 'xml', name }],
 *                                          case, incomplete, problems }
 *     session  { runs: [Run], current: n }  (spec section 4)
 *     run      the run the email is about (normally the current one)
 *     ctx      { template (config/templates/email.en.json), countryName?, versions? (['03', '09']) }
 *
 * The texts come from the template file, so the service desk can change the
 * wording without touching this code. Cases: unreadable (stage 0 stopped),
 * unsupported (stage 1 stopped), fixed (changes applied), rejected, warnings,
 * passed; a note when some checks could not run, a note when the text says
 * the file passed.
 *
 * What goes into the email from the file: its name, counts, check titles,
 * places (block and transaction numbers, EndToEndIds), element and field names
 * and sample values. Never amounts, names, account numbers or other values:
 * the messages of rule and schema findings quote values and are not used, nor
 * the old and new values of the changes (a control sum is an amount, an
 * entered IBAN an account number).
 *
 * The fixes of an email are those of the fix runs that lead to the run, back
 * to the upload they started from (the "original"): a later upload in the same
 * chain is the customer's own new file, which does not contain earlier changes.
 */
(function (g) {
  'use strict';
  const TP = g.TP = g.TP || {};

  const CASES = ['unreadable', 'unsupported', 'rejected', 'fixed', 'warnings', 'passed'];
  const LISTS = ['findings', 'changes', 'samples', 'open'];
  const SEV_RANK = { E: 0, W: 1, I: 2 };
  const STATUSES = ['RJCT', 'ACWC', 'ACTC'];
  const MAILTO_LIMIT = 2000; // characters; Outlook and some web mail programs cut longer mailto links

  // the placeholders each part of the template may use (checkTemplate)
  const COMMON = ['file', 'country', 'formats'];
  const COUNTED = ['errors', 'warnings', 'hints', 'found'];
  const ALLOWED = {
    unreadable: [...COMMON, 'stopTitle', 'stopDetail', 'stopHint'],
    unsupported: [...COMMON, 'stopTitle', 'stopDetail', 'stopHint'],
    rejected: [...COMMON, ...COUNTED, 'findings'],
    warnings: [...COMMON, ...COUNTED, 'findings'],
    passed: [...COMMON, ...COUNTED, 'findings'],
    fixed: [...COMMON, ...COUNTED, 'correctedFile', 'errorsLeft', 'warningsLeft', 'sampleValues', 'result', 'copyResult', 'findings', 'changes', 'samples', 'open']
  };
  const RESULT_ALLOWED = [...COMMON, ...COUNTED, 'correctedFile', 'errorsLeft', 'warningsLeft', 'sampleValues'];
  const FORMATS = {
    lists: { finding: ['title', 'where'], findingWithElement: ['title', 'where', 'element'], change: ['field', 'where'], changeInFile: ['field'], sample: ['field', 'where', 'value'], more: ['more'], untitled: ['rule'] },
    where: { file: [], header: [], block: ['block'], tx: ['block', 'tx'], txWithId: ['block', 'tx', 'e2e'], transactions: ['transactions', 'block'], transactionsInBlock: ['transactions', 'block'], blocks: ['blocks'], places: ['places'] },
    stopDetail: { withLine: ['message', 'line'], withoutLine: ['message'] },
    found: { errorsAndWarnings: ['errors', 'warnings'], errorsOnly: ['errors'], warningsOnly: ['warnings'], none: [] },
    notes: { passed: [...COMMON, ...COUNTED], incomplete: [...COMMON, ...COUNTED] }
  };
  const COUNT_WORDS = ['errors', 'warnings', 'hints', 'sampleValues', 'transactions', 'blocks', 'places'];

  const PH = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
  const placeholders = s => [...String(s).matchAll(PH)].map(m => m[1]);
  // {name} → value; unknown names stay as they are, so a typo in the template shows in the text
  const fill = (s, values) => String(s == null ? '' : s).replace(PH, (all, k) => (values[k] != null ? String(values[k]) : all));
  const num = n => Number(n).toLocaleString('en-US');

  function count(tpl, word, n) {
    const forms = (tpl.counts || {})[word] || {};
    const form = n === 0 && forms['0'] != null ? forms['0'] : n === 1 && forms['1'] != null ? forms['1'] : forms.n != null ? forms.n : `{n} ${word}`;
    return fill(form, { n: num(n) });
  }

  /* ---------------- runs: the chain of fixes ---------------- */
  const runOf = (session, n) => (session && session.runs || []).find(r => r.n === n) || null;
  function currentRun(session) {
    if (!session || !Array.isArray(session.runs) || !session.runs.length) return null;
    return runOf(session, session.current) || session.runs[session.runs.length - 1];
  }

  /*
   * The fix runs that lead to the run and the upload they started from.
   * → { original, fixes: [Run], changes: [AppliedGroup] (in the order applied) }
   */
  function chainOf(session, run) {
    const fixes = [];
    let cur = run;
    const seen = new Set();
    while (cur && cur.source === 'fix' && !seen.has(cur.n)) {
      seen.add(cur.n);
      fixes.unshift(cur);
      cur = cur.parent != null ? runOf(session, cur.parent) : null;
    }
    const original = cur || fixes[0] || run;
    return { original, fixes, changes: fixes.flatMap(r => r.changes || []) };
  }

  /* ---------------- findings ---------------- */
  const isEngine = gr => /\.engine$/.test(gr.rule);
  // counts and status without "Some checks could not run": that is told by the incomplete note
  function tallyOf(result, fallback) {
    if (!result || !Array.isArray(result.groups)) {
      const c = (fallback && fallback.counts) || { E: 0, W: 0, I: 0 };
      return { E: c.E || 0, W: c.W || 0, I: c.I || 0, status: (fallback && fallback.status) || (c.E ? 'RJCT' : c.W ? 'ACWC' : 'ACTC') };
    }
    const c = { E: 0, W: 0, I: 0 };
    for (const gr of result.groups) if (!isEngine(gr)) c[gr.severity] = (c[gr.severity] || 0) + 1;
    return { ...c, status: c.E ? 'RJCT' : c.W ? 'ACWC' : 'ACTC' };
  }

  // a check without a catalogue title gets its message as title (report.js); messages quote values
  function titleOf(gr, tpl) {
    const first = gr.items && gr.items[0];
    if (!gr.title || gr.title === gr.message || (first && gr.title === first.message)) return fill(tpl.lists.untitled, { rule: gr.rule });
    return gr.title;
  }

  const e2eOk = e => e && e !== 'NOTPROVIDED' && String(e).length <= 35;
  // a place of a finding or of a change: { level, block, tx, e2e, header }
  const placeOfItem = it => ({ level: it.level, block: it.block || null, tx: it.tx || null, e2e: it.e2e || null, header: !!(it.xpath && /\/GrpHdr\[/.test(it.xpath)) });
  const placeOfRow = row => ({ level: row.tx ? 'tx' : row.block ? 'block' : 'file', block: row.block || null, tx: row.tx || null, e2e: row.e2e || null, header: !!(row.path && /\/GrpHdr\[/.test(row.path)) });

  function whereOf(places, tpl) {
    const W = tpl.where;
    if (!places.length) return W.file;
    const txs = new Map(), blocks = new Set();
    let files = 0, header = 0;
    for (const p of places) {
      if (p.level === 'tx' && p.block && p.tx) { const k = `${p.block}/${p.tx}`; if (!txs.has(k)) txs.set(k, p); }
      else if (p.level === 'block' && p.block) blocks.add(p.block);
      else { files++; if (p.header) header++; }
    }
    const kinds = (txs.size ? 1 : 0) + (blocks.size ? 1 : 0) + (files ? 1 : 0);
    if (kinds !== 1) return fill(W.places, { places: count(tpl, 'places', places.length) });
    if (files) return files === 1 ? (header ? W.header : W.file) : fill(W.places, { places: count(tpl, 'places', files) });
    if (blocks.size) return blocks.size === 1 ? fill(W.block, { block: [...blocks][0] }) : fill(W.blocks, { blocks: count(tpl, 'blocks', blocks.size) });
    if (txs.size === 1) { const p = [...txs.values()][0]; return e2eOk(p.e2e) ? fill(W.txWithId, p) : fill(W.tx, p); }
    const inBlocks = new Set([...txs.values()].map(p => p.block));
    const values = { transactions: count(tpl, 'transactions', txs.size), block: [...inBlocks][0] };
    return fill(inBlocks.size === 1 ? W.transactionsInBlock : W.transactions, values);
  }

  function findingLine(gr, tpl) {
    const els = gr.source === 'xsd' ? new Set(gr.items.map(i => i.element).filter(Boolean)) : new Set();
    const values = { title: titleOf(gr, tpl), where: whereOf(gr.items.map(placeOfItem), tpl) };
    if (els.size === 1) return fill(tpl.lists.findingWithElement, { ...values, element: [...els][0] });
    return fill(tpl.lists.finding, values);
  }
  // errors first, then warnings (or only the hints); otherwise in the order of the report
  function findingLines(result, sevs, tpl) {
    if (!result || !Array.isArray(result.groups)) return [];
    return result.groups.filter(gr => sevs.includes(gr.severity) && !isEngine(gr))
      .map((gr, i) => ({ gr, i })).sort((a, b) => SEV_RANK[a.gr.severity] - SEV_RANK[b.gr.severity] || a.i - b.i)
      .map(x => findingLine(x.gr, tpl));
  }

  // at most max lines, then "and N more"; one line more is shown rather than "and 1 more"
  function capped(lines, tpl) {
    const max = Math.max(1, +tpl.lists.max || 10);
    if (lines.length <= max + 1) return lines;
    return [...lines.slice(0, max), fill(tpl.lists.more, { more: num(lines.length - max) })];
  }

  /* ---------------- changes and sample values ---------------- */
  /*
   * The last change at each place wins (a later round may change a value again).
   * → { changes: [line], samples: [line], sampleCount }
   */
  function changeLines(changes, tpl) {
    const last = new Map();
    for (const gr of changes) for (const row of gr.rows || []) {
      const key = row.path || `${gr.field || gr.title}|${row.block || ''}|${row.tx || ''}|${gr.rule}-${gr.part || ''}`;
      last.delete(key); // keep the order of the last change
      last.set(key, { gr, row });
    }
    const byField = new Map(), bySample = new Map();
    let sampleCount = 0;
    for (const { gr, row } of last.values()) {
      const field = gr.field || gr.title || gr.rule;
      if (gr.kind === 'sample') {
        sampleCount++;
        const k = `${field}\u0000${row.next}`;
        if (!bySample.has(k)) bySample.set(k, { field, value: row.next, places: [] });
        bySample.get(k).places.push(placeOfRow(row));
      } else {
        if (!byField.has(field)) byField.set(field, []);
        byField.get(field).push(placeOfRow(row));
      }
    }
    const changesOut = [...byField.entries()].map(([field, places]) => places.every(p => p.level === 'file')
      ? fill(tpl.lists.changeInFile, { field })
      : fill(tpl.lists.change, { field, where: whereOf(places, tpl) }));
    const samples = [...bySample.values()].map(s => fill(tpl.lists.sample, { field: s.field, value: s.value == null ? '' : s.value, where: whereOf(s.places, tpl) }));
    return { changes: changesOut, samples, sampleCount };
  }

  /* ---------------- the case ---------------- */
  function caseOf(session, run) {
    const r = run && run.result;
    if (r && (r.stopped === 'intake' || r.stopped === 'well-formed')) return 'unreadable';
    if (r && r.stopped === 'identify') return 'unsupported';
    if (chainOf(session, run).changes.length) return 'fixed';
    const st = tallyOf(r, run).status;
    return st === 'RJCT' ? 'rejected' : st === 'ACWC' ? 'warnings' : 'passed';
  }

  function stopValues(result, tpl) {
    const gr = (result.groups || [])[0];
    if (!gr) return { stopTitle: '', stopDetail: '', stopHint: '' };
    const it = gr.items[0] || {};
    const message = String(it.message || '').trim();
    // the line helps in a file that cannot be read (stage 0); in stage 1 it is only the line of the root element
    const hasLine = it.line && gr.stage === 0 && !/\bline \d/.test(message);
    return {
      stopTitle: String(gr.title || '').replace(/\.$/, ''),
      stopDetail: fill(hasLine ? tpl.stopDetail.withLine : tpl.stopDetail.withoutLine, { message, line: it.line }),
      stopHint: gr.hint || ''
    };
  }

  const baseName = name => String(name || 'payment-file').replace(/\.[^.]+$/, '');
  const LABEL = v => `pain.001.001.${v}`;

  function joinWords(list, word) {
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} ${word} ${list[list.length - 1]}`;
  }

  /* one paragraph: placeholders filled; a list goes on the lines after the text, an empty list drops the paragraph */
  function paragraph(text, values, lists) {
    const listKey = placeholders(text).find(k => LISTS.includes(k));
    if (!listKey) { const p = fill(text, values).trim(); return p || null; }
    const lines = lists[listKey] || [];
    if (!lines.length) return null;
    const at = text.indexOf(`{${listKey}}`);
    const head = fill(text.slice(0, at), values).trim();
    const tail = fill(text.slice(at + listKey.length + 2), values).trim();
    return [head, ...lines, tail].filter(Boolean).join('\n');
  }

  function build(session, run, ctx = {}) {
    const tpl = ctx.template || TP.email.template;
    if (!tpl) throw new Error('The email template is not loaded (config/templates/email.en.json).');
    run = run || currentRun(session);
    if (!run || !run.result) throw new Error('There is no result to write the email about.');
    try { return write(session, run, ctx, tpl); }
    catch (err) {
      // an edited template with a missing part: say what to correct rather than where the code failed
      const problems = checkTemplate(tpl);
      if (problems.length) throw new Error(`The email texts (config/templates/email.en.json) have problems: ${problems.join(' ')}`);
      throw err;
    }
  }

  function write(session, run, ctx, tpl) {
    const r = run.result;
    const kase = caseOf(session, run);
    const chain = chainOf(session, run);
    // the file the customer sent: the upload the fixes started from (a fix run without changes has the same findings)
    const original = chain.original;
    const left = tallyOf(r, run);
    const sent = kase === 'fixed' ? tallyOf(original.result, original) : left;
    const versions = ctx.versions || (ctx.countryConfig && ctx.countryConfig.versions) || ['03', '09'];

    const values = {
      file: original.fileName || r.fileName || '',
      country: r.countryName || ctx.countryName || run.country || r.country || '',
      formats: joinWords(versions.map(LABEL), (tpl.words || {}).or || 'or'),
      errors: count(tpl, 'errors', sent.E), warnings: count(tpl, 'warnings', sent.W), hints: count(tpl, 'hints', sent.I),
      correctedFile: run.fileName || r.fileName || '',
      errorsLeft: count(tpl, 'errors', left.E), warningsLeft: count(tpl, 'warnings', left.W)
    };
    const F = tpl.found || {};
    values.found = fill(sent.E && sent.W ? F.errorsAndWarnings : sent.E ? F.errorsOnly : sent.W ? F.warningsOnly : F.none, values);

    const lists = {};
    if (kase === 'unreadable' || kase === 'unsupported') Object.assign(values, stopValues(r, tpl));
    else if (kase === 'fixed') {
      const ch = changeLines(chain.changes, tpl);
      values.sampleValues = count(tpl, 'sampleValues', ch.sampleCount);
      lists.changes = capped(ch.changes, tpl);
      lists.samples = capped(ch.samples, tpl);
      lists.open = capped(findingLines(r, ['E', 'W'], tpl), tpl);
      lists.findings = capped(findingLines(original.result, ['E', 'W'], tpl), tpl);
    } else lists.findings = capped(findingLines(r, kase === 'passed' ? ['I'] : ['E', 'W'], tpl), tpl);

    const C = tpl.cases[kase];
    if (kase === 'fixed') {
      values.result = fill((C.result || {})[sent.status] || '', values);
      values.copyResult = fill((C.copyResult || {})[left.status] || '', values);
    }
    const passes = kase === 'warnings' || kase === 'passed' || (kase === 'fixed' && left.status !== 'RJCT');
    const incomplete = !!r.incomplete && kase !== 'unreadable' && kase !== 'unsupported';

    const paras = [fill(tpl.greeting, values)];
    for (const p of C.text || []) { const t = paragraph(p, values, lists); if (t) paras.push(t); }
    if (incomplete && tpl.notes && tpl.notes.incomplete) paras.push(fill(tpl.notes.incomplete, values));
    if (passes && tpl.notes && tpl.notes.passed) paras.push(fill(tpl.notes.passed, values));
    const sig = Array.isArray(tpl.signature) ? tpl.signature.join('\n') : String(tpl.signature || '');
    if (sig) paras.push(fill(sig, values));

    const attachments = [{ kind: 'report', name: `${baseName(run.fileName || r.fileName)}_report.html` }];
    if (kase === 'fixed') attachments.push({ kind: 'xml', name: run.fileName || r.fileName });
    return {
      to: '', subject: fill(C.subject, values).replace(/\s+/g, ' ').trim(), body: paras.filter(Boolean).join('\n\n') + '\n',
      attachments, case: kase, incomplete: !!r.incomplete, problems: checkTemplate(tpl)
    };
  }

  /* ---------------- mailto ---------------- */
  /* RFC 6068: addresses separated by commas, subject and body percent-encoded, line breaks as CRLF */
  function mailto(to, subject, body) {
    const addr = String(to || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
      .map(a => encodeURIComponent(a).replace(/%40/g, '@')).join(',');
    const q = [];
    if (subject) q.push('subject=' + encodeURIComponent(subject));
    if (body) q.push('body=' + encodeURIComponent(String(body).replace(/\r?\n/g, '\r\n')));
    return 'mailto:' + addr + (q.length ? '?' + q.join('&') : '');
  }

  /* ---------------- template check ---------------- */
  /* → [problem]: what a person who edited the template must correct; [] when it is fine */
  function checkTemplate(tpl) {
    const out = [];
    if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return ['The template is not an object ({ … }).'];
    const isText = v => typeof v === 'string';
    const unknown = (where, s, allowed) => {
      for (const k of placeholders(s)) if (!allowed.includes(k)) out.push(`${where}: {${k}} is not a placeholder the tool knows here.`);
    };
    if (!isText(tpl.greeting)) out.push('greeting: must be a text.');
    if (!(isText(tpl.signature) || (Array.isArray(tpl.signature) && tpl.signature.every(isText)))) out.push('signature: must be a text or a list of lines.');
    const cases = tpl.cases || {};
    for (const c of CASES) {
      const C = cases[c];
      if (!C || typeof C !== 'object') { out.push(`cases.${c}: missing.`); continue; }
      if (!isText(C.subject)) out.push(`cases.${c}.subject: must be a text.`);
      else {
        unknown(`cases.${c}.subject`, C.subject, ALLOWED[c].filter(k => !LISTS.includes(k)));
        for (const k of placeholders(C.subject)) if (LISTS.includes(k)) out.push(`cases.${c}.subject: the list {${k}} cannot be used in the subject.`);
      }
      if (!Array.isArray(C.text) || !C.text.length || !C.text.every(isText)) { out.push(`cases.${c}.text: must be a list of paragraphs (texts).`); continue; }
      C.text.forEach((p, i) => {
        unknown(`cases.${c}.text[${i + 1}]`, p, ALLOWED[c]);
        const ls = placeholders(p).filter(k => LISTS.includes(k));
        if (ls.length > 1) out.push(`cases.${c}.text[${i + 1}]: only one list per paragraph (found ${ls.map(k => `{${k}}`).join(', ')}).`);
      });
      for (const key of ['result', 'copyResult']) {
        const uses = [C.subject, ...C.text].some(s => isText(s) && placeholders(s).includes(key));
        if (!uses) continue;
        if (!C[key] || typeof C[key] !== 'object') { out.push(`cases.${c}.${key}: missing (the text uses {${key}}).`); continue; }
        for (const st of key === 'result' ? ['RJCT', 'ACWC'] : STATUSES) {
          if (!isText(C[key][st])) out.push(`cases.${c}.${key}.${st}: missing.`);
          else unknown(`cases.${c}.${key}.${st}`, C[key][st], RESULT_ALLOWED);
        }
      }
    }
    for (const [sec, keys] of Object.entries(FORMATS)) {
      const S = tpl[sec];
      if (!S || typeof S !== 'object') { out.push(`${sec}: missing.`); continue; }
      for (const [k, allowed] of Object.entries(keys)) {
        if (!isText(S[k])) out.push(`${sec}.${k}: missing.`);
        else unknown(`${sec}.${k}`, S[k], allowed);
      }
    }
    if (tpl.lists && !(Number.isInteger(tpl.lists.max) && tpl.lists.max >= 1)) out.push('lists.max: must be a whole number of at least 1.');
    for (const w of COUNT_WORDS) {
      const f = (tpl.counts || {})[w];
      if (!f || typeof f !== 'object') { out.push(`counts.${w}: missing.`); continue; }
      if (!isText(f.n) || !f.n.includes('{n}')) out.push(`counts.${w}.n: must be a text with {n}.`);
      for (const k of Object.keys(f)) if (k[0] !== '_' && !['0', '1', 'n'].includes(k)) out.push(`counts.${w}.${k}: only "0", "1" and "n" are used.`);
    }
    if (!tpl.words || !isText(tpl.words.or)) out.push('words.or: missing.');
    return out;
  }

  // every placeholder the cases may use (the template's _about must explain each)
  const PLACEHOLDERS = [...new Set(Object.values(ALLOWED).flat())];
  TP.email = { build, caseOf, chainOf, currentRun, mailto, checkTemplate, MAILTO_LIMIT, CASES, PLACEHOLDERS, template: TP.email ? TP.email.template : null };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = TP.email;
})(typeof self !== 'undefined' ? self : globalThis);

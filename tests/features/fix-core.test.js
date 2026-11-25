/*
 * M3 fix core: locate, apply, propose, checks, session (docs/specs/M3.md, sections 3 and 4).
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, validate, contextFor, TP, ROOT } = t;
  for (const f of ['locate.js', 'edit.js', 'checks.js', 'propose.js', 'session.js']) require(path.join(ROOT, 'js/fix', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'js/fix/actions')).filter(f => f.endsWith('.js')).sort()) require(path.join(ROOT, 'js/fix/actions', f));
  const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/fixes.json'), 'utf8'));
  const F = TP.fix;
  const P = '/Document[1]/CstmrCdtTrfInitn[1]';
  const TX = (b, n) => `${P}/PmtInf[${b}]/CdtTrfTxInf[${n}]`;
  // the text outside the changed ranges must be the same: compare with the changes undone
  const sameOutside = (a, b, from, to) => a.slice(0, from) === b.slice(0, from) && a.slice(a.length - (a.length - to)) === b.slice(b.length - (a.length - to));

  head('M3 fix core: where elements are');
  {
    const x = '<?xml version="1.0"?>\r\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">\r\n  <CstmrCdtTrfInitn>\r\n    <GrpHdr><MsgId>A &amp; B</MsgId><Nb/></GrpHdr>\r\n    <PmtInf>\r\n      <Amt Ccy=\'EUR\' x="1">1.00</Amt>\r\n    </PmtInf>\r\n  </CstmrCdtTrfInitn>\r\n</Document>\r\n';
    const n = F.locate(x, [`${P}/GrpHdr[1]/MsgId[1]`, `${P}/GrpHdr[1]/Nb[1]`, `${P}/PmtInf[1]/Amt[1]/@Ccy`, `${P}/PmtInf[1]`], { children: [`${P}/PmtInf[1]`] });
    const m = n.get(`${P}/GrpHdr[1]/MsgId[1]`), nb = n.get(`${P}/GrpHdr[1]/Nb[1]`), amt = n.get(`${P}/PmtInf[1]/Amt[1]`), pi = n.get(`${P}/PmtInf[1]`);
    ok(m && m.value === 'A & B' && m.raw === 'A &amp; B' && x.slice(m.start, m.end) === '<MsgId>A &amp; B</MsgId>' && m.indent === null, 'locate: value with entities, exact start and end, inline element has no indentation', m && JSON.stringify([m.value, x.slice(m.start, m.end)]));
    ok(nb && nb.selfClosing && x.slice(nb.start, nb.end) === '<Nb/>', 'locate: a self-closing element');
    ok(amt && amt.attrs.Ccy.value === 'EUR' && x.slice(amt.attrs.Ccy.start, amt.attrs.Ccy.end) === 'EUR' && amt.attrs.Ccy.quote === "'" && amt.indent === '      ', 'locate: attribute value position (single quotes) and the indentation of a line', amt && JSON.stringify(amt.attrs));
    ok(pi && !pi.leaf && pi.children.length === 1 && pi.children[0].name === 'Amt' && x.slice(pi.children[0].start, pi.children[0].end).startsWith('<Amt'), 'locate: the children of a parent');
    ok(F.locate('<a><b>1</b>', [`/a[1]/b[1]`]).get('/a[1]/b[1]').value === '1', 'locate: a file that is not well-formed keeps what was found before the error');
  }

  head('M3 fix core: apply changes');
  {
    const x = gen.generate({ version: '03', transactions: 3, blocks: 1 });
    const prop = rows => [{ rule: 'T', part: null, title: 't', field: 'f', kind: 'calculated', sel: true, rows }];
    // text, with escaping
    const nm = `${TX(1, 2)}/Cdtr[1]/Nm[1]`;
    const a = F.apply(x, prop([{ op: 'text', path: nm, old: 'x', val: 'Müller & Söhne <GmbH>' }]));
    const loc = F.locate(x, [nm]).get(nm);
    ok(a.text.includes('<Nm>Müller &amp; Söhne &lt;GmbH&gt;</Nm>') && a.applied.length === 1 && a.skipped.length === 0, 'apply: a text value is replaced and escaped');
    ok(a.text.slice(0, loc.openEnd) === x.slice(0, loc.openEnd) && a.text.slice(a.text.length - (x.length - loc.closeStart)) === x.slice(loc.closeStart), 'apply: every other character of the file stays the same');
    // attribute
    const amt = `${TX(1, 1)}/Amt[1]/InstdAmt[1]`;
    const b = F.apply(x, prop([{ op: 'attr', path: amt, attr: 'Ccy', old: 'EUR', val: 'USD' }]));
    ok(/<InstdAmt Ccy="USD">/.test(b.text) && b.text.length === x.length, 'apply: an attribute value is replaced');
    // insert into an inline parent (Cdtr on one line): no new line
    const noName = x.replace('<Cdtr><Nm>Lindenhof Metall GmbH</Nm>', '<Cdtr>');
    const c = F.apply(noName, prop([{ op: 'insert', insert: { parent: `${TX(1, 1)}/Cdtr[1]`, name: 'Nm', after: [] }, val: 'Sample Creditor Name' }]));
    ok(c.text.includes('<Cdtr><Nm>Sample Creditor Name</Nm><PstlAdr>'), 'apply: insert as the first child of an inline parent');
    // insert after a sibling in a parent with one child per line, CRLF kept
    const crlf = x.replace(/\n/g, '\r\n');
    const d = F.apply(crlf, prop([{ op: 'insert', insert: { parent: `${P}/GrpHdr[1]`, name: 'CtrlSum', after: ['MsgId', 'CreDtTm', 'NbOfTxs'] }, val: '1.00' }]).map(p => p));
    const grp = /<GrpHdr>[\s\S]*?<\/GrpHdr>/.exec(d.text)[0];
    ok(/<NbOfTxs>3<\/NbOfTxs>\r\n      <CtrlSum>1.00<\/CtrlSum>\r\n      <CtrlSum>/.test(grp) && !/[^\r]\n/.test(d.text), 'apply: insert after the right sibling, with the indentation and CRLF line breaks of the file', grp);
    // remove a line, and an inline element
    const e = F.apply(x, prop([{ op: 'remove', path: `${P}/PmtInf[1]/BtchBookg[1]` }, { op: 'remove', path: `${TX(1, 1)}/PmtId[1]/InstrId[1]` }]));
    ok(!/BtchBookg/.test(e.text) && /<PmtMtd>TRF<\/PmtMtd>\n      <NbOfTxs>/.test(e.text) && /<PmtId><EndToEndId>E2E-000001/.test(e.text), 'apply: remove an element with its line, and an inline element alone');
    // two changes of the same text: the first wins
    const f2 = F.apply(x, [...prop([{ op: 'text', path: nm, val: 'A', where: 'x' }]), ...prop([{ op: 'text', path: nm, val: 'B', where: 'y' }])]);
    ok(f2.text.includes('<Nm>A</Nm>') && f2.skipped.length === 1 && /same text/.test(f2.skipped[0].reason), 'apply: two changes of the same text, the second is skipped with a reason');
    // a missing element and an element with children
    const g2 = F.apply(x, prop([{ op: 'text', path: `${TX(1, 9)}/Cdtr[1]/Nm[1]`, val: 'A' }, { op: 'text', path: `${TX(1, 1)}/Cdtr[1]`, val: 'A' }]));
    ok(g2.text === x && g2.skipped.length === 2, 'apply: a missing element and an element with children are skipped, the file is unchanged');
    // not selected, rows with an error
    ok(F.apply(x, [{ ...prop([{ op: 'text', path: nm, val: 'A' }])[0], sel: false }]).text === x && F.apply(x, prop([{ op: 'text', path: nm, val: 'A', error: 'bad' }])).text === x, 'apply: proposals not ticked and rows with an error change nothing');
  }

  head('M3 fix core: checks of typed values');
  {
    const C = F.checks;
    ok(C.iban('AT61 1904 3002 3457 3201') === '' && C.iban('AT621904300234573201') !== '' && C.iban('') !== '' && F.normalise('iban', 'at61 1904 3002 3457 3201') === 'AT611904300234573201', 'checks: IBAN (spaces allowed, check digits, normalised to capitals without spaces)', C.iban('AT621904300234573201'));
    ok(C.bic('DEUTDEFF') === '' && C.bic('DEUTDEFF500') === '' && C.bic('DEUTQQFF') !== '' && C.bic('DEUT') !== '', 'checks: BIC format and country');
    ok(C.date('2026-12-01') === '' && C.date('2026-02-30') !== '' && C.date('01.12.2026') !== '', 'checks: dates');
    ok(C.text70('A'.repeat(70)) === '' && C.text70('A'.repeat(71)) !== '' && C.text70(' A') !== '' && C.text70('') !== '' && C.id35('A//B') !== '', 'checks: texts and ids');
  }

  head('M3 fix core: propose, apply and validate again');
  {
    const base = gen.generate({ version: '09', transactions: 4, blocks: 1, type: 'CROSS_BORDER', country: 'UA' });
    let x = base.replace('<ChrgBr>SHAR</ChrgBr>', '<ChrgBr>SLEV</ChrgBr>')
      .replace(/<Cdtr><Nm>[^<]*<\/Nm>/, '<Cdtr>')
      .replace(/(<RmtInf><Ustrd>)([^<]*)(<\/Ustrd>)/, '$1$2 $3');
    const ctx = contextFor('UA');
    const r1 = await validate(x, '09', 'UA');
    const rules1 = r1.groups.map(g => g.rule + (g.part ? '-' + g.part : ''));
    ok(['7.19', '4.28', '5.4-spaces'].every(k => rules1.includes(k)), 'propose: the test file has 7.19, 4.28 and 5.4-spaces', rules1.join(','));
    const { proposals, manual } = F.propose(r1, x, { fixes, settings: ctx.settings, country: 'UA', countryConfig: ctx.countryConfig });
    const pr = k => proposals.find(p => p.rule + (p.part ? '-' + p.part : '') === k);
    ok(pr('5.4-spaces') && pr('5.4-spaces').sel === true && pr('5.4-spaces').kind === 'calculated', 'propose: a calculated change that does not change the payment is ticked');
    ok(pr('7.19') && pr('7.19').sel === false && pr('7.19').kind === 'choice' && pr('7.19').rows[0].val === 'SHAR' && pr('7.19').rows[0].old === 'SLEV', 'propose: a choice is proposed with its default, not ticked');
    ok(pr('4.28') && pr('4.28').sel === false && pr('4.28').kind === 'sample' && pr('4.28').rows[0].op === 'insert', 'propose: a sample value for a missing element (insert), not ticked');
    ok(Array.isArray(manual) && manual.every(m => m.reason), 'propose: findings without a fix are listed as manual, with a reason', JSON.stringify(manual.map(m => m.rule)));
    proposals.forEach(p => { p.sel = true; });
    F.setValue(pr('4.28'), 'Lindenhof Metall GmbH');
    const out = F.apply(x, proposals);
    ok(out.skipped.length === 0 && out.applied.length === 3, 'apply: all three changes applied', JSON.stringify(out.skipped));
    ok(out.applied.find(a => a.rule === '4.28').kind === 'entered' && out.applied.find(a => a.rule === '7.19').kind === 'choice', 'apply: an edited sample counts as entered, a choice as chosen');
    const r2 = await validate(out.text, '09', 'UA');
    const rules2 = r2.groups.map(g => g.rule + (g.part ? '-' + g.part : ''));
    ok(!['7.19', '4.28', '5.4-spaces'].some(k => rules2.includes(k)), 'validate again: the three findings are gone', rules2.join(','));
    ok(rules2.every(k => rules1.includes(k)), 'validate again: no new findings', rules2.filter(k => !rules1.includes(k)).join(','));
    // an entry: empty first, then checked
    const cd = x.replace(/(<CdtrAcct><Id>)<Othr><Id>[0-9]+<\/Id><\/Othr>/, `$1<IBAN>DE89370400440532013001</IBAN>`);
    const r3 = await validate(cd, '09', 'UA');
    const e = F.propose(r3, cd, { fixes, settings: ctx.settings, country: 'UA', countryConfig: ctx.countryConfig }).proposals.find(p => p.rule === '5.6');
    ok(e && e.kind === 'entry' && e.rows[0].val === '' && e.rows[0].error !== '', 'propose: an IBAN with wrong check digits is an entry, empty, not usable until typed', e && JSON.stringify(e.rows[0]));
    F.setValue(e, 'de89 3704 0044 0532 0130 00');
    ok(e.rows[0].val === 'DE89370400440532013000' && e.rows[0].error === '', 'propose: a typed IBAN is normalised and checked', e.rows[0].error);
  }

  head('M3 fix core: session runs');
  {
    const S = TP.session, s = S.create();
    const x = gen.generate({ version: '03', transactions: 2, blocks: 1 });
    const r = await validate(x, '03');
    Object.assign(r, { fileName: 'salaries.xml', country: 'AT' });
    const a = S.add(s, r, { text: x, bom: true });
    const r2 = { ...r, fileName: 'salaries_corrected.xml' };
    const b = S.add(s, r2, { source: 'fix', parent: a.n, changes: [{ rule: '5.4', rows: [{ where: 'x' }] }], text: x, bom: true });
    const c = S.add(s, { ...r, fileName: 'salaries_v2.xml' }, { parent: S.parentFor(s, { ...r, fileName: 'salaries_v2.xml' }, 'salaries_v2.xml').n });
    ok(S.chain(s, c).map(z => z.n).join() === '1,2,3' && S.changesOf(s, b).length === 1 && S.changesOf(s, c).length === 0, 'session: a new version of the file continues its chain; changes count from the latest upload only', S.chain(s, c).map(z => z.n).join());
    const d = S.add(s, { ...r, fileName: 'salaries_v2_corrected.xml' }, { source: 'fix', parent: c.n, changes: [{ rule: '7.19', rows: [{ where: 'y' }] }], text: x });
    ok(S.segment(s, d).map(z => z.n).join() === '3,4' && S.changesOf(s, d).length === 1 && S.changesOf(s, d)[0].rule === '7.19' && S.correctedName(s, d) === 'salaries_v2_corrected.xml', 'session: a fix of the new version is named after it and lists only its own changes', S.correctedName(s, d));
    ok(S.correctedName(s, b) === 'salaries_corrected.xml' && S.parentFor(s, { ...r, country: 'CZ' }, 'salaries.xml') === null, 'session: corrected file name; another country starts a new chain');
    const bytes = S.corrected(b);
    ok(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF && new TextDecoder().decode(bytes.slice(3)) === x, 'session: the corrected file keeps the BOM of the original, UTF-8');
    for (let i = 0; i < 3; i++) S.add(s, r, {});
    ok(s.runs.filter(z => z.result).length === 3 && s.runs[0].result === null && s.runs[0].counts, 'session: full results kept for the last 3 runs only, counts for all');
  }

  head('M3 fix core: speed');
  {
    const x = gen.generate({ version: '03', transactions: 10000, blocks: 4 });
    const paths = [];
    for (let b = 1; b <= 4; b++) for (let n = 1; n <= 2500; n++) paths.push(`${TX(b, n)}/Cdtr[1]/Nm[1]`);
    let t0 = Date.now();
    const nodes = F.locate(x, paths);
    const msL = Date.now() - t0;
    const rows = paths.map(p => ({ op: 'text', path: p, val: 'New Name' }));
    t0 = Date.now();
    const out = F.apply(x, [{ rule: 'T', title: 't', field: 'f', kind: 'calculated', sel: true, rows }]);
    const msA = Date.now() - t0;
    ok(nodes.size === 10000 && msL < 3000, `speed: locate 10,000 elements in a 10,000-transaction file in ${msL} ms`);
    ok(out.applied[0].rows.length === 10000 && (out.text.match(/<Nm>New Name<\/Nm>/g) || []).length === 10000 && msA < 4000, `speed: apply 10,000 changes in ${msA} ms`);
  }
};

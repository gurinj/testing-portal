/*
 * Findings of the independent review of M3 (2026-11-24), kept as tests: R1 rows of one unit, R2 namespace
 * prefix of inserted elements, R3 unique ids in linear time, R4 chains of another customer's file, R5 comments
 * inside values, R6 typed BICs and characters, R11 two edits at one place, R16 ids not ticked, R17 names.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, validate, contextFor, TP, ROOT } = t;
  for (const f of ['locate.js', 'edit.js', 'checks.js', 'propose.js', 'session.js']) require(path.join(ROOT, 'js/fix', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'js/fix/actions')).filter(f => f.endsWith('.js')).sort()) require(path.join(ROOT, 'js/fix/actions', f));
  const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/fixes.json'), 'utf8'));
  const F = TP.fix, S = TP.session;
  const P = '/Document[1]/CstmrCdtTrfInitn[1]';
  const TX = (b, n) => `${P}/PmtInf[${b}]/CdtTrfTxInf[${n}]`;
  const prop = (id, rows, extra) => Object.assign({ id, rule: id, part: null, title: id, field: id, kind: 'calculated', sel: true, rows }, extra || {});
  const key = p => p.rule + (p.part ? '-' + p.part : '');

  head('M3 review: changes made together or not at all (R1), two edits at one place (R11)');
  {
    const x = gen.generate({ version: '03', transactions: 3, blocks: 1 })
      .replace(/(<CdtTrfTxInf>[\s\S]*?<RmtInf>)<Ustrd>([^<]*)<\/Ustrd>/, '$1<Ustrd>$2 </Ustrd><Ustrd>Invoice 2</Ustrd>');
    const rmt = `${TX(1, 1)}/RmtInf[1]`;
    const u1 = `${rmt}/Ustrd[1]`, u2 = `${rmt}/Ustrd[2]`;
    const old1 = F.locate(x, [u1]).get(u1).value;
    const trim = prop('trim', [{ op: 'text', path: u1, old: old1, val: old1.trim(), where: 'T1' }]);
    const join = prop('join', [{ op: 'text', path: u1, old: old1, val: old1.trim() + ' Invoice 2', unit: rmt, where: 'T1' }, { op: 'remove', path: u2, old: 'Invoice 2', unit: rmt, where: 'T1' }]);
    const out = F.apply(x, [trim, join]);
    ok(out.text.includes('Invoice 2') && out.applied.length === 1 && out.applied[0].rule === 'trim' && out.skipped.length === 2, 'R1: when one row of a unit cannot be made, the other is not made either (no text lost)', JSON.stringify(out.skipped));
    const alone = F.apply(x, [join]);
    ok(alone.text.includes(`<Ustrd>${old1.trim()} Invoice 2</Ustrd></RmtInf>`) && alone.skipped.length === 0, 'R1: alone, both rows of the unit are made');
    const e = '<Document><MsgId></MsgId></Document>';
    const two = F.apply(e, [prop('a', [{ op: 'text', path: '/Document[1]/MsgId[1]', val: 'FIRST' }]), prop('b', [{ op: 'text', path: '/Document[1]/MsgId[1]', val: 'SECOND' }])]);
    ok(two.text === '<Document><MsgId>FIRST</MsgId></Document>' && two.skipped.length === 1, 'R11: two values for one empty element: the first only', two.text);
    const ins = F.apply('<Document><InitgPty><Id/></InitgPty></Document>', [
      prop('a', [{ op: 'insert', insert: { parent: '/Document[1]/InitgPty[1]', name: 'PstlAdr', after: [] }, val: 'x' }]),
      prop('b', [{ op: 'insert', insert: { parent: '/Document[1]/InitgPty[1]', name: 'Nm', after: [] }, val: 'y' }])]);
    ok(ins.skipped.length === 1 && ins.applied.length === 1, 'R11: two inserts at the same place: one is made, the other waits for the next round', ins.text);
  }

  head('M3 review: inserted elements keep the namespace prefix (R2)');
  for (const v of ['03', '09']) {
    const base = gen.generate({ version: v, transactions: 3, blocks: 1 });
    const pre = base.replace(/<(\/?)([A-Za-z][\w]*)([\s>/])/g, (m, s, n, e) => `<${s}ns:${n}${e}`).replace(/xmlns="/, 'xmlns:ns="')
      .replace(/<ns:Cdtr><ns:Nm>[^<]*<\/ns:Nm>/, '<ns:Cdtr>');
    const r1 = await validate(pre, v);
    ok(r1.groups.some(g => g.rule === '4.28'), `R2 (.${v}): a prefixed file without a creditor name has 4.28`, r1.groups.map(key).join(','));
    const ctx = contextFor('AT');
    const { proposals } = F.propose(r1, pre, { fixes, settings: ctx.settings, country: 'AT', countryConfig: ctx.countryConfig });
    const p = proposals.find(x => x.rule === '4.28');
    p.sel = true;
    const out = F.apply(pre, [p]);
    const r2 = await validate(out.text, v);
    ok(out.text.includes('<ns:Cdtr><ns:Nm>Sample Creditor Name</ns:Nm>') && !r2.groups.some(g => g.rule === '4.28' || g.rule === '2.4'), `R2 (.${v}): the new element gets the prefix, 4.28 is gone, no 2.4`, r2.groups.map(key).join(','));
  }

  head('M3 review: a value with a comment inside is not changed (R5)');
  {
    const x = gen.generate({ version: '03', transactions: 2, blocks: 1 }).replace(/<Cdtr><Nm>([^<]*)<\/Nm>/, '<Cdtr><Nm>$1 <!-- checked by AB --></Nm>');
    const nm = `${TX(1, 1)}/Cdtr[1]/Nm[1]`;
    const n = F.locate(x, [nm]).get(nm);
    ok(n.mixed && !n.value.includes('<!--'), 'R5: locate leaves the comment out of the value and marks the element', n && n.value);
    const out = F.apply(x, [prop('t', [{ op: 'text', path: nm, old: n.value, val: n.value.trim(), where: 'T1' }])]);
    ok(out.text === x && out.skipped.length === 1 && /comment/.test(out.skipped[0].reason), 'R5: apply refuses to rewrite it, with the reason');
    const r1 = await validate(x, '03');
    const ctx = contextFor('AT');
    const res = F.propose(r1, x, { fixes, settings: ctx.settings, country: 'AT', countryConfig: ctx.countryConfig });
    const sp = res.proposals.find(p => key(p) === '5.4-spaces'), mn = res.manual.find(m => key(m) === '5.4-spaces');
    ok(!sp && mn && /comment/.test(mn.reason), 'R5: propose lists it as manual, with the reason', JSON.stringify(res.manual.map(m => [key(m), m.reason])));
  }

  head('M3 review: unique ids in linear time (R3)');
  {
    const taken = new Set(['E2E-1']), counters = new Map();
    const t0 = Date.now();
    let last;
    for (let i = 0; i < 20000; i++) last = TP.fix.util.uniqueIdOf('E2E-1', taken, '-', 2, counters);
    const ms = Date.now() - t0;
    ok(last === 'E2E-1-20001' && taken.size === 20001 && ms < 1000, `R3: 20,000 copies of one id made unique in ${ms} ms`, last);
    const long = 'X'.repeat(35), tk = new Set([long]), c2 = new Map();
    const ids = Array.from({ length: 12 }, () => TP.fix.util.uniqueIdOf(long, tk, '-', 2, c2));
    ok(ids.every(v => v.length <= 35) && new Set(ids).size === 12 && ids[8] === 'X'.repeat(32) + '-10', 'R3: within 35 characters, also when the suffix grows', ids.slice(7, 10).join(' '));
  }

  head('M3 review: chains, names and settings (R4, R17, R8)');
  {
    const s = S.create();
    const mk = (fileName, acc, party) => ({ fileName, country: 'AT', status: 'RJCT', counts: { E: 1, W: 0, I: 0 }, blocks: [{ debtorAccount: acc }], facts: { grp: { msgId: 'PAIN001', initgPty: party } } });
    S.add(s, mk('ACME_salaries.xml', 'AT611904300234573201', 'ACME'), {});
    ok(S.parentFor(s, mk('Globex_payments.xml', 'AT021100000012345678', 'Globex'), 'Globex_payments.xml') === null, 'R4: the same MsgId alone does not chain another file');
    ok(S.parentFor(s, mk('ACME_salaries.xml', 'AT021100000012345678', 'Globex'), 'ACME_salaries.xml') === null, 'R4: the same file name with another debtor does not chain');
    ok((S.parentFor(s, mk('ACME_salaries_v2.xml', 'AT61 1904 3002 3457 3201', 'acme'), 'ACME_salaries_v2.xml') || {}).n === 1, 'R4: a new version with the same debtor continues the chain');
    const s2 = S.create();
    const u = S.add(s2, mk('x_corrected.xml', 'AT611904300234573201', 'A'), {});
    ok(S.correctedName(s2, { ...u, source: 'fix', parent: u.n, n: -1 }) === 'x_corrected2.xml', 'R17: a corrected copy uploaded again is not named x_corrected_corrected, nor like itself');
    const s3 = S.create();
    const a = S.add(s3, mk('pay.xml', 'AT611904300234573201', 'A'), {});
    const b = S.add(s3, mk('pay_corrected.xml', 'AT611904300234573201', 'A'), { source: 'fix', parent: a.n });
    const c = S.add(s3, mk('pay.xml', 'AT611904300234573201', 'A'), { parent: b.n });
    ok(S.correctedName(s3, { ...c, source: 'fix', parent: c.n, n: -1 }) === 'pay_corrected2.xml', 'R17: fixing the original again does not reuse the name of the first corrected copy');
    const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'js/validation/pipeline.js'), 'utf8');
    ok(/pin = cur\.result \? \{ settings: cur\.result\.settings/.test(src) && /pin && pin\.settings \? pin\.settings/.test(src), 'R8: a fix is validated again with the settings of the run it corrects');
  }

  head('M3 review: typed values and ids (R6, R16)');
  {
    ok(F.checks.bic('DEMOAT1A', { version: '03' }) !== '' && F.checks.bic('DEMOATWO', { version: '03' }) !== '' && F.checks.bic('DEMOAT1A', { version: '09' }) === '' && F.checks.bic('DEUTDEFF', { version: '03' }) === '', 'R6: a BIC is checked against the pattern of the file\'s schema');
    const sepa = ch => /[A-Za-z0-9/\-?:().,'+ ]/.test(ch);
    ok(F.checks.text70('Müller & Söhne GmbH', { allowed: sepa }) !== '' && F.checks.text70('Mueller and Soehne GmbH', { allowed: sepa }) === '' && F.checks.id35('MSG€1', { allowed: sepa }) !== '', 'R6: typed text is checked against the character set of the payment');
    const x = gen.generate({ version: '03', transactions: 3, blocks: 1 }).replace(/<EndToEndId>([^<]*)<\/EndToEndId>/, '<EndToEndId>Lohn-Müller-01</EndToEndId>');
    const r1 = await validate(x, '03');
    const ctx = contextFor('AT');
    const { proposals } = F.propose(r1, x, { fixes, settings: ctx.settings, country: 'AT', countryConfig: ctx.countryConfig });
    const p = proposals.find(q => q.rows.some(r => /EndToEndId\[1\]$/.test(r.path || '')));
    ok(p && p.sel === false && p.changesPayment === true, 'R16: a calculated change of an EndToEndId is proposed, not ticked, and marked as changing the payment', p && JSON.stringify([key(p), p.sel, p.rows[0].next]));
  }
};

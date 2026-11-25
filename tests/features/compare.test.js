/*
 * Testing Portal – tests of the run comparison (M3): js/compare/compare.js
 * (keys, matching) and js/ui/compare.js (comparison screen, runs strip).
 * Runs are real validations of generated files, changed by text edits the
 * way a customer or a fix would change them; the speed test builds two
 * reports of 10,000 transactions with the real report builder.
 */
'use strict';
const path = require('path');

module.exports = async t => {
  const { ok, head, gen, validate, TP, catalogue } = t;
  const C = require(path.join(t.ROOT, 'js/compare/compare.js'));
  const now = new Date(2026, 10, 18, 10, 0, 0); // Wednesday 18 November 2026, 10:00
  const file = (o = {}) => gen.generate({ version: '03', transactions: 20, blocks: 2, now, ...o });

  // a run as the page has it (TP.validation.validate adds fileName, country, version …)
  async function run(xml, v = '03', over) {
    const r = await validate(xml, v, 'AT', over, now);
    if (r.stop) return Object.assign(TP.report.build({ findings: r.findings, catalogue, stopped: 'well-formed' }), { stopped: 'well-formed', fileName: 'pay.xml', country: 'AT', version: v });
    return Object.assign(r, { fileName: 'pay.xml', country: 'AT', version: v });
  }
  const idOf = gr => gr.rule + (gr.part ? '-' + gr.part : '');
  const ids = list => [...new Set(list.map(idOf))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(',');
  const places = list => list.reduce((n, gr) => n + gr.count, 0);
  const brief = c => `resolved ${ids(c.resolved)} (${c.counts.resolved}) · open ${ids(c.open)} (${c.counts.open}) · new ${ids(c.new)} (${c.counts.new}) · skipped ${ids(c.skipped)} (${c.counts.skipped})`;
  const groupOf = (list, id) => list.filter(gr => idOf(gr) === id);
  const itemsOf = (list, id) => groupOf(list, id).flatMap(gr => gr.items);
  // every finding of a run has its own key
  const unique = (label, r) => ok(C.keysOf(r).size === r.items.length, `${label}: one key per finding (${r.items.length})`, `${C.keysOf(r).size} keys`);

  /* ---- editing the generated files like a customer would ---- */
  const cents = s => Math.round(parseFloat(s) * 100);
  const money = c => (c / 100).toFixed(2);
  function blocksOf(xml) {
    const out = [];
    for (let i = 0; ;) { const s = xml.indexOf('<PmtInf>', i); if (s < 0) break; const e = xml.indexOf('</PmtInf>', s) + 9; out.push({ start: s, end: e }); i = e; }
    return out;
  }
  function txsOf(xml, b) {
    const blk = blocksOf(xml)[b - 1], out = [];
    for (let i = blk.start; ;) { const s = xml.indexOf('<CdtTrfTxInf>', i); if (s < 0 || s > blk.end) break; const e = xml.indexOf('</CdtTrfTxInf>', s) + 14; out.push({ start: s, end: e, text: xml.slice(s, e) }); i = e; }
    return out;
  }
  // number of transactions and control sum of the group header and of block b, changed by dn and dc cents
  function counts(xml, b, dn, dc) {
    const fix = s => s.replace(/<NbOfTxs>(\d+)<\/NbOfTxs>/, (m, n) => `<NbOfTxs>${+n + dn}</NbOfTxs>`).replace(/<CtrlSum>([\d.]+)<\/CtrlSum>/, (m, c) => `<CtrlSum>${money(cents(c) + dc)}</CtrlSum>`);
    xml = fix(xml);
    const blk = blocksOf(xml)[b - 1];
    return xml.slice(0, blk.start) + fix(xml.slice(blk.start, blk.end)) + xml.slice(blk.end);
  }
  const amountOf = tx => cents(/<InstdAmt[^>]*>([^<]+)</.exec(tx)[1]);
  // a copy of transaction (b, from) with a new EndToEndId, InstrId and remittance text (else 9.5, possible duplicate payment),
  // put before transaction t of block b; counts and sums kept right
  function insertTx(xml, b, t, e2e, { from = t, edit = x => x } = {}) {
    const list = txsOf(xml, b);
    const copy = edit(list[from - 1].text.replace(/<EndToEndId>[^<]*</, `<EndToEndId>${e2e}<`).replace(/<InstrId>[^<]*</, `<InstrId>I-${e2e}<`).replace(/(<Ustrd>\s*)Invoice [^<]*/, `$1Invoice ${e2e}`));
    const last = list[list.length - 1].end;
    xml = t > list.length ? xml.slice(0, last) + '\n      ' + copy + xml.slice(last) : xml.slice(0, list[t - 1].start) + copy + '\n      ' + xml.slice(list[t - 1].start);
    return counts(xml, b, 1, amountOf(copy));
  }
  function removeTx(xml, b, t) {
    const tx = txsOf(xml, b)[t - 1];
    const ls = xml.lastIndexOf('\n', tx.start) + 1, le = xml.indexOf('\n', tx.end) + 1;
    return counts(xml.slice(0, ls) + xml.slice(le), b, -1, -amountOf(tx.text));
  }
  // text edit inside transaction t of block b
  function editTx(xml, b, t, edit) {
    const tx = txsOf(xml, b)[t - 1];
    const out = xml.slice(0, tx.start) + edit(tx.text) + xml.slice(tx.end);
    if (out === xml) throw new Error(`edit of block ${b}, transaction ${t} changed nothing`);
    return out;
  }
  const once = (xml, a, b) => { if (!xml.includes(a)) throw new Error('not in the file: ' + a); return xml.replace(a, b); };

  head('M3 run comparison: keys');
  {
    const r = await run(file({ defects: ['ctrlsum', 'bad-iban', 'no-creditor-name', 'past-date', 'dup-e2e', 'dup-pmtinf'] }));
    const keys = [...C.keysOf(r).keys()];
    unique('defect file', r);
    const has = k => ok(keys.includes(k), `key ${k}`, keys.join('\n'));
    has('4.4|file|GrpHdr[1]');                        // file level
    has('4.10|B:PMT-01');                             // block level, PmtInfId
    has('9.1|B:PMT-01');                              // duplicate PmtInfId: running number
    has('9.1|B:PMT-01#2');
    has('9.3|T:PMT-01/E2E-000001');                   // duplicate EndToEndId: running number
    has('9.3|T:PMT-01/E2E-000001#2');
    has('5.6-cdtr|T:PMT-01#2/E2E-000004|CdtrAcct[1]/Id[1]/IBAN[1]'); // transaction in the second block PMT-01
    has('4.28|T:PMT-01#2/E2E-000006');
    ok(r.items.every(it => keys.some(k => k.startsWith(idOf(it) + '|'))), 'every key starts with the check id and part');

    const x = await run(once(once(once(file(), '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><Foo>1</Foo>'), '<EndToEndId>E2E-000004</EndToEndId>', ''), '<PmtInfId>PMT-02</PmtInfId>', '<PmtInfId>A/B|C#1%</PmtInfId>'));
    const xk = [...C.keysOf(x).keys()];
    unique('XSD file', x);
    ok(xk.some(k => /^2\.4\|B:PMT-01\|Foo\[1\]\|Foo\|Foo is not an element/.test(k)), 'XSD key: place, element below it, element name and message', xk.join('\n'));
    ok(xk.some(k => /^2\.2\|T:A%2FB%7CC%231%25\/#2\|PmtId\[1\]\|PmtId\|/.test(k)), 'transaction without EndToEndId: its position (#2); /, |, # and % in ids are escaped', xk.join('\n'));
    const v = C.keysOf(x).values().next().value;
    ok(v && v.group && v.group.title && v.group.ck && v.item && 'where' in v.item && 'e2e' in v.item && 'line' in v.item && !v.item.message && !v.group.items, 'values are small copies: group (title, check) and item (where, EndToEndId, line)', JSON.stringify(v));
    // the same check twice on one block, next to a second block with the same PmtInfId: no key is lost
    const f = (b, line) => ({ source: 'rules', rule: '9.1', stage: 9, severity: 'E', code: 'DU02', level: 'block', message: 'm', xpath: `/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[${b}]`, line, col: 5 });
    const twice = TP.report.build({ findings: [f(1, 10), f(1, 10), f(2, 50)], summary: { grp: {}, blocks: [{ n: 1, id: 'PMT-01', txs: [] }, { n: 2, id: 'PMT-01', txs: [] }] }, catalogue });
    ok([...C.keysOf(twice).keys()].join(' ') === '9.1|B:PMT-01 9.1|B:PMT-01|#2 9.1|B:PMT-01#2', 'a key that repeats gets |#2, apart from the running number of a duplicate id', [...C.keysOf(twice).keys()].join(' '));
    const meta = C.keysOf(x).meta;
    ok(meta && meta.ids.has('B:PMT-01') && meta.ids.has('T:PMT-01/E2E-000001') && Array.isArray(meta.skipped) && !meta.skipped.length, 'meta: the place ids of the run and the modules that did not run', JSON.stringify({ skipped: meta.skipped, ids: meta.ids.size }));
  }

  head('M3 run comparison: a fixed file');
  {
    const a = await run(file({ defects: ['ctrlsum', 'bad-iban', 'no-creditor-name', 'past-date', 'dup-e2e'] }));
    const b = await run(file({ defects: ['no-creditor-name', 'dup-e2e'] })); // control sum, IBAN and date fixed
    const c = C.runs(a, b);
    ok(ids(c.resolved) === '4.4,4.10,5.6-cdtr' && !c.new.length, 'control sum, execution date and IBAN resolved, nothing new', brief(c));
    ok(c.counts.open === b.items.length && c.counts.resolved === a.items.length - b.items.length, 'every finding of the fixed file still open, the rest resolved', brief(c));
    ok(c.checks.resolved === 3 && c.checks.new === 0 && c.checks.open === b.groups.length, 'per check: 3 resolved, the others still open', JSON.stringify(c.checks));
    ok(c.open.every(gr => gr.items.every(i => !i.before && !i.was)), 'still open at the same place: no "before", no severity change');
    const same = C.runs(a, a);
    ok(same.counts.open === a.items.length && !same.counts.resolved && !same.counts.new, 'a run compared with itself: all still open');
    const back = C.runs(b, a);
    ok(ids(back.new) === '4.4,4.10,5.6-cdtr' && !back.resolved.length, 'the other way round: the three are new');
    const viaKeys = C.runs(C.keysOf(a), C.keysOf(b));
    ok(brief(viaKeys) === brief(c) && JSON.stringify(viaKeys.counts) === JSON.stringify(c.counts), 'two key maps give the same comparison as two results');
    const gr = c.resolved.find(x => x.rule === '5.6');
    ok(gr && gr.title && gr.severity === 'E' && gr.level === 'tx' && gr.items[0].where === 'Block 2, transaction 2' && gr.items[0].e2e === 'E2E-000004' && gr.items[0].line > 0,
      'a resolved group: title, severity, level and its places (where, EndToEndId, line of run a)', JSON.stringify(gr));
    ok(['resolved', 'open', 'new'].every(k => c[k].every((x, i, l) => !i || ({ file: 0, block: 1, tx: 2 }[l[i - 1].level] <= { file: 0, block: 1, tx: 2 }[x.level]))), 'groups in the order of the report: file, block, transaction');
  }

  head('M3 run comparison: a new version with transactions inserted or removed');
  {
    const base = file({ defects: ['bad-iban', 'no-creditor-name', 'dup-e2e', 'past-date'] });
    const a = await run(base);
    // two payments added at the start of block 1 and one in the middle of block 2, one of them with a wrong IBAN
    let v2 = insertTx(base, 1, 1, 'NEW-1');
    v2 = insertTx(v2, 1, 1, 'NEW-2', { edit: x => x.replace(/<IBAN>DE(\d\d)/, (m, d) => `<IBAN>DE${String((+d + 1) % 100).padStart(2, '0')}`) });
    v2 = insertTx(v2, 2, 5, 'NEW-3');
    const b = await run(v2);
    unique('new version', b);
    const c = C.runs(a, b);
    ok(!c.resolved.length && ids(c.new) === '5.6-cdtr' && c.counts.new === 1 && itemsOf(c.new, '5.6-cdtr')[0].e2e === 'NEW-2', 'nothing resolved; only the wrong IBAN of the inserted payment is new', brief(c));
    ok(c.counts.open === a.items.length, 'every finding of run a still open', brief(c));
    const moved = itemsOf(c.open, '9.3');
    ok(moved.length === 2 && moved.every(i => i.before && i.before.where !== i.where && i.before.line < i.line), 'the paths shifted (block 1, transaction 1 → 3) and the findings still match', JSON.stringify(moved));
    const blk = itemsOf(c.open, '4.10');
    ok(blk.length === 1 && blk[0].where === 'Block 1', 'block-level finding still open');
    ok(c.meta.byPosition === 0, 'nothing matched by position (the ids were kept)');

    // two payments removed from block 2: the one without creditor name (transaction 3) and a clean one before the wrong IBAN (transaction 1)
    const v3 = removeTx(removeTx(base, 2, 3), 2, 1);
    const r3 = await run(v3);
    const c3 = C.runs(a, r3);
    ok(ids(c3.resolved) === '4.28' && !c3.new.length && c3.counts.open === r3.items.length, 'the finding of a removed payment is resolved, the others still open', brief(c3));
    const shifted = itemsOf(c3.open, '5.6-cdtr')[0];
    ok(shifted && shifted.e2e === 'E2E-000004' && shifted.where === 'Block 2, transaction 1' && shifted.before.where === 'Block 2, transaction 2', 'the wrong IBAN after a removed payment: still open, one position up', JSON.stringify(shifted));

    // a block added in front: PmtInf[1] becomes PmtInf[2], block-level findings keep their PmtInfId
    const blk2 = base.slice(blocksOf(base)[1].start, blocksOf(base)[1].end).replace('<PmtInfId>PMT-02</PmtInfId>', '<PmtInfId>PMT-00</PmtInfId>').replace(/E2E-/g, 'NEW-').replace(/INS-/g, 'INN-').replace(/<Ustrd>Invoice /g, '<Ustrd>Invoice B0-');
    let v4 = base.slice(0, blocksOf(base)[0].start) + blk2 + '\n    ' + base.slice(blocksOf(base)[0].start);
    const sum = (blk2.match(/<InstdAmt[^>]*>[^<]+</g) || []).reduce((n, x) => n + cents(/>([^<]+)</.exec(x)[1]), 0);
    v4 = v4.replace(/<NbOfTxs>(\d+)<\/NbOfTxs>/, (m, n) => `<NbOfTxs>${+n + 10}</NbOfTxs>`).replace(/<CtrlSum>([\d.]+)<\/CtrlSum>/, (m, x) => `<CtrlSum>${money(cents(x) + sum)}</CtrlSum>`);
    const r4 = await run(v4);
    const c4 = C.runs(a, r4);
    const b4 = itemsOf(c4.open, '4.10');
    ok(!c4.resolved.length && b4.length === 1 && b4[0].where === 'Block 2' && b4[0].before.where === 'Block 1', 'a block added in front: the block-level finding of PMT-01 is still open (now block 2)', brief(c4));
    // (9.8 on PMT-02: the copy in front has the same debtor account and date, so the two blocks could be combined)
    ok(ids(c4.new) === '4.28,5.6-cdtr,9.8' && [...itemsOf(c4.new, '4.28'), ...itemsOf(c4.new, '5.6-cdtr')].every(i => /^NEW-/.test(i.e2e)) && itemsOf(c4.new, '9.8').length === 1 && itemsOf(c4.new, '9.8')[0].where === 'Block 3', 'the findings of the copied block are new', brief(c4) + JSON.stringify(itemsOf(c4.new, '9.8')));
  }

  head('M3 run comparison: duplicate EndToEndIds and changed ids');
  {
    // dup-e2e: transactions 1 and 2 of block 1 both have E2E-000001; the second one also lacks the creditor name
    const base = editTx(file({ defects: ['dup-e2e', 'dup-pmtinf', 'bad-iban'] }), 1, 2, x => x.replace(/<Nm>[^<]*<\/Nm>/, ''));
    const a = await run(base);
    ok(itemsOf(a.groups, '9.3').length === 2 && itemsOf(a.groups, '4.28').length === 1, 'set-up: 9.3 at two payments, 4.28 at the second one', ids(a.groups));
    // a payment inserted in front of both: the running numbers keep them apart
    const c1 = C.runs(a, await run(insertTx(base, 1, 1, 'NEW-1')));
    ok(!c1.resolved.length && !c1.new.length && itemsOf(c1.open, '4.28')[0].before.where === 'Block 1, transaction 2' && itemsOf(c1.open, '4.28')[0].where === 'Block 1, transaction 3', 'a payment inserted before two duplicates: all still open, 4.28 stays with the second one', brief(c1));
    // a third duplicate at the end of the block: the first two keep their keys, 9.3 is new at the third
    const c2 = C.runs(a, await run(insertTx(base, 1, 11, 'E2E-000001', { from: 3 })));
    const n2 = itemsOf(c2.new, '9.3');
    ok(!c2.resolved.length && n2.length === 1 && n2[0].where === 'Block 1, transaction 11' && itemsOf(c2.open, '9.3').length === 2, 'a third duplicate: new at the third payment only', brief(c2));
    // the fix gives the second payment a new EndToEndId: 9.3 resolved at both, 4.28 of that payment still open (matched by position)
    const fixed = await run(editTx(base, 1, 2, x => x.replace('<EndToEndId>E2E-000001<', '<EndToEndId>E2E-000003<')));
    const c3 = C.runs(a, fixed);
    ok(ids(c3.resolved) === '9.3' && c3.counts.resolved === 2 && !c3.new.length, 'a new EndToEndId for the duplicate: 9.3 resolved at both payments, nothing new', brief(c3));
    ok(itemsOf(c3.open, '4.28').length === 1 && itemsOf(c3.open, '4.28')[0].e2e === 'E2E-000003' && c3.meta.byPosition === 1, 'the other finding of that payment is still open, matched by position', brief(c3) + ' byPosition ' + c3.meta.byPosition);
    // the fix gives the second block PMT-01 a new PmtInfId: 9.1 resolved, the findings of its payments still open
    const second = base.indexOf('<PmtInfId>PMT-01</PmtInfId>', base.indexOf('<PmtInfId>PMT-01</PmtInfId>') + 1);
    const c4 = C.runs(a, await run(base.slice(0, second) + '<PmtInfId>PMT-02</PmtInfId>' + base.slice(second + 27)));
    ok(ids(c4.resolved) === '9.1' && c4.counts.resolved === 2 && !c4.new.length && itemsOf(c4.open, '5.6-cdtr').length === 1, 'a new PmtInfId for the duplicate block: 9.1 resolved, the IBAN finding in that block still open', brief(c4));
    // reordered payments keep their ids: nothing is paired by position
    const swapped = (() => { const l = txsOf(base, 2); return base.slice(0, l[0].start) + l[1].text + base.slice(l[0].end, l[1].start) + l[0].text + base.slice(l[1].end); })();
    const c5 = C.runs(a, await run(swapped));
    ok(!c5.resolved.length && !c5.new.length && c5.meta.byPosition === 0 && itemsOf(c5.open, '5.6-cdtr')[0].before.where === 'Block 2, transaction 2' && itemsOf(c5.open, '5.6-cdtr')[0].where === 'Block 2, transaction 1', 'two payments swapped: still open, at the new position', brief(c5));
  }

  head('M3 run comparison: file level, block level and XSD findings');
  {
    const base = once(once(file({ defects: ['ctrlsum', 'past-date'] }), '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><Foo>1</Foo>'), '<EndToEndId>E2E-000004</EndToEndId>', '');
    const a = await run(base);
    ok(['2.2', '2.4', '4.4', '4.10'].every(id => a.groups.some(gr => idOf(gr) === id)), 'set-up: XSD 2.2 and 2.4, 4.4 and 4.10', ids(a.groups));
    unique('XSD and rules', a);
    // payments inserted in block 1 and after the one without EndToEndId: XSD findings still open
    const c1 = C.runs(a, await run(insertTx(insertTx(base, 1, 1, 'NEW-1'), 2, 4, 'NEW-2')));
    ok(!c1.resolved.length && !c1.new.length, 'payments inserted: XSD, file-level and block-level findings still open', brief(c1));
    // a payment without EndToEndId is known by its position only: a payment inserted before it moves it (a known limit)
    const c1b = C.runs(a, await run(insertTx(base, 2, 1, 'NEW-1')));
    ok(ids(c1b.resolved) === '2.2' && ids(c1b.new) === '2.2' && c1b.counts.resolved === 1, 'known limit: a payment inserted before a payment without EndToEndId: its 2.2 counts as resolved and new', brief(c1b));
    // the fixes: unknown element removed, control sum and date right, EndToEndId added
    const fixed = await run(file());
    const c2 = C.runs(a, fixed);
    ok(ids(c2.resolved) === '2.2,2.4,4.4,4.10' && !c2.new.length, 'all four resolved', brief(c2));
    // another schema problem on the same place is a different finding
    const c3 = C.runs(a, await run(base.replace('<Foo>1</Foo>', '<Bar>1</Bar>')));
    ok(ids(c3.resolved) === '2.4' && ids(c3.new) === '2.4' && c3.checks.resolved === 1 && c3.checks.new === 1, 'unknown element Foo replaced by Bar: one resolved, one new', brief(c3) + JSON.stringify(c3.checks));
    // the same schema problem with another value stays open
    const amount = /<InstdAmt Ccy="EUR">[^<]+</.exec(file())[0];
    const amt = await run(once(file(), amount, '<InstdAmt Ccy="EUR">12.1234567<'));
    const amt2 = await run(once(file(), amount, '<InstdAmt Ccy="EUR">7.7654321<'));
    const c4 = C.runs(amt, amt2);
    ok(amt.groups.some(gr => gr.source === 'xsd') && !c4.resolved.length && !c4.new.length && c4.counts.open === amt.items.length && amt2.items.length === amt.items.length, 'an amount with too many decimals, another value next time: still open', brief(c4));
    // the payment without EndToEndId: its other findings follow it when the EndToEndId is added
    const noE2e = editTx(base, 2, 2, x => x.replace(/<IBAN>(\w\w)(\d\d)/, (m, cc, d) => `<IBAN>${cc}${String((+d + 1) % 100).padStart(2, '0')}`));
    const a5 = await run(noE2e);
    ok(itemsOf(a5.groups, '5.6-cdtr').length === 1 && !itemsOf(a5.groups, '5.6-cdtr')[0].e2e, 'set-up: a wrong IBAN on the payment without EndToEndId');
    const c5 = C.runs(a5, await run(noE2e.replace('<PmtId><InstrId>INS-000004</InstrId>', '<PmtId><InstrId>INS-000004</InstrId><EndToEndId>E2E-000004</EndToEndId>')));
    ok(ids(c5.resolved) === '2.2' && !c5.new.length && itemsOf(c5.open, '5.6-cdtr')[0].e2e === 'E2E-000004', 'EndToEndId added: 2.2 resolved, the IBAN finding of that payment still open', brief(c5));
  }

  head('M3 run comparison: severity changed, runs that stopped or could not run all checks');
  {
    const xml = file({ defects: ['dup-e2e', 'bad-iban'] });
    const a = await run(xml);
    const b = await run(xml, '03', { checks: { '9.3': { severity: 'E' } } });
    const c = C.runs(a, b);
    const g93 = groupOf(c.open, '9.3')[0];
    ok(!c.resolved.length && !c.new.length && g93 && g93.severity === 'E' && g93.was === 'W' && g93.items.every(i => i.was === 'W'), '9.3 changed from warning to error: still open, was W', brief(c) + ' ' + JSON.stringify(g93));
    ok(c.checks.open === b.groups.length && !c.checks.resolved && !c.checks.new, 'per check: still open, not resolved and new');

    // run a not well-formed (stopped), run b the corrected file
    const broken = await run(xml.replace('</GrpHdr>', ''));
    ok(broken.stopped && broken.groups[0].rule === '0.7', 'set-up: a run stopped at 0.7');
    const cs = C.runs(broken, a);
    ok(ids(cs.resolved) === '0.7' && !cs.new.length && cs.counts.skipped === a.items.length && cs.skipped.every(gr => gr.run === 'b'), 'stopped, then corrected: 0.7 resolved, the findings of run b not compared (not new)', brief(cs));
    const cr = C.runs(a, broken);
    ok(ids(cr.new) === '0.7' && !cr.resolved.length && cr.counts.skipped === a.items.length && cr.skipped.every(gr => gr.run === 'a'), 'a run that stops after a full run: nothing counted as resolved', brief(cr));
    ok(C.keysOf(broken).meta.stopped === 'well-formed' && C.keysOf(broken).meta.skipped.length === 5, 'meta of a stopped run: stopped, 5 modules not run', JSON.stringify(C.keysOf(broken).meta.skipped));

    // the rule checks could not run in run b (as the pipeline reports it): XSD findings compared, rule findings not
    // (no summary of the file then, so the places are positions: matched by position)
    const withFoo = once(xml, '<ChrgBr>SLEV</ChrgBr>', '<ChrgBr>SLEV</ChrgBr><Foo>1</Foo>');
    const full = await run(withFoo);
    const failed = TP.report.build({
      findings: [...(await t.xsd(withFoo, '03')).findings,
        { source: 'rules', rule: '4.engine', stage: 4, severity: 'W', code: null, level: 'file', message: 'The rule checks (stages 3–10) could not run: test', xpath: null, line: null, col: null }],
      catalogue, failedModules: ['iso', 'guideline', 'types', 'consistency'], incomplete: true
    });
    const cf = C.runs(full, failed);
    ok(!cf.resolved.length && ids(cf.open) === '2.4' && ids(cf.new) === '4.engine' && ids(cf.skipped) === ids(full.groups.filter(gr => gr.source !== 'xsd')) && cf.skipped.every(gr => gr.run === 'a'),
      'rule checks failed in run b: XSD still open, rule findings not compared, "could not run" new', brief(cf));
  }

  head('M3 run comparison: a real file of 1,000 payments');
  {
    const base = gen.generate({ version: '03', transactions: 1000, blocks: 4, now }).replace(/<Ustrd>Invoice /g, '<Ustrd> Invoice ');
    const a = await run(base);
    // 3 payments added in the middle of block 2, the spaces fixed in block 3, a bad creditor name in block 4
    let v2 = insertTx(insertTx(insertTx(base, 2, 100, 'NEW-1'), 2, 100, 'NEW-2'), 2, 101, 'NEW-3');
    const b3 = blocksOf(v2)[2];
    v2 = v2.slice(0, b3.start) + v2.slice(b3.start, b3.end).replace(/<Ustrd> Invoice /g, '<Ustrd>Invoice ') + v2.slice(b3.end);
    v2 = editTx(v2, 4, 7, x => x.replace(/<Nm>([^<]*)<\/Nm>/, '<Nm>Ж$1</Nm>'));
    const b = await run(v2);
    unique('1,000 payments', a);
    unique('1,000 payments, new version', b);
    const c = C.runs(a, b);
    ok(c.counts.resolved === 250 && ids(c.resolved) === '5.4-spaces', '250 places resolved (block 3)', brief(c));
    ok(c.counts.new === 4 && ids(c.new) === '5.1,5.4-spaces' && itemsOf(c.new, '5.4-spaces').map(i => i.e2e).sort().join() === 'NEW-1,NEW-2,NEW-3', 'new: the 3 inserted payments and the bad name', brief(c));
    ok(c.counts.open === a.items.length - 250 && itemsOf(c.open, '5.4-spaces').filter(i => i.before && i.before.where !== i.where).length === 151, 'still open: the rest, 151 of them at a new position (after the inserted payments)', brief(c));
    ok(c.checks.open === a.groups.length && c.checks.new === 1 && c.checks.resolved === 0, 'per check: 5.4-spaces still open (partly resolved), 5.1 new', JSON.stringify(c.checks));
  }

  head('M3 run comparison: speed');
  {
    // two reports of 10,000 payments with 30,000 findings each, made by the report builder
    const N = 10000, B = 4;
    const summaryOf = ins => {
      const blocks = [];
      let line = 20;
      for (let b = 1; b <= B; b++) {
        const txs = [];
        const ids = [];
        for (let i = 0; i < N / B; i++) ids.push(`E2E-${b}-${String(i).padStart(5, '0')}`);
        if (b === 2) ids.splice(1200, 0, ...ins);
        ids.forEach((e2e, i) => { txs.push({ n: i + 1, line: line += 12, e2e, creditor: 'Creditor ' + i, amount: '10.00', ccy: 'EUR' }); });
        blocks.push({ n: b, id: `PMT-${b}`, line: 0, txs });
      }
      return { grp: { msgId: 'MSG-1' }, blocks };
    };
    const findingsOf = (summary, skip) => {
      const out = [];
      for (const b of summary.blocks) for (const t of b.txs) {
        if (skip(b, t)) continue;
        const p = `/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[${b.n}]/CdtTrfTxInf[${t.n}]`;
        out.push({ source: 'rules', rule: '5.4', part: 'spaces', stage: 5, severity: 'E', code: 'CH21', level: 'tx', message: 'The text starts with a space.', xpath: p + '/Cdtr[1]/Nm[1]', line: t.line + 4, col: 9, actual: ' x' });
        out.push({ source: 'rules', rule: '5.4', part: 'spaces', stage: 5, severity: 'E', code: 'CH21', level: 'tx', message: 'The text starts with a space.', xpath: p + '/RmtInf[1]/Ustrd[1]', line: t.line + 8, col: 9, actual: ' y' });
        out.push({ source: 'rules', rule: '10.3', stage: 10, severity: 'W', code: null, level: 'tx', message: 'A hint.', xpath: p, line: t.line, col: 7, actual: null });
      }
      return out;
    };
    const sa = summaryOf([]), sb = summaryOf(Array.from({ length: 100 }, (_, i) => `NEW-${i}`));
    const ra = TP.report.build({ findings: findingsOf(sa, () => false), summary: sa, catalogue });
    // run b: 100 payments inserted in block 2 (the paths of 1,300 payments shift); block 4 payments 1–1,000 fixed
    const rb = TP.report.build({ findings: findingsOf(sb, (b, t) => b.n === 4 && t.n <= 1000), summary: sb, catalogue });
    const t0 = process.hrtime.bigint();
    const ka = C.keysOf(ra), kb = C.keysOf(rb);
    const t1 = process.hrtime.bigint();
    const c = C.runs(ka, kb);
    const t2 = process.hrtime.bigint();
    const ms = x => Number(x) / 1e6;
    ok(ra.items.length === 30000 && rb.items.length === 27300 && ka.size === 30000 && kb.size === 27300, 'set-up: 30,000 and 27,300 findings, one key each', `${ra.items.length} ${rb.items.length} ${ka.size} ${kb.size}`);
    ok(c.counts.resolved === 3000 && c.counts.new === 300 && c.counts.open === 27000 && !c.meta.byPosition, 'exact: 3,000 resolved, 300 new, 27,000 still open', brief(c));
    ok(ms(t2 - t0) < 1000, `10,000 payments, 30,000 findings per run: keys in ${ms(t1 - t0).toFixed(0)} ms, comparison in ${ms(t2 - t1).toFixed(0)} ms (Node, budget 1 s)`);
    // the screen with thousands of places
    const mkRun = (r, n, parent) => ({ n, fileName: 'big.xml', label: null, at: '2026-11-18T10:00:00Z', country: 'AT', version: '03', status: r.status, counts: r.counts, incomplete: false, source: parent ? 'fix' : 'upload', parent: parent || null, changes: [], result: r });
    require(path.join(t.ROOT, 'js/ui/common.js'));
    require(path.join(t.ROOT, 'js/ui/compare.js'));
    // the screen opened with the first check of each list open: keys, comparison and drawing
    const st = { session: { runs: [mkRun(ra, 1), mkRun(rb, 2, 1)], current: 2 } };
    st.compare = { current: 2, a: 1, b: 2, open: new Set(['resolved', 'open', 'new'].map(k => `${k}||${c[k][0].ck}`)), all: new Set() };
    const t3 = process.hrtime.bigint();
    const html = TP.ui.screens.compare.view(st);
    const t4 = process.hrtime.bigint();
    ok((html.match(/<tr>/g) || []).length === 3 * 51 && (html.match(/Show all [\d,]+ places/g) || []).join() === 'Show all 2,000 places,Show all 18,000 places,Show all 200 places', 'open checks show 50 places each and "Show all"', (html.match(/Show all [\d,]+ places/g) || []).join(' '));
    ok(ms(t4 - t3) < 1000, `comparison screen opened in ${ms(t4 - t3).toFixed(0)} ms (keys, comparison and 3 open checks of thousands of places)`);
    st.compare.all.add(`open||${c.open[0].ck}`);
    const t5 = process.hrtime.bigint();
    const all = TP.ui.screens.compare.view(st);
    ok((all.match(/<tr>/g) || []).length > 18000, `"Show all" draws all ${c.open[0].count.toLocaleString('en-US')} places of a check (${ms(process.hrtime.bigint() - t5).toFixed(0)} ms)`);
  }

  head('M3 run comparison: screen and runs strip');
  {
    const ui = TP.ui.compare, sc = TP.ui.screens.compare;
    const mk = (r, n, o = {}) => ({ n, fileName: 'pay.xml', label: null, at: '2026-11-18T10:0' + n + ':00Z', country: 'AT', version: '03', status: r.status, counts: r.counts, incomplete: !!r.incomplete, source: 'upload', parent: null, changes: [], result: r, ...o });
    const r1 = await run(file({ defects: ['ctrlsum', 'bad-iban', 'no-creditor-name', 'past-date'] }));
    const r2 = await run(file({ defects: ['no-creditor-name', 'past-date'] }));
    const r3 = await run(file({ defects: ['no-creditor-name'] }));
    const other = await run(file({ defects: ['dup-e2e'], transactions: 4 }));
    const changes = [{ rule: '4.4', title: 'x', field: 'Control sum', kind: 'calculated', rows: [{ where: 'File' }] }, { rule: '5.6', rows: [{}, {}] }];
    const runs = [mk(r1, 1), mk(r2, 2, { source: 'fix', parent: 1, changes }), mk(r3, 3, { source: 'fix', parent: 2, changes: [{ rule: '4.10', rows: [{}] }] })];
    const st = { session: { runs: runs.slice(0, 1), current: 1 } };
    ok(sc.hash === '#compare' && sc.nav === 'start' && sc.title(st) === 'Compare runs' && typeof sc.view === 'function' && typeof sc.mount === 'function', 'the screen registers itself as #compare');
    ok(!sc.needs(st) && !sc.needs({}) && ui.runsStrip(st) === '' && ui.runsStrip({}) === '', 'one run: no comparison screen, no runs strip');
    st.session.runs = runs; st.session.current = 3;
    ok(sc.needs(st), 'two runs or more: the screen can be shown');

    const strip = ui.runsStrip(st);
    ok((strip.match(/class="runstep/g) || []).length === 3 && strip.includes(`Run 1</small><span class="st bad">RJCT</span><b>${r1.groups.length} findings</b>`) && (strip.match(/runarrow/g) || []).length === 2, 'strip: run 1 → run 2 → run 3 with status pill and findings', strip);
    ok(/1 finding resolved since run 2/.test(strip) && /class="res ok"/.test(strip), 'strip: "1 finding resolved since run 2"', strip);
    ok(/data-act="cmp-open" data-a="2" data-b="3"/.test(strip) && /See the comparison/.test(strip), 'strip: link to the comparison of run 2 and run 3');
    ok(/Show what was resolved/.test(strip) && /Rule 4\.10/.test(strip), 'strip: what was resolved, with the rule');
    const long = { session: { runs: Array.from({ length: 8 }, (_, i) => mk(r3, i + 1, { parent: i ? i : null })), current: 8 } };
    const ls = ui.runsStrip(long);
    ok((ls.match(/class="runstep/g) || []).length === 5 && /rungap/.test(ls) && /Run 1</.test(ls) && /Run 8</.test(ls) && !/Run 3</.test(ls), 'strip with 8 runs: run 1, …, the last 4', ls);
    ok(/No findings resolved since run 7/.test(ls), 'strip: nothing resolved');
    const st2 = { session: { runs: [...runs, mk(other, 4)], current: 4 } };
    const s2 = ui.runsStrip(st2);
    ok(/3 other runs in this session/.test(s2) && /data-act="cmp-open" data-b="4"/.test(s2) && !/runarrow/.test(s2), 'strip of a file with one run when the session has others: link to compare', s2);
    const stS = { session: { runs: [mk(r1, 1), mk(await run(file().replace('</GrpHdr>', '')), 2, { parent: 1 })], current: 2 } };
    ok(/stopped at the first module/.test(ui.runsStrip(stS)) && !/resolved since/.test(ui.runsStrip(stS)), 'strip: a run that stopped does not claim resolved findings', ui.runsStrip(stS));
    const failedRun = TP.report.build({ findings: (await t.xsd(file(), '03')).findings, catalogue, failedModules: ['iso', 'guideline', 'types', 'consistency'], incomplete: true });
    const stF = { session: { runs: [mk(r1, 1), mk(failedRun, 2, { parent: 1 })], current: 2 } };
    ok(/Some checks could not run in run 2/.test(ui.runsStrip(stF)) && !/resolved since/.test(ui.runsStrip(stF)), 'strip: a run whose rule checks failed does not claim resolved findings', ui.runsStrip(stF));

    // the screen: default runs, counts, lists, notes
    const html = sc.view(st);
    ok(st.compare.a === 2 && st.compare.b === 3, 'default: the current run and its parent', JSON.stringify({ a: st.compare.a, b: st.compare.b }));
    ok(/<h1 tabindex="-1">Compare runs<\/h1>/.test(html) && /id="cmp-a"/.test(html) && /<option value="2" selected>/.test(html) && /id="cmp-b"/.test(html), 'screen: heading and the two run pickers');
    ok(/Corrected copy of run 2 \(1 value changed\)/.test(html) && /Corrected copy of run 1 \(3 values changed\)/.test(html), 'screen: run cards say where the run came from');
    const tile = (h, k) => (new RegExp(`data-k="${k}"[^>]*><span>[^<]+</span><b>([\\d,]+)</b>`).exec(h) || [])[1];
    ok(tile(html, 'resolved') === '1' && tile(html, 'open') === String(r3.items.length) && tile(html, 'new') === '0', 'screen: counts resolved, still open, new', [tile(html, 'resolved'), tile(html, 'open'), tile(html, 'new')].join(' '));
    ok(/id="cmp-resolved"/.test(html) && /id="cmp-open"/.test(html) && /id="cmp-new"/.test(html) && /No new findings\./.test(html) && !/id="cmp-skipped"/.test(html), 'screen: the three lists, "No new findings."');
    ok(/Rule 4\.10/.test(html) && /data-act="cmp-toggle"/.test(html), 'screen: groups by check with their rule');
    // run 1 against run 3, a run of another file, a stopped run
    st.compare.a = 1;
    const h13 = sc.view(st);
    ok(tile(h13, 'resolved') === '3' && /Rule 4\.4/.test(h13) && /Rule 5\.6-cdtr/.test(h13) && /Rule 4\.10/.test(h13), 'picking run 1: three checks resolved', tile(h13, 'resolved'));
    const o = { session: { runs: [...runs, mk(other, 4)], current: 4 } };
    const ho = sc.view(o);
    ok(o.compare.a === 3 && /not recorded as a version/.test(ho), 'a run without parent is compared with the run before it, with a note', ho.match(/cmp-notes[\s\S]*?<\/div>/));
    const hs = sc.view(stS);
    ok(/Not compared/.test(hs) && /stopped at the first module/.test(hs), 'screen: findings of checks that did not run are listed apart');
    // places: the first 50, then "Show all"
    const bigA = await run(gen.generate({ version: '03', transactions: 120, blocks: 1, now }).replace(/<Ustrd>Invoice /g, '<Ustrd> Invoice '));
    const bigB = await run(gen.generate({ version: '03', transactions: 120, blocks: 1, now }));
    const sb = { session: { runs: [mk(bigA, 1), mk(bigB, 2, { parent: 1, source: 'fix' })], current: 2 } };
    sc.view(sb);
    const cmp = ui.compareRuns(sb.session.runs[0], sb.session.runs[1]);
    sb.compare.open.add(`resolved||${cmp.resolved[0].ck}`);
    const hb = sc.view(sb);
    ok((hb.match(/<tr><td>Block 1, transaction/g) || []).length === 50 && /Show all 120 places/.test(hb), 'an open check shows 50 of 120 places and "Show all 120 places"');
    sb.compare.all.add(`resolved||${cmp.resolved[0].ck}`);
    ok((sc.view(sb).match(/<tr><td>Block 1, transaction/g) || []).length === 120, '"Show all" shows all 120');
    ok(!/<script|onerror|onclick/i.test(hb), 'no inline scripts or handlers');
    const tricky = await run(file().replace('<EndToEndId>E2E-000003</EndToEndId>', '<EndToEndId>&lt;b&gt;"x"</EndToEndId>').replace('<EndToEndId>E2E-000005</EndToEndId>', '<EndToEndId>&lt;b&gt;"x"</EndToEndId>'));
    const se = { session: { runs: [mk(r1, 1), mk(tricky, 2, { parent: 1 })], current: 2 } };
    sc.view(se);
    const ce = ui.compareRuns(se.session.runs[0], se.session.runs[1]);
    const g = ce.new.find(x => x.rule === '9.3');
    if (g) se.compare.open.add(`new||${g.ck}`);
    const he = sc.view(se);
    ok(g && he.includes('&lt;b&gt;&quot;x&quot;') && !he.includes('<b>"x"'), 'values from the file are escaped', g ? '' : brief(ce));
  }
};

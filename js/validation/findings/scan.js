/*
 * Testing Portal – one streaming pass over the payment file.
 * Runs inside the rules worker and in the Node tests. Needs TPSaxes.
 *
 * It does two things at once:
 *  1. finds the line, column and (for leaf elements) the value of every
 *     element path asked for, e.g. "/Document[1]/CstmrCdtTrfInitn[1]/PmtInf[2]/CdtTrfTxInf[7]",
 *     or element number in document order ("#57"), whose path it also returns;
 *  2. collects the summary of the file: group header, payment blocks and
 *     transactions, used by the report (facts, block and transaction tables).
 */
(function (g) {
  'use strict';
  const MAX_VALUE = 300;

  // "/a[1]/b[2]/@x" -> "/a[1]/b[2]"; "#57/@Ccy" -> "#57" (element number in document order, see tools/build.js)
  function elementPath(path) {
    return String(path).replace(/\/(@[^/]*|text\(\)(\[\d+\])?|comment\(\)(\[\d+\])?)$/, '');
  }
  const local = n => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);

  function scan(xml, paths) {
    const wanted = new Map();
    for (const p of paths || []) wanted.set(elementPath(p), null);
    const Saxes = (g.TPSaxes && g.TPSaxes.SaxesParser) || g.TPSaxes;
    const parser = new Saxes({ xmlns: false, position: true });

    const summary = { grp: {}, blocks: [] };
    let block = null, tx = null;
    const stack = [{ name: '', path: '', counts: Object.create(null), text: '', hasChild: false, want: false }];
    let startLine = 1, startCol = 1, ord = 0;

    parser.on('opentagstart', () => { startLine = parser.line; startCol = Math.max(1, parser.column - 1); });
    parser.on('opentag', node => {
      const top = stack[stack.length - 1];
      top.hasChild = true;
      const name = local(node.name);
      const n = (top.counts[name] = (top.counts[name] || 0) + 1);
      const path = `${top.path}/${name}[${n}]`;
      ord++;
      const keys = [];
      if (wanted.has(path)) keys.push(path);
      if (wanted.has('#' + ord)) keys.push('#' + ord);
      for (const k of keys) wanted.set(k, { line: startLine, col: startCol, value: null, path });
      const want = keys.length ? keys : null;
      const depth = stack.length; // depth of the new element (Document = 1)
      if (name === 'PmtInf' && depth === 3) {
        block = { n: summary.blocks.length + 1, line: startLine, txs: [] };
        summary.blocks.push(block);
      } else if (name === 'CdtTrfTxInf' && block && depth === 4) {
        tx = { n: block.txs.length + 1, line: startLine };
        block.txs.push(tx);
      } else if ((name === 'InstdAmt' || (name === 'Amt' && top.name === 'EqvtAmt')) && tx) {
        const a = node.attributes && (node.attributes.Ccy || node.attributes['Ccy']);
        tx.ccy = a && typeof a === 'object' ? a.value : a;
      }
      const el = { name, path, counts: Object.create(null), text: '', hasChild: false, want };
      if (node.isSelfClosing) close(el, stack); else stack.push(el);
    });
    parser.on('text', t => { stack[stack.length - 1].text += t; });
    parser.on('cdata', t => { stack[stack.length - 1].text += t; });
    parser.on('closetag', node => { if (!node.isSelfClosing) close(stack.pop(), stack); });

    function close(el, stack) {
      const value = el.hasChild ? null : el.text.trim();
      if (el.want && value != null) for (const k of el.want) wanted.get(k).value = value.length > MAX_VALUE ? value.slice(0, MAX_VALUE) + '…' : value;
      if (value == null) { if (el.name === 'CdtTrfTxInf') tx = null; if (el.name === 'PmtInf') block = null; return; }
      // path below the current transaction, block or group header
      const names = stack.map(s => s.name).concat(el.name);
      const at = k => names.lastIndexOf(k);
      if (tx && at('CdtTrfTxInf') > 0) {
        const rel = names.slice(at('CdtTrfTxInf') + 1).join('/');
        if (rel === 'PmtId/EndToEndId') tx.e2e = value;
        else if (rel === 'PmtId/InstrId') tx.instrId = value;
        else if (rel === 'Amt/InstdAmt' || rel === 'Amt/EqvtAmt/Amt') tx.amount = value;
        else if (rel === 'Cdtr/Nm') tx.creditor = value;
        else if (rel === 'CdtrAcct/Id/IBAN') tx.account = value;
        else if (rel === 'CdtrAcct/Id/Othr/Id' && !tx.account) tx.account = value;
        else if (rel === 'PmtTpInf/SvcLvl/Cd') { tx.svcLvl = tx.svcLvl || value; (tx.svcCodes = tx.svcCodes || []).push(value); }
        else if (rel === 'PmtTpInf/LclInstrm/Cd') tx.lclCd = value;
        else if (rel === 'PmtTpInf/CtgyPurp/Cd') tx.ctgyPurp = value;
        else if (rel === 'PmtTpInf/InstrPrty') tx.prty = value;
        else if (rel === 'Amt/EqvtAmt/CcyOfTrf') tx.ccyOfTrf = value;
        else if (rel === 'CdtrAgt/FinInstnId/BIC' || rel === 'CdtrAgt/FinInstnId/BICFI') tx.creditorBic = value;
        else if (rel === 'Cdtr/PstlAdr/Ctry') tx.creditorCountry = value;
        else if (rel === 'ChrgBr') tx.chrgBr = value;
        if (rel === 'CdtrAcct/Id/IBAN') tx.iban = value; // tx.account may also be an Othr/Id
      } else if (block && at('PmtInf') > 0) {
        const rel = names.slice(at('PmtInf') + 1).join('/');
        if (rel === 'PmtInfId') block.id = value;
        else if (rel === 'NbOfTxs') block.nbOfTxs = value;
        else if (rel === 'CtrlSum') block.ctrlSum = value;
        else if (rel === 'PmtMtd') block.method = value;
        else if (rel === 'PmtTpInf/SvcLvl/Cd') { block.svcLvl = block.svcLvl || value; (block.svcCodes = block.svcCodes || []).push(value); }
        else if (rel === 'PmtTpInf/LclInstrm/Cd' || rel === 'PmtTpInf/LclInstrm/Prtry') { block.lclInstrm = value; if (rel.endsWith('Cd')) block.lclCd = value; }
        else if (rel === 'PmtTpInf/InstrPrty') block.prty = value;
        else if (rel === 'DbtrAgt/FinInstnId/BIC' || rel === 'DbtrAgt/FinInstnId/BICFI') block.debtorBic = value;
        else if (rel === 'PmtTpInf/CtgyPurp/Cd') block.ctgyPurp = value;
        else if (rel === 'ReqdExctnDt' || rel === 'ReqdExctnDt/Dt' || rel === 'ReqdExctnDt/DtTm') block.date = value;
        else if (rel === 'Dbtr/Nm') block.debtor = value;
        else if (rel === 'DbtrAcct/Id/IBAN') block.debtorAccount = value;
        else if (rel === 'DbtrAcct/Ccy') block.debtorCcy = value;
        else if (rel === 'ChrgBr') block.chrgBr = value;
      } else if (at('GrpHdr') > 0) {
        const rel = names.slice(at('GrpHdr') + 1).join('/');
        if (rel === 'MsgId') summary.grp.msgId = value;
        else if (rel === 'CreDtTm') summary.grp.creDtTm = value;
        else if (rel === 'NbOfTxs') summary.grp.nbOfTxs = value;
        else if (rel === 'CtrlSum') summary.grp.ctrlSum = value;
        else if (rel === 'InitgPty/Nm') summary.grp.initgPty = value;
      }
    }

    parser.write(xml).close();
    const positions = new Map();
    for (const p of paths || []) positions.set(p, wanted.get(elementPath(p)) || null);
    return { positions, summary };
  }

  const TP = g.TP = g.TP || {};
  TP.findings = TP.findings || {};
  TP.findings.scan = scan;
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = { scan };
})(typeof self !== 'undefined' ? self : globalThis);

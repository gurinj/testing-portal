/*
 * Testing Portal – generator for made-up pain.001 test files.
 * Used by the technical check page (speed test) and by the Node tests.
 * All names, accounts and identifiers are fictional. IBANs have valid
 * check digits unless a defect asks for a wrong one.
 */
(function (root) {
  'use strict';

  const NS = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.';
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function mod97(digits) {
    let r = 0;
    for (const ch of digits) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
    return r;
  }
  function toDigits(s) {
    return s.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  }
  function iban(country, bban) {
    const check = 98 - mod97(toDigits(bban + country + '00'));
    return country + pad(check) + bban;
  }
  /* TARGET closing days: 1 Jan, Good Friday, Easter Monday, 1 May, 25 and 26 Dec */
  function targetClosed(x) {
    const y = x.getFullYear(), m = x.getMonth() + 1, d = x.getDate();
    if ((m === 1 && d === 1) || (m === 5 && d === 1) || (m === 12 && (d === 25 || d === 26))) return true;
    const easter = easterSunday(y);
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, easter[0] - 1, easter[1])) / 86400000);
    return diff === -2 || diff === 1;
  }
  function easterSunday(y) { // anonymous Gregorian algorithm: [month, day]
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
  }
  /* the next weekday that is not a TARGET closing day, so clean EUR files never get 10.1 */
  function nextBusinessDay(d) {
    const x = new Date(d);
    do { x.setDate(x.getDate() + 1); } while (x.getDay() === 0 || x.getDay() === 6 || targetClosed(x));
    return x;
  }

  /* simple deterministic pseudo-random numbers, so files are repeatable */
  function rng(seed) {
    let x = seed >>> 0 || 1;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  }

  const CREDITORS = ['Lindenhof Metall GmbH', 'Rheintal Verpackung GmbH', 'Nordmark Logistik GmbH',
    'Seeblick Elektro GmbH', 'Waldau Druck KG', 'Moosbach Energie GmbH', 'Steinfeld Bau GmbH'];
  /* debtor side per selected country: BBAN builder (fits the IBAN registry), local currency, town */
  const COUNTRIES = {
    AT: { ccy: 'EUR', town: 'Wien', bban: n => '99999' + pad(n, 11) },
    CZ: { ccy: 'CZK', town: 'Praha', bban: n => '9999' + pad(n, 16) },
    HU: { ccy: 'HUF', town: 'Budapest', bban: n => '99999999' + pad(n, 16) },
    RO: { ccy: 'RON', town: 'Bucuresti', bban: n => 'DEMO' + pad(n, 16) },
    SK: { ccy: 'EUR', town: 'Bratislava', bban: n => '9999' + pad(n, 16) },
    HR: { ccy: 'EUR', town: 'Zagreb', bban: n => '9999999' + pad(n, 10) },
    RS: { ccy: 'RSD', town: 'Beograd', bban: n => '999' + pad(n, 15) },
    AL: { ccy: 'ALL', town: 'Tirane', bban: n => '99999999' + pad(n, 16) },
    BA: { ccy: 'BAM', town: 'Sarajevo', bban: n => '999999' + pad(n, 10) },
    UA: { ccy: 'UAH', town: 'Kyiv', bban: n => '999999' + pad(n, 19) },
    XK: { ccy: 'EUR', town: 'Prishtine', bban: n => '9999' + pad(n, 12) }
  };
  const TYPES = ['SEPA', 'SEPA_INST', 'DOMESTIC', 'DOMESTIC_URGENT', 'BUDGET', 'INTRA_BANK', 'CROSS_BORDER'];

  /* LEI (ISO 17442): 18 characters and two check digits, mod 97 = 1 */
  function lei(base18) {
    const check = 98 - mod97(toDigits(base18 + '00'));
    return base18 + pad(check);
  }
  /* a UUID v4 from the repeatable random numbers */
  function uuid(rand) {
    const hex = n => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
  }

  const BANKS = [
    { c: 'DE', bic: 'DEMODEFF', bban: n => '99999999' + pad(n, 10), town: 'Duesseldorf', pc: '40210', street: 'Industriestrasse' },
    { c: 'AT', bic: 'DEMOATWW', bban: n => '99999' + pad(n, 11), town: 'Graz', pc: '8010', street: 'Bahnhofgasse' },
    { c: 'NL', bic: 'DEMONL2A', bban: n => 'DEMO' + pad(n, 10), town: 'Utrecht', pc: '3526', street: 'Kanaalweg' }
  ];

  /**
   * generate({ version: '03' | '09', transactions: 1000, blocks: 1, defects: [...], seed,
   *            country: 'AT', type: 'SEPA', uetr: false, lei: false })
   * defects: names of deliberate problems, see DEFECTS below.
   * country: the selected country (debtor account, debtor agent, debtor address).
   * type: the payment type of every transaction (docs/specs/M2.md section 2):
   *   SEPA, SEPA_INST    EUR to creditors in DE, AT and NL, SLEV
   *   DOMESTIC           local currency to creditors in the country, another bank
   *                      (with EUR in a SEPA country this is a SEPA payment)
   *   DOMESTIC_URGENT    the same with service level URGP
   *   BUDGET             category purpose TAXS (RO: a treasury IBAN with TREZ)
   *   INTRA_BANK         local currency to an account at the debtor's bank
   *   CROSS_BORDER       USD to creditors in the US, account Othr/Id, SHAR
   * uetr, lei (.09 only): a UETR per transaction, an LEI for the debtor.
   * now: the time the file is made (default: the clock), for tests with a fixed time of the check.
   * The default (AT, SEPA, no UETR or LEI) is the file of M1, unchanged.
   * Returns the XML text.
   */
  function generate(opts = {}) {
    const v = opts.version === '09' ? '09' : '03';
    const nTx = Math.max(1, opts.transactions || 10);
    const nBlocks = Math.max(1, Math.min(opts.blocks || 1, nTx));
    const defects = new Set(opts.defects || []);
    const rand = rng(opts.seed || 42);
    const bic = v === '09' ? 'BICFI' : 'BIC';
    const now = opts.now ? new Date(opts.now) : new Date(); // opts.now: a fixed time, for tests that fix the time of the check
    const created = new Date(now.getTime() - 3600 * 1000);
    const exec = nextBusinessDay(now);
    const cc = COUNTRIES[opts.country] ? opts.country : 'AT';
    const home = COUNTRIES[cc];
    const type = TYPES.includes(opts.type) ? opts.type : 'SEPA';
    const sepa = type === 'SEPA' || type === 'SEPA_INST';
    const debtorBic = cc === 'AT' ? 'DEMOATWW' : `DEMO${cc}WW`;
    const txCcy = sepa ? 'EUR' : type === 'CROSS_BORDER' ? 'USD' : home.ccy;
    const withUetr = v === '09' && !!opts.uetr, withLei = v === '09' && !!opts.lei;
    // the creditor of transaction i
    const creditorOf = i => {
      if (sepa) { const k = BANKS[i % BANKS.length]; return { ...k, acct: `<IBAN>${iban(k.c, k.bban(1000 + i))}</IBAN>`, ibanText: iban(k.c, k.bban(1000 + i)) }; }
      if (type === 'CROSS_BORDER') return { c: 'US', bic: 'DEMOUS33', town: 'New York', pc: '10001', street: 'Fifth Avenue', acct: `<Othr><Id>${pad(700000 + i, 9)}</Id></Othr>` };
      const bban = type === 'BUDGET' && cc === 'RO' ? 'TREZ' + pad(5000 + i, 16) : home.bban(5000 + i);
      const ib = iban(cc, bban);
      return { c: cc, bic: type === 'INTRA_BANK' ? debtorBic : `OTHR${cc}22`, town: home.town, pc: pad(1000 + (i % 80) * 10, 4), street: 'Hauptstrasse', acct: `<IBAN>${ib}</IBAN>`, ibanText: ib };
    };
    const pmtTpInf = sepa ? `<SvcLvl><Cd>SEPA</Cd></SvcLvl>${type === 'SEPA_INST' ? '<LclInstrm><Cd>INST</Cd></LclInstrm>' : ''}`
      : type === 'DOMESTIC_URGENT' ? '<SvcLvl><Cd>URGP</Cd></SvcLvl>' : type === 'BUDGET' ? '<CtgyPurp><Cd>TAXS</Cd></CtgyPurp>' : '';
    const out = [];
    const w = s => out.push(s);

    const amounts = [];
    for (let i = 0; i < nTx; i++) amounts.push(100 + Math.floor(rand() * 4999900)); // cents
    const perBlock = [];
    for (let b = 0; b < nBlocks; b++) perBlock.push([]);
    for (let i = 0; i < nTx; i++) perBlock[i % nBlocks].push(i);

    const sumCents = list => list.reduce((a, i) => a + amounts[i], 0);
    const money = c => (c / 100).toFixed(2);
    let total = sumCents(amounts.map((_, i) => i));
    if (defects.has('ctrlsum')) total += 10000;

    w('<?xml version="1.0" encoding="UTF-8"?>');
    w(`<Document xmlns="${NS}${v}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`);
    w('  <CstmrCdtTrfInitn>');
    w('    <GrpHdr>');
    w(`      <MsgId>${defects.has('msgid-chars') ? 'MSG€' : 'MSG-'}${isoDate(now).replace(/-/g, '')}-0001</MsgId>`);
    w(`      <CreDtTm>${isoDate(created)}T${pad(created.getHours())}:${pad(created.getMinutes())}:00</CreDtTm>`);
    w(`      <NbOfTxs>${defects.has('nboftxs') ? nTx + 1 : nTx}</NbOfTxs>`);
    w(`      <CtrlSum>${money(total)}</CtrlSum>`);
    w('      <InitgPty><Nm>Beispiel Handels GmbH</Nm></InitgPty>');
    w('    </GrpHdr>');

    for (let b = 0; b < nBlocks; b++) {
      const list = perBlock[b];
      const id = defects.has('dup-pmtinf') && b === 1 ? 'PMT-01' : `PMT-${pad(b + 1)}`;
      w('    <PmtInf>');
      w(`      <PmtInfId>${id}</PmtInfId>`);
      w('      <PmtMtd>TRF</PmtMtd>');
      w('      <BtchBookg>false</BtchBookg>');
      w(`      <NbOfTxs>${list.length}</NbOfTxs>`);
      w(`      <CtrlSum>${money(sumCents(list))}</CtrlSum>`);
      if (pmtTpInf) w(`      <PmtTpInf>${pmtTpInf}</PmtTpInf>`);
      const d = defects.has('past-date') && b === 0 ? isoDate(new Date(now.getTime() - 5 * 86400000)) : type === 'SEPA_INST' ? isoDate(now) : isoDate(exec);
      w(v === '09' ? `      <ReqdExctnDt><Dt>${d}</Dt></ReqdExctnDt>` : `      <ReqdExctnDt>${d}</ReqdExctnDt>`);
      const dbtrId = withLei ? `<Id><OrgId><LEI>${lei('5299009DEMO' + pad(b + 1, 7))}</LEI></OrgId></Id>` : '';
      w(`      <Dbtr><Nm>Beispiel Handels GmbH</Nm><PstlAdr><TwnNm>${home.town}</TwnNm><Ctry>${cc}</Ctry></PstlAdr>${dbtrId}</Dbtr>`);
      w(`      <DbtrAcct><Id><IBAN>${iban(cc, home.bban(12340000 + b))}</IBAN></Id></DbtrAcct>`);
      w(`      <DbtrAgt><FinInstnId><${bic}>${debtorBic}</${bic}></FinInstnId></DbtrAgt>`);
      w(`      <ChrgBr>${type === 'CROSS_BORDER' ? 'SHAR' : 'SLEV'}</ChrgBr>`);
      for (const i of list) {
        const k = creditorOf(i);
        let e2e = `E2E-${pad(i + 1, 6)}`;
        if (defects.has('dup-e2e') && i === 2) e2e = 'E2E-000001';
        let acct = k.acct;
        if (defects.has('bad-iban') && i === 3 && k.ibanText) acct = `<IBAN>${k.ibanText.slice(0, 2) + pad((+k.ibanText.slice(2, 4) + 1) % 100) + k.ibanText.slice(4)}</IBAN>`;
        const ccy = defects.has('sepa-ccy') && i === 4 ? 'USD' : txCcy;
        w('      <CdtTrfTxInf>');
        w(`        <PmtId><InstrId>INS-${pad(i + 1, 6)}</InstrId><EndToEndId>${e2e}</EndToEndId>${withUetr ? `<UETR>${uuid(rand)}</UETR>` : ''}</PmtId>`);
        w(`        <Amt><InstdAmt Ccy="${ccy}">${money(amounts[i])}</InstdAmt></Amt>`);
        w(`        <CdtrAgt><FinInstnId><${bic}>${k.bic}</${bic}></FinInstnId></CdtrAgt>`);
        const name = defects.has('no-creditor-name') && i === 5 ? '' : `<Nm>${esc(CREDITORS[i % CREDITORS.length])}</Nm>`;
        w(`        <Cdtr>${name}<PstlAdr><StrtNm>${k.street}</StrtNm><BldgNb>${1 + (i % 90)}</BldgNb><PstCd>${k.pc}</PstCd><TwnNm>${k.town}</TwnNm><Ctry>${k.c}</Ctry></PstlAdr></Cdtr>`);
        w(`        <CdtrAcct><Id>${acct}</Id></CdtrAcct>`);
        const rmt = defects.has('two-ustrd') && i === 6 ? '<Ustrd>Invoice 1</Ustrd><Ustrd>Invoice 2</Ustrd>' : `<Ustrd>Invoice ${4000 + i}</Ustrd>`;
        w(`        <RmtInf>${rmt}</RmtInf>`);
        w('      </CdtTrfTxInf>');
      }
      w('    </PmtInf>');
    }
    w('  </CstmrCdtTrfInitn>');
    w('</Document>');
    return out.join('\n') + '\n';
  }

  const DEFECTS = ['ctrlsum', 'nboftxs', 'msgid-chars', 'dup-pmtinf', 'past-date', 'dup-e2e',
    'bad-iban', 'sepa-ccy', 'no-creditor-name', 'two-ustrd'];

  const api = { generate, iban, lei, DEFECTS, TYPES, COUNTRIES: Object.keys(COUNTRIES) };
  if (typeof process === 'object' && process.versions && process.versions.node && typeof module === 'object' && module.exports) module.exports = api;
  else { root.TP = root.TP || {}; root.TP.testFiles = api; }
})(typeof self !== 'undefined' ? self : this);

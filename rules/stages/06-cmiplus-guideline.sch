<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 6: CMIplus usage guideline.
  Source of truth: validation catalogue, stage 6; docs/specs/M2.md, section 4.
  The CMIplus guideline is not available yet, so every check reads its
  content from config/settings.json (guideline.*, limits.*) and the country
  files (currencies). With the default settings most checks find nothing;
  null or an empty list switches a check off. 6.7 is covered by 4.10 and 4.11,
  whose limits are settings.

  Paths in guideline.mandatory, .forbidden and .ignored are element names
  separated by "/", below the group header ("file"), the payment block
  ("block") or the transaction ("transaction"). Keys of guideline.maxOccurs
  and guideline.maxLength match the end of an element's path ("Nm" every
  name, "Cdtr/Nm" the creditor's); the most specific key wins.

  Written for pain.001.001.03; the build compiles a .09 variant (BIC / BICFI
  for the debtor agent, InstdAmt / EqvtAmt for the currency, as in .03).

  Performance (docs/RULES.md): plain contexts on GrpHdr and PmtInf; the
  transaction rule has a fast test of the transaction itself (js:tpTxFlag:
  a rule that fires on each of 10,000 transactions costs about 0.5 s);
  6.3 is one walk in JavaScript per level element
  (js:tpOccursBelow; preceding-sibling in a context is quadratic on 10,000
  sibling transactions); 6.4 has a fast test of the element's own value in
  its context (js:tpLengthFlag; a global variable in a context is slower
  than a JavaScript call), and the code checks of 6.9
  one of the code itself (js:tpSubset): those rules fire only where a limit
  may be broken. A maxOccurs limit of 0 is not checked: an element that must
  not occur goes into guideline.forbidden. The lists of 6.1/6.2 and 6.12 are
  switched off by global variables when the settings are empty.
-->
<?testing-portal stage="6" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 6: CMIplus usage guideline</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ (stage6.js, guideline.js, settings.js, payment-type.js) -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <!-- settings (an empty sequence: null, the check is off) -->
  <sch:let name="max-blocks" value="js:tpSetting('limits.maxBlocksPerFile')"/>
  <sch:let name="max-txs" value="js:tpSetting('limits.maxTransactionsPerFile')"/>
  <sch:let name="max-block-txs" value="js:tpSetting('limits.maxTransactionsPerBlock')"/>
  <sch:let name="batch-allowed" value="js:tpSetting('guideline.batchBooking.allowed')"/>
  <sch:let name="batch-one-ccy" value="js:tpSetting('guideline.batchBooking.singleCurrencyPerBlock') = true()"/>
  <sch:let name="one-account" value="js:tpSetting('guideline.multipleDebtorAccounts') = false()"/>
  <sch:let name="one-agent" value="js:tpSetting('guideline.multipleDebtorAgents') = false()"/>
  <!-- switches: the lists and the ultimate parties cost nothing when they are empty or allowed everywhere -->
  <sch:let name="lists-file" value="exists((js:tpSetting('guideline.mandatory.file'), js:tpSetting('guideline.forbidden.file'), js:tpSetting('guideline.ignored.file')))"/>
  <sch:let name="lists-block" value="exists((js:tpSetting('guideline.mandatory.block'), js:tpSetting('guideline.forbidden.block'), js:tpSetting('guideline.ignored.block')))"/>
  <sch:let name="lists-tx" value="exists((js:tpSetting('guideline.mandatory.transaction'), js:tpSetting('guideline.forbidden.transaction'), js:tpSetting('guideline.ignored.transaction')))"/>
  <!-- guideline.ultimateParties: true (default), false or a list of payment types; null, true or [] = allowed for all -->
  <sch:let name="ultimate-everywhere" value="string-join(for $x in js:tpSetting('guideline.ultimateParties') return string($x), ' ') = ('true', '')"/>
  <sch:let name="occurs-on" value="exists(js:tpSetting('guideline.maxOccurs'))"/>
  <!-- elements above the level of an element, left out of the field names in messages -->
  <sch:let name="levels" value="('Document', 'CstmrCdtTrfInitn', 'GrpHdr', 'PmtInf', 'CdtTrfTxInf')"/>

  <!-- ===================================================== file, block, transaction -->
  <sch:pattern id="levels">
    <sch:rule context="p:GrpHdr">
      <sch:let name="blocks" value="../p:PmtInf"/>
      <sch:let name="n-blocks" value="count($blocks)"/>
      <sch:let name="n-txs" value="count($blocks/p:CdtTrfTxInf)"/>
      <sch:let name="missing" value="if ($lists-file) then js:tpMissing(., 'file') else ''"/>
      <sch:let name="forbidden" value="if ($lists-file) then js:tpPresent(., 'file', 'forbidden') else ''"/>
      <sch:let name="ignored" value="if ($lists-file) then js:tpPresent(., 'file', 'ignored') else ''"/>
      <sch:let name="occurs" value="if ($occurs-on) then js:tpOccursBelow(.) else ''"/>
      <!-- debtor account: IBAN or other id; debtor agent: BIC (first 8 characters: the same bank) or clearing member id -->
      <sch:let name="accounts" value="distinct-values(for $a in $blocks/p:DbtrAcct[1]/p:Id[1] return upper-case(normalize-space(($a/p:IBAN, $a/p:Othr/p:Id)[1]))[. != ''])"/>
      <sch:let name="agents" value="distinct-values(for $f in $blocks/p:DbtrAgt[1]/p:FinInstnId[1] return (if ($f/(p:BIC | p:BICFI)) then upper-case(substring(normalize-space(($f/p:BIC, $f/p:BICFI)[1]), 1, 8)) else normalize-space($f/p:ClrSysMmbId[1]/p:MmbId[1]))[. != ''])"/>

      <sch:assert id="R6.1" role="error" flag="CH21"
                  test="$missing = ''">
        The group header has no <sch:value-of select="$missing"/>, which the CMIplus guideline
        requires (setting guideline.mandatory.file).
      </sch:assert>
      <sch:assert id="R6.2-forbidden" role="error" flag="CH17"
                  test="$forbidden = ''">
        The group header contains <sch:value-of select="$forbidden"/>, which CMIplus does not
        accept (setting guideline.forbidden.file).
      </sch:assert>
      <sch:assert id="R6.2-ignored" role="warning" flag="CH17"
                  test="$ignored = ''">
        The group header contains <sch:value-of select="$ignored"/>, which CMIplus ignores
        (setting guideline.ignored.file).
      </sch:assert>
      <sch:assert id="R6.3" role="error" flag="CH17"
                  test="$occurs = ''">
        The group header: <sch:value-of select="$occurs"/>, more than the CMIplus guideline allows
        (setting guideline.maxOccurs).
      </sch:assert>
      <sch:assert id="R6.5-blocks" role="error" flag="NARR"
                  test="not(string($max-blocks) castable as xs:integer) or $n-blocks le xs:integer(string($max-blocks))">
        The file has <sch:value-of select="$n-blocks"/> payment blocks; CMIplus accepts at most
        <sch:value-of select="$max-blocks"/> per file (setting limits.maxBlocksPerFile).
      </sch:assert>
      <sch:assert id="R6.5-file" role="error" flag="NARR"
                  test="not(string($max-txs) castable as xs:integer) or $n-txs le xs:integer(string($max-txs))">
        The file has <sch:value-of select="$n-txs"/> transactions; CMIplus accepts at most
        <sch:value-of select="$max-txs"/> per file (setting limits.maxTransactionsPerFile).
      </sch:assert>
      <sch:assert id="R6.11-accounts" role="error" flag="NARR"
                  test="not($one-account) or count($accounts) le 1">
        The file uses <sch:value-of select="count($accounts)"/> debtor accounts
        (<sch:value-of select="string-join($accounts, ', ')"/>); CMIplus accepts one debtor account per
        file (setting guideline.multipleDebtorAccounts).
      </sch:assert>
      <sch:assert id="R6.11-agents" role="error" flag="NARR"
                  test="not($one-agent) or count($agents) le 1">
        The file uses <sch:value-of select="count($agents)"/> debtor agents
        (<sch:value-of select="string-join($agents, ', ')"/>); CMIplus accepts one debtor agent per
        file (setting guideline.multipleDebtorAgents).
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:PmtInf">
      <sch:let name="id" value="normalize-space(p:PmtInfId[1])"/>
      <sch:let name="txs" value="p:CdtTrfTxInf"/>
      <sch:let name="missing" value="if ($lists-block) then js:tpMissing(., 'block') else ''"/>
      <sch:let name="forbidden" value="if ($lists-block) then js:tpPresent(., 'block', 'forbidden') else ''"/>
      <sch:let name="ignored" value="if ($lists-block) then js:tpPresent(., 'block', 'ignored') else ''"/>
      <sch:let name="occurs" value="if ($occurs-on) then js:tpOccursBelow(.) else ''"/>
      <!-- xs:boolean: true or 1 (whitespace collapsed); other values are XSD errors (2.11) -->
      <sch:let name="batch" value="normalize-space(p:BtchBookg[1]) = ('true', '1')"/>
      <!-- the currency of a transaction, as for the payment type: InstdAmt, else EqvtAmt/CcyOfTrf -->
      <sch:let name="ccys" value="distinct-values(for $t in $txs return normalize-space(($t/p:Amt[1]/p:InstdAmt[1]/@Ccy, $t/p:Amt[1]/p:EqvtAmt[1]/p:CcyOfTrf[1])[1])[. != ''])"/>
      <sch:let name="ult-types" value="if (p:UltmtDbtr and not($ultimate-everywhere)) then distinct-values(for $t in $txs return js:tpPaymentType($t))[not(js:tpTypeAllowed('guideline.ultimateParties', .))] else ()"/>

      <sch:assert id="R6.1" role="error" flag="CH21"
                  test="$missing = ''">
        Payment block <sch:value-of select="$id"/> has no <sch:value-of select="$missing"/>, which
        the CMIplus guideline requires (setting guideline.mandatory.block).
      </sch:assert>
      <sch:assert id="R6.2-forbidden" role="error" flag="CH17"
                  test="$forbidden = ''">
        Payment block <sch:value-of select="$id"/> contains <sch:value-of select="$forbidden"/>,
        which CMIplus does not accept (setting guideline.forbidden.block).
      </sch:assert>
      <sch:assert id="R6.2-ignored" role="warning" flag="CH17"
                  test="$ignored = ''">
        Payment block <sch:value-of select="$id"/> contains <sch:value-of select="$ignored"/>,
        which CMIplus ignores (setting guideline.ignored.block).
      </sch:assert>
      <sch:assert id="R6.3" role="error" flag="CH17"
                  test="$occurs = ''">
        Payment block <sch:value-of select="$id"/>: <sch:value-of select="$occurs"/>, more than the CMIplus guideline allows
        (setting guideline.maxOccurs).
      </sch:assert>
      <sch:assert id="R6.5-block" role="error" flag="NARR"
                  test="not(string($max-block-txs) castable as xs:integer) or count($txs) le xs:integer(string($max-block-txs))">
        Payment block <sch:value-of select="$id"/> has <sch:value-of select="count($txs)"/>
        transactions; CMIplus accepts at most <sch:value-of select="$max-block-txs"/> per block
        (setting limits.maxTransactionsPerBlock).
      </sch:assert>
      <sch:assert id="R6.8-allowed" role="error" flag="NARR"
                  test="not($batch) or not($batch-allowed = false())">
        Payment block <sch:value-of select="$id"/> asks for batch booking (BtchBookg true), which
        CMIplus does not support (setting guideline.batchBooking.allowed).
      </sch:assert>
      <sch:assert id="R6.8-currency" role="error" flag="NARR"
                  test="not($batch) or $batch-allowed = false() or not($batch-one-ccy) or count($ccys) le 1">
        Payment block <sch:value-of select="$id"/> asks for batch booking but has transactions in
        <sch:value-of select="count($ccys)"/> currencies (<sch:value-of select="string-join($ccys, ', ')"/>);
        with batch booking all transactions of a block must have the same currency
        (setting guideline.batchBooking.singleCurrencyPerBlock).
      </sch:assert>
      <sch:assert id="R6.12-dbtr" role="warning" flag="CH17"
                  test="empty($ult-types)">
        Payment block <sch:value-of select="$id"/> has an ultimate debtor, which CMIplus does not
        support for <sch:value-of select="string-join(for $t in $ult-types return js:tpPaymentTypeLabel($t), ', ')"/>
        payments (setting guideline.ultimateParties).
      </sch:assert>
    </sch:rule>

    <!-- js:tpTxFlag: the same tests in JavaScript; a transaction without a problem does not fire the rule -->
    <sch:rule context="p:CdtTrfTxInf[js:tpTxFlag(.)]">
      <sch:let name="e2e" value="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/>
      <sch:let name="type" value="js:tpPaymentType(.)"/>
      <sch:let name="missing" value="if ($lists-tx) then js:tpMissing(., 'transaction') else ''"/>
      <sch:let name="forbidden" value="if ($lists-tx) then js:tpPresent(., 'transaction', 'forbidden') else ''"/>
      <sch:let name="ignored" value="if ($lists-tx) then js:tpPresent(., 'transaction', 'ignored') else ''"/>
      <sch:let name="occurs" value="if ($occurs-on) then js:tpOccursBelow(.) else ''"/>
      <sch:let name="ccy" value="normalize-space((p:Amt[1]/p:InstdAmt[1]/@Ccy, p:Amt[1]/p:EqvtAmt[1]/p:CcyOfTrf[1])[1])"/>
      <sch:let name="ccys-ok" value="js:tpCurrenciesFor($type)"/>
      <sch:let name="ult-ok" value="$ultimate-everywhere or not(p:UltmtDbtr or p:UltmtCdtr) or js:tpTypeAllowed('guideline.ultimateParties', $type)"/>

      <sch:assert id="R6.1" role="error" flag="CH21"
                  test="$missing = ''">
        Transaction <sch:value-of select="$e2e"/> has no <sch:value-of select="$missing"/>, which
        the CMIplus guideline requires (setting guideline.mandatory.transaction).
      </sch:assert>
      <sch:assert id="R6.2-forbidden" role="error" flag="CH17"
                  test="$forbidden = ''">
        Transaction <sch:value-of select="$e2e"/> contains <sch:value-of select="$forbidden"/>,
        which CMIplus does not accept (setting guideline.forbidden.transaction).
      </sch:assert>
      <sch:assert id="R6.2-ignored" role="warning" flag="CH17"
                  test="$ignored = ''">
        Transaction <sch:value-of select="$e2e"/> contains <sch:value-of select="$ignored"/>,
        which CMIplus ignores (setting guideline.ignored.transaction).
      </sch:assert>
      <sch:assert id="R6.3" role="error" flag="CH17"
                  test="$occurs = ''">
        Transaction <sch:value-of select="$e2e"/>: <sch:value-of select="$occurs"/>, more than the CMIplus guideline allows
        (setting guideline.maxOccurs).
      </sch:assert>
      <!-- a currency that is not 3 capital letters is an XSD error (2.7); no payment type is 3.5 -->
      <sch:assert id="R6.6" role="error" flag="AM03"
                  test="$type = '' or $ccys-ok = '' or not(matches($ccy, '^[A-Z]{3}$')) or $ccy = tokenize($ccys-ok, ' ')">
        Transaction <sch:value-of select="$e2e"/>: the currency <sch:value-of select="$ccy"/> is not
        supported for <sch:value-of select="js:tpPaymentTypeLabel($type)"/> payments in
        <sch:value-of select="js:tpCountry('code')"/>; supported: <sch:value-of select="string-join(tokenize($ccys-ok, ' '), ', ')"/>
        (country file, currencies).
      </sch:assert>
      <sch:assert id="R6.12-dbtr" role="warning" flag="CH17"
                  test="$ult-ok or not(p:UltmtDbtr)">
        Transaction <sch:value-of select="$e2e"/> has an ultimate debtor, which CMIplus does not
        support for <sch:value-of select="js:tpPaymentTypeLabel($type)"/> payments
        (setting guideline.ultimateParties).
      </sch:assert>
      <sch:assert id="R6.12-cdtr" role="warning" flag="CH17"
                  test="$ult-ok or not(p:UltmtCdtr)">
        Transaction <sch:value-of select="$e2e"/> has an ultimate creditor, which CMIplus does not
        support for <sch:value-of select="js:tpPaymentTypeLabel($type)"/> payments
        (setting guideline.ultimateParties).
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== occurrences and lengths: 6.3, 6.4 -->
  <sch:pattern id="lengths">
    <!-- the fast test js:tpLengthFlag lets through only values over their limit (no condition on a parent) -->
    <sch:rule context="p:*[not(*)][js:tpLengthFlag(.)]">
      <sch:let name="field" value="string-join(ancestor-or-self::*[not(local-name() = $levels)]/local-name(), '/')"/>
      <sch:let name="limit" value="js:tpLimit(., 'guideline.maxLength')"/>
      <sch:assert id="R6.4" role="error" flag="CH16"
                  test="$limit = 0 or string-length(.) le $limit">
        The value of <sch:value-of select="$field"/> has <sch:value-of select="string-length(.)"/>
        characters; the CMIplus guideline allows <sch:value-of select="$limit"/> (setting guideline.maxLength).
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== code subsets and ids: 6.9, 6.10 -->
  <sch:pattern id="codes">
    <!-- 6.9: only codes of the ISO lists; an unknown code is 4.34–4.37 -->
    <sch:rule context="p:Purp/p:Cd[not(js:tpSubset('guideline.codes.purpose', string(.)))]">
      <sch:assert id="R6.9-purp" role="error" flag="FF07"
                  test="not(js:tpIn('purpose', normalize-space(.)))">
        The purpose code <sch:value-of select="."/> is not one of the codes CMIplus supports
        (setting guideline.codes.purpose).
      </sch:assert>
    </sch:rule>
    <sch:rule context="p:CtgyPurp/p:Cd[not(js:tpSubset('guideline.codes.categoryPurpose', string(.)))]">
      <sch:assert id="R6.9-ctgypurp" role="error" flag="FF06"
                  test="not(js:tpIn('categoryPurpose', normalize-space(.)))">
        The category purpose code <sch:value-of select="."/> is not one of the codes CMIplus
        supports (setting guideline.codes.categoryPurpose).
      </sch:assert>
    </sch:rule>
    <sch:rule context="p:SvcLvl/p:Cd[not(js:tpSubset('guideline.codes.serviceLevel', string(.)))]">
      <sch:assert id="R6.9-svclvl" role="error" flag="FF04"
                  test="not(js:tpIn('serviceLevel', normalize-space(.)))">
        The service level code <sch:value-of select="."/> is not one of the codes CMIplus supports
        (setting guideline.codes.serviceLevel).
      </sch:assert>
    </sch:rule>
    <sch:rule context="p:LclInstrm/p:Cd[not(js:tpSubset('guideline.codes.localInstrument', string(.)))]">
      <sch:assert id="R6.9-lclinstrm" role="error" flag="FF05"
                  test="not(js:tpIn('localInstrument', normalize-space(.)))">
        The local instrument code <sch:value-of select="."/> is not one of the codes CMIplus
        supports (setting guideline.codes.localInstrument).
      </sch:assert>
    </sch:rule>

    <!-- 6.10: a format for the initiating party's organisation id; a missing id is 6.1 (mandatory) -->
    <sch:rule context="p:InitgPty/p:Id/p:OrgId/p:Othr/p:Id">
      <sch:let name="problem" value="js:tpPatternProblem('guideline.initiatingPartyIdPattern', string(.))"/>
      <sch:assert id="R6.10" role="error" flag="NARR"
                  test="$problem = ''">
        <sch:value-of select="if (starts-with($problem, 'invalid')) then concat('The id could not be checked: the setting guideline.initiatingPartyIdPattern is not a valid regular expression (', substring-after($problem, 'invalid: '), ').') else concat('The initiating party id &quot;', ., '&quot; does not have the format CMIplus expects (setting guideline.initiatingPartyIdPattern: ', js:tpSetting('guideline.initiatingPartyIdPattern'), ').')"/>
      </sch:assert>
    </sch:rule>
  </sch:pattern>

</sch:schema>

<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 4: generic ISO 20022 business rules.
  Source of truth: validation catalogue, stage 4, and docs/specs/M2.md,
  section 4. M1 contained the 12 rules of the sample rule file; M2 adds the
  rest of the stage.

  Written for pain.001.001.03. The build compiles a second variant for
  pain.001.001.09 by replacing the namespace (see docs/RULES.md). Where the
  versions differ, the XPath below covers both:
    ReqdExctnDt   .03: date text   .09: child Dt or DtTm
    BIC           .03: BIC         .09: BICFI
    UnitCcy       .09 only (XchgRateInf)
    addresses     .09 has more structured elements; .09 RmtLctnDtls/PstlAdr
                  is a name and address (Nm, Adr), not a postal address
  Rules never fail on invalid data: values are checked with "castable as"
  before they are converted, and single elements are taken with [1] because
  an element may be repeated by mistake. Values that the XSD rejects are left
  to the XSD stage, so the same problem is not reported twice.
  Amounts are InstdAmt or EqvtAmt/Amt (the choice of the Amt element).

  Speed (docs/RULES.md, measured in M2): every time a rule fires costs about
  40 µs, whatever its asserts test. So the checks of elements that every
  transaction has are asserts of the one transaction rule, and "subject"
  points the finding at the element concerned (same place in the report as
  a rule on that element). Elements that are optional and rare (ultimate
  parties, codes, exchange rate, clearing ids) have rules of their own:
  those fire only where the element is used. The address rule has a
  condition on the address itself (not on a parent) so that it fires only
  for addresses that can fail 4.30.
-->
<?testing-portal stage="4" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 4: generic ISO business rules</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <!-- time of the check and limits from config/settings.json (an empty string: limit not set, check off) -->
  <sch:let name="today" value="xs:date(js:tpToday())"/>
  <sch:let name="latest-exec" value="js:tpShiftToday('limits.executionDateMaxAhead', 1)"/>
  <sch:let name="latest-cre" value="js:tpShiftNow('limits.creationDateFutureTolerance', 1)"/>
  <sch:let name="earliest-cre" value="js:tpShiftNow('limits.creationDateMaxAge', -1)"/>

  <!-- guideline settings, read once. Only false switches a feature off: true and null (check off)
       allow it. Limits that are null (or not a number) are not checked. -->
  <sch:let name="dttm-ok" value="not(string(js:tpSetting('guideline.executionDateTime')[1]) = 'false')"/>
  <sch:let name="eqvt-ok" value="not(string(js:tpSetting('guideline.equivalentAmount')[1]) = 'false')"/>
  <sch:let name="rgltry-ok" value="not(string(js:tpSetting('guideline.regulatoryReporting')[1]) = 'false')"/>
  <sch:let name="unstructured-ok" value="not(string(js:tpSetting('guideline.unstructuredAddress')[1]) = 'false')"/>
  <sch:let name="rmt-combined-ok" value="not(string(js:tpSetting('guideline.remittance.combined')[1]) = 'false')"/>
  <sch:let name="rmt-max-ustrd" value="for $v in js:tpSetting('guideline.remittance.maxUstrd')[. castable as xs:double][1] return xs:double($v)"/>
  <sch:let name="rmt-max-strd" value="for $v in js:tpSetting('guideline.remittance.maxStrd')[. castable as xs:double][1] return xs:double($v)"/>

  <!-- BIC as the XSD accepts it (.03 BICIdentifier, .09 BICFIDec2014Identifier): other values are XSD errors -->
  <sch:let name="bic-pattern" value="'^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'"/>

  <!-- ===================================================== group header -->
  <sch:pattern id="group-header">
    <sch:rule context="p:GrpHdr">
      <sch:let name="txs" value="//p:CdtTrfTxInf"/>
      <sch:let name="amounts" value="$txs/p:Amt/(p:InstdAmt | p:EqvtAmt/p:Amt)"/>
      <!-- With an amount that is missing or not a number the sum cannot be checked; the XSD reports the amount. -->
      <sch:let name="amounts-ok" value="count($amounts) = count($txs) and (every $a in $amounts satisfies $a castable as xs:decimal)"/>
      <sch:let name="tx-sum" value="sum(for $a in $amounts return if ($a castable as xs:decimal) then xs:decimal($a) else 0)"/>
      <sch:let name="cre" value="normalize-space(p:CreDtTm[1])"/>
      <sch:let name="msg-id" value="p:MsgId[1]"/>
      <sch:let name="ip" value="p:InitgPty[1]"/>

      <!-- an empty MsgId is an XSD error (2.6); one of spaces only is caught here -->
      <sch:assert id="R4.1" role="error" flag="CH16" subject="$msg-id"
                  test="empty($msg-id) or string-length($msg-id) = 0 or normalize-space($msg-id) != ''">
        The message id (MsgId) consists of spaces only.
      </sch:assert>

      <sch:assert id="R4.2-future" role="error" flag="DT02"
                  test="not($cre castable as xs:dateTime) or $latest-cre = '' or xs:dateTime($cre) le xs:dateTime($latest-cre)">
        The creation date and time (<sch:value-of select="$cre"/>) is in the future.
      </sch:assert>

      <!-- severity set in config/settings.json, checks."4.2-age" (a warning, decided 2026-11-18) -->
      <sch:assert id="R4.2-age" role="error" flag="DT02"
                  test="not($cre castable as xs:dateTime) or $earliest-cre = '' or xs:dateTime($cre) ge xs:dateTime($earliest-cre)">
        The file was created on <sch:value-of select="substring($cre, 1, 10)"/>, which is longer ago than
        <sch:value-of select="js:tpSetting('limits.creationDateMaxAge')"/> (setting limits.creationDateMaxAge).
        Check that this is not an old file sent again.
      </sch:assert>

      <sch:assert id="R4.3" role="error" flag="AM19"
                  test="not(p:NbOfTxs[1] castable as xs:integer) or xs:integer(p:NbOfTxs[1]) = count($txs)">
        The number of transactions in the group header (<sch:value-of select="p:NbOfTxs[1]"/>)
        does not match the number of transactions in the file (<sch:value-of select="count($txs)"/>).
      </sch:assert>

      <sch:assert id="R4.4" role="error" flag="AM16"
                  test="not($amounts-ok) or not(p:CtrlSum[1] castable as xs:decimal) or xs:decimal(p:CtrlSum[1]) = $tx-sum">
        The control sum in the group header (<sch:value-of select="p:CtrlSum[1]"/>)
        does not match the sum of all transaction amounts (<sch:value-of select="format-number($tx-sum, '0.00###')"/>).
      </sch:assert>

      <!-- InitgPty is mandatory in the XSD, but all its elements are optional.
           An empty Nm is an XSD error (2.6); a name of spaces only counts as no name. -->
      <sch:assert id="R4.5" role="error" flag="CH21" subject="($ip, .)[1]"
                  test="empty($ip) or exists($ip/p:Id) or (exists($ip/p:Nm) and (string-length($ip/p:Nm[1]) = 0 or normalize-space($ip/p:Nm[1]) != ''))">
        The initiating party (InitgPty) has neither a name nor an identification.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== payment block -->
  <sch:pattern id="payment-block">
    <sch:rule context="p:PmtInf">
      <sch:let name="txs" value="p:CdtTrfTxInf"/>
      <sch:let name="id" value="normalize-space(p:PmtInfId[1])"/>
      <sch:let name="amounts" value="$txs/p:Amt/(p:InstdAmt | p:EqvtAmt/p:Amt)"/>
      <sch:let name="amounts-ok" value="count($amounts) = count($txs) and (every $a in $amounts satisfies $a castable as xs:decimal)"/>
      <sch:let name="block-sum" value="sum(for $a in $amounts return if ($a castable as xs:decimal) then xs:decimal($a) else 0)"/>
      <!-- .03: ReqdExctnDt is the date; .09: ReqdExctnDt/Dt, or ReqdExctnDt/DtTm whose first 10 characters are the date -->
      <sch:let name="rd" value="p:ReqdExctnDt[1]"/>
      <sch:let name="raw-date" value="if ($rd/p:DtTm) then substring(normalize-space($rd/p:DtTm[1]), 1, 10) else if ($rd/p:Dt) then normalize-space($rd/p:Dt[1]) else normalize-space($rd)"/>
      <sch:let name="exec-date" value="if ($raw-date castable as xs:date) then xs:date($raw-date) else ()"/>
      <sch:let name="pmt-inf-id" value="p:PmtInfId[1]"/>
      <sch:let name="dbtr" value="p:Dbtr[1]"/>
      <sch:let name="dbtr-agt-id" value="p:DbtrAgt[1]/p:FinInstnId[1]"/>
      <sch:let name="dbtr-bic" value="string(($dbtr-agt-id/(p:BIC | p:BICFI))[1])"/>
      <sch:let name="chrgs-agt" value="p:ChrgsAcctAgt[1]"/>
      <sch:let name="chrgs-bic" value="string(($chrgs-agt/p:FinInstnId[1]/(p:BIC | p:BICFI))[1])"/>
      <sch:let name="chrgs-iban" value="p:ChrgsAcct[1]/p:Id[1]/p:IBAN[1]"/>

      <!-- an empty PmtInfId is an XSD error (2.6); one of spaces only is caught here -->
      <sch:assert id="R4.6" role="error" flag="CH16" subject="($pmt-inf-id, .)[1]"
                  test="empty($pmt-inf-id) or string-length($pmt-inf-id) = 0 or normalize-space($pmt-inf-id) != ''">
        The payment information id (PmtInfId) of this payment block consists of spaces only.
      </sch:assert>

      <sch:assert id="R4.7" role="error" flag="AM18"
                  test="not(p:NbOfTxs[1] castable as xs:integer) or xs:integer(p:NbOfTxs[1]) = count($txs)">
        Payment block <sch:value-of select="$id"/>: the number of transactions
        (<sch:value-of select="p:NbOfTxs[1]"/>) does not match the transactions in this
        block (<sch:value-of select="count($txs)"/>).
      </sch:assert>

      <sch:assert id="R4.8" role="error" flag="AM17"
                  test="not($amounts-ok) or not(p:CtrlSum[1] castable as xs:decimal) or xs:decimal(p:CtrlSum[1]) = $block-sum">
        Payment block <sch:value-of select="$id"/>: the control sum
        (<sch:value-of select="p:CtrlSum[1]"/>) does not match the sum of the amounts in
        this block (<sch:value-of select="format-number($block-sum, '0.00###')"/>).
      </sch:assert>

      <!-- The XSD also allows CHK (cheque) and TRA; other values are XSD errors. -->
      <sch:assert id="R4.9" role="error" flag="CH16"
                  test="not(p:PmtMtd[1] = ('CHK', 'TRA'))">
        Payment block <sch:value-of select="$id"/>: the payment method is
        "<sch:value-of select="p:PmtMtd[1]"/>". Only TRF (credit transfer) is accepted.
      </sch:assert>

      <sch:assert id="R4.10" role="error" flag="CH04"
                  test="empty($exec-date) or $exec-date ge $today">
        Payment block <sch:value-of select="$id"/>: the requested execution date
        (<sch:value-of select="$raw-date"/>) is in the past.
      </sch:assert>

      <sch:assert id="R4.11" role="error" flag="CH03"
                  test="empty($exec-date) or $latest-exec = '' or $exec-date le xs:date($latest-exec)">
        Payment block <sch:value-of select="$id"/>: the requested execution date
        (<sch:value-of select="$raw-date"/>) is later than <sch:value-of select="$latest-exec"/>,
        more than <sch:value-of select="js:tpSetting('limits.executionDateMaxAhead')"/> ahead
        (setting limits.executionDateMaxAhead).
      </sch:assert>

      <!-- .09 only: the execution date can be a date and time (DtTm); .03 has no DtTm -->
      <sch:assert id="R4.12" role="error" flag="CH17" subject="($rd/p:DtTm[1], .)[1]"
                  test="$dttm-ok or empty($rd/p:DtTm)">
        Payment block <sch:value-of select="$id"/>: the requested execution date is given
        with a time (DtTm <sch:value-of select="$rd/p:DtTm[1]"/>), which is not supported
        (setting guideline.executionDateTime). Give the date only (Dt).
      </sch:assert>

      <!-- Dbtr is mandatory in the XSD, its name is not. An empty Nm is an XSD error (2.6). -->
      <sch:assert id="R4.15" role="error" flag="CH21" subject="($dbtr, .)[1]"
                  test="empty($dbtr) or (exists($dbtr/p:Nm) and (string-length($dbtr/p:Nm[1]) = 0 or normalize-space($dbtr/p:Nm[1]) != ''))">
        Payment block <sch:value-of select="$id"/>: the debtor name is missing.
      </sch:assert>

      <!-- DbtrAgt and FinInstnId are mandatory in the XSD, their elements are optional -->
      <sch:assert id="R4.17" role="error" flag="RC03" subject="(p:DbtrAgt[1], .)[1]"
                  test="empty($dbtr-agt-id) or exists($dbtr-agt-id/(p:BIC | p:BICFI | p:ClrSysMmbId))">
        Payment block <sch:value-of select="$id"/>: the debtor agent (DbtrAgt) has neither
        a BIC nor a clearing system member id.
      </sch:assert>

      <!-- 4.18: the IBAN of the charges account (registry, length, check digits) ... -->
      <sch:assert id="R4.18-iban" role="error" flag="AC01" subject="($chrgs-iban, .)[1]"
                  test="empty($chrgs-iban) or not(matches($chrgs-iban, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) or js:tpIbanProblem(string($chrgs-iban)) = ''">
        Payment block <sch:value-of select="$id"/>: the charges account IBAN
        <sch:value-of select="$chrgs-iban"/> is not valid: <sch:value-of select="js:tpIbanProblem(string($chrgs-iban))"/>.
      </sch:assert>

      <!-- ... the charges account agent needs a charges account (ISO rule ChargesAccountRule) ... -->
      <sch:assert id="R4.18-account" role="error" flag="AC01" subject="($chrgs-agt, .)[1]"
                  test="empty($chrgs-agt) or exists(p:ChrgsAcct)">
        Payment block <sch:value-of select="$id"/>: a charges account agent (ChrgsAcctAgt)
        is given without a charges account (ChrgsAcct).
      </sch:assert>

      <!-- ... and is the debtor agent or one of its branches (ISO rule ChargesAccountAgentRule):
           compared on the first 8 characters of the BICs, when both have one -->
      <sch:assert id="R4.18-agent" role="error" flag="AC01" subject="($chrgs-agt, .)[1]"
                  test="not(matches($chrgs-bic, $bic-pattern) and matches($dbtr-bic, $bic-pattern)) or substring($chrgs-bic, 1, 8) = substring($dbtr-bic, 1, 8)">
        Payment block <sch:value-of select="$id"/>: the charges account agent
        (BIC <sch:value-of select="$chrgs-bic"/>) is not the debtor agent
        (BIC <sch:value-of select="$dbtr-bic"/>) or one of its branches.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== transaction -->
  <sch:pattern id="transaction">
    <sch:rule context="p:CdtTrfTxInf">
      <sch:let name="blk" value=".."/>
      <sch:let name="e2e-el" value="p:PmtId[1]/p:EndToEndId[1]"/>
      <sch:let name="e2e" value="normalize-space($e2e-el)"/>
      <sch:let name="nm" value="p:Cdtr[1]/p:Nm[1]"/>
      <!-- the amount: InstdAmt or EqvtAmt/Amt -->
      <sch:let name="amt" value="(p:Amt[1]/(p:InstdAmt | p:EqvtAmt/p:Amt))[1]"/>
      <sch:let name="amt-ok" value="$amt castable as xs:decimal"/>
      <sch:let name="ccy" value="string($amt/@Ccy)"/>
      <!-- minor units of ISO 4217, one table for rules and report: tpCcyDecimals in js/validation/functions/settings.js -->
      <sch:let name="decimals-allowed" value="js:tpCcyDecimals($ccy)"/>
      <sch:let name="decimals-used" value="string-length(substring-after(normalize-space($amt), '.'))"/>
      <sch:let name="cdtr-ctry" value="p:Cdtr[1]/p:PstlAdr[1]/p:Ctry[1]"/>
      <sch:let name="rmt" value="p:RmtInf[1]"/>
      <sch:let name="n-ustrd" value="count($rmt/p:Ustrd)"/>
      <sch:let name="n-strd" value="count($rmt/p:Strd)"/>

      <!-- 4.13 and 4.14 (ISO rules PaymentTypeInformationRule and ChargeBearerRule) are reported
           on each transaction that repeats what its block already gives -->
      <sch:assert id="R4.13" role="error" flag="CH17" subject="(p:PmtTpInf[1], .)[1]"
                  test="empty(p:PmtTpInf) or empty($blk/p:PmtTpInf[1])">
        Transaction <sch:value-of select="$e2e"/>: the payment type information (PmtTpInf)
        is given on the transaction and on its payment block. Give it on one level only.
      </sch:assert>

      <sch:assert id="R4.14" role="error" flag="CH17" subject="(p:ChrgBr[1], .)[1]"
                  test="empty(p:ChrgBr) or empty($blk/p:ChrgBr[1])">
        Transaction <sch:value-of select="$e2e"/>: the charge bearer (ChrgBr) is given on the
        transaction (<sch:value-of select="p:ChrgBr[1]"/>) and on its payment block
        (<sch:value-of select="$blk/p:ChrgBr[1]"/>). Give it on one level only.
      </sch:assert>

      <!-- presence is XSD 2.2, an empty EndToEndId XSD 2.6; NOTPROVIDED is allowed (hint X.1) -->
      <sch:assert id="R4.20" role="error" flag="FF08" subject="($e2e-el, .)[1]"
                  test="empty($e2e-el) or string-length($e2e-el) = 0 or $e2e != ''">
        The end-to-end id (EndToEndId) of this transaction consists of spaces only.
      </sch:assert>

      <!-- 4.21 to 4.23 are on the amount element (subject), as in M1 -->
      <sch:assert id="R4.21" role="error" flag="AM01" subject="($amt, .)[1]"
                  test="not($amt-ok) or xs:decimal($amt) gt 0">
        The transaction amount must be greater than zero.
      </sch:assert>

      <sch:assert id="R4.22" role="error" flag="CH20" subject="($amt, .)[1]"
                  test="not($amt-ok) or $decimals-used le $decimals-allowed">
        The amount <sch:value-of select="concat(normalize-space($amt), ' ', $ccy)"/> has
        <sch:value-of select="$decimals-used"/> decimal places. The currency
        <sch:value-of select="$ccy"/> allows <sch:value-of select="$decimals-allowed"/>.
      </sch:assert>

      <!-- a currency that is not 3 capital letters is an XSD error (2.7) -->
      <sch:assert id="R4.23" role="error" flag="AM03" subject="($amt, .)[1]"
                  test="not(matches($ccy, '^[A-Z]{3}$')) or js:tpIn('currencies', $ccy)">
        The currency <sch:value-of select="$ccy"/> of the amount is not an active ISO 4217 currency code.
      </sch:assert>

      <!-- payment type of stage 3 (js/validation/functions/payment-type.js); asked only when there is no creditor agent -->
      <sch:assert id="R4.26" role="error" flag="RC04"
                  test="exists(p:CdtrAgt) or js:tpPaymentType(.) != 'CROSS_BORDER'">
        Transaction <sch:value-of select="$e2e"/>: a cross-border payment needs the creditor
        agent (CdtrAgt), the creditor's bank, but none is given.
      </sch:assert>

      <!-- Creditor is optional in the XSD; the business rule makes the name mandatory.
           An empty Nm is an XSD error (2.6); a name of spaces only is caught here. -->
      <sch:assert id="R4.28" role="error" flag="CH21"
                  test="exists($nm) and (string-length($nm) = 0 or normalize-space($nm) != '')">
        Transaction <sch:value-of select="$e2e"/>: the creditor name is missing.
      </sch:assert>

      <!-- the XSD checks the pattern (2 capital letters, 2.7); the list has ISO 3166-1 and XK -->
      <sch:assert id="R4.29" role="error" flag="BE11" subject="($cdtr-ctry, .)[1]"
                  test="not(matches($cdtr-ctry, '^[A-Z]{2}$')) or js:tpIn('countries', string($cdtr-ctry))">
        Transaction <sch:value-of select="$e2e"/>: the creditor country
        <sch:value-of select="$cdtr-ctry"/> is not an ISO 3166 country code.
      </sch:assert>

      <!-- not for cheques (catalogue: "except cheques"; 4.9 covers them) -->
      <sch:assert id="R4.31" role="error" flag="AC03"
                  test="p:CdtrAcct or normalize-space(../p:PmtMtd[1]) = 'CHK'">
        Transaction <sch:value-of select="$e2e"/>: the creditor account is missing.
      </sch:assert>

      <!-- 4.38: remittance information, limits in guideline.remittance (null: not checked) -->
      <sch:assert id="R4.38-combined" role="error" flag="RR07" subject="($rmt, .)[1]"
                  test="$rmt-combined-ok or $n-ustrd = 0 or $n-strd = 0">
        Transaction <sch:value-of select="$e2e"/>: the remittance information is given both
        unstructured (Ustrd) and structured (Strd), which is not supported
        (setting guideline.remittance.combined). Use one of them.
      </sch:assert>

      <sch:assert id="R4.38-count" role="error" flag="RR07" subject="($rmt, .)[1]"
                  test="(empty($rmt-max-ustrd) or $n-ustrd le $rmt-max-ustrd) and (empty($rmt-max-strd) or $n-strd le $rmt-max-strd)">
        Transaction <sch:value-of select="$e2e"/>: the remittance information has
        <sch:value-of select="string-join((
          if (exists($rmt-max-ustrd) and $n-ustrd gt $rmt-max-ustrd) then concat($n-ustrd, ' unstructured parts (Ustrd), at most ', $rmt-max-ustrd, ' allowed') else (),
          if (exists($rmt-max-strd) and $n-strd gt $rmt-max-strd) then concat($n-strd, ' structured parts (Strd), at most ', $rmt-max-strd, ' allowed') else ()), ' and ')"/>
        (setting guideline.remittance).
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== optional elements
       Rules on elements that are optional: they fire only where the element is used. -->
  <sch:pattern id="elements">

    <!-- 4.16: the debtor account currency (the account id is a choice of the XSD) -->
    <sch:rule context="p:DbtrAcct/p:Ccy">
      <sch:assert id="R4.16" role="error" flag="AC02"
                  test="not(matches(., '^[A-Z]{3}$')) or js:tpIn('currencies', string(.))">
        The currency of the debtor account (<sch:value-of select="."/>) is not an active
        ISO 4217 currency code.
      </sch:assert>
    </sch:rule>

    <!-- 4.23: the currency of every other account (creditor, charges, agents' accounts) and the
         unit currency of the exchange rate (.09). The currency of the amount is checked in the
         transaction rule, the currency of transfer by 4.24. -->
    <sch:rule context="p:Ccy | p:UnitCcy">
      <sch:assert id="R4.23" role="error" flag="AM03"
                  test="not(matches(., '^[A-Z]{3}$')) or js:tpIn('currencies', string(.))">
        The currency <sch:value-of select="."/> (<sch:value-of select="concat(local-name(..), '/', local-name())"/>)
        is not an active ISO 4217 currency code.
      </sch:assert>
    </sch:rule>

    <!-- 4.24: equivalent amount (the amount in another currency than the one transferred) -->
    <sch:rule context="p:EqvtAmt">
      <sch:let name="cot" value="p:CcyOfTrf[1]"/>
      <sch:assert id="R4.24-currency" role="error" flag="AM03" subject="($cot, .)[1]"
                  test="not(matches($cot, '^[A-Z]{3}$')) or js:tpIn('currencies', string($cot))">
        The currency of transfer (CcyOfTrf) <sch:value-of select="$cot"/> of the equivalent
        amount is not an active ISO 4217 currency code.
      </sch:assert>

      <sch:assert id="R4.24-supported" role="error" flag="AM03"
                  test="$eqvt-ok">
        The amount is given as an equivalent amount (EqvtAmt), which is not supported
        (setting guideline.equivalentAmount). Give the amount as InstdAmt.
      </sch:assert>
    </sch:rule>

    <!-- 4.25: exchange rate information. UnitCcy exists in .09 only; one that is not an ISO code is 4.23. -->
    <sch:rule context="p:XchgRateInf">
      <sch:let name="tx" value=".."/>
      <sch:let name="unit" value="p:UnitCcy[1]"/>
      <sch:let name="unit-known" value="matches($unit, '^[A-Z]{3}$') and js:tpIn('currencies', string($unit))"/>
      <!-- the currencies of the transaction: amount, currency of transfer, debtor and creditor account -->
      <sch:let name="tx-ccys" value="distinct-values(for $c in ($tx/p:Amt[1]/(p:InstdAmt | p:EqvtAmt/p:Amt)/@Ccy, $tx/p:Amt[1]/p:EqvtAmt/p:CcyOfTrf, $tx/../p:DbtrAcct[1]/p:Ccy, $tx/p:CdtrAcct[1]/p:Ccy) return normalize-space($c))"/>

      <sch:assert id="R4.25-unit" role="warning" subject="($unit, .)[1]"
                  test="not($unit-known) or string($unit) = $tx-ccys">
        The exchange rate is given for the unit currency <sch:value-of select="$unit"/>, which
        is not a currency of this transaction (<sch:value-of select="string-join($tx-ccys, ', ')"/>).
      </sch:assert>

      <sch:assert id="R4.25-contract" role="warning"
                  test="not(p:RateTp[1] = 'AGRD') or normalize-space(p:CtrctId[1]) != ''">
        The exchange rate type is AGRD (agreed with the bank), but no contract id (CtrctId) is given.
      </sch:assert>
    </sch:rule>

    <!-- 4.19 and 4.32: ultimate parties (block or transaction). An empty Nm is an XSD error (2.6). -->
    <sch:rule context="p:UltmtDbtr">
      <sch:assert id="R4.19" role="error" flag="CH21"
                  test="exists(p:Id) or (exists(p:Nm) and (string-length(p:Nm[1]) = 0 or normalize-space(p:Nm[1]) != ''))">
        The ultimate debtor (UltmtDbtr) has neither a name nor an identification.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:UltmtCdtr">
      <sch:assert id="R4.32" role="error" flag="CH21"
                  test="exists(p:Id) or (exists(p:Nm) and (string-length(p:Nm[1]) = 0 or normalize-space(p:Nm[1]) != ''))">
        The ultimate creditor (UltmtCdtr) has neither a name nor an identification.
      </sch:assert>
    </sch:rule>

    <!-- 4.27: clearing system member id of any agent (debtor, creditor, intermediary, charges account, forwarding).
           A proprietary system (ClrSysId/Prtry) and a member id without a system are not checked;
           member ids of a system without a known format (config/reference/clearing-systems.json) neither. -->
    <sch:rule context="p:ClrSysMmbId">
      <sch:let name="sys" value="normalize-space(p:ClrSysId[1]/p:Cd[1])"/>
      <sch:let name="mmb" value="normalize-space(p:MmbId[1])"/>
      <sch:let name="sys-known" value="$sys != '' and js:tpIn('clearingSystem', $sys)"/>
      <sch:let name="mmb-problem" value="if ($sys-known and $mmb != '') then js:tpClearingProblem($sys, $mmb) else ''"/>

      <sch:assert id="R4.27-code" role="error" flag="RC08" subject="(p:ClrSysId[1]/p:Cd[1], .)[1]"
                  test="$sys = '' or $sys-known">
        The clearing system code <sch:value-of select="$sys"/> is not in the ISO 20022 list
        ExternalClearingSystemIdentification1Code.
      </sch:assert>

      <sch:assert id="R4.27-member" role="error" flag="RC08" subject="(p:MmbId[1], .)[1]"
                  test="$mmb-problem = ''">
        The member id <sch:value-of select="$mmb"/> does not have the format of the clearing
        system <sch:value-of select="$sys"/>: <sch:value-of select="$mmb-problem"/>.
      </sch:assert>
    </sch:rule>

    <!-- 4.33: instruction for the creditor agent. The XSD allows CHQB, HOLD, PHOB, TELB (2.8). -->
    <sch:rule context="p:InstrForCdtrAgt/p:Cd">
      <sch:assert id="R4.33" role="error" flag="CH16"
                  test="not(. = ('CHQB', 'HOLD', 'PHOB', 'TELB')) or js:tpAllowed('guideline.instructionCodes', string(.))">
        The instruction for the creditor agent <sch:value-of select="."/> is not supported
        (setting guideline.instructionCodes: <sch:value-of select="string-join(js:tpSetting('guideline.instructionCodes'), ', ')"/>).
      </sch:assert>
    </sch:rule>

    <!-- 4.34 to 4.37: ISO 20022 external code lists (config/reference/external-codes.json).
         The XSD only checks the length of these codes. Leading or trailing spaces are 5.4. -->
    <sch:rule context="p:Purp/p:Cd">
      <sch:assert id="R4.34" role="error" flag="FF07"
                  test="js:tpIn('purpose', normalize-space(.))">
        The purpose code <sch:value-of select="."/> is not in the ISO 20022 list ExternalPurpose1Code.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:CtgyPurp/p:Cd">
      <sch:assert id="R4.35" role="error" flag="FF06"
                  test="js:tpIn('categoryPurpose', normalize-space(.))">
        The category purpose code <sch:value-of select="."/> is not in the ISO 20022 list ExternalCategoryPurpose1Code.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:SvcLvl/p:Cd">
      <sch:assert id="R4.36" role="error" flag="FF04"
                  test="js:tpIn('serviceLevel', normalize-space(.))">
        The service level code <sch:value-of select="."/> is not in the ISO 20022 list ExternalServiceLevel1Code.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:LclInstrm/p:Cd">
      <sch:assert id="R4.37-code" role="error" flag="FF05"
                  test="js:tpIn('localInstrument', normalize-space(.))">
        The local instrument code <sch:value-of select="."/> is not in the ISO 20022 list ExternalLocalInstrument1Code.
      </sch:assert>
    </sch:rule>

    <!-- an empty list allows no proprietary value; null switches the check off -->
    <sch:rule context="p:LclInstrm/p:Prtry">
      <sch:assert id="R4.37-proprietary" role="error" flag="FF05"
                  test="js:tpAllowed('guideline.localInstrumentProprietary', normalize-space(.))">
        The proprietary local instrument <sch:value-of select="."/> is not allowed
        (setting guideline.localInstrumentProprietary<sch:value-of select="if (exists(js:tpSetting('guideline.localInstrumentProprietary')[1])) then concat(': ', string-join(js:tpSetting('guideline.localInstrumentProprietary'), ', ')) else ', which allows none'"/>).
      </sch:assert>
    </sch:rule>

    <!-- 4.39: a structured creditor reference of type SCOR that looks like an ISO 11649 reference
           (RF and two digits) must have valid check digits; other SCOR references are not checked -->
    <sch:rule context="p:CdtrRefInf">
      <sch:let name="ref" value="normalize-space(p:Ref[1])"/>
      <sch:assert id="R4.39" role="error" flag="RR09" subject="(p:Ref[1], .)[1]"
                  test="not(p:Tp[1]/p:CdOrPrtry[1]/p:Cd[1] = 'SCOR' and matches($ref, '^RF[0-9]{2}', 'i')) or js:tpRfValid($ref)">
        The creditor reference <sch:value-of select="$ref"/> is not a valid ISO 11649
        reference (RF): the check digits are wrong or it has characters other than letters and digits, or more than 25 characters.
      </sch:assert>
    </sch:rule>

    <!-- 4.40: regulatory reporting. Dtls/Cd at most 10 characters is checked by the XSD (Max10Text, 2.6),
         the indicator DbtCdtRptgInd by the XSD too (2.8). -->
    <sch:rule context="p:RgltryRptg">
      <sch:assert id="R4.40-allowed" role="error" flag="RR05"
                  test="$rgltry-ok">
        Regulatory reporting information (RgltryRptg) is given, which is not supported
        (setting guideline.regulatoryReporting).
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:RgltryRptg/p:Dtls/p:Ctry">
      <sch:assert id="R4.40-country" role="error" flag="RR05"
                  test="not(matches(., '^[A-Z]{2}$')) or js:tpIn('countries', string(.))">
        The country of the regulatory reporting details (<sch:value-of select="."/>) is not
        an ISO 3166 country code.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== postal addresses
       4.30 for every postal address: parties, agents and their branches, remittance and
       cheque addresses (Adr). Structured elements are all elements of the address except
       AdrTp, AdrLine and Ctry: an address of Ctry and AdrLine only is unstructured (EPC).
         unstructured (no structured element, AdrLine): 7.8 and 7.18 warn, unless
                       guideline.unstructuredAddress is false, then part "unstructured";
         structured or hybrid (a structured element): TwnNm and Ctry, at most 2 AdrLine,
                       AdrLine does not repeat StrtNm, PstCd or TwnNm;
         Ctry only or empty: not checked, unless unstructured addresses are not allowed.
       The condition in the context is on the address itself: a structured address with TwnNm
       and Ctry and no AdrLine always passes, so the rule does not fire for it (speed). -->
  <sch:pattern id="addresses">
    <sch:rule context="p:PstlAdr[p:AdrLine or not(p:TwnNm and p:Ctry)] | p:Adr[p:AdrLine or not(p:TwnNm and p:Ctry)]">
      <!-- .09 RmtLctnDtls/PstlAdr is a name and address (Nm, Adr): its Adr is checked instead -->
      <sch:let name="is-address" value="empty(p:Adr)"/>
      <sch:let name="lines" value="p:AdrLine"/>
      <sch:let name="structured" value="p:*[not(local-name() = ('AdrTp', 'AdrLine', 'Ctry'))]"/>
      <sch:let name="unstructured" value="$is-address and empty($structured) and exists($lines)"/>
      <sch:let name="checked" value="$is-address and (exists($structured) or (not($unstructured-ok) and empty($lines)))"/>
      <sch:let name="no-twn" value="empty(p:TwnNm)"/>
      <sch:let name="no-ctry" value="empty(p:Ctry)"/>
      <!-- StrtNm, PstCd, TwnNm repeated in an AdrLine, compared as whole words ("Wien" is not in
           "Wiener Strasse"); values of fewer than 3 letters or digits are not compared.
           JavaScript: js/validation/functions/stage4.js -->
      <sch:let name="repeated" value="if ($checked and exists($lines)) then js:tpAddressRepeats(.) else ''"/>

      <sch:assert id="R4.30-unstructured" role="error" flag="CH16"
                  test="not($unstructured) or $unstructured-ok">
        The address has only address lines (AdrLine). Unstructured addresses are not accepted
        (setting guideline.unstructuredAddress): give at least the town (TwnNm) and the country (Ctry).
      </sch:assert>

      <sch:assert id="R4.30-missing" role="error" flag="CH16"
                  test="not($checked) or not($no-twn or $no-ctry)">
        The address has no <sch:value-of select="string-join(('town (TwnNm)'[$no-twn], 'country (Ctry)'[$no-ctry]), ' and no ')"/>.
        A structured or hybrid address needs both.
      </sch:assert>

      <sch:assert id="R4.30-lines" role="error" flag="CH16"
                  test="not($checked) or count($lines) le 2">
        The address has <sch:value-of select="count($lines)"/> address lines (AdrLine) besides its
        structured elements. A hybrid address may have at most 2.
      </sch:assert>

      <sch:assert id="R4.30-repeat" role="error" flag="CH16"
                  test="not($checked) or $repeated = ''">
        An address line (AdrLine) repeats what the structured elements of the address already
        give (<sch:value-of select="$repeated"/>).
      </sch:assert>
    </sch:rule>
  </sch:pattern>

</sch:schema>

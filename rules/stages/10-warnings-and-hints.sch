<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 10: warnings and hints.
  Source of truth: validation catalogue, stage 10 (docs/specs/M2.md, section 4).
  Stage 10 never rejects: warnings (10.1, 10.3) and information. 10.4 is the
  same check as 5.2 and 10.5 as 6.2 part "ignored"; they have no rule here.
  RX.1 (EndToEndId NOTPROVIDED) is from M1 and not in the catalogue.
  Written for pain.001.001.03; the build compiles a .09 variant. The version
  of the file is read from the namespace (ends with .03 or .09): the build
  replaces the whole .03 namespace text, so never compare with it here.

  Settings (config/settings.json, country files): hints.truncateLength (10.3),
  hints.recommend.address|purpose|lei|ultimate (10.6), hints.nearLimitShare and
  limits.max* (10.9), hints.version03 (10.8); country holidays (10.1) and
  cutOff (10.2, format in js/validation/functions/stage10.js).
  Business days and cut-off times do not apply to SEPA Instant (24/7).
-->
<?testing-portal stage="10" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 10: warnings and hints</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <sch:let name="today" value="string(js:tpToday())"/>
  <sch:let name="now-time" value="substring(string(js:tpNow()), 12, 5)"/>
  <!-- 10.9: share of a limit (0.9), empty if not set -->
  <sch:let name="share-raw" value="string(js:tpSetting('hints.nearLimitShare'))"/>
  <sch:let name="share" value="if ($share-raw castable as xs:decimal and xs:decimal($share-raw) gt 0) then xs:decimal($share-raw) else ()"/>
  <sch:let name="max-tx-raw" value="string(js:tpSetting('limits.maxTransactionsPerFile'))"/>
  <sch:let name="max-blocks-raw" value="string(js:tpSetting('limits.maxBlocksPerFile'))"/>
  <sch:let name="max-per-block-raw" value="string(js:tpSetting('limits.maxTransactionsPerBlock'))"/>
  <sch:let name="max-tx" value="if ($max-tx-raw castable as xs:integer) then xs:integer($max-tx-raw) else ()"/>
  <sch:let name="max-blocks" value="if ($max-blocks-raw castable as xs:integer) then xs:integer($max-blocks-raw) else ()"/>
  <sch:let name="max-per-block" value="if ($max-per-block-raw castable as xs:integer) then xs:integer($max-per-block-raw) else ()"/>
  <!-- 10.6: recommended data, each part switched by a setting -->
  <sch:let name="rec-address" value="js:tpSetting('hints.recommend.address') = true()"/>
  <sch:let name="rec-purpose" value="js:tpSetting('hints.recommend.purpose') = true()"/>
  <sch:let name="rec-lei" value="js:tpSetting('hints.recommend.lei') = true()"/>
  <sch:let name="rec-ultimate" value="js:tpSetting('hints.recommend.ultimate') = true()"/>
  <!-- 10.6 address: an unstructured address is a warning of 7.8 (SEPA) and 7.18 (cross-border), or an error if switched off -->
  <sch:let name="unstructured-allowed" value="not(js:tpSetting('guideline.unstructuredAddress') = false())"/>

  <!-- ===================================================== group header -->
  <sch:pattern id="file">
    <sch:rule context="p:GrpHdr">
      <!-- 10.8: only where the country also accepts .09 (country file "versions"; not set = accepted) -->
      <sch:let name="versions" value="js:tpCountry('versions')"/>
      <sch:report id="R10.8" role="information"
                  test="ends-with(namespace-uri(), '.03') and js:tpSetting('hints.version03') = true() and (empty($versions) or $versions = '09')">
        This file uses pain.001.001.03 (ISO 20022 version 2009). The bank also accepts
        pain.001.001.09 (version 2019), which has structured addresses, the LEI and the UETR;
        plan the change to .09.
      </sch:report>

      <sch:let name="n-tx" value="count(../p:PmtInf/p:CdtTrfTxInf)"/>
      <sch:let name="n-blocks" value="count(../p:PmtInf)"/>
      <!-- above the limit is an error of 6.5 -->
      <sch:report id="R10.9-transactions" role="information"
                  test="exists($share) and exists($max-tx) and $n-tx le $max-tx and $n-tx ge $share * $max-tx">
        The file has <sch:value-of select="$n-tx"/> transactions, close to the limit of
        <sch:value-of select="$max-tx"/> transactions per file.
      </sch:report>
      <sch:report id="R10.9-blocks" role="information"
                  test="exists($share) and exists($max-blocks) and $n-blocks le $max-blocks and $n-blocks ge $share * $max-blocks">
        The file has <sch:value-of select="$n-blocks"/> payment blocks, close to the limit of
        <sch:value-of select="$max-blocks"/> payment blocks per file.
      </sch:report>

      <sch:let name="hybrid" value="for $a in (p:InitgPty, p:FwdgAgt/p:FinInstnId)/p:PstlAdr return if (exists($a/p:AdrLine) and exists($a/p:*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])) then local-name(if ($a/parent::p:FinInstnId) then $a/../.. else $a/..) else ()"/>
      <sch:report id="R10.7" role="information" test="exists($hybrid)">
        Group header: the address of <sch:value-of select="string-join($hybrid, ', ')"/> combines structured elements
        with address lines (AdrLine), a hybrid address. A fully structured address is recommended.
      </sch:report>

      <sch:let name="trunc" value="string(js:tpTruncated(.))"/>
      <sch:report id="R10.3" role="warning" test="$trunc != ''">
        Group header: text that CMIplus would shorten: <sch:value-of select="$trunc"/>.
      </sch:report>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== payment block -->
  <sch:pattern id="block">
    <sch:rule context="p:PmtInf">
      <sch:let name="id" value="normalize-space(p:PmtInfId[1])"/>
      <sch:let name="txs" value="p:CdtTrfTxInf"/>
      <!-- .03: ReqdExctnDt is the date; .09: ReqdExctnDt/Dt, or the first 10 characters of ReqdExctnDt/DtTm -->
      <sch:let name="rd" value="p:ReqdExctnDt[1]"/>
      <sch:let name="date" value="if ($rd/p:DtTm) then substring(normalize-space($rd/p:DtTm[1]), 1, 10) else if ($rd/p:Dt) then normalize-space($rd/p:Dt[1]) else normalize-space($rd)"/>
      <!-- a date in the past is an error of 4.10; a date the XSD rejects is left to the XSD -->
      <sch:let name="date-ok" value="$date castable as xs:date and $date ge $today"/>
      <!-- business days matter for every payment except SEPA Instant; TARGET for EUR payments -->
      <sch:let name="not-instant" value="$txs[js:tpPaymentType(.) != 'SEPA_INST']"/>
      <sch:let name="target" value="exists($not-instant[(p:Amt[1]/p:InstdAmt[1]/@Ccy, p:Amt[1]/p:EqvtAmt[1]/p:CcyOfTrf[1])[1] = 'EUR'])"/>
      <sch:let name="non-business" value="if ($date-ok and exists($not-instant)) then string(js:tpNonBusinessDay($date, $target)) else ''"/>
      <sch:report id="R10.1" role="warning" test="$non-business != ''">
        Payment block <sch:value-of select="$id"/>: the requested execution date
        <sch:value-of select="$date"/> is <sch:value-of select="$non-business"/>. CMIplus moves
        the execution to the next business day.
      </sch:report>

      <sch:let name="cut-off" value="if ($date-ok and $date = $today and $non-business = '') then string(js:tpCutOff(.)) else ''"/>
      <sch:report id="R10.2" role="information" test="$cut-off != '' and $now-time ge $cut-off">
        Payment block <sch:value-of select="$id"/>: the execution date is today and it is now
        <sch:value-of select="$now-time"/>, after the cut-off time of <sch:value-of select="$cut-off"/>
        (indicative). The payments may be executed on the next business day.
      </sch:report>

      <sch:report id="R10.6-lei" role="information"
                  test="$rec-lei and ends-with(namespace-uri(), '.09') and empty(p:Dbtr[1]/p:Id[1]/p:OrgId[1]/p:LEI)">
        Payment block <sch:value-of select="$id"/>: the debtor has no LEI. The LEI
        (Dbtr/Id/OrgId/LEI) is recommended.
      </sch:report>

      <!-- 10.6 ultimate and 10.10: one hint per block. Without any ultimate debtor 10.6 says what
           to add; with one, or with that part switched off, 10.10 asks to check the rules. -->
      <sch:let name="initg" value="normalize-space(../p:GrpHdr[1]/p:InitgPty[1]/p:Nm[1])"/>
      <sch:let name="dbtr" value="normalize-space(p:Dbtr[1]/p:Nm[1])"/>
      <sch:let name="differ" value="$initg != '' and $dbtr != '' and upper-case($initg) != upper-case($dbtr)"/>
      <sch:let name="no-ultimate" value="empty(p:UltmtDbtr) and empty($txs/p:UltmtDbtr)"/>
      <sch:report id="R10.6-ultimate" role="information"
                  test="$rec-ultimate and $differ and $no-ultimate">
        Payment block <sch:value-of select="$id"/>: the initiating party "<sch:value-of select="$initg"/>"
        is not the debtor "<sch:value-of select="$dbtr"/>", and no ultimate debtor is given. If these
        payments are made on behalf of another party, name it as the ultimate debtor (UltmtDbtr).
      </sch:report>
      <sch:report id="R10.10" role="information"
                  test="$differ and not($rec-ultimate and $no-ultimate)">
        Payment block <sch:value-of select="$id"/>: the initiating party "<sch:value-of select="$initg"/>"
        is not the debtor "<sch:value-of select="$dbtr"/>". Check the bank's rules for payments on
        behalf of others (ultimate debtor).
      </sch:report>

      <sch:let name="n-tx" value="count($txs)"/>
      <sch:report id="R10.9-block" role="information"
                  test="exists($share) and exists($max-per-block) and $n-tx le $max-per-block and $n-tx ge $share * $max-per-block">
        Payment block <sch:value-of select="$id"/> has <sch:value-of select="$n-tx"/> transactions,
        close to the limit of <sch:value-of select="$max-per-block"/> transactions per block.
      </sch:report>

      <sch:let name="hybrid" value="for $a in (p:Dbtr, p:UltmtDbtr, p:DbtrAgt/p:FinInstnId, p:ChrgsAcctAgt/p:FinInstnId)/p:PstlAdr return if (exists($a/p:AdrLine) and exists($a/p:*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])) then local-name(if ($a/parent::p:FinInstnId) then $a/../.. else $a/..) else ()"/>
      <sch:report id="R10.7" role="information" test="exists($hybrid)">
        Payment block <sch:value-of select="$id"/>: the address of <sch:value-of select="string-join($hybrid, ', ')"/> combines structured elements
        with address lines (AdrLine), a hybrid address. A fully structured address is recommended.
      </sch:report>

      <sch:let name="trunc" value="string(js:tpTruncated(.))"/>
      <sch:report id="R10.3" role="warning" test="$trunc != ''">
        Payment block <sch:value-of select="$id"/>: text that CMIplus would shorten: <sch:value-of select="$trunc"/>.
      </sch:report>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== transaction
       One rule per transaction (each rule visit costs time on large files).
       10.7 is checked on the addresses of the header, the block and the transaction. -->
  <sch:pattern id="transaction">
    <sch:rule context="p:CdtTrfTxInf">
      <sch:let name="e2e" value="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/>
      <sch:let name="type" value="string(js:tpPaymentType(.))"/>

      <sch:let name="trunc" value="string(js:tpTruncated(.))"/>
      <sch:report id="R10.3" role="warning" test="$trunc != ''">
        Transaction <sch:value-of select="$e2e"/>: text that CMIplus would shorten: <sch:value-of select="$trunc"/>.
      </sch:report>

      <!-- structured: any address element but AdrLine, Ctry and AdrTp. A missing address of a
           cross-border payment and unstructured SEPA and cross-border addresses are stage 7. -->
      <sch:let name="adr" value="p:Cdtr[1]/p:PstlAdr[1]"/>
      <sch:let name="unstructured" value="exists($adr/p:AdrLine) and empty($adr/p:*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])"/>
      <sch:report id="R10.6-address" role="information"
                  test="$rec-address and exists(p:Cdtr) and $type != 'CROSS_BORDER'
                        and (empty($adr) or ($unstructured and $unstructured-allowed and not($type = ('SEPA', 'SEPA_INST'))))">
        Transaction <sch:value-of select="$e2e"/>: the creditor has <sch:value-of select="if (empty($adr)) then 'no postal address' else 'only an unstructured address (AdrLine)'"/>.
        A structured address (street, building number, post code, town, country) is recommended.
      </sch:report>

      <sch:report id="R10.6-purpose" role="information"
                  test="$rec-purpose and empty(p:Purp)">
        Transaction <sch:value-of select="$e2e"/>: no purpose code (Purp) is given. A purpose code is recommended.
      </sch:report>

      <sch:let name="hybrid" value="for $a in .//p:PstlAdr return if (exists($a/p:AdrLine) and exists($a/p:*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])) then local-name(if ($a/parent::p:FinInstnId) then $a/../.. else $a/..) else ()"/>
      <sch:report id="R10.7" role="information" test="exists($hybrid)">
        Transaction <sch:value-of select="$e2e"/>: the address of <sch:value-of select="string-join($hybrid, ', ')"/> combines structured elements
        with address lines (AdrLine), a hybrid address. A fully structured address is recommended.
      </sch:report>

      <!-- NOT IN THE CATALOGUE: placeholder id, no reason code. Since M2 on the transaction (M1: its PmtId). -->
      <sch:report id="RX.1" role="information"
                  test="$e2e = 'NOTPROVIDED'">
        No end-to-end id is provided for this transaction. The beneficiary will
        not receive a reference from you.
      </sch:report>
    </sch:rule>
  </sch:pattern>

</sch:schema>

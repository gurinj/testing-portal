<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 7: payment-type rules.
  Source of truth: validation catalogue, stage 7; docs/specs/M2.md, section 4.
  Written for pain.001.001.03; the build compiles a .09 variant. Where the
  versions differ, the XPath covers both: BIC (.03) or BICFI (.09);
  ReqdExctnDt (.03 date) or ReqdExctnDt/Dt or /DtTm (.09); SvcLvl repeats in .09.

  Every rule runs for the payment type of its transaction, from
  js:tpPaymentType(.) (stage 3, js/validation/functions/payment-type.js),
  the same function that sets the type in the report. Since M2 the M1 rules
  7.1, 7.4 and 7.6 also use it: before, "SEPA" meant service level SEPA only;
  now it also covers EUR payments between SEPA countries without a service
  level (docs/specs/M2.md, section 2).

  The currency of a transaction is that of InstdAmt, or EqvtAmt/CcyOfTrf
  (the currency of the transfer), as for the payment type.

  Values the XSD rejects are left to the XSD (docs/RULES.md, rule 8): IBANs,
  BICs and currencies are tested against their XSD pattern before their
  characters are read, codes outside the ISO lists are left to 4.36/4.37.

  Performance (docs/RULES.md), measured on 10,000 transactions:
  - SaxonJS evaluates every sch:let that a test uses, and every assert, for
    every node of the rule. So the transaction rules are one per payment type,
    with the type as a condition on the transaction itself (cached).
  - The block's own elements are read from $head, the elements before the
    first transaction: $blk/p:PmtTpInf[1] walks all children of the block
    when the block has no PmtTpInf (10,000 transactions: 27 s).
  - Block-wide checks ask js:tpBlockType(..) first (one call per block).
  - Regular expressions are literals.
-->
<?testing-portal stage="7" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 7: payment-type rules</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <!-- the selected country and its file (config/countries/<CC>.json) -->
  <sch:let name="cc" value="js:tpSelectedCountry()"/>
  <sch:let name="local-ccy" value="string(js:tpCountry('currency'))"/>
  <sch:let name="high-value" value="if (js:tpCountry('domestic.highValueThreshold') castable as xs:decimal) then xs:decimal(js:tpCountry('domestic.highValueThreshold')) else ()"/>
  <sch:let name="domestic-lists" value="js:tpCountryListed('domestic.serviceLevels') or js:tpCountryListed('domestic.localInstruments')"/>
  <!-- time of the check (fixed in the tests) -->
  <sch:let name="today" value="js:tpToday()"/>
  <!-- settings (config/settings.json); null switches the check off -->
  <sch:let name="sepa-min" value="if (js:tpSetting('limits.sepaMinAmount') castable as xs:decimal) then xs:decimal(js:tpSetting('limits.sepaMinAmount')) else ()"/>
  <sch:let name="sepa-max" value="if (js:tpSetting('limits.sepaMaxAmount') castable as xs:decimal) then xs:decimal(js:tpSetting('limits.sepaMaxAmount')) else ()"/>
  <sch:let name="instant-max" value="if (js:tpSetting('limits.instantMaxAmount') castable as xs:decimal) then xs:decimal(js:tpSetting('limits.instantMaxAmount')) else ()"/>
  <sch:let name="scheduled-instant" value="string(js:tpSetting('guideline.scheduledInstant')) = 'true'"/>
  <!-- unstructured addresses still accepted (warnings 7.8, 7.18); if false, 4.30 reports them instead -->
  <sch:let name="unstructured-ok" value="string(js:tpSetting('guideline.unstructuredAddress')) = 'true'"/>
  <sch:let name="retired" value="js:tpSetting('crossBorder.retiredCurrencies')"/>
  <sch:let name="purpose-for" value="js:tpSetting('crossBorder.purposeRequiredFor')"/>
  <!-- the element names that end the paths in crossBorder.truncateLength (Nm, AdrLine) and the shortest length:
       js:tpLimit is called only for these elements when they are longer (speed) -->
  <sch:let name="trunc-names" value="js:tpLimitNames('crossBorder.truncateLength')"/>
  <sch:let name="trunc-min" value="js:tpMinLimit('crossBorder.truncateLength')"/>

  <!-- ===================================================== transactions, one rule per payment type
       The type is a condition on the transaction itself (js:tpPaymentType is cached per transaction);
       the rules exclude each other, so a transaction runs the checks of its type only. -->

  <sch:pattern id="transaction">
  <!-- ============ SEPA credit transfer and SEPA Instant -->
    <sch:rule context="p:CdtTrfTxInf[js:tpPaymentType(.) = ('SEPA', 'SEPA_INST')]">
      <sch:let name="type" value="js:tpPaymentType(.)"/>
      <sch:let name="e2e" value="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/>
      <sch:let name="head" value="../p:CdtTrfTxInf[1]/preceding-sibling::*"/>
      <sch:let name="instd" value="p:Amt[1]/p:InstdAmt[1]"/>
      <sch:let name="eqvt" value="if ($instd) then () else p:Amt[1]/p:EqvtAmt[1]"/>
      <!-- currency of the transfer; a code that is not 3 capital letters is an XSD error (2.7) -->
      <sch:let name="ccy" value="if ($instd) then string($instd/@Ccy) else string($eqvt/p:CcyOfTrf[1])"/>
      <!-- a currency that is not in ISO 4217 is reported by 4.23 only (review 2026-11-19) -->
      <sch:let name="ccy-ok" value="matches($ccy, '^[A-Z]{3}$') and js:tpIn('currencies', $ccy)"/>
      <!-- the amount in EUR: InstdAmt in EUR, or EqvtAmt in EUR transferred in EUR -->
      <sch:let name="eur-node" value="($instd[@Ccy = 'EUR'], $eqvt[p:CcyOfTrf[1] = 'EUR']/p:Amt[1][@Ccy = 'EUR'])[1]"/>
      <sch:let name="eur" value="if ($eur-node castable as xs:decimal) then xs:decimal($eur-node) else ()"/>
      <!-- the charge bearer of the transaction, else of the block; other values than DEBT, CRED, SHAR, SLEV: XSD (2.8) -->
      <sch:let name="chrg-br" value="normalize-space((p:ChrgBr[1], $head[self::p:ChrgBr])[1])"/>
      <sch:let name="cdtr-id" value="p:CdtrAcct[1]/p:Id[1]"/>
      <sch:let name="cdtr-iban" value="string($cdtr-id/p:IBAN[1])"/>
      <sch:let name="iban-ok" value="matches($cdtr-iban, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')"/>

      <sch:assert id="R7.1" role="error" flag="AM03"
                  test="$type = 'SEPA_INST' or not($ccy-ok) or $ccy = 'EUR'">
        Transaction <sch:value-of select="$e2e"/>: a SEPA credit transfer
        must be in EUR, but the currency is <sch:value-of select="$ccy"/>.
      </sch:assert>

      <!-- the account is a choice of IBAN or Othr; neither or both is an XSD error (2.5) -->
      <sch:assert id="R7.2" role="error" flag="AC03"
                  test="if ($cdtr-id/p:IBAN) then not($iban-ok) or js:tpIn('sepa', substring($cdtr-iban, 1, 2)) else empty($cdtr-id/p:Othr)">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): the creditor account must be an
        IBAN of a SEPA country, but <sch:value-of select="if ($cdtr-id/p:IBAN) then concat('the IBAN ', $cdtr-iban, ' is from ', substring($cdtr-iban, 1, 2), ', which is not in the SEPA scheme.') else concat('it is given as ', normalize-space($cdtr-id/p:Othr[1]/p:Id[1]), ', which is not an IBAN.')"/>
      </sch:assert>

      <!-- service level codes of block and transaction (SvcLvl repeats in .09); codes outside the ISO list: 4.36 -->
      <sch:let name="other-svc" value="if ($type = 'SEPA') then ($head[self::p:PmtTpInf]/p:SvcLvl/p:Cd, p:PmtTpInf[1]/p:SvcLvl/p:Cd)[. != 'SEPA'][js:tpIn('serviceLevel', string(.))] else ()"/>
      <sch:assert id="R7.3" role="error" flag="FF04"
                  test="empty($other-svc)">
        Transaction <sch:value-of select="$e2e"/>: a SEPA credit transfer must have service level SEPA, but
        <sch:value-of select="string-join(distinct-values($other-svc), ' and ')"/> is given.
      </sch:assert>

      <!-- SEPA by its service level or local instrument (explicit): an error. A EUR payment between SEPA
           countries without them (SEPA by payment type only) may be sent another way: a warning
           (merge 2026-11-18, to confirm with the bank's files). -->
      <sch:let name="explicit" value="$type = 'SEPA_INST' or ($head[self::p:PmtTpInf]/p:SvcLvl/p:Cd, p:PmtTpInf[1]/p:SvcLvl/p:Cd) = 'SEPA'"/>
      <sch:assert id="R7.4" role="error" flag="CH16"
                  test="not($explicit) or not($chrg-br = ('DEBT', 'CRED', 'SHAR'))">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): the charge bearer must be SLEV,
        but it is <sch:value-of select="$chrg-br"/>.
      </sch:assert>
      <sch:assert id="R7.4-implicit" role="warning" flag="CH16"
                  test="$explicit or not($chrg-br = ('DEBT', 'CRED', 'SHAR'))">
        Transaction <sch:value-of select="$e2e"/>: a EUR payment to a SEPA country without service level SEPA is treated as a SEPA
        credit transfer, which needs charge bearer SLEV; it is <sch:value-of select="$chrg-br"/>. Use SLEV, or say how the payment
        should be sent (service level).
      </sch:assert>

      <!-- an amount of zero is reported by 4.21, not here -->
      <sch:assert id="R7.5" role="error" flag="AM02"
                  test="empty($eur) or ((empty($sepa-min) or $eur le 0 or $eur ge $sepa-min) and (empty($sepa-max) or $eur le $sepa-max))">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): the amount
        <sch:value-of select="normalize-space($eur-node)"/> EUR is
        <sch:value-of select="if (exists($sepa-max) and $eur gt $sepa-max) then concat('above the SEPA maximum of ', $sepa-max, ' EUR (setting limits.sepaMaxAmount).') else concat('below the SEPA minimum of ', $sepa-min, ' EUR (setting limits.sepaMinAmount).')"/>
      </sch:assert>

      <!-- 7.6 part name: the creditor here; debtor and ultimate parties on their name elements (pattern names) -->
      <sch:let name="cdtr-nm" value="string(p:Cdtr[1]/p:Nm[1])"/>
      <!-- a name already limited to 70 or less by 6.4 (guideline.maxLength) is reported there only -->
      <sch:assert id="R7.6-name" role="error" flag="CH15"
                  test="string-length($cdtr-nm) le 70 or js:tpLengthCovered(p:Cdtr[1]/p:Nm[1], 70)">
        Transaction <sch:value-of select="$e2e"/>: the creditor name has <sch:value-of select="string-length($cdtr-nm)"/> characters;
        SEPA payments allow at most 70: "<sch:value-of select="$cdtr-nm"/>".
      </sch:assert>

      <!-- left to 4.38 when guideline.remittance allows at most one Ustrd or one Strd (the default) -->
      <sch:assert id="R7.6-rmt" role="error" flag="CH15"
                  test="count(p:RmtInf[1]/p:Ustrd) + count(p:RmtInf[1]/p:Strd) le 1 or js:tpRemittanceCovered()">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): the remittance information has
        <sch:value-of select="count(p:RmtInf[1]/p:Ustrd)"/> unstructured and <sch:value-of select="count(p:RmtInf[1]/p:Strd)"/>
        structured parts. SEPA allows one unstructured text of up to 140 characters or one structured reference.
      </sch:assert>

      <!-- unstructured: address lines and no structured element; AdrTp and a country code may come with them
           (the former SEPA format). The same definition as 4.30, which checks all other addresses.
           The creditor's address here, the debtor's in pattern addresses. -->
      <sch:let name="cdtr-adr" value="p:Cdtr[1]/p:PstlAdr[1]"/>
      <sch:assert id="R7.8" role="warning"
                  test="not($unstructured-ok) or empty($cdtr-adr/p:AdrLine) or exists($cdtr-adr/*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])">
        Transaction <sch:value-of select="$e2e"/>: the creditor address of a SEPA payment is unstructured (address lines
        only). SEPA still accepts it until the EPC sets a new end date; a structured address with at least town name
        (TwnNm) and country (Ctry) is needed then.
      </sch:assert>

      <!-- 7.9: the country of the creditor's bank is that of its BIC, else of the creditor IBAN -->
      <sch:let name="cdtr-bank" value="if (exists($head[self::p:Dbtr]/p:PstlAdr[1]/*[normalize-space(.) != ''])) then ''
            else for $b in string((p:CdtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1])
            return if (matches($b, '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')) then substring($b, 5, 2) else if ($iban-ok) then substring($cdtr-iban, 1, 2) else ''"/>
      <sch:assert id="R7.9" role="error" flag="CH21"
                  test="$cdtr-bank = '' or not(js:tpIn('sepa', $cdtr-bank)) or js:tpIn('eea', $cdtr-bank)">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): the creditor's bank is in
        <sch:value-of select="$cdtr-bank"/>, a SEPA country outside the EEA, so the debtor's address is required,
        but payment block <sch:value-of select="normalize-space(../p:PmtInfId[1])"/> has no debtor address.
      </sch:assert>

      <!-- SEPA Instant; 7.11 on the execution date (pattern block) -->
      <sch:assert id="R7.10" role="error" flag="FF05"
                  test="$type = 'SEPA' or not($ccy-ok) or $ccy = 'EUR'">
        Transaction <sch:value-of select="$e2e"/>: a SEPA Instant payment (local instrument INST) must be in EUR,
        but the currency is <sch:value-of select="$ccy"/>.
      </sch:assert>

      <sch:assert id="R7.12" role="error" flag="AM02"
                  test="$type = 'SEPA' or empty($instant-max) or empty($eur) or $eur le $instant-max">
        Transaction <sch:value-of select="$e2e"/>: the amount <sch:value-of select="normalize-space($eur-node)"/> EUR is above
        the limit for SEPA Instant payments of <sch:value-of select="$instant-max"/> EUR (setting limits.instantMaxAmount).
      </sch:assert>
    </sch:rule>

  <!-- ============ domestic standard and urgent -->
    <sch:rule context="p:CdtTrfTxInf[js:tpPaymentType(.) = ('DOMESTIC', 'DOMESTIC_URGENT')]">
      <sch:let name="type" value="js:tpPaymentType(.)"/>
      <sch:let name="e2e" value="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/>
      <sch:let name="head" value="../p:CdtTrfTxInf[1]/preceding-sibling::*"/>
      <sch:let name="instd" value="p:Amt[1]/p:InstdAmt[1]"/>
      <sch:let name="eqvt" value="if ($instd) then () else p:Amt[1]/p:EqvtAmt[1]"/>
      <sch:let name="ccy" value="if ($instd) then string($instd/@Ccy) else string($eqvt/p:CcyOfTrf[1])"/>
      <sch:let name="cdtr-iban" value="string(p:CdtrAcct[1]/p:Id[1]/p:IBAN[1])"/>

      <sch:assert id="R7.13" role="error" flag="AM03"
                  test="not(matches($ccy, '^[A-Z]{3}$')) or not(js:tpIn('currencies', $ccy)) or $local-ccy = '' or $ccy = $local-ccy">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): a domestic payment in
        <sch:value-of select="$cc"/> must be in <sch:value-of select="$local-ccy"/>, but the currency is <sch:value-of select="$ccy"/>.
      </sch:assert>

      <!-- With the derivation of docs/specs/M2.md section 2 a creditor IBAN of another country makes the
           payment cross-border, so this cannot fail today; it keeps the rule if the derivation changes.
           The local account formats are country rules (stage 8). -->
      <sch:assert id="R7.14" role="error" flag="AC03"
                  test="not(matches($cdtr-iban, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) or $cc = '' or substring($cdtr-iban, 1, 2) = $cc">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>): the creditor IBAN
        <sch:value-of select="$cdtr-iban"/> is not an account in <sch:value-of select="$cc"/>.
      </sch:assert>

      <!-- country lists domestic.serviceLevels and domestic.localInstruments (null = any code); codes outside the ISO lists: 4.36, 4.37 -->
      <sch:let name="bad-codes" value="if ($domestic-lists) then (
            for $c in ($head[self::p:PmtTpInf]/p:SvcLvl/p:Cd, p:PmtTpInf[1]/p:SvcLvl/p:Cd)[js:tpIn('serviceLevel', string(.))] return
              if (js:tpCountryAllows('domestic.serviceLevels', string($c))) then () else concat('service level ', $c),
            for $c in ($head[self::p:PmtTpInf]/p:LclInstrm[1]/p:Cd[1], p:PmtTpInf[1]/p:LclInstrm[1]/p:Cd[1])[js:tpIn('localInstrument', string(.))] return
              if (js:tpCountryAllows('domestic.localInstruments', string($c))) then () else concat('local instrument ', $c)) else ()"/>
      <sch:assert id="R7.15" role="error" flag="FF04"
                  test="empty($bad-codes)">
        Transaction <sch:value-of select="$e2e"/> (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>):
        <sch:value-of select="string-join(distinct-values($bad-codes), ' and ')"/>
        <sch:value-of select="if (count(distinct-values($bad-codes)) gt 1) then ' are' else ' is'"/> not used for
        domestic payments in <sch:value-of select="$cc"/>. Allowed in <sch:value-of select="$cc"/>:
        <sch:value-of select="string-join((
            if (js:tpCountryListed('domestic.serviceLevels')) then concat('service levels ', if (exists(js:tpCountry('domestic.serviceLevels'))) then string-join(js:tpCountry('domestic.serviceLevels'), ', ') else 'none') else (),
            if (js:tpCountryListed('domestic.localInstruments')) then concat('local instruments ', if (exists(js:tpCountry('domestic.localInstruments'))) then string-join(js:tpCountry('domestic.localInstruments'), ', ') else 'none') else ()), '; ')"/>
        (country file <sch:value-of select="$cc"/>, domestic).
      </sch:assert>

      <sch:let name="local-node" value="if ($type = 'DOMESTIC' and exists($high-value)) then ($instd[@Ccy = $local-ccy], $eqvt[p:CcyOfTrf[1] = $local-ccy]/p:Amt[1][@Ccy = $local-ccy])[1] else ()"/>
      <sch:let name="local-amt" value="if ($local-node castable as xs:decimal) then xs:decimal($local-node) else ()"/>
      <sch:assert id="R7.16" role="warning"
                  test="empty($local-amt) or $local-amt le $high-value">
        Transaction <sch:value-of select="$e2e"/>: the amount <sch:value-of select="concat(normalize-space($local-node), ' ', $local-ccy)"/> is above the high-value
        threshold of <sch:value-of select="concat($high-value, ' ', $local-ccy)"/> in <sch:value-of select="$cc"/> (country file, domestic.highValueThreshold),
        but it is sent as a standard payment.
      </sch:assert>
    </sch:rule>

  <!-- ============ cross-border (SWIFT) -->
    <sch:rule context="p:CdtTrfTxInf[js:tpPaymentType(.) = 'CROSS_BORDER']">
      <sch:let name="e2e" value="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/>
      <sch:let name="head" value="../p:CdtTrfTxInf[1]/preceding-sibling::*"/>
      <sch:let name="instd" value="p:Amt[1]/p:InstdAmt[1]"/>
      <sch:let name="ccy" value="if ($instd) then string($instd/@Ccy) else string(p:Amt[1]/p:EqvtAmt[1]/p:CcyOfTrf[1])"/>
      <!-- a currency that is not in ISO 4217 is reported by 4.23 only (review 2026-11-19) -->
      <sch:let name="ccy-ok" value="matches($ccy, '^[A-Z]{3}$') and js:tpIn('currencies', $ccy)"/>
      <sch:let name="chrg-br" value="normalize-space((p:ChrgBr[1], $head[self::p:ChrgBr])[1])"/>
      <sch:let name="cdtr-id" value="p:CdtrAcct[1]/p:Id[1]"/>
      <sch:let name="cdtr-iban" value="string($cdtr-id/p:IBAN[1])"/>
      <sch:let name="cdtr-bic" value="string((p:CdtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1])"/>
      <sch:let name="cdtr-bic-ok" value="matches($cdtr-bic, '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')"/>

      <!-- a missing creditor agent is reported by 4.26 -->
      <sch:let name="cdtr-fin" value="if ($cdtr-bic-ok) then () else p:CdtrAgt[1]/p:FinInstnId[1]"/>
      <sch:let name="agent-missing" value="if (exists($cdtr-fin) and empty($cdtr-fin/(p:BIC | p:BICFI))) then (
                                             ('clearing member id')[empty($cdtr-fin/p:ClrSysMmbId[1]/p:MmbId)],
                                             ('name')[normalize-space($cdtr-fin/p:Nm[1]) = ''],
                                             ('address')[empty($cdtr-fin/p:PstlAdr[1]/*[normalize-space(.) != ''])]) else ()"/>
      <sch:assert id="R7.17" role="error" flag="RC04"
                  test="empty($agent-missing)">
        Transaction <sch:value-of select="$e2e"/>: the creditor's bank of a cross-border payment has no BIC.
        Without a BIC it needs a clearing member id, its name and its address; missing:
        <sch:value-of select="string-join($agent-missing, ', ')"/>.
      </sch:assert>

      <!-- unstructured creditor address (as 7.8); the debtor's in pattern addresses -->
      <sch:let name="cdtr-adr" value="p:Cdtr[1]/p:PstlAdr[1]"/>
      <!-- no address at all (review 2026-11-19): the catalogue's "without TwnNm and Ctry"; a missing creditor agent is 4.26 -->
      <sch:assert id="R7.18-missing" role="warning"
                  test="exists($cdtr-adr)">
        Transaction <sch:value-of select="$e2e"/>: the creditor of a cross-border payment has no postal address. Give at
        least town name (TwnNm) and country (Ctry); banks and Swift need them to process the payment.
      </sch:assert>
      <sch:assert id="R7.18" role="warning"
                  test="not($unstructured-ok) or empty($cdtr-adr/p:AdrLine) or exists($cdtr-adr/*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])">
        Transaction <sch:value-of select="$e2e"/>: the creditor address of a cross-border payment is unstructured (address
        lines only). Swift still accepts it until it sets a new date; a structured address with at least town name
        (TwnNm) and country (Ctry) is needed then.
      </sch:assert>

      <!-- Banks in the EEA and an EEA currency: charges shared (PSD2). The debtor's bank: its BIC, else the debtor
           IBAN, else the selected country; the creditor's bank: its BIC, else the creditor IBAN. -->
      <sch:let name="eea-ccy" value="$ccy-ok and js:tpIn('eeaCurrencies', $ccy)"/>
      <sch:let name="dbtr-bank" value="if (not($eea-ccy)) then '' else
            for $b in string(($head[self::p:DbtrAgt]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1]), $i in string($head[self::p:DbtrAcct]/p:Id[1]/p:IBAN[1])
            return if (matches($b, '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')) then substring($b, 5, 2) else if (matches($i, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) then substring($i, 1, 2) else $cc"/>
      <sch:let name="cdtr-bank" value="if (not($eea-ccy)) then '' else if ($cdtr-bic-ok) then substring($cdtr-bic, 5, 2) else if (matches($cdtr-iban, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) then substring($cdtr-iban, 1, 2) else ''"/>
      <sch:let name="eea-case" value="$dbtr-bank != '' and $cdtr-bank != '' and js:tpIn('eea', $dbtr-bank) and js:tpIn('eea', $cdtr-bank)"/>

      <sch:assert id="R7.19" role="error" flag="CH16"
                  test="$chrg-br != 'SLEV'">
        Transaction <sch:value-of select="$e2e"/>: a cross-border payment cannot use charge bearer SLEV, which is
        for SEPA payments. Use <sch:value-of select="if ($eea-case) then 'SHAR (both banks are in the EEA and the currency is an EEA currency)' else 'SHAR, DEBT or CRED'"/>.
      </sch:assert>

      <!-- SLEV is reported by 7.19 -->
      <sch:assert id="R7.20" role="error" flag="CH16"
                  test="not($chrg-br = ('DEBT', 'CRED')) or not($eea-case)">
        Transaction <sch:value-of select="$e2e"/>: both banks are in the EEA (<sch:value-of select="$dbtr-bank"/> and
        <sch:value-of select="$cdtr-bank"/>) and <sch:value-of select="$ccy"/> is an EEA currency, so the charges must be
        shared (SHAR), but the charge bearer is <sch:value-of select="$chrg-br"/>.
      </sch:assert>

      <!-- creditor account: an IBAN (checked by 5.6), or Othr/Id where the country of the creditor's bank
           (its BIC, else the creditor's address) does not use IBANs (IBAN registry) -->
      <sch:let name="othr" value="if ($cdtr-id/p:IBAN) then '' else normalize-space($cdtr-id/p:Othr[1]/p:Id[1])"/>
      <sch:let name="acct-ctry" value="if ($othr = '') then '' else if ($cdtr-bic-ok) then substring($cdtr-bic, 5, 2) else upper-case(normalize-space(p:Cdtr[1]/p:PstlAdr[1]/p:Ctry[1]))"/>
      <sch:let name="iban-country" value="$othr != '' and js:tpIbanUsed($acct-ctry)"/>
      <sch:assert id="R7.21" role="error" flag="AC03"
                  test="$othr = '' or (not($iban-country) and matches($othr, '^[A-Za-z0-9/\- ]+$'))">
        Transaction <sch:value-of select="$e2e"/>: <sch:value-of select="if ($iban-country) then concat('the creditor account ', $othr, ' is not an IBAN, but accounts in ', $acct-ctry, ' have IBANs. Give the creditor''s IBAN.') else concat('the creditor account ', $othr, ' contains characters other than letters, digits, - / and spaces.')"/>
      </sch:assert>

      <!-- destination: the creditor's country as for the payment type (IBAN, else BIC of the creditor's bank, else address) -->
      <sch:let name="dest" value="if (empty($purpose-for)) then ''
            else if (matches(normalize-space($cdtr-iban), '^[A-Za-z]{2}')) then upper-case(substring(normalize-space($cdtr-iban), 1, 2))
            else if (string-length(normalize-space($cdtr-bic)) ge 6) then upper-case(substring(normalize-space($cdtr-bic), 5, 2))
            else upper-case(normalize-space(p:Cdtr[1]/p:PstlAdr[1]/p:Ctry[1]))"/>
      <sch:assert id="R7.22" role="error" flag="RR05"
                  test="not($dest = $purpose-for) or exists(p:Purp[1]/*) or exists(p:RgltryRptg)">
        Transaction <sch:value-of select="$e2e"/>: payments to <sch:value-of select="$dest"/> need a purpose code (Purp)
        or regulatory reporting (RgltryRptg) (setting crossBorder.purposeRequiredFor).
      </sch:assert>

      <!-- a code that is no longer an active ISO 4217 code is reported by 4.23 -->
      <sch:assert id="R7.23" role="warning" flag="AM03"
                  test="not($ccy-ok) or not($ccy = $retired) or not(js:tpIn('currencies', $ccy))">
        Transaction <sch:value-of select="$e2e"/>: the currency <sch:value-of select="$ccy"/> is no longer in use
        (setting crossBorder.retiredCurrencies).
      </sch:assert>

      <sch:let name="intermediaries" value="(p:IntrmyAgt1[1], p:IntrmyAgt2[1], p:IntrmyAgt3[1])[not(p:FinInstnId[1]/(p:BIC | p:BICFI))]"/>
      <sch:assert id="R7.24" role="error" flag="RC11"
                  test="empty($intermediaries)">
        Transaction <sch:value-of select="$e2e"/>: the intermediary bank <sch:value-of select="string-join(for $a in $intermediaries return local-name($a), ', ')"/>
        of a cross-border payment has no BIC.
      </sch:assert>

      <!-- texts below the transaction; those of the block: pattern block -->
      <sch:let name="too-long" value="if (exists($trunc-names)) then (
            for $e in .//*[local-name() = $trunc-names][not(*)][string-length(normalize-space(.)) gt $trunc-min], $n in js:tpLimit($e, 'crossBorder.truncateLength')
            return if ($n gt 0 and string-length(normalize-space($e)) gt $n)
                   then concat(string-join($e/ancestor-or-self::*[count(ancestor::*) ge 4]/local-name(), '/'), ' (', string-length(normalize-space($e)), ' characters, kept ', $n, ')')
                   else ()) else ()"/>
      <sch:assert id="R7.25" role="warning" flag="RR08"
                  test="empty($too-long)">
        Transaction <sch:value-of select="$e2e"/>: a cross-border payment goes on in a format that keeps fewer
        characters, so this text may be cut: <sch:value-of select="string-join($too-long, ', ')"/>
        (setting crossBorder.truncateLength).
      </sch:assert>
    </sch:rule>

  <!-- ============ other types: hints -->
    <sch:rule context="p:CdtTrfTxInf[js:tpPaymentType(.) = ('INTRA_BANK', 'BUDGET')]">
      <sch:report id="R7.26" role="information"
                  test="js:tpPaymentType(.) = 'INTRA_BANK'">
        Transaction <sch:value-of select="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/> is an intra-bank transfer: the creditor's bank
        <sch:value-of select="string((p:CdtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1])"/> is the debtor's bank or a bank of the same group in <sch:value-of select="$cc"/>.
        The country rules of <sch:value-of select="$cc"/> for intra-bank transfers (stage 8) apply.
      </sch:report>

      <sch:report id="R7.27" role="information"
                  test="js:tpPaymentType(.) = 'BUDGET'">
        Transaction <sch:value-of select="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/> is a budget or tax payment
        (<sch:value-of select="for $g in upper-case(normalize-space((p:PmtTpInf[1]/p:CtgyPurp[1]/p:Cd[1], ../p:CdtTrfTxInf[1]/preceding-sibling::p:PmtTpInf/p:CtgyPurp[1]/p:Cd[1])[1]))
            return if ($g != '' and $g = js:tpSetting('paymentTypes.budgetCategoryPurpose')) then concat('category purpose ', $g) else concat('the creditor account ', string(p:CdtrAcct[1]/p:Id[1]/p:IBAN[1]), ' is a treasury account')"/>).
        The country rules of <sch:value-of select="$cc"/> for budget, tax and customs payments (stage 8) apply.
      </sch:report>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== payment block -->
  <sch:pattern id="block">
    <!-- the execution date is one per block: one finding per block with SEPA Instant payments -->
    <sch:rule context="p:ReqdExctnDt">
      <!-- .03: the date; .09: Dt, or DtTm whose first 10 characters are the date -->
      <sch:let name="raw-date" value="if (p:DtTm) then substring(normalize-space(p:DtTm[1]), 1, 10) else if (p:Dt) then normalize-space(p:Dt[1]) else normalize-space(.)"/>
      <!-- a date in the past is reported by 4.10 -->
      <sch:assert id="R7.11" role="error" flag="NARR"
                  test="$scheduled-instant or not($raw-date castable as xs:date) or xs:date($raw-date) le xs:date($today)
                        or not(js:tpBlockType(..) = ('SEPA_INST', 'MIXED')) or not(some $t in ../p:CdtTrfTxInf satisfies js:tpPaymentType($t) = 'SEPA_INST')">
        Payment block <sch:value-of select="normalize-space(../p:PmtInfId[1])"/>: the requested execution date
        <sch:value-of select="$raw-date"/> is in the future, but its <sch:value-of select="count(../p:CdtTrfTxInf[js:tpPaymentType(.) = 'SEPA_INST'])"/>
        SEPA Instant payments are executed on the day they are sent (<sch:value-of select="$today"/>).
        Scheduled instant payments are not supported (setting guideline.scheduledInstant).
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:PmtInf">
      <!-- texts of the block (debtor, debtor's bank, ultimate debtor …) for blocks with cross-border payments -->
      <sch:let name="too-long" value="if (exists($trunc-names)) then (
            for $e in p:CdtTrfTxInf[1]/preceding-sibling::*/descendant-or-self::*[local-name() = $trunc-names][not(*)][string-length(normalize-space(.)) gt $trunc-min], $n in js:tpLimit($e, 'crossBorder.truncateLength')
            return if ($n gt 0 and string-length(normalize-space($e)) gt $n)
                   then concat(string-join($e/ancestor-or-self::*[count(ancestor::*) ge 3]/local-name(), '/'), ' (', string-length(normalize-space($e)), ' characters, kept ', $n, ')')
                   else ()) else ()"/>
      <sch:assert id="R7.18-missing" role="warning"
                  test="exists(p:Dbtr[1]/p:PstlAdr) or not(js:tpBlockType(.) = ('CROSS_BORDER', 'MIXED')) or not(some $t in p:CdtTrfTxInf satisfies js:tpPaymentType($t) = 'CROSS_BORDER')">
        Payment block <sch:value-of select="normalize-space(p:PmtInfId[1])"/>: the debtor of its cross-border payments has no
        postal address. Give at least town name (TwnNm) and country (Ctry); banks and Swift need them to process the payment.
      </sch:assert>
      <sch:assert id="R7.25" role="warning" flag="RR08"
                  test="empty($too-long) or not(js:tpBlockType(.) = ('CROSS_BORDER', 'MIXED')) or not(some $t in p:CdtTrfTxInf satisfies js:tpPaymentType($t) = 'CROSS_BORDER')">
        Payment block <sch:value-of select="normalize-space(p:PmtInfId[1])"/>: its cross-border payments go on in a
        format that keeps fewer characters, so this text may be cut: <sch:value-of select="string-join($too-long, ', ')"/>
        (setting crossBorder.truncateLength).
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== names (7.6) -->
  <sch:pattern id="names">
    <!-- Dbtr and UltmtDbtr of a block count for its transactions; UltmtCdtr and UltmtDbtr of a transaction for that one.
         The creditor's name: in the SEPA rule above. -->
    <sch:rule context="p:Dbtr/p:Nm | p:UltmtDbtr/p:Nm | p:UltmtCdtr/p:Nm">
      <sch:assert id="R7.6-name" role="error" flag="CH15"
                  test="string-length(.) le 70 or js:tpLengthCovered(., 70) or (if (../../self::p:CdtTrfTxInf) then not(js:tpPaymentType(../..) = ('SEPA', 'SEPA_INST'))
                        else (js:tpBlockType(../..) = ('', 'DOMESTIC', 'DOMESTIC_URGENT', 'CROSS_BORDER', 'INTRA_BANK', 'BUDGET')
                              or not(some $t in ../../p:CdtTrfTxInf satisfies js:tpPaymentType($t) = ('SEPA', 'SEPA_INST'))))">
        <sch:value-of select="if (../../self::p:CdtTrfTxInf) then concat('Transaction ', normalize-space(../../p:PmtId[1]/p:EndToEndId[1])) else concat('Payment block ', normalize-space(../../p:PmtInfId[1]))"/>:
        the <sch:value-of select="if (parent::p:Dbtr) then 'debtor' else if (parent::p:UltmtDbtr) then 'ultimate debtor' else 'ultimate creditor'"/>
        name has <sch:value-of select="string-length(.)"/> characters; SEPA payments allow at most 70: "<sch:value-of select="."/>".
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== debtor address (7.8, 7.18) -->
  <sch:pattern id="debtor-address">
    <!-- unstructured as in the transaction rules; for the types of the block's transactions -->
    <sch:rule context="p:Dbtr/p:PstlAdr">
      <sch:let name="types" value="if (not($unstructured-ok) or empty(p:AdrLine) or exists(*[not(self::p:AdrLine or self::p:Ctry or self::p:AdrTp)])) then ()
            else for $b in js:tpBlockType(../..) return if ($b = 'MIXED') then distinct-values(for $t in ../../p:CdtTrfTxInf return js:tpPaymentType($t)) else $b"/>

      <sch:assert id="R7.8" role="warning"
                  test="not($types = ('SEPA', 'SEPA_INST'))">
        Payment block <sch:value-of select="normalize-space(../../p:PmtInfId[1])"/>: the debtor address of its SEPA payments
        is unstructured (address lines only). SEPA still accepts it until the EPC sets a new end date; a structured
        address with at least town name (TwnNm) and country (Ctry) is needed then.
      </sch:assert>

      <sch:assert id="R7.18" role="warning"
                  test="not($types = 'CROSS_BORDER')">
        Payment block <sch:value-of select="normalize-space(../../p:PmtInfId[1])"/>: the debtor address of its cross-border
        payments is unstructured (address lines only). Swift still accepts it until it sets a new date; a structured
        address with at least town name (TwnNm) and country (Ctry) is needed then.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

</sch:schema>

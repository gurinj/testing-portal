<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 3: country context and payment classification.
  Source of truth: validation catalogue, stage 3; docs/specs/M2.md, sections 2 and 4.
  Written for pain.001.001.03; the build compiles a .09 variant. Where the
  versions differ, the XPath covers both (BIC in .03, BICFI in .09).

  The payment type of a transaction comes from js:tpPaymentType(.)
  (js/validation/functions/payment-type.js), the same function that sets the
  type shown in the report, so rules and report always agree. Stage 7 runs
  the rules of each type.

  The selected country is js:tpSelectedCountry(); its file
  (config/countries/<CC>.json) is read through js:tpCountry(...).

  Values the XSD rejects are left to the XSD: the IBAN and BIC rules sit on
  the elements themselves, so a value that fails its XSD pattern is
  suppressed in the report, and they test the pattern again before reading
  characters out of the value.

  Performance (docs/RULES.md): plain element contexts, the payment type is
  cached per transaction; a block asks js:tpBlockType(.) first (one call per block); no JavaScript call per transaction with the default settings; regular expressions are literals.
-->
<?testing-portal stage="3" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 3: country context and payment classification</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <!-- the selected country and the settings of this stage (config/settings.json, "guideline") -->
  <sch:let name="cc" value="js:tpSelectedCountry()"/>
  <sch:let name="one-country" value="string(js:tpSetting('guideline.oneCountryPerFile')) = 'true'"/>
  <sch:let name="one-type" value="string(js:tpSetting('guideline.onePaymentTypePerBlock')) = 'true'"/>
  <!-- the country is in SEPA: the flag of its file, else the SEPA list (config/reference/payment-areas.json) -->
  <sch:let name="in-sepa" value="if (exists(js:tpCountry('sepa'))) then string(js:tpCountry('sepa')) = 'true' else js:tpIn('sepa', $cc)"/>
  <!-- a list of payment types in the country file (null: every type, SEPA types only in a SEPA country) -->
  <sch:let name="types-listed" value="js:tpCountryListed('paymentTypes')"/>
  <!-- XSD patterns, written as literals (faster): IBAN2007Identifier '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$';
       BIC of .09 '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$' (BICFIDec2014Identifier, also covers .03) -->

  <!-- ===================================================== country context -->
  <sch:pattern id="country">

    <sch:rule context="p:GrpHdr">
      <!-- The page loads config/countries/<CC>.json; a file that is missing or cannot be read
           becomes a placeholder with an "error" (js/validation/pipeline.js), in the tests an empty object. -->
      <sch:assert id="R3.1" role="error"
                  test="$cc != '' and empty(js:tpCountry('error')) and upper-case(string(js:tpCountry('code'))) = $cc">
        <sch:value-of select="if ($cc = '') then 'No country was selected for the check, so' else concat('There is no country configuration for the selected country ', $cc, ' (config/countries/', $cc, '.json), so')"/>
        its currency, payment types and country rules are not known. The file was checked with the general rules only.
      </sch:assert>

      <!-- debtor country of each block: the country of the debtor IBAN, else characters 5–6 of the debtor agent BIC -->
      <sch:let name="blocks" value="../p:PmtInf"/>
      <sch:let name="countries" value="distinct-values(for $b in $blocks,
            $i in string($b/p:DbtrAcct[1]/p:Id[1]/p:IBAN[1]),
            $c in string(($b/p:DbtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1])
          return if (matches($i, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) then substring($i, 1, 2) else if (matches($c, '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')) then substring($c, 5, 2) else ())"/>
      <!-- 3.2 and 3.3 already report every block whose debtor is not in the selected country, so 3.4 only
           reports when both are switched off in settings.checks (review 2026-11-19: one problem, one finding) -->
      <sch:assert id="R3.4" role="error" flag="NARR"
                  test="not($one-country) or count($countries) le 1 or (js:tpCheckOn('3.2') and js:tpCheckOn('3.3'))">
        The payment blocks of this file have debtors in <sch:value-of select="count($countries)"/> countries:
        <sch:value-of select="string-join(for $k in $countries return concat($k, ' (', string-join(for $b in $blocks,
            $i in string($b/p:DbtrAcct[1]/p:Id[1]/p:IBAN[1]),
            $c in string(($b/p:DbtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1])
          return if ((if (matches($i, '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) then substring($i, 1, 2) else if (matches($c, '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')) then substring($c, 5, 2) else '') = $k) then concat('block ', normalize-space($b/p:PmtInfId[1])) else (), ', '), ')'), '; ')"/>.
        A file may contain payments of one country only (setting guideline.oneCountryPerFile).
      </sch:assert>
    </sch:rule>

    <!-- DbtrAcct occurs only in the payment block -->
    <sch:rule context="p:DbtrAcct/p:Id/p:IBAN">
      <sch:assert id="R3.2" role="error" flag="NARR"
                  test="not(matches(., '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')) or $cc = '' or substring(., 1, 2) = $cc">
        Payment block <sch:value-of select="normalize-space(../../../p:PmtInfId[1])"/>: the debtor account
        <sch:value-of select="."/> is an account in <sch:value-of select="substring(., 1, 2)"/>, but the file is
        checked for <sch:value-of select="$cc"/>.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:DbtrAgt/p:FinInstnId/p:BIC | p:DbtrAgt/p:FinInstnId/p:BICFI">
      <sch:assert id="R3.3" role="error" flag="RC03"
                  test="not(matches(., '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')) or $cc = '' or substring(., 5, 2) = $cc">
        Payment block <sch:value-of select="normalize-space(../../../p:PmtInfId[1])"/>: the debtor's bank
        <sch:value-of select="."/> is a bank in <sch:value-of select="substring(., 5, 2)"/>, but the file is
        checked for <sch:value-of select="$cc"/>.
      </sch:assert>
    </sch:rule>

  </sch:pattern>

  <!-- ===================================================== payment type -->
  <sch:pattern id="classification">

    <sch:rule context="p:CdtTrfTxInf">
      <sch:let name="type" value="js:tpPaymentType(.)"/>
      <sch:let name="e2e" value="normalize-space(p:PmtId[1]/p:EndToEndId[1])"/>

      <sch:assert id="R3.5" role="error" flag="FF03"
                  test="$type != ''">
        Transaction <sch:value-of select="$e2e"/>: the payment type cannot be determined. The creditor's
        country is not known (no creditor IBAN, creditor agent BIC or creditor address country), and the currency
        <sch:value-of select="concat((p:Amt[1]/p:InstdAmt[1]/@Ccy, p:Amt[1]/p:EqvtAmt[1]/p:CcyOfTrf[1], '(none)')[1], if (exists(js:tpCountry('currency'))) then concat(' is not the local currency ', js:tpCountry('currency'), '.') else ' cannot be compared with a local currency (none configured).')"/>
      </sch:assert>

      <!-- country "paymentTypes": a list decides; null means every type, but SEPA and SEPA Instant only in a SEPA country -->
      <sch:assert id="R3.6" role="error" flag="FF03"
                  test="$type = '' or (if ($types-listed) then js:tpCountryAllows('paymentTypes', $type) else (not($type = ('SEPA', 'SEPA_INST')) or $in-sepa))">
        Transaction <sch:value-of select="$e2e"/>: the payment type "<sch:value-of select="js:tpPaymentTypeLabel($type)"/>"
        is not offered in <sch:value-of select="$cc"/><sch:value-of select="if ($types-listed) then concat(' (country file ', $cc, ', paymentTypes: ', string-join(js:tpCountry('paymentTypes'), ', '), ').') else ', which is not in the SEPA scheme.'"/>
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:PmtInf">
      <!-- transactions whose type cannot be determined are reported by 3.5 and do not count here; intra-bank and
           budget payments travel with the other payments of a block and do not make it mixed (review 2026-11-19) -->
      <sch:let name="types" value="if ($one-type and js:tpBlockType(.) = 'MIXED') then distinct-values(for $t in p:CdtTrfTxInf return js:tpPaymentType($t))[. != '' and not(. = ('INTRA_BANK', 'BUDGET'))] else ()"/>
      <sch:assert id="R3.7" role="error" flag="FF03"
                  test="count($types) le 1">
        Payment block <sch:value-of select="normalize-space(p:PmtInfId[1])"/> mixes payment types:
        <sch:value-of select="string-join(for $k in $types return concat(js:tpPaymentTypeLabel($k), ': ', count(p:CdtTrfTxInf[js:tpPaymentType(.) = $k])), ', ')"/>.
        Put the payments of each type in a block of their own (setting guideline.onePaymentTypePerBlock).
      </sch:assert>
    </sch:rule>

  </sch:pattern>

</sch:schema>

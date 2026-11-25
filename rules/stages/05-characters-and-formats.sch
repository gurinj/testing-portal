<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 5: character set, identifiers and field formats.
  Source of truth: validation catalogue, stage 5; docs/specs/M2.md, section 4.
  5.9 (BIC directory) is not in M2: the directory is licensed.

  Written for pain.001.001.03; the build compiles a .09 variant. Where the
  versions differ, the rules cover both:
    BIC    .03 FinInstnId/BIC, OrgId/BICOrBEI    .09 FinInstnId/BICFI, OrgId/AnyBIC
    LEI    .09 only (FinInstnId/LEI, OrgId/LEI, BrnchId/LEI)
  Values that the XSD rejects (pattern of IBAN, BIC, country code, LEI) are
  left to the XSD stage; the rules test only values the XSD accepts.

  Character set (5.1, 5.2): every text value is tested against the set of its
  payment type (js:tpTextSet): SEPA and SEPA Instant the set charsets.sepa,
  cross-border charsets.swiftX, the other types the country's characterSet.
  Values of the group header use the country's set, values of a payment block
  the SEPA set if the block is SEPA (all its transactions SEPA or SEPA
  Instant), else the country's set. A character outside the set with a plain
  Latin form (é → e, ß → ss) is 5.2 (warning), any other 5.1 (error).
  Typed values (dates, amounts, IBAN, BIC, codes with an XSD pattern; see
  TYPED in stage5.js) are left to the XSD for 5.1 and 5.2.
  Control characters are 5.3 only, spaces and line breaks at the start or the
  end 5.4 only, so one problem gives one finding.

  Performance (docs/RULES.md): 5.1–5.4 look at every leaf element, about 40
  per transaction. A rule that fires on each of them costs about 3 s on
  10,000 transactions, so the rule contexts carry a cheap test of the
  element's own value (never a condition on a parent): js:tpTextFlag accepts
  plain values at once, js:tpIbanProblem, js:tpBicCountryValid and js:tpIn
  only let wrong values through. A rule fires only where something may be
  wrong; the asserts then say what.
-->
<?testing-portal stage="5" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 5: character set, identifiers and field formats</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ (stage5.js, charset.js, iban.js, settings.js) -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <!-- elements above the level of a value, left out of the field names in messages ("Cdtr/PstlAdr/Ctry") -->
  <sch:let name="levels" value="('Document', 'CstmrCdtTrfInitn', 'GrpHdr', 'PmtInf', 'CdtTrfTxInf')"/>

  <!-- ===================================================== text values: 5.1–5.4 -->
  <sch:pattern id="text-values">
    <sch:rule context="p:*[not(*)][js:tpTextFlag(.)]">
      <sch:let name="v" value="string(.)"/>
      <sch:let name="field" value="string-join(ancestor-or-self::*[not(local-name() = $levels)]/local-name(), '/')"/>
      <sch:let name="set" value="js:tpTextSet(.)"/>
      <!-- the value without spaces and line breaks at the start and the end -->
      <sch:let name="inner" value="replace($v, '^[ \t\r\n]+|[ \t\r\n]+$', '')"/>
      <!-- control characters are 5.3, not 5.1 (in JavaScript: \p{..} classes are slow in SaxonJS) -->
      <sch:let name="bad" value="js:tpBadChars(js:tpWithoutControls($v), $set)"/>
      <sch:let name="controls" value="js:tpControlChars($inner)"/>
      <sch:let name="translit" value="js:tpTranslitChars($v, $set)"/>
      <!-- 4.1, 4.6, 4.20 and 4.28 report these elements when they are blank -->
      <!-- blank values that a stage 4 check reports: 4.1, 4.6, 4.20, 4.28, 4.15; 4.5, 4.19, 4.32 when the party has no Id either -->
      <sch:let name="blank-elsewhere" value="local-name() = ('MsgId', 'PmtInfId', 'EndToEndId') or (local-name() = 'Nm' and (local-name(..) = ('Cdtr', 'Dbtr') or (local-name(..) = ('InitgPty', 'UltmtDbtr', 'UltmtCdtr') and not(../p:Id))))"/>

      <sch:assert id="R5.1" role="error" flag="RR10"
                  test="$bad = ''">
        The value of <sch:value-of select="$field"/>, "<sch:value-of select="$v"/>", contains
        characters that are not allowed in <sch:value-of select="js:tpCharsetLabel($set)"/>:
        <sch:value-of select="$bad"/>. Allowed are <sch:value-of select="js:tpCharsetChars($set)"/>.
      </sch:assert>

      <sch:assert id="R5.2" role="warning" flag="RR10"
                  test="$translit = ''">
        The value of <sch:value-of select="$field"/>, "<sch:value-of select="$v"/>", contains
        characters outside <sch:value-of select="js:tpCharsetLabel($set)"/> that CMIplus would
        replace: <sch:value-of select="$translit"/>.
      </sch:assert>

      <sch:assert id="R5.3" role="error" flag="RR10"
                  test="$controls = ''">
        The value of <sch:value-of select="$field"/>, "<sch:value-of select="$v"/>", contains
        control characters: <sch:value-of select="$controls"/>.
      </sch:assert>

      <sch:assert id="R5.4-blank" role="error" flag="CH16"
                  test="$inner != '' or $blank-elsewhere">
        The value of <sch:value-of select="$field"/> contains only spaces.
      </sch:assert>

      <sch:assert id="R5.4-spaces" role="error" flag="CH16"
                  test="$inner = '' or $inner = $v">
        The value of <sch:value-of select="$field"/>, "<sch:value-of select="$v"/>", starts or
        ends with a space or a line break.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== reference ids: 5.5 -->
  <sch:pattern id="references">
    <!-- MsgId is only in GrpHdr, PmtInfId only in PmtInf, InstrId and EndToEndId only in PmtId -->
    <sch:rule context="p:MsgId[contains(., '/')] | p:PmtInfId[contains(., '/')] | p:InstrId[contains(., '/')] | p:EndToEndId[contains(., '/')]">
      <sch:let name="t" value="normalize-space(.)"/>
      <sch:assert id="R5.5" role="error" flag="CH16"
                  test="not(starts-with($t, '/') or ends-with($t, '/') or contains($t, '//'))">
        The <sch:value-of select="local-name()"/> "<sch:value-of select="$t"/>"
        <sch:value-of select="if (starts-with($t, '/')) then 'starts with' else if (ends-with($t, '/')) then 'ends with' else 'contains'"/>
        "<sch:value-of select="if (contains($t, '//') and not(starts-with($t, '/') or ends-with($t, '/'))) then '//' else '/'"/>".
        Reference ids must not start or end with "/" and must not contain "//".
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- ===================================================== IBAN, BIC, country code, LEI, scheme codes: 5.6–5.12 -->
  <sch:pattern id="identifiers">
    <!-- 5.6: registry country, length, mod-97 check digits, BBAN structure (js:tpIbanProblem, config/reference/iban-registry.json).
         The reason code follows the account: AC02 debtor, AC03 creditor, AC01 other accounts (agents' accounts).
         The charges account (ChrgsAcct) is 4.18 (part iban), so it is left out here. -->
    <sch:rule context="p:IBAN[js:tpIbanProblem(string(.)) != '']">
      <sch:let name="problem" value="js:tpIbanProblem(string(.))"/>
      <!-- the IBAN pattern of the XSD, the same in .03 and .09 -->
      <sch:let name="xsd-ok" value="matches(., '^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$')"/>
      <sch:let name="acct" value="local-name(../..)"/>

      <sch:assert id="R5.6-dbtr" role="error" flag="AC02"
                  test="not($xsd-ok) or $acct != 'DbtrAcct'">
        The debtor IBAN "<sch:value-of select="."/>" is not valid: <sch:value-of select="$problem"/>.
      </sch:assert>
      <sch:assert id="R5.6-cdtr" role="error" flag="AC03"
                  test="not($xsd-ok) or $acct != 'CdtrAcct'">
        The creditor IBAN "<sch:value-of select="."/>" is not valid: <sch:value-of select="$problem"/>.
      </sch:assert>
      <sch:assert id="R5.6-other" role="error" flag="AC01"
                  test="not($xsd-ok) or $acct = ('DbtrAcct', 'CdtrAcct', 'ChrgsAcct')">
        The IBAN of <sch:value-of select="$acct"/>, "<sch:value-of select="."/>", is not valid: <sch:value-of select="$problem"/>.
      </sch:assert>
    </sch:rule>

    <!-- 5.7, 5.8: agent BICs (FinInstnId/BIC, .09 BICFI) and BICs as party ids (OrgId/BICOrBEI, .09 AnyBIC) -->
    <sch:rule context="p:BIC[not(js:tpBicCountryValid(string(.))) or substring(., 8, 1) = '0']
                       | p:BICFI[not(js:tpBicCountryValid(string(.))) or substring(., 8, 1) = '0']
                       | p:BICOrBEI[not(js:tpBicCountryValid(string(.))) or substring(., 8, 1) = '0']
                       | p:AnyBIC[not(js:tpBicCountryValid(string(.))) or substring(., 8, 1) = '0']">
      <!-- the BIC patterns of both XSDs have a country code of 2 capital letters at characters 5–6 -->
      <sch:let name="xsd-ok" value="matches(., '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')"/>
      <!-- CdtrAgt for an agent's BIC, the party (Cdtr, InitgPty, …) for an organisation id -->
      <sch:let name="owner" value="if (local-name(..) = 'FinInstnId') then local-name(../..) else local-name(../../..)"/>

      <sch:assert id="R5.7" role="error" flag="RC01"
                  test="not($xsd-ok) or js:tpBicCountryValid(string(.))">
        The BIC "<sch:value-of select="."/>" of <sch:value-of select="$owner"/> has the country code
        "<sch:value-of select="substring(., 5, 2)"/>" (characters 5–6), which is not an ISO 3166 country code.
      </sch:assert>
      <sch:assert id="R5.8" role="warning" flag="RC01"
                  test="not($xsd-ok) or substring(., 8, 1) != '0'">
        The BIC "<sch:value-of select="."/>" of <sch:value-of select="$owner"/> is a test BIC:
        its 8th character is "0".
      </sch:assert>
    </sch:rule>

    <!-- 5.10: every country code; Cdtr/PstlAdr/Ctry is 4.29, RgltryRptg/Dtls/Ctry is 4.40 (part country) -->
    <sch:rule context="p:Ctry[not(js:tpIn('countries', string(.)))]
                       | p:CtryOfBirth[not(js:tpIn('countries', string(.)))]
                       | p:CtryOfRes[not(js:tpIn('countries', string(.)))]">
      <sch:let name="field" value="string-join(ancestor-or-self::*[not(local-name() = $levels)]/local-name(), '/')"/>
      <sch:let name="elsewhere" value="(local-name(..) = 'PstlAdr' and local-name(../..) = 'Cdtr') or local-name(..) = 'Dtls'"/>
      <sch:assert id="R5.10" role="error" flag="BE09"
                  test="not(matches(., '^[A-Z]{2}$')) or $elsewhere">
        The country code "<sch:value-of select="."/>" of <sch:value-of select="$field"/> is not
        an ISO 3166 country code.
      </sch:assert>
    </sch:rule>

    <!-- 5.11: .09 only; the XSD checks the 20 characters, the rule the ISO 17442 check digits -->
    <sch:rule context="p:LEI[not(js:tpLeiValid(string(.)))]">
      <sch:let name="field" value="string-join(ancestor-or-self::*[not(local-name() = $levels)]/local-name(), '/')"/>
      <sch:assert id="R5.11" role="error" flag="CH16"
                  test="not(matches(., '^[A-Z0-9]{18}[0-9]{2}$'))">
        The LEI "<sch:value-of select="."/>" of <sch:value-of select="$field"/> is not valid:
        the check digits (characters 19–20) are wrong.
      </sch:assert>
    </sch:rule>

    <!-- 5.12: scheme codes of organisation and private ids (ISO external code lists) -->
    <sch:rule context="p:OrgId/p:Othr/p:SchmeNm/p:Cd">
      <sch:assert id="R5.12-org" role="warning"
                  test="js:tpIn('organisationId', string(.))">
        The scheme code "<sch:value-of select="."/>" of the organisation id of <sch:value-of select="local-name(../../../../..)"/>
        is not in the ISO 20022 list ExternalOrganisationIdentification1Code.
      </sch:assert>
    </sch:rule>
    <sch:rule context="p:PrvtId/p:Othr/p:SchmeNm/p:Cd">
      <sch:assert id="R5.12-prvt" role="warning"
                  test="js:tpIn('personId', string(.))">
        The scheme code "<sch:value-of select="."/>" of the private id of <sch:value-of select="local-name(../../../../..)"/>
        is not in the ISO 20022 list ExternalPersonIdentification1Code.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

</sch:schema>

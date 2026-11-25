<?xml version="1.0" encoding="UTF-8"?>
<!--
  ============================================================================
  Testing Portal: sample Schematron rule file
  ============================================================================
  Message : pain.001.001.03 (ISO 20022, version 2009)
            Customer Credit Transfer Initiation
  Content : 20 example validations
  Status  : learning example. Rule ids, severities and reason codes are
            taken from the validation catalogue (state of 2026-11-10).
            The rule logic itself is still an example.

  HOW TO READ THIS FILE (the building blocks, from outside to inside)

    schema    the whole rule file
    ns        declares the namespace prefix used in the XPath expressions
    let       a named value: a constant or a calculation, used as $name
    phase     a named selection of patterns that can be run on its own
    pattern   a group of rules that belong together
    rule      selects WHICH XML elements are checked     (attribute: context)
    assert    a condition that must be TRUE              (attribute: test)
              a finding is raised when the test is false
    report    a condition that should NOT be true        (attribute: test)
              a finding is raised when the test is true

  The text inside assert / report is the message shown to the user.
  value-of inserts a value from the checked file into that message.

  CONVENTIONS USED IN THIS FILE

    id    = "R" + check id from the validation catalogue, e.g. R4.3
            (an XML id may not start with a digit)
    role  = severity: error | warning | information
            (catalogue: E | W | I)
    flag  = ISO 20022 status reason code from the catalogue

  COVERAGE NOTES (example rule compared with the catalogue check)

    R4.2   checks only "not in the future". The catalogue check also has
           a tolerance and a maximum age.
    R5.1   checks only MsgId. The catalogue check covers all text fields.
    R5.6   checks only the format and check digits of the creditor IBAN.
           The catalogue check also covers country, length per IBAN
           registry and the national BBAN structure.
    R7.6   checks only the remittance occurrences. The catalogue check
           also limits names to 70 and Ustrd to 140 characters.
    RX.1   is NOT in the catalogue (hint for EndToEndId NOTPROVIDED).

  GOOD TO KNOW

    1. Schematron does not replace the XSD. The XSD checks structure, data
       types and lengths. Schematron checks what the XSD cannot express:
       totals, duplicates, dependencies between fields, date logic.
       This file assumes the XSD check has already been done.
    2. context and test are XPath expressions. "p:" is the prefix for the
       pain.001 namespace declared below.
    3. Inside ONE pattern an element is checked by the FIRST rule whose
       context matches it, and by no other rule of that pattern. Rules in
       different patterns do not affect each other.
    4. Inside attributes write lt / le / gt / ge instead of < <= > >=
       (the character < is not allowed in an XML attribute).
  ============================================================================
-->
<!--
  ============================================================================
  M0 VERSION OF THE SAMPLE RULE FILE
  ============================================================================
  This is the 20-rule learning example (docs/reference/pain.001.001.03-sample-rules.sch)
  with three changes found in the M0 technical check. The rules themselves
  (ids, severities, reason codes, messages) are unchanged.

    1. Duplicates (R9.1, R9.3) use indexes (xsl:key) instead of counting
       every element of the file again for each element. Without this a
       file with 10,000 transactions took minutes.
    2. The IBAN check (R5.6) calls js:tpIbanValid(), a JavaScript function
       of the Testing Portal (js/validation/functions/iban.js). In SaxonJS
       the plain-XPath version cannot compute mod 97 on a 30-digit number
       exactly and reported valid IBANs as wrong.
    3. The SEPA rules (R7.1, R7.4, R7.6) use the simple context
       p:CdtTrfTxInf and test the block's service level in a let, instead
       of a condition on the parent in the context. SaxonJS matches a
       context with a condition on the parent very slowly.
  ============================================================================
-->
<?testing-portal stage="4" versions="03" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            queryBinding="xslt2"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            schemaVersion="0.1">

  <sch:title>pain.001.001.03: sample business rules for Testing Portal</sch:title>

  <!-- Namespace of the validated message. Every element name in the XPath
       expressions below carries the prefix "p:". -->
  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>
  <xsl:key name="e2e" match="p:PmtId/p:EndToEndId" use="."/>
  <xsl:key name="pmtinf" match="p:PmtInf" use="p:PmtInfId"/>


  <!-- ======================================================================
       GLOBAL VALUES: defined once, usable in every rule as $name
       ====================================================================== -->

  <sch:let name="today" value="current-date()"/>

  <!-- How many days ahead a requested execution date may be -->
  <sch:let name="max-days-ahead" value="365"/>

  <!-- Basic Latin character set commonly allowed in payment identifiers -->
  <sch:let name="allowed-chars" value="'^[A-Za-z0-9/\-?:().,''+ ]+$'"/>

  <!-- Currencies that are not written with two decimal places -->
  <sch:let name="ccy-0-decimals" value="('JPY', 'KRW', 'ISK', 'CLP', 'VND')"/>
  <sch:let name="ccy-3-decimals" value="('BHD', 'KWD', 'OMR', 'JOD', 'TND')"/>


  <!-- ======================================================================
       PHASES: optional. A phase runs only the listed patterns.
       When no phase is chosen, every pattern in the file runs.
       ====================================================================== -->

  <sch:phase id="core">
    <sch:active pattern="totals"/>
    <sch:active pattern="identifiers"/>
    <sch:active pattern="dates"/>
    <sch:active pattern="parties-and-accounts"/>
    <sch:active pattern="amounts"/>
  </sch:phase>

  <sch:phase id="sepa-only">
    <sch:active pattern="sepa"/>
  </sch:phase>


  <!-- ======================================================================
       PATTERN 1: Totals (number of transactions and control sums)
       ====================================================================== -->

  <sch:pattern id="totals">
    <sch:title>Totals in group header and payment blocks</sch:title>

    <!-- Checked once per file: the group header -->
    <sch:rule context="p:GrpHdr">

      <sch:let name="tx-count" value="count(//p:CdtTrfTxInf)"/>
      <!-- xs:decimal(.) gives exact decimal arithmetic. Without it the
           amounts would be summed as floating point numbers. -->
      <sch:let name="tx-sum" value="sum(//p:CdtTrfTxInf/p:Amt/p:InstdAmt/xs:decimal(.))"/>

      <sch:assert id="R4.3" role="error" flag="AM19"
                  test="number(p:NbOfTxs) = $tx-count">
        The number of transactions in the group header (<sch:value-of select="p:NbOfTxs"/>)
        does not match the number of transactions in the file (<sch:value-of select="$tx-count"/>).
      </sch:assert>

      <!-- "not(p:CtrlSum) or ..." means: only checked when CtrlSum is present -->
      <sch:assert id="R4.4" role="error" flag="AM16"
                  test="not(p:CtrlSum) or xs:decimal(p:CtrlSum) = $tx-sum">
        The control sum in the group header (<sch:value-of select="p:CtrlSum"/>)
        does not match the sum of all transaction amounts (<sch:value-of select="$tx-sum"/>).
      </sch:assert>

    </sch:rule>

    <!-- Checked once per payment block -->
    <sch:rule context="p:PmtInf">

      <sch:let name="block-count" value="count(p:CdtTrfTxInf)"/>
      <sch:let name="block-sum" value="sum(p:CdtTrfTxInf/p:Amt/p:InstdAmt/xs:decimal(.))"/>

      <sch:assert id="R4.7" role="error" flag="AM18"
                  test="not(p:NbOfTxs) or number(p:NbOfTxs) = $block-count">
        Payment block <sch:value-of select="p:PmtInfId"/>: the number of transactions
        (<sch:value-of select="p:NbOfTxs"/>) does not match the transactions in this
        block (<sch:value-of select="$block-count"/>).
      </sch:assert>

      <sch:assert id="R4.8" role="error" flag="AM17"
                  test="not(p:CtrlSum) or xs:decimal(p:CtrlSum) = $block-sum">
        Payment block <sch:value-of select="p:PmtInfId"/>: the control sum
        (<sch:value-of select="p:CtrlSum"/>) does not match the sum of the amounts in
        this block (<sch:value-of select="$block-sum"/>).
      </sch:assert>

    </sch:rule>
  </sch:pattern>


  <!-- ======================================================================
       PATTERN 2: Identifiers (allowed characters and duplicates)
       ====================================================================== -->

  <sch:pattern id="identifiers">
    <sch:title>Message, payment block and transaction identifiers</sch:title>

    <sch:rule context="p:GrpHdr/p:MsgId">
      <!-- "." is the element selected by the context, here MsgId -->
      <sch:assert id="R5.1" role="error" flag="RR10"
                  test="matches(., $allowed-chars)">
        The message id "<sch:value-of select="."/>" contains characters that are not
        allowed. Use only letters a-z, A-Z, digits, space and / - ? : ( ) . , ' +
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:PmtInf">
      <!-- The id of this payment block is stored in $id. The test then counts
           how many payment blocks in the file carry the same id.
           ".." means "go one level up", here to the parent of PmtInf. -->
      <sch:let name="id" value="p:PmtInfId"/>

      <sch:assert id="R9.1" role="error" flag="DU02"
                  test="count(key('pmtinf', $id)) = 1">
        The payment information id "<sch:value-of select="$id"/>" is used by more
        than one payment block. Each payment block needs its own id.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:CdtTrfTxInf/p:PmtId">

      <!-- "//" means "anywhere in the file" -->
      <sch:let name="e2e" value="p:EndToEndId"/>

      <sch:assert id="R9.3" role="warning" flag="DU04"
                  test="$e2e = 'NOTPROVIDED'
                        or count(key('e2e', $e2e)) = 1">
        The end-to-end id "<sch:value-of select="$e2e"/>" is used by more than
        one transaction in this file.
      </sch:assert>

      <!-- A report is the opposite of an assert: the finding is raised
           when the test is TRUE. Handy for hints.
           NOT IN THE CATALOGUE: this hint has no catalogue check yet,
           so it has a placeholder id and no reason code. -->
      <sch:report id="RX.1" role="information"
                  test="p:EndToEndId = 'NOTPROVIDED'">
        No end-to-end id is provided for this transaction. The beneficiary will
        not receive a reference from you.
      </sch:report>

    </sch:rule>
  </sch:pattern>


  <!-- ======================================================================
       PATTERN 3: Dates
       ====================================================================== -->

  <sch:pattern id="dates">
    <sch:title>Creation date and requested execution date</sch:title>

    <sch:rule context="p:GrpHdr">
      <sch:assert id="R4.2" role="error" flag="DT02"
                  test="xs:dateTime(p:CreDtTm) le current-dateTime()">
        The creation date and time (<sch:value-of select="p:CreDtTm"/>) is in the future.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:PmtInf">

      <sch:let name="exec-date" value="xs:date(p:ReqdExctnDt)"/>
      <sch:let name="latest-date" value="$today + $max-days-ahead * xs:dayTimeDuration('P1D')"/>

      <sch:assert id="R4.10" role="error" flag="CH04"
                  test="$exec-date ge $today">
        Payment block <sch:value-of select="p:PmtInfId"/>: the requested execution date
        (<sch:value-of select="p:ReqdExctnDt"/>) is in the past.
      </sch:assert>

      <sch:assert id="R4.11" role="error" flag="CH03"
                  test="$exec-date le $latest-date">
        Payment block <sch:value-of select="p:PmtInfId"/>: the requested execution date
        (<sch:value-of select="p:ReqdExctnDt"/>) is more than
        <sch:value-of select="$max-days-ahead"/> days in the future.
      </sch:assert>

    </sch:rule>
  </sch:pattern>


  <!-- ======================================================================
       PATTERN 4: Parties and accounts
       ====================================================================== -->

  <sch:pattern id="parties-and-accounts">
    <sch:title>Payment method, creditor and creditor account</sch:title>

    <sch:rule context="p:PmtInf">
      <!-- The XSD also allows CHK (cheque) and TRA. A credit transfer file
           is expected to use TRF. -->
      <sch:assert id="R4.9" role="error" flag="CH16"
                  test="p:PmtMtd = 'TRF'">
        Payment block <sch:value-of select="p:PmtInfId"/>: the payment method is
        "<sch:value-of select="p:PmtMtd"/>". Only TRF (credit transfer) is accepted.
      </sch:assert>
    </sch:rule>

    <sch:rule context="p:CdtTrfTxInf">

      <!-- Creditor is optional in the XSD, so the business rule makes it
           mandatory. normalize-space also catches a name of spaces only. -->
      <sch:assert id="R4.28" role="error" flag="CH21"
                  test="normalize-space(p:Cdtr/p:Nm) != ''">
        Transaction <sch:value-of select="p:PmtId/p:EndToEndId"/>: the creditor name
        is missing.
      </sch:assert>

      <!-- A test that is only a path means "this element exists" -->
      <sch:assert id="R4.31" role="error" flag="AC03"
                  test="p:CdtrAcct">
        Transaction <sch:value-of select="p:PmtId/p:EndToEndId"/>: the creditor account
        is missing.
      </sch:assert>

    </sch:rule>

    <!-- ADVANCED EXAMPLE: IBAN check digits (ISO 13616, mod 97) written in
         plain XPath. Each let builds on the one before it.
         In a real setup this is usually a function provided by the
         Testing Portal application, for example pv:iban-valid(.). -->
    <sch:rule context="p:CdtrAcct/p:Id/p:IBAN">

      <!-- 1. upper case, spaces removed -->
      <sch:let name="iban" value="upper-case(replace(., '\s', ''))"/>
      <!-- 2. move the first four characters to the end -->
      <sch:let name="moved" value="concat(substring($iban, 5), substring($iban, 1, 4))"/>
      <!-- 3. replace every letter by a number: A = 10, B = 11 ... Z = 35 -->
      <sch:let name="digits" value="string-join(
                                      for $c in string-to-codepoints($moved)
                                      return if ($c ge 65) then string($c - 55)
                                             else codepoints-to-string($c), '')"/>

      <!-- 4. the resulting number divided by 97 must leave remainder 1 -->
      <sch:assert id="R5.6" role="error" flag="AC01"
                  test="js:tpIbanValid(string(.))">
        The creditor IBAN "<sch:value-of select="."/>" is not valid: the check digits
        do not match. Please check the IBAN for typing errors.
      </sch:assert>

    </sch:rule>
  </sch:pattern>


  <!-- ======================================================================
       PATTERN 5: Amounts
       ====================================================================== -->

  <sch:pattern id="amounts">
    <sch:title>Transaction amounts</sch:title>

    <sch:rule context="p:CdtTrfTxInf/p:Amt/p:InstdAmt">

      <!-- @Ccy is the attribute Ccy of InstdAmt -->
      <sch:let name="decimals-allowed"
               value="if (@Ccy = $ccy-0-decimals) then 0
                      else if (@Ccy = $ccy-3-decimals) then 3
                      else 2"/>
      <sch:let name="decimals-used" value="string-length(substring-after(., '.'))"/>

      <sch:assert id="R4.21" role="error" flag="AM01"
                  test="xs:decimal(.) gt 0">
        The transaction amount must be greater than zero.
      </sch:assert>

      <sch:assert id="R4.22" role="error" flag="CH20"
                  test="$decimals-used le $decimals-allowed">
        The amount <sch:value-of select="."/> <sch:value-of select="@Ccy"/> has
        <sch:value-of select="$decimals-used"/> decimal places. The currency
        <sch:value-of select="@Ccy"/> allows <sch:value-of select="$decimals-allowed"/>.
      </sch:assert>

    </sch:rule>
  </sch:pattern>


  <!-- ======================================================================
       PATTERN 6: SEPA rules
       The context has a condition in [ ]: the rules apply only to
       transactions in payment blocks marked with service level SEPA.
       Other payment blocks are not touched by this pattern.
       ====================================================================== -->

  <sch:pattern id="sepa">
    <sch:title>Rules for SEPA credit transfers</sch:title>

    <sch:rule context="p:CdtTrfTxInf">
      <sch:let name="blk" value=".."/>
      <sch:let name="is-sepa" value="$blk/p:PmtTpInf[1]/p:SvcLvl[1]/p:Cd[1] = 'SEPA'"/>

      <sch:assert id="R7.1" role="error" flag="AM03"
                  test="not($is-sepa) or p:Amt/p:InstdAmt/@Ccy = 'EUR'">
        Transaction <sch:value-of select="p:PmtId/p:EndToEndId"/>: a SEPA credit transfer
        must be in EUR, but the currency is <sch:value-of select="p:Amt/p:InstdAmt/@Ccy"/>.
      </sch:assert>

      <!-- The charge bearer can be given on the payment block (../p:ChrgBr)
           or on the transaction (p:ChrgBr). Neither may differ from SLEV. -->
      <sch:assert id="R7.4" role="error" flag="CH16"
                  test="not($is-sepa) or not((p:ChrgBr, $blk/p:ChrgBr[1])[. != 'SLEV'])">
        Transaction <sch:value-of select="p:PmtId/p:EndToEndId"/>: for a SEPA credit
        transfer the charge bearer must be SLEV.
      </sch:assert>

      <sch:assert id="R7.6" role="error" flag="CH15"
                  test="not($is-sepa) or count(p:RmtInf/p:Ustrd) + count(p:RmtInf/p:Strd) le 1">
        Transaction <sch:value-of select="p:PmtId/p:EndToEndId"/>: a SEPA credit transfer
        may carry either one unstructured or one structured remittance information,
        not both and not more than one.
      </sch:assert>

    </sch:rule>
  </sch:pattern>

  <!--
    NOT SHOWN IN THIS EXAMPLE
      abstract patterns and rules   reusable rule templates
      diagnostics                   extra message texts, also per language
      include / extends             splitting rules over several files
      properties                    additional structured data per finding

    OUTPUT
      A Schematron engine returns an XML report (SVRL). For every finding it
      contains the id, role and flag of the assert, the message text and the
      XPath location of the element in the checked file.
  -->

</sch:schema>

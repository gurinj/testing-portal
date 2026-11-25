<?xml version="1.0" encoding="UTF-8"?>
<!--
  Testing Portal – stage 9: in-file consistency and duplicates.
  Source of truth: validation catalogue, stage 9 (docs/specs/M2.md, section 4).
  M1 contains 9.1 and 9.3; M2 adds 9.2, 9.4–9.8 and 9.10. 9.9 (MsgId used
  before) needs the history of the app and is not in M2.
  Written for pain.001.001.03; the build compiles a .09 variant (UETR exists
  only in .09; BIC is BICFI there; ReqdExctnDt has a Dt or DtTm child).

  Performance (docs/RULES.md): duplicates are looked up in indexes built once
  per file: xsl:keys for the blocks (no positional predicate in "match", [1]
  in "use"), a JavaScript index for the transactions (see below). A value that
  cannot be built (a missing account, an amount that is not a number) gives no
  entry. Lookups take only the first entry of a group, never count() over it,
  so a value shared by 10,000 transactions or blocks stays linear. All
  transaction checks share one rule context.
  Findings of 9.2-9.6 are reported on the transaction (CdtTrfTxInf); in M1
  9.3 was reported on its PmtId. Values are compared without spaces and case where the
  catalogue compares accounts or names.
-->
<?testing-portal stage="9" versions="03 09" countries="*"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron"
            xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
            queryBinding="xslt2">

  <sch:title>Stage 9: in-file consistency</sch:title>

  <sch:ns prefix="p"  uri="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>
  <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <!-- functions of the Testing Portal, see js/validation/functions/ -->
  <sch:ns prefix="js" uri="http://saxonica.com/ns/globalJS"/>

  <!-- 9.2–9.5: the duplicates of a transaction come from js:tpDuplicateOf
       (js/validation/functions/stage9.js), one index of the file built in one pass:
       four xsl:keys on 10,000 transactions cost 1.0–1.6 s in SaxonJS, the index 0.1–0.3 s. -->
  <xsl:key name="pmtinf" match="p:PmtInf" use="normalize-space(p:PmtInfId[1])"/>

  <!-- 9.7 and 9.8: payment blocks by debtor account (IBAN or other id, without spaces, upper case) -->
  <xsl:key name="dbtr-acct" match="p:PmtInf"
           use="let $a := upper-case(translate(string((p:DbtrAcct[1]/p:Id[1]/p:IBAN[1], p:DbtrAcct[1]/p:Id[1]/p:Othr[1]/p:Id[1])[1]), ' ', '')) return if ($a = '') then () else $a"/>
  <!-- 9.8: debtor account | execution date | payment type of the block (js:tpBlockType: '' or MIXED gives no entry) -->
  <xsl:key name="same-block" match="p:PmtInf"
           use="let $a := upper-case(translate(string((p:DbtrAcct[1]/p:Id[1]/p:IBAN[1], p:DbtrAcct[1]/p:Id[1]/p:Othr[1]/p:Id[1])[1]), ' ', '')),
                    $rd := p:ReqdExctnDt[1],
                    $date := if ($rd/p:DtTm) then substring(normalize-space($rd/p:DtTm[1]), 1, 10) else if ($rd/p:Dt) then normalize-space($rd/p:Dt[1]) else normalize-space($rd),
                    $type := string(js:tpBlockType(.))
                return if ($a = '' or $date = '' or $type = ('', 'MIXED')) then () else concat($a, '|', $date, '|', $type)"/>

  <sch:pattern id="blocks">
    <sch:rule context="p:PmtInf">
      <sch:let name="self" value="."/>
      <sch:let name="id" value="normalize-space(p:PmtInfId[1])"/>
      <sch:assert id="R9.1" role="error" flag="DU02"
                  test="$id = '' or count(key('pmtinf', $id)) = 1">
        The payment information id "<sch:value-of select="$id"/>" is used by more
        than one payment block. Each payment block needs its own id.
      </sch:assert>

      <sch:let name="acct" value="upper-case(translate(string((p:DbtrAcct[1]/p:Id[1]/p:IBAN[1], p:DbtrAcct[1]/p:Id[1]/p:Othr[1]/p:Id[1])[1]), ' ', ''))"/>
      <!-- 9.7: compared with the first block that uses the same debtor account -->
      <sch:let name="first" value="if ($acct = '') then () else key('dbtr-acct', $acct)[1]"/>
      <sch:let name="name" value="normalize-space(p:Dbtr[1]/p:Nm[1])"/>
      <sch:let name="first-name" value="normalize-space($first/p:Dbtr[1]/p:Nm[1])"/>
      <sch:assert id="R9.7" role="warning"
                  test="empty($first) or $first is $self or $name = '' or $first-name = '' or upper-case($name) = upper-case($first-name)">
        Payment block <sch:value-of select="$id"/>: the debtor name "<sch:value-of select="$name"/>" differs from
        "<sch:value-of select="$first-name"/>" in payment block <sch:value-of select="normalize-space($first/p:PmtInfId[1])"/>,
        which uses the same debtor account <sch:value-of select="$acct"/>.
      </sch:assert>

      <!-- 9.8: reported on every block after the first of its group, which it names -->
      <sch:let name="rd" value="p:ReqdExctnDt[1]"/>
      <sch:let name="date" value="if ($rd/p:DtTm) then substring(normalize-space($rd/p:DtTm[1]), 1, 10) else if ($rd/p:Dt) then normalize-space($rd/p:Dt[1]) else normalize-space($rd)"/>
      <sch:let name="type" value="string(js:tpBlockType(.))"/>
      <sch:let name="same" value="if ($acct = '' or $date = '' or $type = ('', 'MIXED')) then () else key('same-block', concat($acct, '|', $date, '|', $type))[1]"/>
      <sch:report id="R9.8" role="information"
                  test="exists($same) and not($same is $self)">
        Payment block <sch:value-of select="$id"/> has the same debtor account, execution date
        (<sch:value-of select="$date"/>) and payment type (<sch:value-of select="js:tpPaymentTypeLabel($type)"/>)
        as payment block <sch:value-of select="normalize-space($same/p:PmtInfId[1])"/>. The payments could be sent
        in one block, unless other block data (such as batch booking or charge bearer) differ.
      </sch:report>
    </sch:rule>
  </sch:pattern>

  <sch:pattern id="transactions">
    <sch:rule context="p:CdtTrfTxInf">
      <sch:let name="blk" value=".."/>
      <sch:let name="id" value="p:PmtId[1]"/>
      <sch:let name="e2e" value="normalize-space($id/p:EndToEndId[1])"/>
      <!-- another transaction of the file with the same value, or () -->
      <sch:let name="instr-other" value="js:tpDuplicateOf(., 'I')"/>
      <sch:let name="e2e-other" value="js:tpDuplicateOf(., 'E')"/>
      <sch:let name="uetr-other" value="js:tpDuplicateOf(., 'U')"/>
      <sch:let name="dup-other" value="js:tpDuplicateOf(., 'D')"/>

      <sch:assert id="R9.2" role="error" flag="DU05" test="empty($instr-other)">
        The instruction id "<sch:value-of select="normalize-space($id/p:InstrId[1])"/>" is used by more than one
        transaction in this file.
      </sch:assert>
      <sch:assert id="R9.3" role="warning" flag="DU04" test="empty($e2e-other)">
        The end-to-end id "<sch:value-of select="$e2e"/>" is used by more than
        one transaction in this file.
      </sch:assert>
      <!-- p:UETR exists only in .09 -->
      <sch:assert id="R9.4" role="error" flag="NARR" test="empty($uetr-other)">
        The UETR "<sch:value-of select="normalize-space($id/p:UETR[1])"/>" is used by more than one transaction
        in this file. Every transaction needs its own UETR.
      </sch:assert>

      <sch:assert id="R9.5" role="warning" flag="AM05" test="empty($dup-other)">
        Transaction <sch:value-of select="$e2e"/>: transaction <sch:value-of select="normalize-space($dup-other/p:PmtId[1]/p:EndToEndId[1])"/>
        has the same creditor account, amount (<sch:value-of select="let $a := (p:Amt[1]/p:InstdAmt[1], p:Amt[1]/p:EqvtAmt[1]/p:Amt[1])[1] return concat(normalize-space($a), ' ', $a/@Ccy)"/>),
        execution date and remittance information. Check that the payment is not entered twice.
      </sch:assert>

      <!-- 9.6: an IBAN identifies the account; another id only together with its bank,
           so two different agent BICs, or two different account currencies, mean two accounts.
           The details are read only when the account ids are the same. -->
      <sch:let name="cdtr-id" value="(p:CdtrAcct[1]/p:Id[1]/p:IBAN[1], p:CdtrAcct[1]/p:Id[1]/p:Othr[1]/p:Id[1])[1]"/>
      <sch:let name="dbtr-id" value="($blk/p:DbtrAcct[1]/p:Id[1]/p:IBAN[1], $blk/p:DbtrAcct[1]/p:Id[1]/p:Othr[1]/p:Id[1])[1]"/>
      <sch:assert id="R9.6" role="error" flag="NARR"
                  test="empty($cdtr-id) or empty($dbtr-id) or translate($cdtr-id, ' ', '') = '' or upper-case(translate($cdtr-id, ' ', '')) != upper-case(translate($dbtr-id, ' ', ''))
                        or (let $dc := normalize-space($blk/p:DbtrAcct[1]/p:Ccy[1]), $cc := normalize-space(p:CdtrAcct[1]/p:Ccy[1]) return $dc != '' and $cc != '' and $dc != $cc)
                        or (not(local-name($dbtr-id) = 'IBAN' and local-name($cdtr-id) = 'IBAN')
                            and (let $db := upper-case(substring(normalize-space(($blk/p:DbtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1]), 1, 8)),
                                     $cb := upper-case(substring(normalize-space((p:CdtrAgt[1]/p:FinInstnId[1]/(p:BIC | p:BICFI))[1]), 1, 8))
                                 return $db != '' and $cb != '' and $db != $cb))">
        Transaction <sch:value-of select="$e2e"/>: the creditor account <sch:value-of select="normalize-space($cdtr-id)"/>
        is the debtor's own account. A payment to the account it is paid from cannot be executed.
      </sch:assert>
    </sch:rule>

    <!-- 9.10: on the block or on the transaction -->
    <sch:rule context="p:UltmtDbtr">
      <sch:let name="nm" value="normalize-space(p:Nm[1])"/>
      <sch:let name="dbtr" value="normalize-space(ancestor::p:PmtInf[1]/p:Dbtr[1]/p:Nm[1])"/>
      <sch:report id="R9.10" role="information"
                  test="$nm != '' and upper-case($nm) = upper-case($dbtr)">
        The ultimate debtor "<sch:value-of select="$nm"/>" has the same name as the debtor. An ultimate
        debtor is only needed when the payment is made on behalf of another party.
      </sch:report>
    </sch:rule>
  </sch:pattern>

</sch:schema>

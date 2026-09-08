import { assertEquals } from "jsr:@std/assert@1";
import { Asn1DocumentFormattingEditProvider } from "../src/format.ts";
import { applyEdits, neverCancelled, openAsn1, resetAll } from "./helpers.ts";

const ASN1_BEFORE_FORMATTING = `
SelectedAttributeTypes {joint-iso-itu-t ds(  5  ) module  (1) selectedAttributeTypes(5)  9  } DEFINITIONS ::= BEGIN IMPORTS
  -- from Rec. ITU-T X.501 | ISO/IEC 9594-2

  id-at, id-avc, id, id-asx, id-cat,    id-coat, id-lmr, id-lsx, id-mr, id-not, id-pr
    FROM UsefulDefinitions
      {joint-iso-itu-t ds(5) module(1) usefulDefinitions(0) 9} WITH SUCCESSORS

  Attribute{}, ATTRIBUTE, AttributeType, AttributeValueAssertion, CONTEXT,
  ContextAssertion, DistinguishedName, distinguishedNameMatch,
  MAPPING-BASED-MATCHING{}, MATCHING-RULE, OBJECT-CLASS,
  objectIdentifierMatch, SubtreeSpecification, SupportedAttributes, SYNTAX-NAME
    FROM InformationFramework
      {joint-iso-itu-t ds(5) module(1) informationFramework(1) 9} WITH SUCCESSORS

  AttributeCombination, ContextCombination, MRMapping
    FROM ServiceAdministration
      {joint-iso-itu-t ds(5) module(1) serviceAdministration(33) 9} WITH SUCCESSORS

  AttributeTypeDescription, DITContentRuleDescription, DITStructureRuleDescription, MatchingRuleDescription, MatchingRuleUseDescription, NameFormDescription, ObjectClassDescription
    FROM SchemaAdministration
      {joint-iso-itu-t ds(5) module(1) schemaAdministration(23) 9} WITH SUCCESSORS

  -- from Rec. ITU-T X.509 | ISO/IEC 9594-8

  AlgorithmIdentifier{}, Certificate, CertificateList, CertificatePair,
  SupportedAlgorithm, SupportedAlgorithms
     FROM AuthenticationFramework
       {joint-iso-itu-t ds(5) module(1) authenticationFramework(7) 9} WITH SUCCESSORS

  G3FacsimileNonBasicParameters
    FROM PkiPmiExternalDataTypes
      {joint-iso-itu-t ds(5) module(1) pkiPmiExternalDataTypes(40) 9} WITH SUCCESSORS
 -- from Rec. ITU-T X.511 | ISO/IEC 9594-3
  FilterItem, HierarchySelections, SearchControlOptions, ServiceControlOptions
    FROM DirectoryAbstractService
      {joint-iso-itu-t ds(5) module(1) directoryAbstractService(2) 9} WITH SUCCESSORS

 -- from Rec. ITU-T X.520 | ISO/IEC 9594-6

  PwdAlphabet, PwdVocabulary, UserPwd
     FROM PasswordPolicy
       {joint-iso-itu-t ds(5) module(1) passwordPolicy(39) 9} WITH SUCCESSORS ;

message PrintableString ::= "hi mom"

END -- SelectedAttributeTypes
`;

Deno.test("formats module header, imports, and assignments conservatively", async () => {
    resetAll();
    const document = await openAsn1(ASN1_BEFORE_FORMATTING);
    const edits = await new Asn1DocumentFormattingEditProvider()
        .provideDocumentFormattingEdits(
            document,
            { tabSize: 2, insertSpaces: true },
            neverCancelled(),
        );
    if (!edits) {
        throw new Error("expected formatting edits");
    }
    const actual = applyEdits(document, edits);
    assertEquals(actual.includes("ds(  5  )"), false);
    assertEquals(actual.includes("{joint-iso-itu-t ds(5) module(1) selectedAttributeTypes(5) 9}"), true);
    assertEquals(/^DEFINITIONS ::=$/m.test(actual), true);
    assertEquals(/^BEGIN$/m.test(actual), true);
    assertEquals(/^IMPORTS$/m.test(actual), true);
    assertEquals(actual.includes('message PrintableString ::= "hi mom"'), true);
});

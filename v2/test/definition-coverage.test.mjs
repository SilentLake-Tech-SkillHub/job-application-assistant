import test from'node:test';import assert from'node:assert/strict';import{assertDefinitionMapped,matchesPageIdentity}from'../shared/definition-coverage.mjs';
test('visible fields cannot hide a missing optional or conditional official question',()=>{
 const p={companyDefinitions:{company:{definitionHash:'current',fieldIds:['basic','optional','conditional']}}},t={coverage:{officialDefinitionHash:'current'},pages:[{fields:[{schemaQuestionId:'basic'},{schemaQuestionId:'optional'}]}]};
 assert.throws(()=>assertDefinitionMapped(p,'company',t),/OFFICIAL_DEFINITION_HAS_UNMAPPED_QUESTIONS/);t.pages[0].fields.push({schemaQuestionId:'conditional'});assert.doesNotThrow(()=>assertDefinitionMapped(p,'company',t));t.coverage.officialDefinitionHash='old';assert.throws(()=>assertDefinitionMapped(p,'company',t),/OFFICIAL_DEFINITION_VERSION_NOT_BOUND/);
});
test('common editor pathname is narrowed by the actually observed role query',()=>{
 const p={pathPrefix:'/editor',roleIdentity:{parameter:'pid',value:'one'}};assert.equal(matchesPageIdentity(p,'https://example.test/editor?pid=one'),true);assert.equal(matchesPageIdentity(p,'https://example.test/editor?pid=two'),false);assert.equal(matchesPageIdentity(p,'https://example.test/other?pid=one'),false);
});

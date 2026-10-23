import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {selectorAliasDOM} from '../shared/selector-aliases.mjs';
import {retireLegacyQuestionMappings} from '../shared/profile-migration.mjs';
import {formLocation} from '../shared/profile.mjs';import {hash} from '../shared/engine.mjs';
test('collector aliases need the same unique actual DOM node; labels, hidden nodes and ambiguous matches cannot substitute',()=>{
 const node=shown=>({getClientRects:()=>shown?[{}]:[],closest:()=>null,matches:()=>false}),a=node(true),b=node(true),hidden=node(false),map={'#old':[a],'#new':[a],'#same-label':[b],'#hidden':[hidden],'#ambiguous':[a,b]};
 const result=vm.runInNewContext('('+selectorAliasDOM.toString()+')(input)',{document:{querySelectorAll:s=>map[s]||[]},getComputedStyle:()=>({visibility:'visible'}),input:{alternatives:['#old','#same-label','#hidden','#ambiguous','#absent'],references:['#new']}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{pairs:[{alternativeIndex:0,referenceIndex:0}],valuesRead:false});
});
test('inactive unmapped locator records retire only with page/template-bound live equivalence, unresolved conditional records remain',()=>{
 const companyId='sample',url='https://sample.test/form',template={evidence:{sourceUrl:url},pages:[{fields:[{source:'name',inventorySelectors:['semantic-name'],read:{selector:'semantic-name'}}]}]},key=hash({companyId,pageUrl:formLocation(url)}).slice(0,20);
 const profile={facts:{name:{value:'Keep real fact'}},companyForms:{[key]:{mappings:{duplicate:{factKey:'unmapped.duplicate',status:'needs_semantic_mapping',selector:'#old-name',active:false,coverageRequired:true},unseen:{factKey:'unmapped.unseen',status:'needs_semantic_mapping',selector:'#conditional-unseen',active:false,coverageRequired:true}}}}};
 const probe={operation:'internal_condition_probe',companyId,templateHash:hash(template),status:'verified',restoration:'verified',branches:[{status:'verified',newQuestions:0,inventory:[{selector:'semantic-name'}]}],selectorEquivalences:{companyId,pageUrl:url,templateHash:hash(template),pairs:[{selector:'#old-name',reference:'semantic-name'}]}};
 assert.equal(retireLegacyQuestionMappings(profile,{companyId,template,probe}).retired,1);assert.ok(profile.companyForms[key].mappings.unseen);assert.equal(profile.facts.name.value,'Keep real fact');
 probe.selectorEquivalences.pageUrl='https://other.test/form';assert.throws(()=>retireLegacyQuestionMappings(profile,{companyId,template,probe}),/SCOPE_MISMATCH/);
});

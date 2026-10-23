import test from 'node:test';import assert from 'node:assert/strict';
import {discoverMappedChoice} from '../shared/choice-discovery.mjs';
const factKey='education.sample.school.name.zh',selector='#school',pageUrl='https://example.test/form';
const setup=()=>({profile:{facts:{[factKey]:{status:'known',value:'Example University'},'education.sample.school.name.en':{status:'known',value:'Example International University'},'education.sample.school.abbreviation':{status:'known',value:'EIU'}},companyForms:{form:{companyId:'sample',pageUrl,mappings:{field:{selector,factKey}}}}},capture:{companyId:'sample',captureId:'capture',pageUrl,controls:[{selector,label:'School',type:'combobox'}]},selector,choicesId:'choices'});
const captured=options=>({status:'captured',restored:true,options,optionRecords:options.map(label=>({label,value:'id-'+label,disabled:false,selected:false}))});
const empty=()=>({status:'captured_empty_search',restored:true,options:[],coverage:{emptyEvidence:['No results']}});
test('mapped source owns the query and a real exact candidate resolves immediately',async()=>{
 const args=setup(),queries=[];const result=await discoverMappedChoice({...args,inspect:async(_,q)=>{queries.push(q);return captured(['Example University']);}});
 assert.deepEqual(queries,['Example']);assert.equal(result.resolution.selectedOption,'Example University');assert.equal(result.resolution.optionValue,'id-Example University');assert.equal(result.status,'choice_resolved');assert.equal(result.executionVerified,false);
});
test('confirmed aliases are searched in order after actual empty-result evidence',async()=>{
 const queries=[];const result=await discoverMappedChoice({...setup(),inspect:async(_,q)=>{queries.push(q);return q==='Example'?empty():captured(['Example International University']);}});
 assert.deepEqual(queries,['Example','Example International']);assert.equal(result.resolution.method,'known_alias');assert.equal(result.goal.attempts.length,2);
});
test('zero DOM matches without website empty evidence can never claim no candidate',async()=>{
 for(const result of [{status:'captured',restored:true,options:[]},{status:'captured_empty_search',restored:true,options:[],coverage:{}}])await assert.rejects(discoverMappedChoice({...setup(),inspect:async()=>result}),/EMPTY_EVIDENCE_REQUIRED/);
});
test('unmapped or unknown facts reject before page interaction',async()=>{
 const args=setup();let calls=0;args.profile.companyForms.form.mappings.field.factKey='unmapped.pending';await assert.rejects(discoverMappedChoice({...args,inspect:async()=>{calls++;}}),/MAPPING_REQUIRED/);assert.equal(calls,0);
});
test('fuzzy candidates remain visible for semantic review and are never hard selected',async()=>{
 const result=await discoverMappedChoice({...setup(),inspect:async()=>captured(['Example University Campus'])});assert.equal(result.status,'choice_semantic_review_required');assert.equal(result.resolution,undefined);assert.equal(result.candidates[0].option,'Example University Campus');
});
test('driver failure remains a driver failure instead of an absent-option conclusion',async()=>{
 await assert.rejects(discoverMappedChoice({...setup(),inspect:async()=>{throw Error('CONTROL_DRIVER_REQUIRED');}}),/CONTROL_DRIVER_REQUIRED/);
});

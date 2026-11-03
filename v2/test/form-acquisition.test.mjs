import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionPlan,detectedAcquisitionPlan,assertCollectionProvider,captureContentId,isChoiceControl,capturedChoiceOptions,compactConstructionResult,templateFromDraft} from '../shared/form-acquisition.mjs';
import {hash} from '../shared/engine.mjs';

test('same-page observed framework chooses the collector without an agent flag; ambiguity stays explicit',async()=>{
 const page={observe:async spec=>{assert.deepEqual(spec.fields,[]);return {groups:{ant:3,feishu:0}};}};
 assert.equal((await detectedAcquisitionPlan(page,{provider:'feishu'})).provider,'ant');
 await assert.rejects(assertCollectionProvider(page,{}),/FORM_PROVIDER_REQUIRES_REBUILD/);
 assert.equal(await assertCollectionProvider(page,{provider:'ant'}),true);
 await assert.rejects(detectedAcquisitionPlan(page,{},'feishu'),/EVIDENCE_MISMATCH/);
 await assert.rejects(detectedAcquisitionPlan({observe:async()=>({groups:{ant:1,feishu:1}})},{}),/AMBIGUOUS/);
});
test('a Phoenix form rejects a guessed Feishu collector before empty capture can be persisted',async()=>{
 const page={observe:async()=>({groups:{ant:0,feishu:0,phoenix:12}})};
 assert.equal((await detectedAcquisitionPlan(page,{})).provider,'phoenix');
 await assert.rejects(detectedAcquisitionPlan(page,{},'feishu'),/PROVIDER_EVIDENCE_MISMATCH/);
});
test('capture identity is the allocated form code; content changes only its hash',()=>{
 const id=captureContentId('F000001');assert.equal(id,'capture-F000001');assert.equal(id,captureContentId('F000001'));
 assert.notEqual(id,captureContentId('F000002'));assert.throws(()=>captureContentId('arbitrary-name'),/FORM_CODE_REQUIRED/);
});

test('explicit construction provider overrides an obsolete template without dropping its page contract',()=>{
 const plan={provider:'feishu',readySelector:'form',fields:[{id:'original'}]};
 assert.deepEqual(acquisitionPlan(plan,'ant'),{...plan,provider:'ant'});
 assert.equal(acquisitionPlan(plan).provider,'feishu');
 assert.deepEqual(acquisitionPlan(null,'ant'),{provider:'ant'});
 assert.equal(plan.provider,'feishu');
});

test('compact construction avoids a full template roundtrip and retains every blocker',()=>{
 const built={template:{pages:[{fields:[{id:'one'},{id:'two'}]}]},readyToRegister:false,blockers:[{reason:'OPTIONS_NOT_CAPTURED'}],pending:[{kind:'ready',id:'one'},{kind:'construction',id:'two'}],requiresUser:false,nextTools:['capture_choice_options']};
 const compact=compactConstructionResult(built);
 assert.equal(compact.template,undefined);assert.equal(compact.fieldCount,2);
 assert.deepEqual(compact.pendingCounts,{ready:1,construction:1});
 assert.deepEqual(compact.blockers,built.blockers);assert.equal(compact.pending.length,1);
});

test('draft reference registration checks company, exact template hash and completed construction',()=>{
 const draft={companyId:'fixture',template:{id:'form',pages:[]},readyToRegister:true,blockers:[]};
 const request={companyId:'fixture',draftHash:hash(draft.template)};
 assert.equal(templateFromDraft(draft,request,hash),draft.template);
 assert.throws(()=>templateFromDraft(draft,{...request,companyId:'other'},hash),/COMPANY_SCOPE/);
 assert.throws(()=>templateFromDraft({...draft,template:{id:'changed'}},request,hash),/HASH_CHANGED/);
 assert.throws(()=>templateFromDraft({...draft,readyToRegister:false},request,hash),/CONSTRUCTION_INCOMPLETE/);
 assert.throws(()=>templateFromDraft({...draft,blockers:[{reason:'uncaptured'}]},request,hash),/CONSTRUCTION_INCOMPLETE/);
});

test('radio and native select options are collected without a dropdown action or invented fallback',()=>{
 for(const field of [{type:'radio',options:['男','女']},{tag:'select',type:'select-one',options:['本科','硕士']}]){
  assert.equal(isChoiceControl(field),true);
  assert.deepEqual(capturedChoiceOptions(field),{options:field.options,status:'captured',restored:true,source:'rendered_control_capture'});
 }
 assert.equal(capturedChoiceOptions({type:'radio'}).status,'options_not_observed');
 assert.deepEqual(capturedChoiceOptions({type:'radio'}).options,[]);
 assert.equal(capturedChoiceOptions({type:'combobox',contextProvider:'.ant-form-item'}),null);
 assert.equal(isChoiceControl({type:'text'}),false);
 for(const field of [{type:'search',contextProvider:'.ud-formily-item'},{type:'combobox',contextProvider:'.ant-form-item'},{type:'choice',contextProvider:'.atsx-form-item'}])assert.equal(isChoiceControl(field),true);
});

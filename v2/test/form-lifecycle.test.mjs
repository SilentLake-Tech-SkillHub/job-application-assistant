import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Store,hash} from '../shared/engine.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';
import {updateCompanyTemplate,constructionTemplate,promoteSealedTemplate} from '../shared/template-lifecycle.mjs';
import {templateState,assertReaRequired,clearTemplateFailures,recordRealFillFailure} from '../shared/template-state.mjs';
import {retainControlChoices,bindControlChoices,formScope,compatibleInventory} from '../shared/control-choice-store.mjs';
const template=()=>({id:'C00001',version:1,evidence:{formId:'C00001',sourceUrl:'https://example.com/form?jobAdId=one&userId=old',observedAt:'synthetic'},pages:[{pathPrefix:'/form',fields:[{id:'name',source:'name',label:'Name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]});
async function setup(fn){const root=await mkdtemp(path.join(os.tmpdir(),'form-lifecycle-'));try{const store=new Store(root),o=observedSeal(template(),'S0001');await o.persist(store);await store.put('runs',o.probe.id,o.probe);await store.put('templates',o.template.id,o.template);await fn(store,o);}finally{await rm(root,{recursive:true,force:true});}}
test('updating the official definition precedes validation; failed finalization retains that updated definition',()=>setup(async(store,o)=>{
 const before=hash(o.template),draft=structuredClone(o.template);draft.pages[0].fields[0].label='Revised';
 await updateCompanyTemplate(store,{companyId:'S0001',template:draft});
 assert.notEqual(hash(await store.get('templates',draft.id)),before);
 const candidate=await constructionTemplate(store,draft.id);assert.equal(candidate.pages[0].fields[0].label,'Revised');
 await assert.rejects(promoteSealedTemplate(store,{companyId:'S0001',template:candidate,probe:{...o.probe,status:'failed'}}));
 assert.equal(hash(await store.get('templates',draft.id)),hash(candidate));assert.equal((await templateState(o.template,'S0001')).reason,'available');
}));
test('a built form stays available whatever the later evidence looks like, until a real fill fails',()=>setup(async(store,o)=>{
 await clearTemplateFailures(store,o.template);await assert.rejects(store.get('runs','seal-C00001'),{code:'ENOENT'});
 assert.equal((await templateState(o.template)).reason,'available');
 await assert.rejects(assertReaRequired({store,template:o.template}),/REA_NOT_REQUIRED/);
 for(const change of [async()=>{const capture=await store.get('runs',o.capture.captureId);capture.controls.push({selector:'#new',label:'New',type:'text'});await store.put('runs',capture.captureId,capture);},async()=>{await store.remove('runs','acquisition-C00001');},async()=>{await store.remove('runs','form-structure-C00001');}]){await change();assert.equal((await templateState(o.template)).reason,'available');}
 await recordRealFillFailure(store,o.template,'S0001',['name']);
 assert.deepEqual((await store.get('templates',o.template.id)).validation.realFillFailure.fields,['name']);
 const state=await templateState(o.template);assert.equal(state.reason,'real_fill_failure');assert.equal(state.route,'incremental');assert.deepEqual(state.blockers,['name']);
 await assert.rejects(assertReaRequired({store,template:o.template}),/REA_NOT_REQUIRED/);
 await clearTemplateFailures(store,o.template,'S0001');assert.equal((await templateState(o.template)).reason,'available');
}));
test('only a form that never finished building goes to acquisition and may use REA',async()=>{
 assert.equal((await templateState(null)).reason,'never_built');
 const unfinished=template();unfinished.coverage={allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:false};
 const store={get:async()=>{throw Object.assign(Error('none'),{code:'ENOENT'});}};
 const state=await templateState(unfinished);assert.equal(state.reason,'never_built');assert.equal(state.route,'acquire');
 await assertReaRequired({store,template:unfinished});
});
test('task cleanup and direct deletion cannot erase a referenced sealing proof',()=>setup(async(store,o)=>{
 await clearTemplateFailures(store,o.template,'S0001');await store.clearTaskRecords(['unrelated']);
 await assert.rejects(store.remove('runs',o.probe.id),/SEALED_EVIDENCE_PROTECTED/);
 assert.equal((await templateState(o.template,'S0001')).reason,'available');
}));
test('control choices survive recapture and another job URL; only changed controls expire',()=>{
 const capture={formId:'C00001',companyId:'S0001',pageUrl:'https://example.com/form?jobAdId=one&userId=old',captureId:'capture-C00001',controls:[{selector:'#a',label:'A',type:'select',options:['A','B']},{selector:'#b',label:'B',type:'select',options:['C']}]};
 const asset=bindControlChoices({capture,choices:capture.controls.map(c=>({selector:c.selector,options:c.options,status:'captured',restored:true,resolutions:{name:{selectedOption:c.options[0]}}}))});
 const again={...capture,captureId:'other',pageUrl:'https://example.com/form?jobAdId=two&userId=new',controls:structuredClone(capture.controls)};
 assert.equal(retainControlChoices(asset,again).length,2);assert.equal(formScope(capture.pageUrl),formScope(again.pageUrl));
 again.controls[1].options=['Changed'];const retained=retainControlChoices(asset,again);assert.deepEqual(retained.map(c=>c.selector),['#a']);
 assert.equal(retained[0].controlId,asset.choices[0].controlId);assert.equal(retainControlChoices(asset,{...again,pageUrl:'https://example.com/other'}).length,1);assert.equal(retainControlChoices(asset,{...again,formId:'C00002'}).length,0);
});

test('a component upgrade that removes an evidence field does not invalidate the form',()=>setup(async(store,o)=>{
 const changed=structuredClone(o.template);delete changed.evidence.pipeline;await store.put('templates',changed.id,changed);
 assert.equal((await templateState(changed)).reason,'available');
}));
test('a later draft receipt cannot invalidate the certified official form',()=>setup(async(store,o)=>{
 await clearTemplateFailures(store,o.template,'S0001');const receipt=await store.get('runs','acquisition-C00001');await store.put('runs','acquisition-C00001',{...receipt,contractHash:'draft-hash'});
 assert.equal((await templateState(o.template,'S0001')).reason,'available');
}));

test('a closed extra repeat row preserves its evidenced definition; a missing ordinary field does not',()=>{
 const baseline={controls:[{selector:'#base',label:'Base',type:'text'},{selector:'#repeat',label:'School',type:'text',group:'Education',repeatIndex:1}]};
 assert.equal(compatibleInventory(baseline,{controls:[baseline.controls[0]]}),true);
 assert.equal(compatibleInventory(baseline,{controls:[baseline.controls[1]]}),false);
 assert.equal(compatibleInventory(baseline,{controls:[{...baseline.controls[0],label:'Changed'}]}),false);
});

test('a promoted proof survives the next failed draft probe under the same form key',()=>setup(async(store,o)=>{
 const draft=await updateCompanyTemplate(store,{companyId:'S0001',template:o.template});const probe={...o.probe,id:'condition-probe-C00001',templateHash:hash(draft)};await store.put('runs',probe.id,probe);
 const sealed=await promoteSealedTemplate(store,{companyId:'S0001',template:draft,probe});assert.equal(sealed.coverage.proof.runId,'sealed-probe-C00001');
 await store.put('runs',probe.id,{...probe,status:'failed'});assert.equal((await templateState(sealed,'S0001')).reason,'available');
 await assert.rejects(store.put('runs',sealed.coverage.proof.runId,{operation:'unrelated'}),/SEALED_EVIDENCE_PROTECTED/);
}));

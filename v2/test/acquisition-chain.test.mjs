import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAcquisitionChain,assertAcquiredStructure,assertCapturedAcquisition} from '../shared/acquisition-chain.mjs';
import {continuationFor} from '../shared/workflow-continuation.mjs';
import {FormRouter} from '../shared/form-route.mjs';
import {technicalHandoffReasons} from '../shared/workflow-contract.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';

function fixture(){
 const template={id:'pipeline',version:1,evidence:{sourceUrl:'https://example.test/form',observedAt:'synthetic'},pages:[{pathPrefix:'/form',fields:[{id:'name',label:'Name',source:'person.name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]};
 const acquired=observedSeal(template,'example');
 const assets=new Map(acquired.assets);assets.set(acquired.probe.id,acquired.probe);
 const store={get:async(group,id)=>{if(group==='templates')return acquired.template;if(!assets.has(id))throw Object.assign(Error('absent'),{code:'ENOENT'});return assets.get(id);}};
 return {...acquired,assets,store};
}
test('a sealed asset keeps the full collector and construction chain through version increment',async()=>{
 const f=fixture();assert.equal((await assertAcquisitionChain(f.template,{store:f.store,companyId:'example'})).version,1);
});
test('coverage flags and a valid seal cannot release an asset without collector provenance',async()=>{
 const f=fixture();delete f.template.evidence.pipeline;
 const router=new FormRouter({store:f.store,companies:[{id:'example',origin:'https://example.test',templateId:'pipeline'}],validateTemplate:()=>{}});
 const result=await router.resolve({companyId:'example',pageUrl:'https://example.test/form'});
 assert.equal(result.route,'acquire');assert.equal(result.requiresUser,false);assert.deepEqual(result.blockers,['MCP_ACQUISITION_CHAIN_REQUIRED']);
});
test('missing raw REA, native structure, script integrity and incomplete structure are rejected',()=>{
 for(const [change,reason] of [
  [s=>delete s.rawEvidence,'ACQUISITION_RAW_REA_EVIDENCE_REQUIRED'],
  [s=>delete s.nativeStructure,'ACQUISITION_NATIVE_STRUCTURE_REQUIRED'],
  [s=>s.nativeStructure.documents[0].nodes.push({nodeName:'INPUT'}),'ACQUISITION_NATIVE_STRUCTURE_CHANGED'],
  [s=>s.structure.completeness.truncated_sections=['dom'],'ACQUISITION_STRUCTURE_INCOMPLETE'],
  [s=>s.scriptCoverage.included=1,'ACQUISITION_SCRIPT_EVIDENCE_CHANGED'],
  [s=>s.controls=[],'ACQUISITION_CONTROL_INVENTORY_INCOMPLETE']
 ]){const f=fixture(),structure=structuredClone(f.structure);change(structure);assert.throws(()=>assertAcquiredStructure(structure,f.capture,'example'),new RegExp(reason));}
});
test('old construction cannot survive capture overwrite, changed field actions or missing receipts',async()=>{
 for(const change of [f=>f.capture.controls[0].label='Other question',f=>f.template.pages[0].fields[0].actions[0].selector='#other',f=>f.assets.delete(f.receipt.structureId)]){
  const f=fixture();change(f);await assert.rejects(assertAcquisitionChain(f.template,{store:f.store,companyId:'example'}),/ACQUISITION_CONTROL_CAPTURE_CHANGED|ACQUISITION_EVIDENCE_CHANGED|MCP_CONSTRUCTION_RECEIPT_CHANGED|ACQUISITION_EVIDENCE_MISSING/);
 }
});
test('current profile mapping must still identify the same captured field and source',async()=>{
 const f=fixture(),profile={companyForms:{form:{companyId:'example',pageUrl:f.capture.pageUrl,mappings:{one:{active:true,selector:'#name',factKey:'person.name'}}}}};
 await assertAcquisitionChain(f.template,{store:f.store,companyId:'example',profile});
 profile.companyForms.form.mappings.one.factKey='other.person';await assert.rejects(assertAcquisitionChain(f.template,{store:f.store,companyId:'example',profile}),/ACQUISITION_PROFILE_MAPPING_CHANGED/);
});
test('real verification and preparation runs can hand off driver failures without inventing an error ID',()=>{
 assert.deepEqual(technicalHandoffReasons({operation:'verify_current',checks:[{status:'mismatch',reason:'SEARCHABLE_COMMIT_NOT_VERIFIED'},{status:'unverified',reason:'UPLOAD_NOT_CONFIRMED_BY_SITE'},{status:'needs_user',reason:'UNANSWERED_FIELD_REQUIRES_USER_RESPONSE'}]}),['SEARCHABLE_COMMIT_NOT_VERIFIED','UPLOAD_NOT_CONFIRMED_BY_SITE']);
 assert.deepEqual(technicalHandoffReasons({operation:'selected_field_prepare',errorCode:'FORM_CONTROL_CONTRACT_CHANGED'}),['FORM_CONTROL_CONTRACT_CHANGED']);
 assert.deepEqual(technicalHandoffReasons({operation:'verify_current',checks:[{status:'mismatch',reason:'VALUE_DIFFERS'}]}),[]);
});

test('mapping and choice acquisition require the paired collector before any website access',async()=>{
 const f=fixture();await assertCapturedAcquisition(f.store,{companyId:'example',captureId:f.capture.captureId});
 f.assets.delete(f.receipt.structureId);await assert.rejects(assertCapturedAcquisition(f.store,{companyId:'example',captureId:f.capture.captureId}),/MCP_ACQUISITION_CHAIN_REQUIRED/);
});

test('already verified protected fields cannot be relabeled as user work because another answer is missing',()=>{
 const template={pages:[{fields:[{id:'document',source:'identity.idNumber',label:'身份证号码',kind:'text',userOnly:true,userOnlyReason:'sensitive_identity',inventoryType:'text'},{id:'award-date',source:'award.date',label:'获奖时间',kind:'date'}]}]};
 const profile={facts:{'award.date':{status:'missing'}}};
 const continuation=continuationFor({template,profile,verification:{status:'needs_attention',checks:[{id:'document',status:'match'},{id:'award-date',status:'needs_user'}]}});
 assert.deepEqual(continuation.fields.map(field=>field.id),['award-date']);assert.equal(continuation.continueWithOtherCompanies,true);
});

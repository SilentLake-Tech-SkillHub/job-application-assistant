import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAcquisitionChain,assertAcquiredStructure,assertCapturedAcquisition,acquisitionStructureId,latestStructurePointer,recordReaInspection,recordAcquisitionChain} from '../shared/acquisition-chain.mjs';
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

// The real recording path (recordReaInspection → bindStructureControls) with the
// scenarios a rebuild meets: same page minutes later, a newly opened tab with the
// same controls, a stale capture, and a changed form.
async function inspectionScenario(){
 const {hash}=await import('../shared/engine.mjs');
 const {captureContentId}=await import('../shared/form-acquisition.mjs');
 const assets=new Map(),store={get:async(group,id)=>{if(!assets.has(id))throw Object.assign(Error('absent'),{code:'ENOENT'});return structuredClone(assets.get(id));},put:async(group,id,value)=>{assets.set(id,structuredClone(value));}};
 const companyId='example',pageUrl='https://example.test/form',controls=[{selector:'#name',label:'Name',type:'text',required:true}];
 // Same as captureCompanyControls: content-addressed id, record overwritten with the latest observation.
 const capture=async(pageId,observedAt,list=controls)=>{const captureId=captureContentId(companyId,pageUrl,null,list,hash),record={companyId,pageUrl,pageId,readOnly:true,provider:null,observedAt,controls:list,captureId};await store.put('runs',captureId,record);return record;};
 const inspect=async(pageId,observedAt,captured,n)=>{
  const rawEvidence={operation:'inspect_web_page',predicate_type:'rea.web-page-inspection',evidence_id:'rea-'+n,normalized_result:{scripts:{items:[]}}};
  const body={schemaVersion:1,pageUrl,targetId:'target-'+pageId,documents:[{nodes:[{index:0,nodeName:'FORM'}]}],accessibility:[{nodeId:'1',role:'textbox'}]};
  const structure={schemaVersion:1,provider:'rea',evidenceId:rawEvidence.evidence_id,evidenceHash:hash(rawEvidence),pageId,pageUrl,targetId:body.targetId,observedAt,accessibility:[],limitations:[],completeness:{truncated_sections:[],unavailable_sections:[]}};
  return recordReaInspection(store,{companyId,pageUrl,structure,capture:captured,rawEvidence,nativeStructure:{...body,observedAt,structureHash:hash(body),executableSelectors:false}});
 };
 const build=async(structureId,captured)=>{
  const template={id:'pipeline',version:1,evidence:{sourceUrl:pageUrl,observedAt:captured.observedAt,captureId:captured.captureId},pages:[{pathPrefix:'/form',fields:[{id:'name',label:'Name',source:'person.name',kind:'text',inventorySelectors:['#name'],control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]};
  await recordAcquisitionChain(store,{companyId,structureId,structure:await store.get('runs',structureId),capture:captured,template});return template;
 };
 return {store,assets,capture,inspect,build,companyId,pageUrl};
}
test('rebuild scenarios: same page later, a new tab with the same controls, a changed form; the built template stays valid',async()=>{
 const s=await inspectionScenario(),t0='2026-10-26T12:00:00.000Z',t3='2026-10-26T12:03:00.000Z',t9='2026-10-26T12:09:00.000Z';
 const first=await s.inspect('chrome:a',t0,await s.capture('chrome:a',t0),1),template=await s.build(first.id,await s.store.get('runs',(await s.store.get('runs',first.id)).captureId));
 assert.equal((await assertAcquisitionChain(template,{store:s.store,companyId:s.companyId})).version,1);
 // Same page three minutes later: a fresh capture and REA inspection bind; the template is untouched.
 const later=await s.inspect('chrome:a',t3,await s.capture('chrome:a',t3),2);assert.notEqual(later.id,first.id);
 assert.equal((await assertAcquisitionChain(template,{store:s.store,companyId:s.companyId})).version,1);
 // A newly opened tab with the same controls: same captureId, its own page and time.
 const tab=await s.capture('chrome:b',t9),fresh=await s.inspect('chrome:b',t9,tab,3);assert.equal(tab.captureId,template.evidence.captureId);
 assert.equal((await assertCapturedAcquisition(s.store,{companyId:s.companyId,captureId:tab.captureId})).structure.pageId,'chrome:b');
 assert.equal((await assertAcquisitionChain(template,{store:s.store,companyId:s.companyId})).version,1);
 const rebuilt=await s.build(fresh.id,tab);assert.equal((await assertAcquisitionChain(rebuilt,{store:s.store,companyId:s.companyId})).version,1);
 // A REA inspection paired with a capture from another tab or minutes earlier is still refused.
 await assert.rejects(s.inspect('chrome:c',t9,tab,4),/REA_CONTROL_CAPTURE_SCOPE_MISMATCH/);
 await assert.rejects(s.inspect('chrome:b','2026-10-26T12:15:00.000Z',tab,5),/REA_CONTROL_CAPTURE_TOO_FAR_APART/);
 // A changed form is a different capture; the template built on the old one keeps its evidence.
 const changed=await s.capture('chrome:b',t9,[{selector:'#name',label:'Name',type:'text',required:true},{selector:'#new',label:'New',type:'text',required:false}]);
 assert.notEqual(changed.captureId,tab.captureId);assert.equal((await assertAcquisitionChain(rebuilt,{store:s.store,companyId:s.companyId})).version,1);
 // Building again on a page replaces the page's construction receipt: the superseded template no longer runs.
 await assert.rejects(assertAcquisitionChain(template,{store:s.store,companyId:s.companyId}),/MCP_CONSTRUCTION_RECEIPT_CHANGED/);
});
test('a template whose captured controls changed under the same id is refused',async()=>{
 const s=await inspectionScenario(),t0='2026-10-26T12:00:00.000Z';
 const first=await s.inspect('chrome:a',t0,await s.capture('chrome:a',t0),1),captured=await s.store.get('runs',(await s.store.get('runs',first.id)).captureId),template=await s.build(first.id,captured);
 s.assets.set(captured.captureId,{...captured,controls:[{...captured.controls[0],label:'Other'}]});
 await assert.rejects(assertAcquisitionChain(template,{store:s.store,companyId:s.companyId}),/ACQUISITION_CONTROL_CAPTURE_CHANGED|ACQUISITION_EVIDENCE_CHANGED/);
});
test('a page-level structure written before per-capture records still resolves',async()=>{
 const f=fixture(),url=f.template.evidence.sourceUrl;
 f.assets.set(acquisitionStructureId('example',url),f.structure);f.assets.delete(f.template.evidence.pipeline.structureId);
 assert.equal((await assertCapturedAcquisition(f.store,{companyId:'example',pageUrl:url})).capture.captureId,f.capture.captureId);
});

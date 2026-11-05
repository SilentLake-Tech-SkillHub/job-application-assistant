// Temp fixtures write synthetic company files under a temp 岗位交接/公司/; no production data is modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';
import {MATERIAL_SOURCES,materialAudit,resolveMaterialValues} from '../shared/business-materials.mjs';
import {readHandoffBatch,contentSha} from '../shared/company-directory.mjs';
import {companyDoc,site,role as roleRow,confirm as confirmDoc,saveCompany,handoffWorkspace} from './fixtures/handoff.mjs';
import {confirmedMaterialContext} from '../shared/role-material-context.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';
import {registerObservedQuestions,registerTemplateContract,resolveProfile,assertQuestionsMapped} from '../shared/profile.mjs';
import {compileExecutionPlan,assertPreparedPlan,orderedFillIds} from '../shared/execution-plan.mjs';
import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';import {hash} from '../shared/engine.mjs';
const roleUrl='https://alpha.example/job/12345',pageUrl='https://alpha.example/apply/12345';
const materials=()=>({schemaVersion:2,items:[{key:'referralCode',status:'available',value:'SampleCode17',raw:'SampleCode17',requireWhenAvailable:true,evidence:{'岗位编码':'J000001',column:'内推码',cellSha256:'01ea865b8857c860a984e96930719596dbf5b4c002f7b3d00bb80d2da84b167e'}}]});
const context=()=>({batchId:'sample-batch',contentSha256:'sample-sha',companyId:'alpha',roleId:'J000001',roleUrl,materials:materials()});
const field=()=>({id:'referral',source:MATERIAL_SOURCES.referralCode,label:'推荐码',inventoryLabel:'推荐码',inventoryType:'text',required:false,inventorySelectors:['#referral'],kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#referral',kind:'value'},actions:[{method:'fill',selector:'#referral'}]});
const template=()=>({id:'generic-referral',version:1,evidence:{sourceUrl:pageUrl,observedAt:'synthetic'},coverage:{allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:true},pages:[{pathPrefix:'/apply',readySelector:'form',roleTitle:'Product',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[field()]}]});
const profile=()=>({schemaVersion:1,facts:{},entities:{},sources:{},fieldRegistry:{}});
const task=()=>({...resolveMaterialValues(context()),companyId:'alpha',roleId:'J000001',pageUrl,templateHash:hash(template())});
const observation=(value='SampleCode17')=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl,roleTitle:'Product',sections:[{title:'Basics'}],inventoryIds:['referral'],fields:{referral:{present:true,value}},pageErrors:[]});
const alpha=(m=materials())=>companyDoc({code:'C00001',name:'Sample',batchId:'sample-batch',sites:[site('S0001','https://alpha.example')],roles:[roleRow('J000001','S0001','Product',roleUrl,{'官方岗位ID':'12345','材料':m})]});
const catalog=[{id:'S0001',siteId:'S0001',companyId:'C00001',origin:'https://alpha.example'}];
test('known required role materials run first after prerequisites, using the frozen order',()=>{
 const fields=[{id:'name',source:'name',kind:'text',disposition:'fill'},{id:'channel',source:'channel',kind:'choice',disposition:'fill'},{id:'code',source:'material:referralCode',kind:'text',disposition:'fill',when:{source:'channel',equals:'Referral'}}];
 assert.deepEqual(orderedFillIds(fields,[{fieldId:'code'}]),['channel','code','name']);
});
test('complete material chain: exporter → handoff → queue → mapping → resolution → frozen plan → independent readback',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'role-material-chain-'));
 try{
  const exported=process.env.TEST_MATERIALS_JSON?JSON.parse(await readFile(process.env.TEST_MATERIALS_JSON,'utf8')):materials();
  await saveCompany(root,confirmDoc(alpha(exported)));
  const adapter=()=>readHandoffBatch({handoffDir:root});
  const queues=new RoleQueue({root:path.join(root,'queue'),catalog,inputAdapter:adapter}),q=await queues.import({});assert.deepEqual(q.tasks[0].materials,exported);
  const ctx=await confirmedMaterialContext({handoffDir:root,companyId:'S0001',roleId:'J000001',pageUrl,catalog}),p=profile(),t=template();assert.equal(ctx.roleId,'J000001');
  const reg=registerObservedQuestions(p,{companyId:'S0001',pageUrl,observedAt:'synthetic',coverageRequired:true,fields:[{selector:'#referral',label:'推荐码',type:'text',required:false}]});
  assert.equal(Object.values(p.companyForms[reg.pageKey].mappings)[0].factKey,MATERIAL_SOURCES.referralCode);registerTemplateContract(p,{companyId:'S0001',template:t,templateHash:hash(t)});assert.equal(p.facts[MATERIAL_SOURCES.referralCode],undefined);assertQuestionsMapped(p,'S0001',pageUrl);
  const resolved=resolveProfile(p,t,{},'S0001',ctx),job={companyId:'S0001',roleId:'J000001',pageUrl,templateHash:hash(t),...resolved};assert.equal(resolved.values[MATERIAL_SOURCES.referralCode],'SampleCode17');
  const plan=await compileExecutionPlan(t,job);assert.equal(plan.readyForExecution,true);assert.equal(plan.pages[0].fields[0].required,false);assert.equal(plan.pages[0].fields[0].effectiveRequired,true);assert.equal(plan.pages[0].fields[0].disposition,'fill');
  const expected=compileExpected(t.pages[0],job),result=verifyForm(expected,observation());assert.equal(result.status,'verified');assert.equal(result.materialCoverage.complete,true);
  for(const value of ['', 'WrongCode', 'SampleCode17 ']){const r=verifyForm(expected,observation(value));assert.equal(r.status,'needs_attention');assert.equal(r.materialCoverage.complete,false);}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing destination, mapping, value or executable branch blocks known material, including partial filling',async()=>{
 for(const mutate of [t=>t.pages[0].fields=[],t=>t.pages[0].fields[0].source='legacy.fact',t=>t.pages[0].fields[0].userOnly=true,t=>t.pages[0].fields[0].when={source:'branch',equals:true}]){
  const t=template();mutate(t);const job=task(),p=await compileExecutionPlan(t,job);assert.equal(p.readyForExecution,false);assert.ok(p.materialCoverage.blockers.length);await assert.rejects(assertPreparedPlan(p,t,{...job,planId:p.id,planHash:p.planHash},{allowPartialPreparation:true}),/FORM_CONSTRUCTION_INCOMPLETE/);
 }
 const job=task();delete job.values[MATERIAL_SOURCES.referralCode];assert.ok(materialAudit([field()],job).blockers.includes('ROLE_MATERIAL_VALUE_NOT_RESOLVED'));
});
test('known material cannot be omitted; absent and unresolved have distinct outcomes',async()=>{
 const job=task();job.omissions={referral:{kind:'user_declined',evidence:'synthetic'}};await assert.rejects(compileExecutionPlan(template(),job),/REQUIRED_FIELD_CANNOT_BE_OMITTED/);
 const ctx=context();ctx.materials.items[0]={...ctx.materials.items[0],value:null,status:'absent',raw:'无公开内推码',evidence:{...ctx.materials.items[0].evidence,cellSha256:createHash('sha256').update('无公开内推码').digest('hex')}};const p=profile(),t=template();registerTemplateContract(p,{companyId:'alpha',template:t,templateHash:hash(t)});
 const absent={...job,omissions:{},...resolveProfile(p,t,{},'alpha',ctx)},plan=await compileExecutionPlan(t,absent);assert.equal(plan.pages[0].fields[0].disposition,'omitted');assert.equal(plan.materialCoverage.complete,true);
 ctx.materials.items[0].status='unresolved';assert.ok(materialAudit([field()],{...task(),materialContext:ctx}).blockers.includes('ROLE_MATERIAL_REQUIRES_RESOLUTION'));
});
test('changed materials invalidate frozen plans; cross-company or cross-role material is rejected',async()=>{
 const t=template(),job=task(),p=await compileExecutionPlan(t,job),changed=structuredClone(job);changed.materialContext.materials.items[0].value='OtherCode19';changed.values[MATERIAL_SOURCES.referralCode]='OtherCode19';await assert.rejects(assertPreparedPlan(p,t,{...changed,planId:p.id,planHash:p.planHash},{}),/PREPARED_PLAN_INPUTS_CHANGED/);
 for(const patch of [{companyId:'beta'},{roleId:'J000002'}])assert.throws(()=>materialAudit([field()],{...job,...patch}),/ROLE_MATERIAL_SCOPE_MISMATCH/);
});
test('material-only queue upgrade preserves tasks and pages, rejects selection edits and stale hashes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'material-upgrade-'));
 try{
  const base=confirmDoc(alpha());await saveCompany(root,base);
  const queues=new RoleQueue({root:path.join(root,'queue'),catalog,inputAdapter:()=>readHandoffBatch({handoffDir:root})}),q=await queues.import({});await queues.put(q.tasks[0].taskId,{queueId:q.queueId,status:'ready_for_user_review',pageId:'chrome:original',applicationUrl:pageUrl,verifyRunId:'old'});
  // 搜索端 amend-materials：只改材料，按“只改材料”范围重新确认，并记下上一版指纹
  const upgrade=structuredClone(base);upgrade['岗位'][0]['材料'].items[0]={...upgrade['岗位'][0]['材料'].items[0],status:'absent',value:null,raw:'',evidence:{'岗位编码':'J000001',column:'内推码',cellSha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}};
  const amended=confirmDoc(upgrade);Object.assign(amended['批次']['确认'],{scope:'materials_only',previousContentSha256:base['批次']['确认'].contentSha256});await saveCompany(root,amended);
  await assert.rejects(queues.task({...q,taskId:q.tasks[0].taskId}),/HANDOFF_CHANGED_AFTER_CONFIRMATION|ROLE_INPUT_CHANGED/);
  const next=await queues.refreshMaterials({...q,authorizationRef:'User approves the material amendment'});assert.equal(next.tasks[0].taskId,q.tasks[0].taskId);assert.equal(next.queueId,q.queueId);assert.notEqual(next.queueHash,q.queueHash);assert.deepEqual(next.refreshedCompanies,[{companyCode:'C00001',scope:'materials_only'}]);
  const state=await queues.read(q.tasks[0].taskId);assert.equal(state.pageId,'chrome:original');assert.equal(state.status,'ready_to_fill');assert.equal(state.verifyRunId,undefined);
  assert.equal((await queues.task({...next,taskId:q.tasks[0].taskId})).t.materials.items[0].status,'absent');await assert.rejects(queues.get(q),/ROLE_QUEUE_HASH_MISMATCH/);
  assert.equal(next.tasks[0].inputChanged,undefined);
  const {source}=await readHandoffBatch({handoffDir:root});assert.equal(JSON.parse(await readFile(path.join(root,'queue',q.queueId+'.json'),'utf8')).source.contentSha256,source.contentSha256);
  // 链接变更（apply-observations）：同样按范围确认，已打开的页面作废
  const relinked=structuredClone(amended);relinked['岗位'][0]['投递链接']=pageUrl;const linkDoc=confirmDoc(relinked);Object.assign(linkDoc['批次']['确认'],{scope:'links_only',previousContentSha256:amended['批次']['确认'].contentSha256});await saveCompany(root,linkDoc);
  const after=await queues.refreshMaterials({...next,authorizationRef:'User approves the new link'});const rebound=await queues.read(q.tasks[0].taskId);assert.deepEqual([rebound.status,rebound.pageId,rebound.verifyRunId,rebound.carriedFrom.reason],['rebind_required','chrome:original',undefined,'links_changed']);
  assert.equal((await queues.task({...after,taskId:q.tasks[0].taskId})).t.applyUrl,pageUrl);
  const malicious=structuredClone(relinked);malicious['批次']['选中岗位']=[];const bad=confirmDoc(malicious);Object.assign(bad['批次']['确认'],{scope:'materials_only',previousContentSha256:linkDoc['批次']['确认'].contentSha256});await saveCompany(root,bad);
  await assert.rejects(queues.refreshMaterials({...after,authorizationRef:'synthetic'}),/MATERIAL_AMENDMENT_CHANGED_SELECTION|HANDOFF_NOT_CONFIRMED/);
  await saveCompany(root,confirmDoc({...relinked,'岗位':relinked['岗位'].map(r=>({...r,'岗位名称':'Changed role'}))}));
  await assert.rejects(queues.refreshMaterials({...after,authorizationRef:'synthetic'}),/CONFIRMED_MATERIAL_AMENDMENT_REQUIRED/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a known role material binds only the selected branch of a shared source question',async()=>{
 const t=template(),job=task(),primary=t.pages[0].fields[0];
 primary.when={source:'channel',equals:'Employee referral'};
 const alternate={...field(),id:'alternate',source:'companyAnswers.alpha.ambassadorCode',when:{source:'channel',equals:'Ambassador'}};
 t.pages[0].fields.push(alternate);
 job.values.channel='Employee referral';
 const plan=await compileExecutionPlan(t,job);
 assert.deepEqual(plan.materialCoverage.requirements.map(row=>row.fieldId),[primary.id]);
 assert.equal(plan.readyForExecution,true);
 assert.equal(plan.pages[0].fields[1].disposition,'inactive');
 assert.equal(plan.pages[0].fields[1].effectiveRequired,false);
 delete job.values.channel;
 assert.ok(materialAudit(t.pages[0].fields,job).blockers.includes('REQUIRED_MATERIAL_NOT_EXECUTABLE'));
});

// Temp fixtures use writeFile for 投递批次.json; no production data is modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {MATERIAL_SOURCES,materialAudit,resolveMaterialValues} from '../shared/business-materials.mjs';
import {readHandoffBatch,contentSha} from '../shared/company-directory.mjs';
import {confirmedMaterialContext} from '../shared/role-material-context.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';
import {registerObservedQuestions,registerTemplateContract,resolveProfile,assertQuestionsMapped} from '../shared/profile.mjs';
import {compileExecutionPlan,assertPreparedPlan,orderedFillIds} from '../shared/execution-plan.mjs';
import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';import {hash} from '../shared/engine.mjs';
const roleUrl='https://alpha.example/job/12345',pageUrl='https://alpha.example/apply/12345';
const materials=()=>({schemaVersion:1,items:[{key:'referralCode',status:'available',value:'SampleCode17',raw:'SampleCode17',requireWhenAvailable:true,evidence:{masterDataSha256:'sample-master',roleUrl,column:'内推码'}}]});
const context=()=>({batchId:'sample-batch',contentSha256:'sample-sha',companyId:'alpha',roleId:'12345',roleUrl,materials:materials()});
const field=()=>({id:'referral',source:MATERIAL_SOURCES.referralCode,label:'推荐码',inventoryLabel:'推荐码',inventoryType:'text',required:false,inventorySelectors:['#referral'],kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#referral',kind:'value'},actions:[{method:'fill',selector:'#referral'}]});
const template=()=>({id:'generic-referral',version:1,evidence:{sourceUrl:pageUrl,observedAt:'synthetic'},coverage:{allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:true},pages:[{pathPrefix:'/apply',readySelector:'form',roleTitle:'Product',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[field()]}]});
const profile=()=>({schemaVersion:1,facts:{},entities:{},sources:{},fieldRegistry:{}});
const task=()=>({...resolveMaterialValues(context()),companyId:'alpha',roleId:'12345',pageUrl,templateHash:hash(template())});
const observation=(value='SampleCode17')=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl,roleTitle:'Product',sections:[{title:'Basics'}],inventoryIds:['referral'],fields:{referral:{present:true,value}},pageErrors:[]});
const confirmed=b=>({...b,confirmation:{userQuote:'Confirm synthetic roles',contentSha256:contentSha(b)}});
test('known required role materials run first after prerequisites, using the frozen order',()=>{
 const fields=[{id:'name',source:'name',kind:'text',disposition:'fill'},{id:'channel',source:'channel',kind:'choice',disposition:'fill'},{id:'code',source:'material:referralCode',kind:'text',disposition:'fill',when:{source:'channel',equals:'Referral'}}];
 assert.deepEqual(orderedFillIds(fields,[{fieldId:'code'}]),['channel','code','name']);
});
test('complete material chain: exporter → handoff → queue → mapping → resolution → frozen plan → independent readback',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'role-material-chain-'));
 try{
  const exported=process.env.TEST_MATERIALS_JSON?JSON.parse(await readFile(process.env.TEST_MATERIALS_JSON,'utf8')):materials();
  const b=confirmed({schemaVersion:2,materialContractVersion:1,batchId:'sample-batch',state:'已交接',companies:[{companyId:'alpha','公司':'Sample','地区':'Test','岗位':[{'岗位ID':'12345','岗位名称':'Product','岗位链接':roleUrl,materials:exported}]}]});
  await writeFile(path.join(root,'投递批次.json'),JSON.stringify(b));
  const adapter=()=>readHandoffBatch({handoffDir:root}),catalog=[{id:'alpha',origin:'https://alpha.example'}];
  const queues=new RoleQueue({root:path.join(root,'queue'),catalog,inputAdapter:adapter}),q=await queues.import({});assert.deepEqual(q.tasks[0].materials,exported);
  const ctx=await confirmedMaterialContext({handoffDir:root,companyId:'alpha',roleId:'12345',pageUrl,catalog}),p=profile(),t=template();
  const reg=registerObservedQuestions(p,{companyId:'alpha',pageUrl,observedAt:'synthetic',coverageRequired:true,fields:[{selector:'#referral',label:'推荐码',type:'text',required:false}]});
  assert.equal(Object.values(p.companyForms[reg.pageKey].mappings)[0].factKey,MATERIAL_SOURCES.referralCode);registerTemplateContract(p,{companyId:'alpha',template:t,templateHash:hash(t)});assert.equal(p.facts[MATERIAL_SOURCES.referralCode],undefined);assertQuestionsMapped(p,'alpha',pageUrl);
  const resolved=resolveProfile(p,t,{},'alpha',ctx),job={companyId:'alpha',roleId:'12345',pageUrl,templateHash:hash(t),...resolved};assert.equal(resolved.values[MATERIAL_SOURCES.referralCode],'SampleCode17');
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
 const ctx=context();ctx.materials.items[0]={...ctx.materials.items[0],value:null,status:'absent',raw:'无公开内推码'};const p=profile(),t=template();registerTemplateContract(p,{companyId:'alpha',template:t,templateHash:hash(t)});
 const absent={...job,omissions:{},...resolveProfile(p,t,{},'alpha',ctx)},plan=await compileExecutionPlan(t,absent);assert.equal(plan.pages[0].fields[0].disposition,'omitted');assert.equal(plan.materialCoverage.complete,true);
 ctx.materials.items[0].status='unresolved';assert.ok(materialAudit([field()],{...task(),materialContext:ctx}).blockers.includes('ROLE_MATERIAL_REQUIRES_RESOLUTION'));
});
test('changed materials invalidate frozen plans; cross-company or cross-role material is rejected',async()=>{
 const t=template(),job=task(),p=await compileExecutionPlan(t,job),changed=structuredClone(job);changed.materialContext.materials.items[0].value='OtherCode19';changed.values[MATERIAL_SOURCES.referralCode]='OtherCode19';await assert.rejects(assertPreparedPlan(p,t,{...changed,planId:p.id,planHash:p.planHash},{}),/PREPARED_PLAN_INPUTS_CHANGED/);
 for(const patch of [{companyId:'beta'},{roleId:'54321'}])assert.throws(()=>materialAudit([field()],{...job,...patch}),/ROLE_MATERIAL_SCOPE_MISMATCH/);
});
test('material-only queue upgrade preserves tasks and pages, rejects selection edits and stale hashes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'material-upgrade-'));
 try{
  const base={schemaVersion:2,batchId:'sample-batch',state:'已交接',companies:[{companyId:'alpha','公司':'Sample','地区':'Test','岗位':[{'岗位ID':'12345','岗位名称':'Product','岗位链接':roleUrl}]}]},file=path.join(root,'投递批次.json');await writeFile(file,JSON.stringify(confirmed(base)));
  const queues=new RoleQueue({root:path.join(root,'queue'),catalog:[{id:'alpha',origin:'https://alpha.example'}],inputAdapter:()=>readHandoffBatch({handoffDir:root})}),q=await queues.import({});await queues.put(q.tasks[0].taskId,{queueId:q.queueId,status:'ready_for_user_review',pageId:'chrome:original',applicationUrl:pageUrl,verifyRunId:'old'});
  const upgrade=structuredClone(base);upgrade.materialContractVersion=1;upgrade.companies[0]['岗位'][0].materials=materials();const amended=confirmed(upgrade);Object.assign(amended.confirmation,{scope:'materials_only',previousContentSha256:contentSha(base)});await writeFile(file,JSON.stringify(amended));
  const next=await queues.refreshMaterials({...q,authorizationRef:'User approves the material amendment'});assert.equal(next.tasks[0].taskId,q.tasks[0].taskId);assert.equal(next.queueId,q.queueId);assert.notEqual(next.queueHash,q.queueHash);const state=await queues.read(q.tasks[0].taskId);assert.equal(state.pageId,'chrome:original');assert.equal(state.status,'ready_to_fill');assert.equal(state.verifyRunId,undefined);await queues.get(next);await assert.rejects(queues.get(q),/ROLE_QUEUE_HASH_MISMATCH/);
  const malicious=structuredClone(upgrade);malicious.companies[0]['岗位'][0]['岗位名称']='Changed role';const bad=confirmed(malicious);Object.assign(bad.confirmation,{scope:'materials_only',previousContentSha256:contentSha(upgrade)});await writeFile(file,JSON.stringify(bad));await assert.rejects(queues.refreshMaterials({...next,authorizationRef:'synthetic'}),/MATERIAL_AMENDMENT_CHANGED_SELECTION/);
 }finally{await rm(root,{recursive:true,force:true});}
});

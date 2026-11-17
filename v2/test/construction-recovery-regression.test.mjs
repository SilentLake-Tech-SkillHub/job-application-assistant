import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {runConstructionBuild} from '../shared/construction-orchestrator.mjs';
import {failureReasons,recordOutcome} from '../shared/stop-loss.mjs';
import {workflowEnvelope,technicalHandoffReasons,executeWorkflowOperation} from '../shared/workflow-contract.mjs';
import {TaskRecords,withTaskRecords} from '../shared/task-records.mjs';
import {readRoleIdentity,inferredRoleIdentity,assertRoleSnapshot} from '../shared/role-identity.mjs';
import {detectedAcquisitionPlan} from '../shared/form-acquisition.mjs';
import {constructionRecordView} from '../shared/construction-record-view.mjs';
import {readdir,readFile} from 'node:fs/promises';

const task={companyId:'C00001',captureId:'capture-C00001',pageUrl:'https://example.test/apply',queue:{taskId:'task-a'}};
const authorization={prepare:true,evidence:'authorized construction'};
test('Formily DOM selects the native reader even when ATS name suggested atsx',async()=>{
 const page={observe:async()=>({groups:{formily:20,feishu:0}})};
 assert.equal((await detectedAcquisitionPlan(page,null,'feishu')).provider,'phoenix');
});
test('URL identity templates generalize to other jobs and reject patterns without a capture',()=>{
 const spec=inferredRoleIdentity('https://example.test/campus/resume/12345/apply','12345');
 assert.equal(readRoleIdentity(spec,'https://example.test/campus/resume/67890/apply').value,'67890');
 assert.throws(()=>readRoleIdentity({...spec,pattern:'^/campus/resume/12345/apply$'},'https://example.test/campus/resume/12345/apply'),/CAPTURE_GROUP_REQUIRED/);
 assert.throws(()=>assertRoleSnapshot({roleTitle:'Job'},{pageUrl:'https://example.test/apply',roleTitle:'Name'},'https://example.test/apply'),e=>e.message==='ROLE_IDENTITY_MISMATCH'&&e.details.checks.role===false);
});
test('large record views return a field slice and script references without copying scripts',()=>{
 const value={controls:[{id:'a',section:'Education'},{id:'b',section:'Work'}],rawEvidence:{script:'x'.repeat(100000)},scriptInventory:['x'.repeat(100000)]};
 const r=constructionRecordView(value,{fieldId:'b'});
 assert.deepEqual(r.value.controls,[{id:'b',section:'Work'}]);assert.ok(r.recordReferences.includes('scriptInventory'));assert.ok(JSON.stringify(r).length<10000);
});
test('thrown business or postprocessing failures are still counted as failed calls',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'failed-metric-'));
 try{
  await assert.rejects(executeWorkflowOperation('form_construct_build',{taskId:'task-a'},async()=>{throw Error('POSTPROCESS_FAILED');},{env:{RECRUITING_HOST_ROLE:'executor',RECRUITING_METRICS_DIR:root}}),/POSTPROCESS_FAILED/);
  const [file]=await readdir(root),metric=JSON.parse(await readFile(path.join(root,file),'utf8'));
  assert.equal(metric.calls,1);assert.equal(metric.errors,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('construction preserves blocker objects through public failure processing',async()=>{
 const deps={cycle:async()=>({stage:'build'}),profile:async()=>({}),template:async()=>null,update:async()=>null,
 call:async tool=>tool==='form_mapping_candidates'?{candidates:[]}:{readyToRegister:false,pending:[{kind:'mapping',id:'field-a'}],blockers:[{id:'field-a',reason:'CONTROL_DRIVER_REQUIRED'}]}};
 const r=await runConstructionBuild({deps,task,authorization,page:{readySelector:'#ready',sections:['Info']}});
 assert.ok(Array.isArray(r.blockers));assert.equal(r.blockerCount,1);
 assert.deepEqual(failureReasons({...r,continuation:{owner:'agent'}}),['CONTROL_DRIVER_REQUIRED']);
});
test('primary backfill returns the exact missing candidates instead of discarding findings',async()=>{
 const gaps=[{kind:'missing_in_visual',reaId:'child-a',label:'School'}];
 const deps={cycle:async()=>({stage:'primary_review'}),captureSelectors:async()=>[],call:async()=>({status:'needs_backfill',primary:{findings:gaps}})};
 const r=await runConstructionBuild({deps,task,authorization,primary:{matches:[]},evidence:'observed'});
 assert.deepEqual(r.gaps,gaps);assert.equal(r.agentItems[0].reaId,'child-a');
});
test('a page definition survives acquisition backfill before a company template exists',async()=>{
 let saved={},stage='primary_review',built;
 const deps={cycle:async()=>({stage}),captureSelectors:async()=>[],savePage:async page=>{saved.pageDefinition=page;},update:async()=>saved,profile:async()=>({}),template:async()=>null,
 call:async(tool,args)=>{if(tool==='form_review_completeness')return {status:'needs_backfill',primary:{findings:[]}};if(tool==='form_mapping_candidates')return {candidates:[]};if(tool==='form_build_template'){built=args.page;return {readyToRegister:false,pending:[{kind:'answer'}],blockers:[]};}throw Error(tool);}};
 const page={readySelector:'#ready',sections:['Info']};
 await runConstructionBuild({deps,task,authorization,page,primary:{matches:[]},evidence:'observed'});
 stage='build';await runConstructionBuild({deps,task,authorization});assert.deepEqual(built,page);
});
test('identity failures route to recovery and can be handed off with their existing evidence',()=>{
 for(const error of ['ROLE_OR_LOGIN_STATE_CHANGED_BEFORE_FILL','LOGIN_RETURN_ROLE_VERIFICATION_FAILED','ROLE_IDENTITY_MISMATCH','ROLE_PAGE_LOCATION_MISMATCH']){
  assert.deepEqual(workflowEnvelope({error}).continuation.nextTools,['role_advance']);
  assert.deepEqual(technicalHandoffReasons({operation:'mcp_error',error}),[error]);
 }
});
test('missing company assets remain construction work after repeated route queries',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'construction-route-'));
 try{for(let i=0;i<3;i++){
  const r=await recordOutcome({tool:'workflow_next',phase:'route',args:{companyId:'C00001'},env:{RECRUITING_STOP_LOSS_DIR:root},result:{blockers:[{reason:'COMPANY_FORM_ASSET_MISSING'}],continuation:{owner:'agent',state:'construct'}}});
  assert.equal(r.continuation.owner,'agent');assert.equal(r.repeatedFailure,undefined);
 }}finally{await rm(root,{recursive:true,force:true});}
});
test('different failed operations retain their own latest evidence in the same task',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'operation-evidence-')),records=new TaskRecords(root);
 try{
  for(const [tool,id] of [['form_test_interactions','test-error'],['role_advance','restore-error']])await withTaskRecords({taskId:'task-a',companyId:'C00001',roleId:'J000001',tool},()=>records.put('runs',id,{id,operation:'mcp_error',companyId:null,error:'ROLE_IDENTITY_MISMATCH'}));
  assert.equal((await records.get('runs','test-error')).companyId,'C00001');assert.equal((await records.get('runs','restore-error')).roleId,'J000001');
 }finally{await rm(root,{recursive:true,force:true});}
});

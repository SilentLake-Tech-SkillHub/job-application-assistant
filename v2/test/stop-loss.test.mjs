import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {registerWorkflowTool} from '../shared/workflow-contract.mjs';import {failureReasons} from '../shared/stop-loss.mjs';
const setup=async(tool,responder,extra={})=>{const dir=await mkdtemp(path.join(os.tmpdir(),'stop-loss-'));const env={RECRUITING_PRIVATE_DIR:dir,RECRUITING_WORKER_SOURCE_SHA256:'v1',...extra};let handler,calls=0;
 registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},tool,{},async a=>{calls++;return {content:[{type:'text',text:JSON.stringify(responder(a,calls))}]};},env);
 return {env,call:async a=>{const r=await handler(a);return {isError:r.isError===true,data:JSON.parse(r.content[0].text)};},calls:()=>calls};};
test('same technical failure twice on one task stops it and routes to handoff, third call never runs',async()=>{
 const t=await setup('role_verify',()=>({error:'BROWSER_HOST_OPERATION_FAILED',failureEvidenceId:'e1'}));
 const a={taskId:'task-a'};let r=await t.call(a);assert.equal(r.data.stopLoss,undefined);assert.notEqual(r.data.continuation.reason,'STOP_LOSS_REPEATED_FAILURE');
 r=await t.call(a);assert.equal(r.data.continuation.reason,'STOP_LOSS_REPEATED_FAILURE');assert.deepEqual(r.data.continuation.nextTools,['workflow_handoff','workflow_advance']);assert.equal(r.data.stopLoss.count,2);assert.deepEqual(r.data.stopLoss.evidenceIds,['e1']);
 r=await t.call(a);assert.equal(r.isError,true);assert.equal(r.data.error,'STOP_LOSS_REPEATED_FAILURE');assert.equal(t.calls(),2);
 r=await t.call({taskId:'task-b'});assert.notEqual(r.data.error,'STOP_LOSS_REPEATED_FAILURE');assert.equal(t.calls(),3);
});
test('ordinary value mismatches route to blocked record, not maintainer handoff',async()=>{
 const t=await setup('verify_current',()=>({status:'needs_attention',id:'run',checks:[{status:'match'},{status:'mismatch',reason:'VALUE_DIFFERS'}]}));
 await t.call({taskId:'x'});const r=await t.call({taskId:'x'});assert.deepEqual(r.data.continuation.nextTools,['company_batch_record','workflow_advance']);assert.equal(r.data.stopLoss.technical,false);
});
test('a new code version or a different failure resets the count',async()=>{
 let code='BROWSER_HOST_OPERATION_FAILED';const t=await setup('role_verify',()=>({error:code}));
 await t.call({taskId:'x'});code='PAGE_NOT_READY';let r=await t.call({taskId:'x'});assert.equal(r.data.stopLoss,undefined);
 r=await t.call({taskId:'x'});assert.equal(r.data.stopLoss.count,2);
 t.env.RECRUITING_WORKER_SOURCE_SHA256='v2';r=await t.call({taskId:'x'});assert.notEqual(r.isError,true);assert.equal(r.data.stopLoss,undefined);
});
test('success clears the record; user-owned waits never count',async()=>{
 let ok=false;const t=await setup('role_verify',()=>ok?{status:'verified'}:{error:'PAGE_NOT_READY'});
 await t.call({taskId:'x'});ok=true;await t.call({taskId:'x'});ok=false;const r=await t.call({taskId:'x'});assert.equal(r.data.stopLoss,undefined);
 assert.deepEqual(failureReasons({status:'needs_user_login',continuation:{owner:'user'}}),[]);
});
test('construction tools only stop on identical arguments',async()=>{
 const t=await setup('capture_choice_options',()=>({error:'ACTUAL_CAPTURED_OPTION_REQUIRED'}));
 await t.call({companyId:'c',selectors:['#a']});let r=await t.call({companyId:'c',selectors:['#b']});assert.equal(r.data.stopLoss,undefined);
 r=await t.call({companyId:'c',selectors:['#b']});assert.equal(r.data.stopLoss.count,2);
});
test('without a private directory or scope nothing is recorded',async()=>{
 let handler;registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},'role_verify',{},async()=>({content:[{type:'text',text:JSON.stringify({error:'PAGE_NOT_READY'})}]}),{});
 for(let i=0;i<3;i++){const d=JSON.parse((await handler({taskId:'x'})).content[0].text);assert.equal(d.stopLoss,undefined);}
});

test('host page loss and Ant date paging instability count as driver gaps for handoff',async()=>{
 const {isTechnicalFailure,technicalHandoffReasons}=await import('../shared/workflow-contract.mjs');
 assert.equal(isTechnicalFailure(['EXISTING_PAGE_NOT_FOUND']),true);assert.equal(isTechnicalFailure(['ANT_DATE_NAVIGATION_UNSTABLE']),true);
 assert.deepEqual(technicalHandoffReasons({checks:[{status:'mismatch',reason:'ANT_DATE_NAVIGATION_UNSTABLE'}]}),['ANT_DATE_NAVIGATION_UNSTABLE']);
 assert.equal(isTechnicalFailure(['VALUE_DIFFERS']),false);assert.equal(isTechnicalFailure(['UNANSWERED_FIELD_REQUIRES_USER_RESPONSE']),false);
});

test('each call adds count, elapsed time and returned bytes to one overwritten record per scope and tool',async()=>{
 const {readdir,readFile}=await import('node:fs/promises');
 const t=await setup('role_verify',()=>({status:'verified',padding:'x'.repeat(1000)}));
 await t.call({taskId:'m'});await t.call({taskId:'m'});
 const dir=path.join(t.env.RECRUITING_PRIVATE_DIR,'metrics'),files=await readdir(dir);assert.equal(files.length,1);
 const m=JSON.parse(await readFile(path.join(dir,files[0]),'utf8'));assert.equal(m.calls,2);assert.equal(m.scope,'m');assert.equal(m.tool,'role_verify');assert.ok(m.resultBytes>2000);assert.equal(JSON.stringify(m).includes('xxxx'),false);
});

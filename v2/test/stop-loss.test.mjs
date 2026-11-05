import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {registerWorkflowTool} from '../shared/workflow-contract.mjs';import {failureReasons,recordOutcome} from '../shared/stop-loss.mjs';
const setup=async(tool,responder,extra={})=>{const dir=await mkdtemp(path.join(os.tmpdir(),'stop-loss-'));const env={RECRUITING_PRIVATE_DIR:dir,RECRUITING_WORKER_SOURCE_SHA256:'v1',...extra};let handler,calls=0;
 registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},tool,{},async a=>{calls++;return {content:[{type:'text',text:JSON.stringify(responder(a,calls))}]};},env);
 return {env,call:async a=>{const r=await handler(a);return {isError:r.isError===true,data:JSON.parse(r.content[0].text)};},calls:()=>calls};};
test('a new code version or a different failure resets the count',async()=>{
 let code='BROWSER_HOST_OPERATION_FAILED';const t=await setup('role_verify',()=>({error:code}));
 await t.call({taskId:'x'});code='PAGE_NOT_READY';let r=await t.call({taskId:'x'});assert.equal(r.data.repeatedFailure,undefined);
 r=await t.call({taskId:'x'});assert.equal(r.data.repeatedFailure.count,2);
 t.env.RECRUITING_WORKER_SOURCE_SHA256='v2';r=await t.call({taskId:'x'});assert.notEqual(r.isError,true);assert.equal(r.data.repeatedFailure,undefined);
});
test('success clears the record; user-owned waits never count',async()=>{
 let ok=false;const t=await setup('role_verify',()=>ok?{status:'verified'}:{error:'PAGE_NOT_READY'});
 await t.call({taskId:'x'});ok=true;await t.call({taskId:'x'});ok=false;const r=await t.call({taskId:'x'});assert.equal(r.data.repeatedFailure,undefined);
 assert.deepEqual(failureReasons({status:'needs_user_login',continuation:{owner:'user'}}),[]);
});
test('construction tools only stop on identical arguments',async()=>{
 const t=await setup('capture_choice_options',()=>({error:'ACTUAL_CAPTURED_OPTION_REQUIRED'}));
 await t.call({companyId:'c',selectors:['#a']});let r=await t.call({companyId:'c',selectors:['#b']});assert.equal(r.data.repeatedFailure,undefined);
 r=await t.call({companyId:'c',selectors:['#b']});assert.equal(r.data.repeatedFailure.count,2);
});
test('without a private directory or scope nothing is recorded',async()=>{
 let handler;registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},'role_verify',{},async()=>({content:[{type:'text',text:JSON.stringify({error:'PAGE_NOT_READY'})}]}),{});
 for(let i=0;i<3;i++){const d=JSON.parse((await handler({taskId:'x'})).content[0].text);assert.equal(d.repeatedFailure,undefined);}
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

test('T9 the same real failure twice asks the user with the failed fields; the third call still runs and nothing is locked',async()=>{
 const t=await setup('role_verify',()=>({status:'needs_attention',id:'run',deferredControls:[{id:'f1',label:'School',source:'education.a.school',reason:'CONTROL_NOT_ON_PAGE'}]}));
 const a={taskId:'task-a'};let r=await t.call(a);assert.equal(r.data.repeatedFailure,undefined);
 r=await t.call(a);assert.equal(r.data.continuation.state,'ask_user');assert.equal(r.data.continuation.owner,'user');assert.equal(r.data.continuation.requiresUser,true);assert.equal(r.data.continuation.continueWithOtherCompanies,true);
 assert.deepEqual(r.data.repeatedFailure.fields,[{id:'f1',label:'School',source:'education.a.school',reason:'CONTROL_NOT_ON_PAGE'}]);assert.deepEqual(r.data.repeatedFailure.evidenceIds,['run']);
 r=await t.call(a);assert.notEqual(r.isError,true);assert.equal(t.calls(),3);assert.equal(r.data.continuation.state,'ask_user');
 r=await t.call({taskId:'task-b'});assert.equal(r.data.repeatedFailure,undefined);assert.equal(t.calls(),4);
});
test('T9 a refreshed page, recovery or lost page never counts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'stop-t9-'));
 try{
  const env={RECRUITING_STOP_LOSS_DIR:dir},args={taskId:'task'},failing=error=>({error,continuation:{owner:'agent'}});
  for(const code of ['BROWSER_DOCUMENT_CHANGED_REBIND_REQUIRED','ROLE_BROWSER_PAGE_LOST','VERIFIED_ROLE_PAGE_BINDING_REQUIRED','BROWSER_RESTORE_ALREADY_ATTEMPTED','PAGE_OR_ROLE_IDENTITY_CHANGED','REPEAT_CONTRACT_LEARNED'])for(let i=0;i<3;i++){
   const out=await recordOutcome({tool:'role_prepare',phase:'fill',args,result:failing(code),env});assert.equal(out.repeatedFailure,undefined,code);
  }
  await recordOutcome({tool:'role_prepare',phase:'fill',args,result:failing('FILL_VALUE_REJECTED'),env});
  assert.equal((await recordOutcome({tool:'role_prepare',phase:'fill',args,result:failing('FILL_VALUE_REJECTED'),env})).repeatedFailure.count,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('different arguments or a changed capture are a different failure',async()=>{
 const t=await setup('capture_choice_options',()=>({error:'ACTUAL_CAPTURED_OPTION_REQUIRED'})),dir=path.join(t.env.RECRUITING_PRIVATE_DIR,'runs');await mkdir(dir,{recursive:true});
 const file=path.join(dir,'capture-C00001.json'),capture={companyId:'S0001',formId:'C00001',pageUrl:'https://example.test/form',provider:null,controls:[{selector:'#a',label:'Original'}],observedAt:'first'};
 try{
  await writeFile(file,JSON.stringify(capture));const args={companyId:'S0001',captureId:'capture-C00001',selectors:['#a']};await t.call(args);
  assert.equal((await t.call({...args,selectors:['#b']})).data.repeatedFailure,undefined);
  await t.call(args);capture.observedAt='later';await writeFile(file,JSON.stringify(capture));assert.equal((await t.call(args)).data.repeatedFailure.count,2);
  capture.controls[0].label='Changed';await writeFile(file,JSON.stringify(capture));assert.equal((await t.call(args)).data.repeatedFailure,undefined);
 }finally{await rm(t.env.RECRUITING_PRIVATE_DIR,{recursive:true,force:true});}
});

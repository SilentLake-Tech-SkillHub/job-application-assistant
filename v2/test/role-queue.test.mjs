import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';import path from 'node:path';
import {RoleQueue} from '../shared/role-queue.mjs';import {RoleFlow} from '../shared/role-flow.mjs';
import {CompanyDirectory} from '../shared/company-directory.mjs';import {handoffInput} from '../shared/queue-config.mjs';
import {readOutcomes,recordObservation} from '../shared/application-outcome.mjs';
import {companyDoc,site,role,confirm,saveCompany,handoffWorkspace} from './fixtures/handoff.mjs';

const urlA='https://example.com/campus/role/A',urlB='https://example.com/campus/role/B';
// 一家公司（C00001）一个站点（S0001），两个岗位：A 第 1 志愿、B 第 2 志愿（文件里 B 在前）。
const sample=({selected=['J000001','J000002']}={})=>companyDoc({code:'C00001',name:'样例',batchId:'synthetic',sites:[site('S0001','https://example.com')],
 roles:[role('J000002','S0001','Role B',urlB,{'官方岗位ID':'B','志愿顺序':2}),role('J000001','S0001','Role A',urlA,{'官方岗位ID':'A','志愿顺序':1})],selected});
async function fixture(fn,doc=sample()){
 const dir=await handoffWorkspace([confirm(doc)]),catalog=await new CompanyDirectory({handoffDir:dir}).load();
 const queues=new RoleQueue({root:path.join(dir,'queue'),catalog,inputAdapter:handoffInput(dir)});
 const save=async d=>saveCompany(dir,d);
 try{await fn({dir,doc,save,queues,catalog});}finally{await rm(dir,{recursive:true,force:true});}
}
const loginFor=()=>({company:async()=>({companyId:'S0001',origin:'https://example.com',allowedPaths:['/campus/'],fields:{root:'.login'},account:{selector:'.account',source:'phone',countryCode:'+86'}}),locked:async(c,fn)=>fn(),profile:async()=>({facts:{phone:{status:'known',value:'13800001234',sourceIds:['synthetic']}}})});
const onlyA=()=>sample({selected:['J000001']});

test('queue uses the confirmed 志愿顺序 rather than file order and blocks jumping ahead',()=>fixture(async({queues})=>{
 const q=await queues.import({});assert.deepEqual(q.tasks.map(t=>[t.companyId,t.companyCode,t.roleId]),[['S0001','C00001','J000001'],['S0001','C00001','J000002']]);
 await assert.rejects(queues.task({...q,taskId:q.tasks[1].taskId}),/CONFIRMED_ROLE_ORDER_BLOCKED/);
 await queues.put(q.tasks[0].taskId,{status:'ready_for_user_review'});assert.equal((await queues.task({...q,taskId:q.tasks[1].taskId})).t.roleId,'J000002');
}));

test('a changed confirmed company file blocks the frozen task; legacy plan inputs are refused',()=>fixture(async({doc,save,queues,catalog})=>{
 const q=await queues.import({});
 const edited=confirm(doc);edited['岗位'][1]['岗位链接']='https://example.com/campus/role/A2';await save(edited);
 await assert.rejects(queues.task({...q,taskId:q.tasks[0].taskId}),/HANDOFF_CHANGED_AFTER_CONFIRMATION|ROLE_INPUT_CHANGED/);
 await assert.rejects(queues.import({rolesFile:'/x/公司方案.json'}),/HANDOFF_BATCH_REQUIRED/);
 await assert.rejects(queues.import({companyPlan:{schemaVersion:1}}),/HANDOFF_BATCH_REQUIRED/);
 assert.throws(()=>new RoleQueue({root:'/tmp/none',catalog}),/HANDOFF_INPUT_ADAPTER_REQUIRED/);
 const forged=new RoleQueue({root:'/tmp/none',catalog,inputAdapter:async()=>({input:{schemaVersion:1,batchId:'b',companies:[]},source:{kind:'object'}})});
 await assert.rejects(forged.import({}),/HANDOFF_BATCH_REQUIRED/);
}));

test('duplicate order, a role off its site and an unknown site fail before browser',async()=>{
 const dup=sample();dup['岗位'][0]['志愿顺序']=1;
 await fixture(async({queues})=>{await assert.rejects(queues.import({}),/INVALID_CONFIRMED_ROLE_ORDER/);},dup);
 const off=sample();off['岗位'][0]['岗位链接']='https://other.example/role';
 await fixture(async({queues})=>{await assert.rejects(queues.import({}),/INVALID_CONFIRMED_ROLE_URL/);},off);
 await fixture(async({dir,queues})=>{queues.catalog=queues.catalog.map(c=>({...c,siteId:'S0009'}));await assert.rejects(queues.import({}),/INVALID_CONFIRMED_ROLE_URL/);});
});

test('roles with a recorded outcome are protected by role code until the user reviews them',()=>fixture(async({dir,queues})=>{
 await writeFile(path.join(dir,'投递回传.json'),JSON.stringify({schemaVersion:2,roles:{J000002:{event:'submission_confirmed'},J000001:{event:'submission_uncertain'}},observations:[]}));
 const q=await queues.import({});assert.equal(q.tasks.length,0);
 assert.deepEqual(q.protectedRoles.map(p=>[p.roleId,p.reason]),[['J000001','outcome_requires_resolution'],['J000002','already_submitted']]);
}));

test('first navigation is role URL, login redirect preserves task and resume restores original tab',()=>fixture(async({queues})=>{
 const q=await queues.import({}),args={...q,taskId:q.tasks[0].taskId};let loggedIn=false,wrongTitle=false,closed=false;let pageUrl='about:blank';const calls=[];
 const browser={request:async(method,a)=>{calls.push({method,...a});if(method==='tabs'){if(closed)throw Error('ROLE_BROWSER_PAGE_LOST');return [{id:'same-tab',url:pageUrl}];}if(method==='openPage'){pageUrl=loggedIn?a.pageUrl:'https://example.com/campus/login';return {pageId:'same-tab',pageUrl};}if(method==='roleSnapshot'){if(closed)throw Error('ROLE_BROWSER_PAGE_LOST');return {pageUrl,roleTitle:loggedIn?(wrongTitle?'Wrong role':'Role A'):null,account:loggedIn?'1380****234':null,loginFormPresent:!loggedIn,readAt:new Date().toISOString()};}}};
 const login={...loginFor(),compile:async a=>{assert.equal(a.taskContext.returnUrl,urlA);return {planId:'synthetic',planHash:'h'};}};
 const flow=new RoleFlow({queues,login,browser,templates:async()=>({pages:[{pathPrefix:'/campus/role/',roleTitle:'Role A',roleSelector:'.title',readySelector:'.form'}]})});
 const opened=await flow.open(args);assert.equal(opened.status,'needs_login');assert.equal(calls.find(x=>x.method==='openPage').pageUrl,urlA);
 loggedIn=true;pageUrl='https://example.com/campus/';const restored=await flow.resume(args);assert.equal(restored.status,'ready_to_fill');assert.equal(restored.originalRoleRestored,true);assert.equal(calls.filter(x=>x.method==='openPage').at(-1).pageId,'same-tab');
 wrongTitle=true;await assert.rejects(flow.resume(args),/LOGIN_RETURN_ROLE_VERIFICATION_FAILED/);
 closed=true;await assert.rejects(flow.resume(args),/ROLE_BROWSER_PAGE_LOST/);
}));

test('explicit parallel roles skip only same-company predecessor; default still serial',()=>fixture(async({queues})=>{
 const q=await queues.import({parallelRoles:true,authorizationRef:'synthetic explicit parallel authorization'});assert.equal((await queues.task({...q,taskId:q.tasks[1].taskId})).t.roleId,'J000002');
 await assert.rejects(queues.import({parallelRoles:true}),/PARALLEL_ROLE_AUTHORIZATION_REQUIRED/);
}));

test('observed application entry is persisted and reuses its original tab',()=>fixture(async({queues})=>{
 const q=await queues.import({}),task=q.tasks[0],args={...q,taskId:task.taskId};
 await queues.put(task.taskId,{queueId:q.queueId,pageId:'original-tab',status:'authenticated_at_role'});
 const calls=[],apply='https://example.com/campus/resume/123/apply';
 const browser={request:async(method,a)=>{calls.push({method,...a});if(method==='openPage')return {pageId:'original-tab',pageUrl:a.pageUrl};if(method==='roleSnapshot')return {account:'1380****234',loginFormPresent:false};if(method==='roleEnterApplication')return {pageId:'original-tab',pageUrl:apply,roleTitle:'Role A',accountMatched:true};}};
 const r=await new RoleFlow({queues,login:loginFor(),browser}).enter(args);assert.equal(r.status,'ready_to_fill');assert.equal(r.observation,undefined);
 const saved=await queues.read(task.taskId);assert.equal(saved.applicationUrl,apply);assert.equal(saved.returnUrl,apply);assert.equal(calls.find(c=>c.method==='openPage').pageId,'original-tab');
 await new RoleFlow({queues,login:loginFor(),browser}).enter(args);assert.equal(calls.filter(x=>x.method==='openPage').at(-1).pageUrl,apply);
},onlyA()));

test('an empty 投递链接 is observed once on first verified entry; an existing one is not re-reported; nothing is written to the company file',()=>fixture(async({dir,queues})=>{
 const file=path.join(dir,'公司','C00001.json'),before=await readFile(file,'utf8');
 const q=await queues.import({}),task=q.tasks[0],args={...q,taskId:task.taskId},apply='https://example.com/campus/apply/A';let url;const opened=[];
 const browser={request:async(method,a)=>{if(method==='openPage'){url=a.pageUrl;opened.push(url);return {pageId:'tab',pageUrl:url};}if(method==='roleEnterApplication')return {pageId:'tab',pageUrl:apply,roleTitle:'Role A',accountMatched:true};return {pageUrl:url,account:'1380****234',loginFormPresent:false};}};
 const flow=new RoleFlow({queues,login:loginFor(),browser,templates:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},onObservation:o=>recordObservation({...o,handoffDir:dir})});
 const r=await flow.open(args);assert.equal(r.status,'authenticated_at_role');assert.equal(opened[0],urlA);
 const e=await flow.enter(args);assert.equal(e.observation,'observed');
 assert.deepEqual((await readOutcomes(dir)).observations.map(o=>[o.kind,o.code,o.field,o.value,o.evidence]),[['role','J000001','投递链接',apply,'role_enter_application_verified']]);
 assert.equal(await readFile(file,'utf8'),before);
 const failing=new RoleFlow({queues,login:loginFor(),browser,onObservation:async()=>{throw Error('OUTCOME_WRITE_LOCKED');}});
 await queues.put(task.taskId,{queueId:q.queueId,status:'authenticated_at_role'});
 assert.equal((await failing.enter(args)).observation,'write_failed:OUTCOME_WRITE_LOCKED');
},onlyA()));

test('a known 投递链接 is used directly and not re-observed; when it fails the task re-enters from the role link and reports the new address',async()=>{
 const doc=onlyA();doc['岗位'][1]['投递链接']='https://example.com/campus/apply/old';
 await fixture(async({dir,queues})=>{
  const q=await queues.import({}),task=q.tasks[0],args={...q,taskId:task.taskId},apply='https://example.com/campus/apply/new';let url;const opened=[];const seen=[];
  const browser={request:async(method,a)=>{if(method==='openPage'){url=a.pageUrl;opened.push(url);return {pageId:'tab',pageUrl:url};}if(method==='roleEnterApplication')return {pageId:'tab',pageUrl:apply,roleTitle:'Role A',accountMatched:true};return {pageUrl:url,account:'1380****234',loginFormPresent:false};}};
  const flow=new RoleFlow({queues,login:loginFor(),browser,templates:async()=>({pages:[{pathPrefix:'/campus/apply/',roleTitle:'Role A',readySelector:'.form'}]}),onObservation:async o=>{seen.push(o);return recordObservation({...o,handoffDir:dir});}});
  // 申请页有覆盖它的表单模板：直接从已知投递链接进入
  await assert.rejects(flow.open(args),/LOGIN_RETURN_ROLE_VERIFICATION_FAILED/);assert.equal(opened.at(-1),'https://example.com/campus/apply/old');
  // 报“投递链接打不开”：记失效观察，任务改从岗位链接进入
  await assert.rejects(flow.reportLinkFailure({...args,field:'投递链接',evidence:' '}),/OBSERVATION_EVIDENCE_REQUIRED/);
  await assert.rejects(flow.reportLinkFailure({...args,field:'登录链接',evidence:'x'}),/INVALID_OBSERVATION/);
  const reported=await flow.reportLinkFailure({...args,field:'投递链接',evidence:'打开后跳到首页'});assert.equal(reported.status,'observed');assert.equal(reported.nextStep,'role_open');
  const ctx=await flow.context(args);assert.equal(ctx.target,urlA);assert.equal(ctx.t.applyUrl,null);
  await flow.open(args);assert.equal(opened.at(-1),urlA);
  const e=await flow.enter(args);assert.equal(e.observation,'observed');
  assert.deepEqual((await readOutcomes(dir)).observations.map(o=>[o.field,o.value]),[['投递链接',apply]]);
  assert.deepEqual(seen.map(o=>[o.field,o.value]),[['投递链接',null],['投递链接',apply]]);
  // 岗位链接打不开：只记失效观察
  const failed=await flow.reportLinkFailure({...args,field:'岗位链接',evidence:'404'});assert.equal(failed.field,'岗位链接');
  assert.deepEqual((await readOutcomes(dir)).observations.map(o=>[o.field,o.value]),[['投递链接',apply],['岗位链接',null]]);
 },doc);
});

test('a new company form is not a prerequisite for opening its confirmed role',()=>fixture(async({queues})=>{
 const q=await queues.import({}),args={...q,taskId:q.tasks[0].taskId};
 let url;const browser={request:async(method,a)=>{if(method==='openPage'){url=a.pageUrl;return {pageId:'existing',pageUrl:url};}return {pageUrl:url,account:'1380****234',loginFormPresent:false};}};
 const flow=new RoleFlow({queues,login:loginFor(),browser,templates:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}});
 const r=await flow.open(args);assert.equal(r.status,'authenticated_at_role');assert.deepEqual(r.nextTools,['role_enter_application']);assert.equal(r.formAssetRequiredBeforeFill,true);
},onlyA()));

test('re-importing the same confirmed batch returns the same queue and the same task IDs; no new tasks, no new tabs',()=>fixture(async({queues})=>{
 const a=await queues.import({}),b=await queues.import({});assert.equal(b.reused,true);assert.equal(b.queueId,a.queueId);assert.deepEqual(b.tasks.map(t=>t.taskId),a.tasks.map(t=>t.taskId));assert.equal((await queues.queues()).length,1);
}));
test('a changed confirmation makes a new queue that supersedes the old one; each role keeps its bound tab; task records stay unique',()=>fixture(async({queues,doc,save})=>{
 const a=await queues.import({});await queues.put(a.tasks[0].taskId,{queueId:a.queueId,taskId:a.tasks[0].taskId,pageId:'chrome:tab-a',status:'authenticated_at_role'});await queues.put(a.tasks[1].taskId,{queueId:a.queueId,taskId:a.tasks[1].taskId,status:'opened'});
 const changed=structuredClone(doc);changed['岗位'][0]['岗位名称']='Role B (renamed)';await save(confirm(changed));
 const b=await queues.import({});assert.notEqual(b.queueId,a.queueId);assert.deepEqual(b.supersededQueues,[a.queueId]);assert.equal(b.carriedPageBindings,1);
 assert.deepEqual(b.tasks.map(t=>t.taskId),a.tasks.map(t=>t.taskId));
 const kept=await queues.read(b.tasks[0].taskId);assert.deepEqual([kept.queueId,kept.pageId,kept.status],[b.queueId,'chrome:tab-a','rebind_required']);
 await assert.rejects(queues.read(b.tasks[1].taskId),{code:'ENOENT'});assert.equal((await queues.queues()).length,1);
 assert.deepEqual([...(await queues.boundPages())],[['chrome:tab-a',b.tasks[0].taskId]]);
}));
test('confirming the redirected role link mid-run keeps the same tab and progress; any other link change keeps only the tab',()=>fixture(async({queues,doc,save})=>{
 const q=await queues.import({}),task=q.tasks[0],landed='https://example.com/campus/role/A-landed';
 await queues.put(task.taskId,{queueId:q.queueId,taskId:task.taskId,pageId:'chrome:tab',originalRoleUrl:urlA,returnUrl:'https://example.com/campus/apply/A',applicationUrl:'https://example.com/campus/apply/A',status:'ready_for_user_review',fillRunId:'f',verifyRunId:'v',siteRoleId:'A2',landedDetailUrl:landed});
 const relink=async(url,prev)=>{const d=structuredClone(doc);d['岗位'][1]['岗位链接']=url;const c=confirm(d);Object.assign(c['批次']['确认'],{scope:'links_only',previousContentSha256:prev});await save(c);return c;};
 const first=await relink(landed,confirm(doc)['批次']['确认'].contentSha256);
 const after=await queues.refreshMaterials({...q,authorizationRef:'用户：换成跳转后的链接'});
 const kept=await queues.read(task.taskId);assert.deepEqual([kept.status,kept.pageId,kept.fillRunId,kept.verifyRunId,kept.originalRoleUrl,kept.returnUrl],['ready_for_user_review','chrome:tab','f','v',landed,'https://example.com/campus/apply/A']);
 await relink('https://example.com/campus/role/A-other',first['批次']['确认'].contentSha256);
 await queues.refreshMaterials({...after,authorizationRef:'用户：换成另一条链接'});
 const rebound=await queues.read(task.taskId);assert.deepEqual([rebound.status,rebound.pageId,rebound.fillRunId,rebound.siteRoleId,rebound.carriedFrom.hadFill],['rebind_required','chrome:tab',undefined,undefined,true]);
},onlyA()));

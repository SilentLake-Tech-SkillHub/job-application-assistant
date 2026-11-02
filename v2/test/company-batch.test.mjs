import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../shared/engine.mjs';import {RoleQueue} from '../shared/role-queue.mjs';import {CompanyBatch} from '../shared/company-batch.mjs';
import {createHash} from 'node:crypto';
import {CompanyDirectory} from '../shared/company-directory.mjs';import {handoffInput} from '../shared/queue-config.mjs';
import {companyDoc,site,role,confirm,saveCompany,handoffWorkspace} from './fixtures/handoff.mjs';
const pad=(n,w)=>String(n).padStart(w,'0');
// 交接区里 n 家公司，各一个站点、一个岗位；addRole(i) 给第 i 家补第二个岗位（志愿顺序 2）后按用户确认重新保存。
async function fixture(fn,n=24){const root=await mkdtemp(path.join(os.tmpdir(),'company-batch-'));
 const docs=Array.from({length:n},(_,i)=>{const o=`https://c${i}.example.com`,S='S'+pad(i+1,4);return companyDoc({code:'C'+pad(i+1,5),name:'公司'+i,order:i+1,batchId:'synthetic',sites:[site(S,o)],roles:[role('J'+pad(i+1,6),S,'Role',o+'/role/1',{'志愿顺序':1})]});});
 const dir=await handoffWorkspace(docs.map(d=>confirm(d)));
 const addRole=async i=>{const d=docs[i],S=d['站点'][0]['站点编码'],J='J'+pad(100+i,6);d['岗位'].push(role(J,S,'Role',d['站点'][0]['站点']+'/role/2',{'志愿顺序':2}));d['批次']['选中岗位'].push(J);await saveCompany(dir,confirm(d));return J;};
 const catalog=await new CompanyDirectory({handoffDir:dir}).load();
 const store=new Store(path.join(root,'store')),queues=new RoleQueue({root:path.join(root,'queues'),catalog,inputAdapter:handoffInput(dir)});let now=1000000;const batch=new CompanyBatch({store,queues,catalog,browser:{executionCapabilities:async()=>({channels:{chrome:{available:true,provider:'local_cdp_chrome'},iab:{available:true,provider:'official_host_browser_sdk'}},capability:{status:'detected',channels:['chrome','iab'],mode:'dual'}})},clock:()=>now,leaseRoot:root});
 try{await fn({catalog,addRole,store,queues,batch,setChannels:async(i,channels)=>{docs[i]['批次']['执行']={browserChannels:channels};await saveCompany(dir,confirm(docs[i]));},tick:()=>now+=31*60*1000});}finally{await rm(root,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});}}
test('default takes ten companies per channel, not ten roles; repeat take cannot duplicate',()=>fixture(async({batch,addRole})=>{await addRole(0);const b=await batch.create({authorizationRef:'synthetic approved batch'}),r=await batch.take(b);assert.deepEqual(r.activeCompanies,{chrome:10,iab:10});assert.equal(r.assignments.length,20);assert.equal(r.assignments[0].tasks.length,2);assert.equal(r.pendingCompanies,4);assert.equal(r.browserExecuted,false);assert.equal((await batch.take(b)).assignments.length,0);}));
test('same verified login scope is pinned to one channel; a waiting login does not block the other',()=>fixture(async({batch,catalog,queues})=>{catalog[1].loginScope=catalog[0].origin;catalog[0].loginScope=catalog[0].origin;const b=await batch.create({authorizationRef:'synthetic',companiesPerChannel:2}),r=await batch.take(b);assert.equal(r.assignments[0].channel,r.assignments[1].channel);const a=r.assignments[0];await queues.put(a.tasks[0].taskId,{status:'needs_login',loginPlan:{planId:'observed-login'}});await batch.record({...b,...a,status:'waiting_for_user'});assert.equal((await batch.status(b)).companies[0].status,'waiting_for_user');assert.equal(r.activeCompanies.iab,2);}));
test('wrong lease, forged success and expired task are refused without browser work',()=>fixture(async({batch,tick})=>{const b=await batch.create({authorizationRef:'synthetic'}),r=await batch.take(b),a=r.assignments[0];await assert.rejects(batch.record({...b,...a,channel:'iab',status:'running'}),/LEASE_MISMATCH/);await assert.rejects(batch.record({...b,...a,status:'ready_for_user_review'}),/RUN_EVIDENCE_REQUIRED/);tick();await assert.rejects(batch.record({...b,...a,status:'running'}),/LEASE_MISMATCH/);await batch.take(b);assert.equal((await batch.status(b)).companies[0].status,'blocked');}));
test('company concurrency releases another company but retains within-company role order',()=>fixture(async({batch,addRole,queues})=>{await addRole(0);const b=await batch.create({authorizationRef:'synthetic'}),q=b.queue;assert.equal(q.executionMode,'parallel_companies');await assert.rejects(queues.task({...q,taskId:q.tasks[1].taskId}),/ROLE_ORDER_BLOCKED/);assert.equal((await queues.task({...q,taskId:q.tasks[2].taskId})).t.companyId,'S0002');}));
test('creating the same confirmed batch again returns the existing run instead of a competing second batch',()=>fixture(async({batch})=>{const a=await batch.create({authorizationRef:'first'}),b=await batch.create({authorizationRef:'second'});assert.equal(b.reused,true);assert.equal(b.batchId,a.batchId);assert.equal(b.queue.queueId,a.queue.queueId);assert.deepEqual(b.queue.tasks.map(t=>t.taskId),a.queue.tasks.map(t=>t.taskId));const first=await batch.take(a);assert.ok(first.assignments.length>0);const again=await batch.take({batchId:b.batchId,batchHash:b.batchHash});assert.equal(again.assignments.length,0);}));
test('runs created before the queue index are still found through the scope owners and released',()=>fixture(async({batch,store,addRole})=>{
 const a=await batch.create({authorizationRef:'first'});await batch.take(a);await store.put('runs','company-batch-by-queue',{});
 await addRole(0);const b=await batch.create({authorizationRef:'second'});assert.equal((await batch.take(b)).assignments.length,20);assert.ok((await store.get('runs',a.batchId)).closedAt);
}));
test('a changed confirmation supersedes the old queue and run: old run closed, its login scopes released, page bindings carried by role',()=>fixture(async({batch,queues,addRole})=>{
 const a=await batch.create({authorizationRef:'first'}),taken=await batch.take(a),t0=taken.assignments[0].tasks[0];
 await queues.put(t0.taskId,{queueId:a.queue.queueId,taskId:t0.taskId,pageId:'chrome:kept-tab',status:'ready_to_fill',siteRoleId:'landed-id'});
 await addRole(0);const b=await batch.create({authorizationRef:'second'});
 assert.notEqual(b.batchId,a.batchId);assert.deepEqual(b.queue.supersededQueues,[a.queue.queueId]);assert.equal(b.queue.carriedPageBindings,1);
 const carried=await queues.read(t0.taskId);assert.deepEqual([carried.queueId,carried.pageId,carried.status,carried.siteRoleId],[b.queue.queueId,'chrome:kept-tab','rebind_required','landed-id']);
 assert.equal((await queues.queues()).length,1);await assert.rejects(batch.take(a),/ENOENT/);
 const r=await batch.take(b);assert.equal(r.assignments.length,20);
}));
test('parallelRoles option in company_batch_create enables intra-company role concurrency alongside dual-channel company concurrency',()=>fixture(async({batch,addRole,queues})=>{await addRole(0);const b=await batch.create({authorizationRef:'synthetic-dual-layer',parallelRoles:true}),q=b.queue;assert.equal(b.parallelRoles,true);assert.equal(q.executionMode,'parallel_companies');assert.equal(q.parallelRoles,true);assert.equal((await queues.task({...q,taskId:q.tasks[1].taskId})).t.roleId,'J000100');assert.equal((await queues.task({...q,taskId:q.tasks[2].taskId})).t.companyId,'S0002');}));

test('an explanation alone cannot turn technical work into a user wait or company completion',()=>fixture(async({batch})=>{
 const b=await batch.create({authorizationRef:'synthetic'}),r=await batch.take(b),a=r.assignments[0];
 await assert.rejects(batch.record({...b,...a,status:'waiting_for_user',reason:'driver missing'}),/USER_WAIT_EVIDENCE_REQUIRED/);
 await assert.rejects(batch.record({...b,...a,status:'blocked',reason:'driver missing'}),/VERIFIED_BLOCK_HANDOFF_REQUIRED/);
}));

test('company completion requires an independent receipt for the exact role materials',()=>fixture(async({batch,queues,store})=>{
 const b=await batch.create({authorizationRef:'synthetic'}),a=(await batch.take(b)).assignments[0],task=a.tasks[0];
 await queues.put(task.taskId,{status:'ready_for_user_review',verifyRunId:'material-verify',applicationUrl:task.url});
 const run={id:'material-verify',operation:'verify_current',companyId:task.companyId,pageUrl:task.url,status:'verified',checks:[{id:'field',status:'match'}]};
 await store.put('runs',run.id,run);
 const args={...b,...a,status:'ready_for_user_review',runIds:[run.id]};
 await assert.rejects(batch.record(args),/ROLE_MATERIAL_VERIFICATION_REQUIRED/);
 run.materialCoverage={enabled:true,complete:true,materialsHash:'wrong-hash'};await store.put('runs',run.id,run);await assert.rejects(batch.record(args),/ROLE_MATERIAL_VERIFICATION_REQUIRED/);
 run.materialCoverage.materialsHash=createHash('sha256').update(JSON.stringify(task.materials)).digest('hex');await store.put('runs',run.id,run);assert.equal((await batch.record(args)).status,'ready_for_user_review');
},1));


test('confirmed company browser channels survive import and allow a Chrome-only exception without changing others',()=>fixture(async({batch,setChannels})=>{
 await setChannels(0,['chrome']);await setChannels(1,['chrome']);await setChannels(2,['iab']);
 const b=await batch.create({authorizationRef:'confirmed per-company channels'}),a=(await batch.take(b)).assignments;
 assert.equal(a[0].channel,'chrome');assert.equal(a[1].channel,'chrome');assert.equal(a[2].channel,'iab');
 assert.deepEqual((await batch.status(b)).companies.map(c=>c.allowedChannels),[['chrome'],['chrome'],['iab'],['chrome','iab']]);
},4));
test('missing true IAB refuses the default batch before creating a queue or changing an old assignment',()=>fixture(async({batch,queues})=>{
 batch.browser={executionCapabilities:async()=>({channels:{chrome:{available:true},iab:{available:false,reason:'IAB_HOST_BRIDGE_REQUIRED'}},capability:{status:'detected',channels:['chrome','iab']}})};
 await assert.rejects(batch.create({authorizationRef:'dual default'}),/IAB_HOST_BRIDGE_REQUIRED/);assert.equal((await queues.queues()).length,0);
},2));
test('explicitly confirmed Chrome-only company batch does not require absent IAB',()=>fixture(async({batch,setChannels})=>{
 await setChannels(0,['chrome']);batch.browser={executionCapabilities:async()=>({channels:{chrome:{available:true},iab:{available:false}}})};
 const b=await batch.create({authorizationRef:'one company Chrome-only'});assert.equal((await batch.take(b)).assignments[0].channel,'chrome');
},1));
test('channel restriction requires company scope and preserves unselected company policies and page state',()=>fixture(async({batch,queues})=>{
 const b=await batch.create({authorizationRef:'dual'}),assignments=(await batch.take(b)).assignments,selected=assignments.find(a=>a.channel==='iab'),other=assignments.find(a=>a.channel==='iab'&&a.companyId!==selected.companyId);
 for(const a of [selected,other])await queues.put(a.tasks[0].taskId,{pageId:'iab:'+a.companyId,returnUrl:a.tasks[0].url,status:'ready_to_fill'});
 await assert.rejects(batch.restrictChannels({...b,channels:['chrome'],authorizationRef:'only selected firm'}),/COMPANY_SCOPE_REQUIRED/);
 const result=await batch.restrictChannels({...b,companyIds:[selected.companyId],channels:['chrome'],authorizationRef:'only selected firm'});
 assert.equal(result.moved.length,1);assert.equal(result.moved[0].companyId,selected.companyId);
 const status=await batch.status(b);assert.deepEqual(status.channels,['chrome','iab']);assert.deepEqual(status.companies.find(c=>c.companyId===other.companyId).allowedChannels,['chrome','iab']);
 assert.equal((await queues.read(other.tasks[0].taskId)).pageId,'iab:'+other.companyId);
 assert.equal((await queues.read(selected.tasks[0].taskId)).previousBrowserBinding.pageId,'iab:'+selected.companyId);
},4));
test('default channels come only from the recorded capability file; without it no batch is created',()=>fixture(async({batch,queues})=>{
 batch.browser={executionCapabilities:async()=>({channels:{chrome:{available:true},iab:{available:true}},capability:{status:'detection_required',channels:[]}})};
 await assert.rejects(batch.create({authorizationRef:'no capability'}),/BROWSER_CAPABILITY_DETECTION_REQUIRED/);assert.equal((await queues.queues()).length,0);
 batch.browser={executionCapabilities:async()=>({channels:{chrome:{available:true},iab:{available:true}},capability:{status:'detected',channels:['chrome'],mode:'single'}})};
 const b=await batch.create({authorizationRef:'chrome only host'});assert.deepEqual((await batch.status(b)).companies.map(c=>c.allowedChannels),[['chrome'],['chrome']]);
},2));
test('a detected host without any usable channel (Chrome not installed, no built-in browser) stops with one explicit next step; an explicit batch channel still works',()=>fixture(async({batch,queues,setChannels})=>{
 batch.browser={executionCapabilities:async()=>({channels:{chrome:{available:true},iab:{available:false}},capability:{status:'detected',channels:[],iab:'agent_only',chrome:'not_installed'}})};
 await assert.rejects(batch.create({authorizationRef:'agent-only host'}),error=>error.message==='NO_USABLE_BROWSER_CHANNEL'&&/chrome-clone\.mjs status/.test(error.details.nextStep)&&!/Playwright/.test(error.details.nextStep));assert.equal((await queues.queues()).length,0);
 await setChannels(0,['chrome']);await setChannels(1,['chrome']);const b=await batch.create({authorizationRef:'user confirmed chrome'});assert.deepEqual((await batch.status(b)).companies.map(c=>c.allowedChannels),[['chrome'],['chrome']]);
},2));

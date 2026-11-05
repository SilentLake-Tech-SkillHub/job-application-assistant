import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Engine,Store,hash} from '../shared/engine.mjs';import {acquireLease,leasePath} from '../shared/leases.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';
const template=id=>({id,version:1,coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true},evidence:{sourceUrl:'https://example.com/form/'+id.replace('role-',''),observedAt:'synthetic'},pages:[{pathPrefix:'/form/',readySelector:'#form',roleTitle:id,roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},groups:[],fields:[{id:'name',source:'name',label:'Name',kind:'text',required:true,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]});
test('same account workers overlap inside one lease, and failures settle before release',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'parallel-roles-')),store=new Store(path.join(dir,'store')),leaseRoot=path.join(dir,'leases');let active=0,maximum=0,completed=0;
 const company={id:'sample',origin:'https://example.com',templateId:'base'};
 const engine=new Engine({store,companies:[company],browser:{},leaseRoot});const authorization={prepare:true,evidence:'synthetic same account parallel preparation'};
 try{
 const observed=observedSeal(template('base'),'sample'),t=observed.template;await store.put('templates',t.id,t);await observed.persist(store);await store.put('runs',observed.probe.id,observed.probe);
 const tasks=[],preparedPlans=[];for(const id of ['a','b','c']){let task={companyId:'sample',roleId:id,confirmedRole:{title:'role-'+id},pageUrl:'https://example.com/form/'+id,templateHash:hash(t),values:{name:'Synthetic'},roleQueueArgs:{queueId:'synthetic',taskId:id}};const {compiled,...plan}=await engine.preparePlan(task,{transient:true});preparedPlans.push(compiled);tasks.push({...task,planId:plan.planId,planHash:plan.planHash});}
 engine.runCompany=async({task})=>{active++;maximum=Math.max(maximum,active);await assert.rejects(acquireLease(leasePath(leaseRoot,'recruiting-origin:'+company.origin)),/RESOURCE_ALREADY_RUNNING/);await new Promise(r=>setTimeout(r,15));active--;completed++;if(task.roleId==='b')throw Error('synthetic unexpected worker failure');return {companyId:'sample',status:'verified',fields:[],pageChecks:[],startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),submission:'not_performed'};};
 const r=await engine.prepare({tasks,concurrency:3,authorization,parallelRoles:true,preparedPlans});assert.equal(maximum,3);assert.equal(completed,3);assert.deepEqual(await readdir(path.join(store.root,'plans')),['execution-plan-sample.json']);assert.equal((await store.get('plans','execution-plan-sample')).taskId,'c');assert.equal(active,0);assert.equal(r.workerErrors,1);assert.equal(r.results.length,3);assert.equal(r.results[1].errorCode,'BATCH_WORKER_INTERRUPTED');const release=await acquireLease(leasePath(leaseRoot,'recruiting-origin:'+company.origin));await release();
 await assert.rejects(engine.prepare({tasks,concurrency:3,authorization}),/COMPANY_ALREADY_RUNNING/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('the previous company plan is refused before any browser operation after another role replaces it',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'company-plan-replace-'));
 try{
  const store=new Store(dir),company={id:'sample',origin:'https://example.com',templateId:'base'};
  const {template:sealed,persist}=observedSeal(template('base'),'sample');
  await store.put('templates',sealed.id,sealed);await persist(store);
  const engine=new Engine({store,companies:[company],browser:{existingPage:()=>assert.fail('stale plan must not reach browser')},leaseRoot:dir});
  const task={companyId:company.id,pageUrl:'https://example.com/form/a',templateHash:hash(sealed),values:{name:'Synthetic'},taskId:'first'};
  const first=await engine.preparePlan(task);
  const next=await engine.preparePlan({...task,taskId:'second',pageUrl:'https://example.com/form/b'});
  assert.equal(first.planId,next.planId);
  assert.notEqual(first.planHash,next.planHash);
  await assert.rejects(engine.prepare({tasks:[{...task,planId:first.planId,planHash:first.planHash}],authorization:{prepare:true,evidence:'synthetic'}}),/PREPARED_PLAN_HASH_MISMATCH/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

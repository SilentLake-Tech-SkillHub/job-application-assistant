import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine,Store,hash} from '../shared/engine.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';

const template=(id,origin,coverage)=>({id,version:1,coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true,...coverage},evidence:{sourceUrl:origin+'/form',observedAt:'synthetic'},pages:[{pathPrefix:'/form',readySelector:'#form',roleTitle:'Synthetic role',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},groups:[],fields:[{id:'name',source:'name',label:'Name',kind:'text',required:true,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]});
async function fixture(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'construction-gate-')),store=new Store(path.join(root,'data'));let browserAccesses=0;
 const companies=[{id:'a',origin:'https://a.example.com',templateId:'form-a'},{id:'b',origin:'https://b.example.com',templateId:'form-b'}];
 const browser={existingPage:async()=>{browserAccesses++;throw Error('UNEXPECTED_BROWSER_ACCESS');}};
 const engine=new Engine({store,companies,browser,leaseRoot:path.join(root,'leases')});
 const task=async(index,coverage,values={name:'Synthetic'})=>{const c=companies[index],t=template(c.templateId,c.origin,coverage);await store.put('templates',t.id,t);const args={companyId:c.id,pageUrl:c.origin+'/form',templateHash:hash(t),values};const plan=await engine.preparePlan(args);return {...args,planId:plan.planId,planHash:plan.planHash,compiled:plan};};
 try{await fn({engine,task,accesses:()=>browserAccesses});}finally{await rm(root,{recursive:true,force:true});}
}
test('one incomplete company blocks the batch before any company touches a browser',()=>fixture(async({engine,task,accesses})=>{
 const a=await task(0),b=await task(1,{allConditionalBranchesVerified:false});
 assert.equal(b.compiled.status,'blocked_construction');
 await assert.rejects(engine.prepare({tasks:[a,b],concurrency:2,authorization:{prepare:true,evidence:'synthetic'}}),/FORM_CONSTRUCTION_INCOMPLETE/);
 assert.equal(accesses(),0);
}));
test('partial answer authority cannot override an unsupported driver or unknown mapping',()=>fixture(async({engine,task,accesses})=>{
 for(const coverage of [{allDriversSupported:false},{allControlsMapped:false}]){
  const a=await task(0,coverage);
  await assert.rejects(engine.prepare({tasks:[a],authorization:{prepare:true,evidence:'synthetic',allowPartialPreparation:true}}),/FORM_CONSTRUCTION_INCOMPLETE/);
 }
 assert.equal(accesses(),0);
}));
test('an unanswered field cannot become execution ready merely because a plan was compiled',()=>fixture(async({engine,task,accesses})=>{
 const a=await task(0,undefined,{});assert.equal(a.compiled.status,'needs_answers');assert.equal(a.compiled.readyForExecution,false);
 await assert.rejects(engine.prepare({tasks:[a],authorization:{prepare:true,evidence:'synthetic'}}),/PROFILE_PREPARATION_INCOMPLETE/);assert.equal(accesses(),0);
}));

test('saved page-global positional locators are blocked even with partial preparation authority',async()=>{
 const t=template('legacy-form','https://a.example.com');
 t.pages[0].fields[0].actions[0].selector='body > div:nth-of-type(1) > input';
 const task={companyId:'a',pageUrl:'https://a.example.com/form',templateHash:hash(t),values:{name:'Synthetic'}};
 const p=await compileExecutionPlan(t,task);
 assert.deepEqual(p.unstableFields,['name']);
 assert.ok(p.constructionBlockers.includes('PAGE_GLOBAL_POSITIONAL_LOCATORS'));
 await assert.rejects(assertPreparedPlan(p,t,{...task,planId:p.id,planHash:p.planHash},{prepare:true,allowPartialPreparation:true}),/FORM_CONSTRUCTION_INCOMPLETE/);
});
test('field-local positional selectors remain valid for repeated date and radio controls',async()=>{
 const t=template('anchored-form','https://a.example.com');
 t.pages[0].fields[0].actions[0].selector='#education [id="start_end_time"] > div:nth-of-type(2) > input';
 const p=await compileExecutionPlan(t,{companyId:'a',pageUrl:'https://a.example.com/form',templateHash:hash(t),values:{name:'Synthetic'}});
 assert.deepEqual(p.unstableFields,[]);assert.equal(p.readyForExecution,true);
});

test('missing construction declarations are not treated as verified',async()=>{
 const t=template('old-form','https://a.example.com');delete t.coverage;
 const task={companyId:'a',pageUrl:'https://a.example.com/form',templateHash:hash(t),values:{name:'Synthetic'}};
 const p=await compileExecutionPlan(t,task);assert.equal(p.constructionBlockers.length,3);
 await assert.rejects(assertPreparedPlan(p,t,{...task,planId:p.id,planHash:p.planHash},{allowPartialPreparation:true}),/FORM_CONSTRUCTION_INCOMPLETE/);
});

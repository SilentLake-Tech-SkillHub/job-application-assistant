import test from 'node:test';
import assert from 'node:assert/strict';
import {FormRouter} from '../shared/form-route.mjs';
import {Engine,validateTemplate,Store,hash} from '../shared/engine.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {observedSeal} from './fixtures/observed-seal.mjs';
const template=()=>({id:'form',version:1,coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true},evidence:{sourceUrl:'https://example.com/form',observedAt:'synthetic'},pages:[{pathPrefix:'/form',readySelector:'#form',roleTitle:'Role',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[{id:'name',label:'Name',source:'name',kind:'text',required:true,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]});
test('existing usable company form skips acquisition; no asset selects acquisition without browser I/O',async()=>{
 let reads=0;const observed=observedSeal(template(),'company'),companies=[{id:'company',origin:'https://example.com',templateId:'form'}],store={get:async (group,id)=>{reads++;return group==='runs'?(observed.assets.get(id)||observed.probe):observed.template;}},r=new FormRouter({store,companies,validateTemplate});
 const args={companyId:'company',pageUrl:'https://example.com/form'};
 assert.equal((await r.resolve(args)).route,'reuse');assert.equal(reads,5);
 companies[0].templateId=null;assert.equal((await r.resolve(args)).reason,'NO_COMPANY_FORM_ASSET');assert.equal(reads,5);
});
test('partial or incompatible asset requests only missing/different parts, never grants filling',async()=>{
 const company={id:'company',origin:'https://example.com',templateId:'form'};let t=template();const r=new FormRouter({store:{get:async()=>t},companies:[company],validateTemplate});
 t.coverage.allConditionalBranchesVerified=false;let out=await r.resolve({companyId:'company',pageUrl:'https://example.com/form'});assert.equal(out.route,'acquire');assert.equal(out.recapture,'missing_or_different_parts');
 t=template();out=await r.resolve({companyId:'company',pageUrl:'https://example.com/other'});assert.equal(out.reason,'FORM_PATH_NOT_COVERED');
});
test('missing profile answers stay on reuse branch and are reported locally, not sent back to capture',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'form-route-'));try{
  const store=new Store(root),observed=observedSeal(template(),'company'),t=observed.template;await store.put('templates',t.id,t);await observed.persist(store);await store.put('runs',observed.probe.id,observed.probe);let browserCalls=0;
  const engine=new Engine({store,companies:[{id:'company',origin:'https://example.com',templateId:'form'}],browser:{existingPage:()=>{browserCalls++;}}});
  const p=await engine.preparePlan({companyId:'company',pageUrl:'https://example.com/form',templateHash:hash(t),values:{}});
  assert.equal(p.route,'reuse');assert.equal(p.status,'needs_answers');assert.equal(browserCalls,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

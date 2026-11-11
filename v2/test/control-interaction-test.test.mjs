import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store,Engine,hash} from '../shared/engine.mjs';import {draftTemplate} from '../shared/template-validation.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';import {testControlInteractions} from '../shared/control-interaction-test.mjs';
import {assertInteractionEvidence} from '../shared/construction-cycle.mjs';
async function scenario(fail,summary=false,emptyReadback=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'interaction-cycle-')),url='https://fixture.test/form';
 try{
  const field={id:'name',label:'Name',source:'name',kind:'text',required:false,inventorySelectors:['#name'],inventoryLabel:'Name',inventoryType:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]};
  const raw={id:'C00001',version:1,evidence:{sourceUrl:url,observedAt:'synthetic'},pages:[{pathPrefix:'/form',roleTitle:'Role',roleSelector:'h1',readySelector:'#form',fields:[field]}]},observed=observedSeal(raw,'C00001'),candidate=draftTemplate(observed.template),probe={...observed.probe,templateHash:hash(candidate)};
  const store=new Store(root);await store.put('templates','C00001',observed.template);const officialHash=hash(observed.template);let acts=0,bindings=0,value='Same';
  const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>[{selector:'#name',label:'Name',type:'text',required:false}],observe:async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Role',fields:{name:{present:!emptyReadback||acts>0,value:emptyReadback&&acts===0?null:value,errors:[]}}}),act:async(a,v)=>{acts++;if(fail)throw Error('CONTROL_COMMIT_NOT_VERIFIED');value=v;}};
  let mapped=0;
  const engine=new Engine({store,companies:[{id:'C00001',origin:'https://fixture.test',templateId:'C00001'}],browser:{existingPage:async()=>page},onInventory:async(_company,_url,_fields,_plan,options)=>{assert.equal(hash(options.constructionTemplate),hash(candidate));mapped++;}});
  if(summary)await store.put('runs',probe.id,probe);
  const response=summary?{id:probe.id,status:'verified',restoration:'verified'}:probe;
  const result=await testControlInteractions({engine,store,template:candidate,probe:response,task:{companyId:'C00001',pageUrl:url,values:{name:'Same'}},authorization:{prepare:true,evidence:'synthetic interaction test'},assertBinding:async()=>{bindings++;}});
  assert.equal(acts,1);assert.equal(bindings,2);assert.ok(mapped>0);assert.equal(hash(await store.get('templates','C00001')),officialHash);return result;
 }finally{await rm(root,{recursive:true,force:true});}
}
test('interaction test executes an already matching control and independently reads it, without promoting the archive',async()=>{const result=await scenario(false);assert.equal(result.status,'verified');assert.deepEqual(result.testedFieldIds,['name']);assert.equal(result.browserExecuted,true);});
test('an actual driver failure produces backfill evidence and leaves the official template untouched',async()=>{const result=await scenario(true);assert.equal(result.status,'needs_attention');assert.equal(result.failures[0].reason,'CONTROL_COMMIT_NOT_VERIFIED');assert.deepEqual(result.testedFieldIds,[]);});
test('the normal compact condition-probe response loads its persisted full evidence before real interactions',async()=>{const result=await scenario(false,true);assert.equal(result.status,'verified');assert.deepEqual(result.testedFieldIds,['name']);});
test('a rendered control is filled even before its selected-value readback node exists',async()=>{const result=await scenario(false,false,true);assert.equal(result.status,'verified');assert.deepEqual(result.testedFieldIds,['name']);});
test('real interaction coverage follows the approved record selection and retains the reusable repeat definition',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'interaction-records-')),url='https://fixture.test/form';
 try{
  const field=(index,key)=>{const selector='.atsx-form-item[data-cy="project['+index+'].name"]';return {id:key,source:'projects.'+key+'.name',label:'Name',kind:'text',required:false,inventorySelectors:[selector],inventoryLabel:'Name',inventoryType:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector,kind:'value'},actions:[{method:'fill',selector}]};};
  const fields=[field(0,'one'),field(1,'two')],raw={id:'C00001',version:1,evidence:{sourceUrl:url,observedAt:'synthetic'},pages:[{pathPrefix:'/form',roleTitle:'Role',roleSelector:'h1',readySelector:'#form',groups:[{id:'project',sectionKey:'project',selector:'.records',addSelector:'#add',count:1}],fields}]};
  const observed=observedSeal(raw,'C00001'),candidate=draftTemplate(observed.template),probe={...observed.probe,templateHash:hash(candidate),branches:observed.probe.branches.map(branch=>({...branch,inventory:branch.inventory.slice(0,1)}))};
  const store=new Store(root);await store.put('templates','C00001',observed.template);let value='Before',writes=0;
  const page={assertLocation:async()=>{},wait:async()=>{},ensureGroups:async()=>{},inventory:async()=>probe.branches[0].inventory,observe:async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Role',groups:{project:1},fields:{one:{present:true,value,errors:[]}}}),act:async(_,next)=>{value=next;writes++;}};
  const engine=new Engine({store,companies:[{id:'C00001',origin:'https://fixture.test',templateId:'C00001'}],browser:{existingPage:async()=>page}});
  const result=await testControlInteractions({engine,store,template:candidate,probe,task:{companyId:'C00001',pageUrl:url,values:{'projects.one.name':'Approved','projects.two.name':'Excluded'},recordPlan:{entities:{projects:['one','two']},projects:['one']}},authorization:{prepare:true,evidence:'approved project selection'},assertBinding:async()=>{}});
  assert.equal(result.status,'verified');assert.equal(writes,1);assert.deepEqual(result.inactiveRecordFieldIds,['two']);assertInteractionEvidence(candidate,result);
  assert.equal(candidate.pages[0].fields.length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

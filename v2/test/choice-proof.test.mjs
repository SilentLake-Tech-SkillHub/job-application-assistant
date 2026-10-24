import test from 'node:test';import assert from 'node:assert/strict';
import {confirmChoiceEvidence} from '../shared/choice-proof.mjs';
import {verifyDropdownSelections} from '../shared/choice-verification.mjs';
import {verifyForm} from '../shared/verifier.mjs';
const candidate={label:'University',value:'school-1',valueAttribute:'data-value',disabled:false,selected:false};
test('dropdown evidence requires exact label, actual selected state and exposed value identity',()=>{
 const reopened={...candidate,selected:true};assert.equal(confirmChoiceEvidence(candidate,reopened,{expectedLabel:'University',blurredLabel:'University'}).valueCompared,true);
 assert.throws(()=>confirmChoiceEvidence(candidate,{...reopened,label:'Similar University'},{expectedLabel:'University',blurredLabel:'University'}),/SELECTED_LABEL_MISMATCH/);
 assert.throws(()=>confirmChoiceEvidence(candidate,{...reopened,value:'school-2'},{expectedLabel:'University',blurredLabel:'University'}),/SELECTED_VALUE_MISMATCH/);
 assert.throws(()=>confirmChoiceEvidence(candidate,{...reopened,selected:false},{expectedLabel:'University',blurredLabel:'University'}),/REOPENED_OPTION_NOT_SELECTED/);
});
test('independent choice verification opens in verify mode without selecting or overwriting',async()=>{
 const calls=[],plan={fields:[{id:'school',source:'school',control:{type:'dropdown'},read:{},actions:[{method:'ant_dropdown',selector:'#school',options:['University']}]}]};
 const proofs=await verifyDropdownSelections({act:async(a,v)=>{calls.push(a.method);return {selectionProof:{label:v,blurConfirmed:true,reopenedOptionSelected:true}};}},plan,{values:{school:'University'}});
 assert.deepEqual(calls,['ant_dropdown_verify']);assert.equal(proofs.school.status,'verified');
});
test('display equality plus a visible selected marker cannot pass field verification alone',()=>{
 const expected={pageUrl:'https://fixture.test/form',roleTitle:'Role',fields:[{id:'school',kind:'choice',value:'University',selectionVerificationRequired:true,choiceValue:'school-1'}]},observed={source:'live_dom',readAt:new Date().toISOString(),pageUrl:expected.pageUrl,roleTitle:'Role',inventoryIds:['school'],fields:{school:{present:true,value:'University',selected:true}}};
 assert.equal(verifyForm(expected,observed).status,'needs_attention');
 observed.fields.school.selectionProof={status:'verified',label:'University',value:'school-2',blurConfirmed:true,reopenedOptionSelected:true};assert.equal(verifyForm(expected,observed).status,'needs_attention');
 observed.fields.school.selectionProof.value='school-1';assert.equal(verifyForm(expected,observed).status,'verified');
});

test('an already matching school cannot bypass real choice verification through the skip path',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{Store,Engine,hash}=await import('../shared/engine.mjs'),{observedSeal}=await import('./fixtures/observed-seal.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'choice-skip-'));try{
 const url='https://fixture.test/form',source={id:'school',version:1,evidence:{sourceUrl:url,observedAt:new Date().toISOString()},pages:[{pathPrefix:'/form',readySelector:'form',roleTitle:'Role',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[{id:'school',source:'school',label:'School',inventoryLabel:'School',inventoryType:'combobox',inventorySelectors:['#field'],kind:'choice',control:{type:'dropdown',valueType:'string',readbackType:'string',options:['University']},read:{kind:'text',selector:'#selected',selectedSelector:'#selected'},actions:[{method:'ant_dropdown',selector:'#field',options:['University']}]}]}]};
 const sealed=observedSeal(source,'synthetic'),store=new Store(dir);await store.put('templates','school',sealed.template);await sealed.persist(store);await store.put('runs',sealed.probe.id,sealed.probe);
 const inventory=[{selector:'#field',label:'School',type:'combobox',required:false}],observation=()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Role',sections:[{title:'Basics'}],fields:{school:{present:true,value:'University',selected:true,errors:[]}},groups:{}});let writes=0;
 const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>inventory,observe:async()=>observation(),act:async a=>{if(a.method.endsWith('_verify'))throw Error('CHOICE_REOPENED_OPTION_NOT_SELECTED');writes++;}};
 const engine=new Engine({store,browser:{existingPage:async()=>page},companies:[{id:'synthetic',origin:'https://fixture.test',templateId:'school'}],leaseRoot:dir}),task={companyId:'synthetic',pageUrl:url,templateHash:hash(sealed.template),values:{school:'University'}};
 const plan=await engine.preparePlan(task),run=await engine.prepare({tasks:[{...task,planId:plan.planId,planHash:plan.planHash}],authorization:{prepare:true,evidence:'synthetic'}});
 assert.equal(run.results[0].errorCode,'EXISTING_CHOICE_NOT_VERIFIED');assert.equal(writes,0);assert.notEqual(run.results[0].status,'verified');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CDP field screenshots use an explicit private directory without requiring a browser profile or navigating',async()=>{
 const {BrowserAdapter}=await import('../shared/browser.mjs'),{mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'choice-screen-'));try{
 let captured=false;const browser=new BrowserAdapter('http://127.0.0.1:9223',{screenshotDir:dir}),target={count:async()=>1,screenshot:async options=>{captured=true;await writeFile(options.path,'synthetic image');}};
 browser.pageIds.set('original',{isClosed:()=>false,evaluate:async()=>[],locator:selector=>{assert.equal(selector,'#school');return target;}});
 const result=await browser.screenshot('original',{selector:'#school'});assert.equal(result.scope,'captured_field');assert.equal(captured,true);assert.equal(result.path.startsWith(dir),true);assert.equal(browser.connectionAttempts,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

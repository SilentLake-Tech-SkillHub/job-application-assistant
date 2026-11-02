import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';import {hash} from '../shared/engine.mjs';
const coverage={allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true};
const page=fields=>({pathPrefix:'/form',readySelector:'form',roleTitle:'Role',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields});
test('an authorized ordinary privacy field remains reference-only in the plan and uses its restricted proof',async()=>{
 const field={id:'privacy',label:'我已阅读并同意隐私政策',kind:'boolean',source:'policy.consent',userOnly:true,required:true,control:{type:'checkbox',valueType:'boolean',readbackType:'boolean'},read:{selector:'#privacy',kind:'checked'},actions:[]},template={id:'fixture',version:1,coverage,pages:[page([field])]},task={companyId:'fixture',roleId:'J000001',pageUrl:'https://example.test/form',templateHash:hash(template),values:{},privacyFillContext:{contextHash:'trusted-context',fields:[{fieldId:'privacy',authorizationRef:'profile.policy.businessAuthorization'}]}};
 const plan=await compileExecutionPlan(template,task);assert.equal(plan.counts.authorized_privacy,1);assert.equal(plan.counts.user_only,0);assert.equal(plan.counts.needs_user,0);assert.equal(plan.allKnown,true);assert.deepEqual(plan.pages[0].fields[0].actions,[]);assert.equal(plan.pages[0].fields[0].value,undefined);
 await assertPreparedPlan(plan,template,{...task,planId:plan.id,planHash:plan.planHash},{prepare:true},{scope:'authorized_privacy_fields'});
 const expected=compileExpected(template.pages[0],task),observed={source:'live_dom',pageUrl:task.pageUrl,readAt:new Date().toISOString(),roleTitle:'Role',sections:[{title:'Basics'}],inventoryIds:['privacy'],fields:{privacy:{present:true,userOnly:true,privacyFillProof:{status:'verified',contextHash:'trusted-context',authorizationRef:'profile.policy.businessAuthorization',readbackStable:true}}}};
 assert.equal(verifyForm(expected,observed).status,'verified');delete observed.fields.privacy.privacyFillProof;assert.equal(verifyForm(expected,observed).status,'needs_attention');
});
test('local attachment preflight uses source metadata, never consumes legacy file digest, and catches a source change',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'file-plan-no-hash-'));try{const file=path.join(root,'resume.pdf');await writeFile(file,'test-source');const asset={paths:[file],displayNames:['resume.pdf'],revision:'r1'};Object.defineProperty(asset,'sha256',{enumerable:true,get(){assert.fail('Legacy attachment digest must not be consumed');}});
 const field={id:'resume',label:'Resume',kind:'file',source:'resumeRef',control:{type:'file_upload',valueType:'string',readbackType:'string[]'},read:{selector:'#file',kind:'files',filenameSelector:'.name',uploadedSelector:'.done'},actions:[{method:'upload',selector:'#file'}]},template={id:'fixture',version:1,coverage,pages:[page([field])]},task={companyId:'fixture',roleId:'J000001',pageUrl:'https://example.test/form',templateHash:hash(template),values:{resumeRef:'approved'},files:{approved:asset}};
 const plan=await compileExecutionPlan(template,task);assert.equal(plan.readyForExecution,true);assert.equal(plan.files.approved.sha256,undefined);assert.equal(plan.fileMetadata.approved[0].size,11);const bound={...task,planId:plan.id,planHash:plan.planHash};await assertPreparedPlan(plan,template,bound,{prepare:true,uploads:true});await writeFile(file,'a new source version');await assert.rejects(assertPreparedPlan(plan,template,bound,{prepare:true,uploads:true}),/PLAN_CONTENT_CHANGED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a photo is uploaded only when the business switch is 1; at 0 or undecided it is user-operated and the resume still uploads',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'photo-switch-'));try{
  const photo=path.join(root,'photo.png'),resume=path.join(root,'resume.pdf');await writeFile(photo,'png');await writeFile(resume,'pdf');
  const fileField=(id,label,source)=>({id,label,kind:'file',source,control:{type:'file_upload',valueType:'string',readbackType:'string[]'},read:{selector:'#'+id,kind:'files',filenameSelector:'.name',uploadedSelector:'.done'},actions:[{method:'upload',selector:'#'+id}]});
  const template={id:'fixture',version:1,coverage,pages:[page([fileField('photo','证件照','photoRef'),fileField('resume','简历','resumeRef')])]};
  const base={companyId:'fixture',roleId:'J000001',pageUrl:'https://example.test/form',templateHash:hash(template),values:{photoRef:'p',resumeRef:'r'},files:{p:{paths:[photo],displayNames:['photo.png'],revision:'1'},r:{paths:[resume],displayNames:['resume.pdf'],revision:'1'}}};
  const disposition=plan=>Object.fromEntries(plan.pages[0].fields.map(f=>[f.id,f.disposition]));
  for(const switchValue of [0,null,undefined]){const plan=await compileExecutionPlan(template,{...base,...(switchValue===undefined?{}:{agreementPolicy:{businessAuthorization:switchValue}})});assert.deepEqual(disposition(plan),{photo:'user_only',resume:'fill'},String(switchValue));assert.deepEqual(plan.pages[0].executionOrder[0].fieldIds,['resume']);}
  const on=await compileExecutionPlan(template,{...base,agreementPolicy:{businessAuthorization:1}});assert.deepEqual(disposition(on),{photo:'fill',resume:'fill'});
  const off=await compileExecutionPlan(template,{...base,agreementPolicy:{businessAuthorization:0}});assert.notEqual(on.inputHash,off.inputHash);
  // An image file in an unlabeled upload is still a photo.
  const unlabeled={...template,pages:[page([fileField('att','附件','photoRef')])]};assert.equal((await compileExecutionPlan(unlabeled,{...base,templateHash:hash(unlabeled),agreementPolicy:{businessAuthorization:0}})).pages[0].fields[0].disposition,'user_only');
 }finally{await rm(root,{recursive:true,force:true});}
});

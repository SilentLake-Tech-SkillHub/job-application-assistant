import test from 'node:test';import assert from 'node:assert/strict';
import {authorizedProfileContext,applyAuthorizedProfileFields,attachProfileFillProofs} from '../shared/profile-fill-authorization.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';import {hash,Engine} from '../shared/engine.mjs';
const secret='SYNTHETIC-IDENTITY-ONLY';
const fixture=()=>{
 const profile={schemaVersion:1,sources:{user:{kind:'user_reply',evidence:'Use existing profile at confirmed recruiting destinations'}},policy:{globalAgreementAccepted:true,profileFillAuthorization:{scope:'global',destinations:'confirmed_official_recruiting_roles',sensitiveSources:['identity.idCard.number'],sourceId:'user',revoked:false}},facts:{'identity.idCard.number':{status:'known',value:secret,sourceIds:['user']}},entities:{}};
 const field={id:'identity',label:'身份证号码',inventoryLabel:'身份证号码',source:'unmapped.identity',userOnly:true,kind:'text',required:true,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#identity',kind:'value'},actions:[]};
 const template={id:'profile',version:1,evidence:{sourceUrl:'https://official.example/apply/1',observedAt:'synthetic'},coverage:{allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:true},pages:[{pathPrefix:'/apply',roleTitle:'Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h3'},fields:[field]}]};
 const scope={companyId:'sample',roleId:'1',pageUrl:template.evidence.sourceUrl,officialOrigin:'https://official.example',materialContext:{batchId:'confirmed',contentSha256:'confirmed-content',companyId:'sample',roleId:'1'}};
 const context=authorizedProfileContext(profile,template,scope),task={companyId:'sample',roleId:'1',pageUrl:scope.pageUrl,templateHash:hash(template),values:{},profileFillContext:context};return {profile,field,template,scope,context,task};
};
test('global master-data fill is independent of privacy agreement and limited to confirmed official roles',()=>{
 const f=fixture();assert.equal(f.context.fields[0].source,'identity.idCard.number');assert.equal(JSON.stringify(f.context).includes(secret),false);
 const p=structuredClone(f.profile);delete p.policy.profileFillAuthorization;assert.equal(authorizedProfileContext(p,f.template,f.scope),null);
 p.policy.profileFillAuthorization={...f.profile.policy.profileFillAuthorization,revoked:true};assert.equal(authorizedProfileContext(p,f.template,f.scope),null);
 for(const patch of [{roleId:'other'},{officialOrigin:'https://wrong.example'},{materialContext:{}}])assert.throws(()=>authorizedProfileContext(f.profile,f.template,{...f.scope,...patch}),/CONFIRMED_ROLE_REQUIRED/);
 f.field.label=f.field.inventoryLabel='短信验证码';assert.equal(authorizedProfileContext(f.profile,f.template,f.scope),null);
});
test('freeze stores exact source and action references, never an identity value; revocation or source change invalidates it',async()=>{
 const f=fixture(),plan=await compileExecutionPlan(f.template,f.task);assert.equal(plan.counts.authorized_profile,1);assert.equal(plan.counts.user_only,0);assert.equal(plan.allKnown,true);assert.equal(JSON.stringify(plan).includes(secret),false);assert.equal(plan.pages[0].fields[0].value,undefined);
 await assertPreparedPlan(plan,f.template,{...f.task,planId:plan.id,planHash:plan.planHash},{prepare:true},{scope:'authorized_profile_fields'});
 const ordinary={...f.task,profileFillContext:null},without=await compileExecutionPlan(f.template,ordinary);await assert.rejects(assertPreparedPlan(without,f.template,{...ordinary,planId:without.id,planHash:without.planHash},{prepare:true},{scope:'authorized_profile_fields'}),/EXECUTION_SCOPE_INVALID/);
 f.profile.facts['identity.idCard.number'].value='UPDATED-SYNTHETIC';const current=authorizedProfileContext(f.profile,f.template,f.scope);assert.notEqual(current.contextHash,f.context.contextHash);
 await assert.rejects(assertPreparedPlan(plan,f.template,{...f.task,profileFillContext:current,planId:plan.id,planHash:plan.planHash},{prepare:true}),/INPUTS_CHANGED/);
});
test('execution fills only the sourced authorized target and independently verifies without persisting or returning the value',async()=>{
 const f=fixture();let actual='',writes=0;const page={observe:async()=>({fields:{identity:{present:true,value:actual}}}),act:async(action,value)=>{assert.equal(action.selector,'#identity');writes++;actual=value;}};
 const args={page,profile:f.profile,template:f.template,scope:f.scope,expected:f.context};const prepared=await applyAuthorizedProfileFields({...args,prepare:true});assert.equal(writes,1);assert.equal(prepared.identity.status,'verified');assert.equal(JSON.stringify(prepared).includes(secret),false);
 const proofs=await applyAuthorizedProfileFields(args);assert.equal(writes,1);const expected=compileExpected({...f.template.pages[0],sections:undefined},f.task),observed={source:'live_dom',readAt:new Date().toISOString(),pageUrl:f.scope.pageUrl,roleTitle:'Role',inventoryIds:['identity'],fields:{identity:{present:true,userOnly:true}}};
 assert.equal(verifyForm(expected,observed).status,'needs_attention');assert.equal(verifyForm(expected,attachProfileFillProofs(observed,proofs)).status,'verified');assert.equal(JSON.stringify(observed).includes(secret),false);
 actual='WRONG';const mismatch=await applyAuthorizedProfileFields(args);assert.equal(mismatch.identity.status,'failed');assert.equal(verifyForm(expected,attachProfileFillProofs(observed,mismatch)).status,'needs_attention');
 f.profile.policy.profileFillAuthorization.revoked=true;await assert.rejects(applyAuthorizedProfileFields({...args,prepare:true}),/AUTHORIZATION_OR_SOURCE_CHANGED/);assert.equal(writes,1);
});
test('a global sensitive fill still requires a real queue role binding before any browser access',async()=>{
 const f=fixture();let browserAccess=false;const engine=new Engine({store:{},companies:[],browser:{existingPage:async()=>{browserAccess=true;}}});
 await assert.rejects(engine.prepare({tasks:[f.task],authorization:{prepare:true,evidence:'synthetic'},concurrency:1}),/PROFILE_FILL_ROLE_BINDING_REQUIRED/);assert.equal(browserAccess,false);
});
test('generic document-number fields require an actually selected identity-document type before transmission',async()=>{
 const f=fixture();f.field.label=f.field.inventoryLabel='证件号码';assert.equal(authorizedProfileContext(f.profile,f.template,f.scope),null);
 f.profile.facts['identity.idCard.type']={status:'known',value:'居民身份证',sourceIds:['user']};f.template.pages[0].fields.push({id:'document-type',source:'identity.idCard.type',label:'证件类型',kind:'choice',enumMap:{'居民身份证':'身份证'},read:{selector:'#type',kind:'text',selectedSelector:'#selected'}});
 const context=authorizedProfileContext(f.profile,f.template,f.scope);assert.equal(context.fields.length,1);assert.equal(context.fields[0].documentTypeGuard.expected,'身份证');let writes=0;
 await assert.rejects(applyAuthorizedProfileFields({page:{observe:async()=>({fields:{'document-type':{present:true,selected:true,value:'护照'}}}),act:async()=>{writes++;}},profile:f.profile,template:f.template,scope:f.scope,expected:context,prepare:true}),/DOCUMENT_TYPE_NOT_VERIFIED/);assert.equal(writes,0);
});

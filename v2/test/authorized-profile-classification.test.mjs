import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPending} from '../shared/field-policy.mjs';
import {profileStatus,registerObservedQuestions,resolveProfile,validateProfile} from '../shared/profile.mjs';
import {authorizedProfileContext} from '../shared/profile-fill-authorization.mjs';
import {compileExecutionPlan} from '../shared/execution-plan.mjs';

function fixture(){
 const profile={schemaVersion:1,sources:{user:{kind:'user_reply'}},entities:{},facts:{'identity.idCard.number':{status:'known',value:'SYNTHETIC-IDENTITY',sourceIds:['user']},'identity.idCard.type':{status:'known',value:'身份证',sourceIds:['user']}},policy:{businessAuthorization:1}};
 const field={id:'identity',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},label:'证件号码',inventoryLabel:'证件号码',inventoryType:'text',userOnly:true,source:'unmapped.identity',read:{selector:'#identity',kind:'value'},actions:[],documentTypePrefix:{label:'身份证',selector:'#type'}};
 const template={id:'test',pages:[{fields:[field]}]};
 const scope={companyId:'test',roleId:'role',pageUrl:'https://official.example/form',officialOrigin:'https://official.example',materialContext:{batchId:'batch',contentSha256:'confirmed',companyId:'test',roleId:'role'}};
 registerObservedQuestions(profile,{companyId:'test',pageUrl:scope.pageUrl,fields:[{...field,selector:'#identity',type:'text'}],observedAt:'test'});
 return {profile,field,template,scope};
}
test('authorized identity belongs to Agent in draft and status; revocation is immediate and values never leave profile',()=>{
 const {profile,field,template,scope}=fixture();
 const pending=classifyPending(field,profile);
 assert.equal(pending.kind,'ready');assert.equal(pending.owner,'agent');assert.equal(pending.resolution,'authorized_profile');
 const question=profileStatus(profile,'test',scope.pageUrl).forms[0].questions[0];
 assert.equal(question.userOnly,false);assert.equal(question.answerStatus,'known');assert.equal(question.resolution,'authorized_profile');
 assert.deepEqual(field.actions,[]);
 assert.equal(JSON.stringify({pending,question,context:authorizedProfileContext(profile,template,scope)}).includes('SYNTHETIC-IDENTITY'),false);
 profile.policy.businessAuthorization=0;
 assert.equal(classifyPending(field,profile).kind,'human_action');
 assert.equal(profileStatus(profile,'test',scope.pageUrl).forms[0].questions[0].userOnly,true);
});
for(const scenario of ['revoked','unknown_type','passport','bank','unsourced','unknown_source_reference'])test('identity exceptions preserve permission versus runtime-evidence ownership: '+scenario,async()=>{
 const {profile,field,template,scope}=fixture();
 if(scenario==='revoked')profile.policy.businessAuthorization=0;
 if(scenario==='unknown_type')delete field.documentTypePrefix;
 if(scenario==='passport')field.label=field.inventoryLabel='护照号码';
 if(scenario==='bank')field.label=field.inventoryLabel='银行卡号';
 if(scenario==='unsourced')profile.facts['identity.idCard.number'].sourceIds=[];
 if(scenario==='unknown_source_reference')profile.facts['identity.idCard.number'].sourceIds=['absent-source'];
 const technical=['unknown_type','unsourced','unknown_source_reference'].includes(scenario);
 assert.equal(classifyPending(field,profile).kind,technical?'construction':'human_action');
 assert.equal(authorizedProfileContext(profile,template,scope),null);
 registerObservedQuestions(profile,{companyId:'test',pageUrl:scope.pageUrl,fields:[{...field,selector:'#identity',type:'text'}],observedAt:'exception'});
 const question=profileStatus(profile,'test',scope.pageUrl).forms[0].questions.find(q=>q.active);
 assert.equal(question.userOnly,!technical);assert.equal(question.mappingStatus,technical?'runtime_evidence_pending':'user_only');
 const plan=await compileExecutionPlan(template,{companyId:'test',pageUrl:scope.pageUrl,values:{},profileFillContext:authorizedProfileContext(profile,template,scope)});
 assert.equal(plan.counts.user_only,1);assert.equal(JSON.stringify(plan).includes('SYNTHETIC-IDENTITY'),false);
});
test('protected canonical identity cannot enter ordinary plan values',async()=>{
 const {profile,field,template,scope}=fixture();field.source='identity.idCard.number';
 const resolved=resolveProfile(profile,template);
 assert.equal(resolved.values[field.source],undefined);
 await assert.rejects(compileExecutionPlan(template,{companyId:'test',pageUrl:scope.pageUrl,values:{[field.source]:'SYNTHETIC-IDENTITY'}}),/PROTECTED_PROFILE_VALUE_FORBIDDEN/);
 profile.facts.other={status:'known',value:'ordinary',sourceIds:[]};
 assert.throws(()=>validateProfile(profile),/UNSOURCED_FACT/);
 profile.facts.other.sourceIds=['absent-source'];assert.throws(()=>validateProfile(profile),/UNKNOWN_FACT_SOURCE/);
});
test('inactive superseded questions are not counted as missing answers or human actions',()=>{
 const {profile,field,scope}=fixture();
 registerObservedQuestions(profile,{companyId:'test',pageUrl:scope.pageUrl,fields:[{...field,selector:'#current',type:'text'}],observedAt:'new'});
 const questions=profileStatus(profile,'test',scope.pageUrl).forms[0].questions;
 assert.equal(questions.length,2);const inactive=questions.find(q=>q.active===false);
 assert.equal(inactive.answerStatus,'inactive');assert.equal(inactive.userOnly,false);
 assert.equal(questions.find(q=>q.active).mappingStatus,'authorized_profile');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {evaluateBusinessAuthorization,businessAuthorizationSwitch} from '../shared/business-authorization.mjs';
import {classifyPending,isAgreementCheckbox} from '../shared/field-policy.mjs';
import {registerObservedQuestions,profileStatus} from '../shared/profile.mjs';
import {auditStoredContract,workflowEnvelope} from '../shared/workflow-contract.mjs';
import {authorizedProfileContext,applyAuthorizedProfileFields} from '../shared/profile-fill-authorization.mjs';
import {setAuthorization,authorizationStatus} from '../scripts/business-authorization.mjs';
const profile=()=>({schemaVersion:1,entities:{},sources:{user:{kind:'user_reply'}},facts:{'identity.idCard.number':{status:'known',value:'SYNTHETIC-IDENTITY-ONLY',sourceIds:['user']},'identity.idCard.type':{status:'known',value:'身份证',sourceIds:['user']}},policy:{businessAuthorization:{value:1,sourceId:'user',updatedAt:'2026-11-01T00:00:00Z'}}});
const privacyField={id:'privacy',source:'unmapped.privacy',kind:'boolean',inventoryType:'checkbox',userOnly:true,label:'我已阅读并同意《招聘隐私政策》',control:{type:'checkbox',valueType:'boolean',readbackType:'boolean'},read:{selector:'#privacy',kind:'checked'},actions:[]};
const scope={operation:'recruiting_privacy',officialOrigin:'https://jobs.example.test',pageUrl:'https://jobs.example.test/apply',confirmedRole:{companyId:'company',roleId:'role'}};
const off=p=>{p.policy.businessAuthorization={...p.policy.businessAuthorization,value:0};return p;};
test('switch 1 is one durable permission across sessions, companies and any agreement wording',()=>{
 const p=profile(),first=evaluateBusinessAuthorization(p,scope);assert.equal(first.decision,'allow');assert.equal(first.permanent,true);assert.equal(first.authorizationRef,'profile.policy.businessAuthorization');assert.equal(first.switchValue,1);
 for(const [i,text] of ['新版本隐私政策','本人已阅读并同意《用户协议》','本人承诺遵守保密协议','您同意接受竞业限制','点击确认即视为签署劳动合同'].entries()){const next=evaluateBusinessAuthorization(JSON.parse(JSON.stringify(p)),{...scope,sessionId:'s'+i,companyId:'c'+i,disclosure:{title:text,text}});assert.equal(next.decision,'allow',text);assert.equal(next.authorizationRef,first.authorizationRef);}
 assert.equal(evaluateBusinessAuthorization({policy:{businessAuthorization:1}},{...scope,phase:'classify'}).decision,'allow');
});
test('switch 0 stops every business operation; an undecided switch is reported, never assumed',()=>{
 const p=off(profile());for(const operation of ['recruiting_privacy','identity_fill','photo_source']){const r=evaluateBusinessAuthorization(p,{...scope,operation,phase:'classify',field:{label:'身份证号码',kind:'text'}});assert.equal(r.decision,'revoked');assert.equal(r.reason,'BUSINESS_AUTHORIZATION_OFF');}
 const none=profile();delete none.policy.businessAuthorization;const r=evaluateBusinessAuthorization(none,scope);assert.equal(r.decision,'out_of_scope');assert.equal(r.reason,'BUSINESS_AUTHORIZATION_SWITCH_REQUIRED');assert.equal(businessAuthorizationSwitch(none),null);
 assert.equal(evaluateBusinessAuthorization({},scope).decision,'out_of_scope');assert.equal(evaluateBusinessAuthorization(profile(),{...scope,operation:'payment'}).decision,'out_of_scope');
});
test('missing official origin or confirmed role is agent technical work under switch 1',()=>{
 for(const patch of [{confirmedRole:false},{officialOrigin:'https://other.example.test'},{officialOrigin:'http://jobs.example.test'}]){const r=evaluateBusinessAuthorization(profile(),{...scope,...patch});assert.equal(r.decision,'technical_pending');}
});
test('only real agreement checkboxes are covered; preference questions, signatures and identity fields are not',()=>{
 assert.equal(isAgreementCheckbox(privacyField),true);
 for(const label of ['本人承诺以上信息真实有效','我已阅读并同意《候选人告知书》','I have read and agree to the terms'])assert.equal(isAgreementCheckbox({...privacyField,label}),true,label);
 for(const field of [{...privacyField,label:'是否同意调剂'},{...privacyField,label:'服从分配'},{id:'sig',label:'签名',kind:'text',inventoryType:'text'},{id:'pp',label:'护照号码',kind:'text',inventoryType:'text'}])assert.equal(isAgreementCheckbox(field),false,field.label);
 const p=profile();assert.equal(classifyPending(privacyField,p).resolution,'authorized_privacy');assert.equal(classifyPending({...privacyField,label:'是否同意调剂'},p).resolution,undefined);
 assert.equal(classifyPending(privacyField,off(profile())).kind,'human_action');
 assert.notEqual(classifyPending({id:'sig',label:'签名',kind:'text',inventoryType:'text',userOnly:true,source:'unmapped.sig',read:{selector:'#sig',kind:'value'},actions:[],control:{type:'text',valueType:'string',readbackType:'string'}},p).resolution,'authorized_privacy');
});
test('classification, question status and contract audit share the switch without writing answers',()=>{
 const p=profile();registerObservedQuestions(p,{companyId:'company',pageUrl:scope.pageUrl,fields:[{...privacyField,selector:'#privacy',type:'checkbox'}],observedAt:'now'});const q=profileStatus(p,'company',scope.pageUrl).forms[0].questions[0];assert.equal(q.mappingStatus,'authorized_privacy');assert.equal(q.answerStatus,'known');assert.equal(q.userOnly,false);assert.equal(q.owner,'agent');assert.equal(JSON.stringify(p.facts).includes('userQuote'),false);assert.equal(JSON.stringify(p.policy),JSON.stringify(profile().policy));
 assert.equal(auditStoredContract({pages:[{fields:[privacyField]}]},p).fields[0].operationMode,'authorized_runtime');
 off(p);assert.equal(profileStatus(p,'company',scope.pageUrl).forms[0].questions[0].userOnly,true);assert.equal(auditStoredContract({pages:[{fields:[privacyField]}]},p).fields[0].operationMode,'user_action');
 const passport={id:'passport',label:'护照号码',type:'text',userOnly:true,selector:'#passport'},q2=profile();registerObservedQuestions(q2,{companyId:'company',pageUrl:scope.pageUrl,fields:[passport],observedAt:'now'});assert.notEqual(profileStatus(q2,'company',scope.pageUrl).forms[0].questions[0].mappingStatus,'authorized_privacy');
});
test('identity fill follows the same switch and never returns the value',()=>{
 const p=profile(),field={id:'identity',label:'证件号码',kind:'text',documentTypePrefix:{label:'身份证',selector:'#type'}},input={operation:'identity_fill',phase:'classify',field};
 const allowed=evaluateBusinessAuthorization(p,input);assert.equal(allowed.decision,'allow');assert.equal(allowed.permanent,true);assert.equal(allowed.authorizationRef,'profile.policy.businessAuthorization');assert.equal(JSON.stringify(allowed).includes('SYNTHETIC-IDENTITY-ONLY'),false);
 assert.equal(evaluateBusinessAuthorization(p,{...input,field:{id:'bank',label:'银行卡号',kind:'text'}}).decision,'out_of_scope');
 off(p);assert.equal(evaluateBusinessAuthorization(p,input).decision,'revoked');
});
test('a switch turned off after freezing recompiles the plan; nothing stops or asks again',()=>{
 for(const error of ['BUSINESS_AUTHORIZATION_OFF','PROFILE_FILL_AUTHORIZATION_REVOKED','RECRUITING_PRIVACY_AUTHORIZATION_REVOKED']){const r=workflowEnvelope({error});assert.equal(r.continuation.owner,'agent');assert.equal(r.continuation.requiresUser,false);assert.equal(r.continuation.shouldContinue,true);assert.deepEqual(r.continuation.nextTools,['prepare_plan']);}
 const refresh=workflowEnvelope({error:'PROFILE_FILL_RUNTIME_CONTEXT_REFRESH_REQUIRED'});assert.equal(refresh.continuation.owner,'agent');assert.deepEqual(refresh.continuation.nextTools,['prepare_plan']);
});
test('the switch script is the single writer: quote required, legacy keys and the contradictory never-store entry removed',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'business-switch-')),file=path.join(dir,'profile.json'),p=profile();
 p.policy={globalAgreementAccepted:true,privacyAcceptanceScope:'global',profileFillAuthorization:{scope:'global'},loginPrivacyAcceptances:{c:{}},forbiddenStoredValues:['password','government_id_number']};await writeFile(file,JSON.stringify(p));
 await assert.rejects(setAuthorization(file,{value:1,quote:''}),/USER_QUOTE_REQUIRED/);await assert.rejects(setAuthorization(file,{value:2,quote:'x'}),/1_OR_0/);
 const r=await setAuthorization(file,{value:1,quote:'所有的永久纳入授权'});assert.equal(r.switchValue,1);
 const saved=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(Object.keys(saved.policy).sort(),['businessAuthorization','forbiddenStoredValues']);assert.deepEqual(saved.policy.forbiddenStoredValues,['password']);assert.equal(saved.sources[saved.policy.businessAuthorization.sourceId].evidence,'所有的永久纳入授权');
 assert.equal((await authorizationStatus(file)).switchValue,1);await setAuthorization(file,{value:0,quote:'不授权'});assert.equal((await authorizationStatus(file)).switchValue,0);assert.deepEqual((await authorizationStatus(file)).legacyKeysPresent,[]);
});
test('missing identity type or provenance remains agent evidence work under an otherwise valid permission',()=>{
 const p=profile(),field={id:'identity',label:'证件号码',kind:'text',userOnly:true,source:'unmapped.identity',read:{selector:'#id',kind:'value'},actions:[],control:{type:'text',valueType:'string',readbackType:'string'}};
 assert.equal(evaluateBusinessAuthorization(p,{operation:'identity_fill',phase:'classify',field}).reason,'CURRENT_IDENTITY_DOCUMENT_TYPE_REQUIRED');assert.equal(classifyPending(field,p).kind,'construction');field.documentTypePrefix={label:'身份证',selector:'#type'};p.facts['identity.idCard.number'].sourceIds=[];assert.equal(classifyPending(field,p).owner,'agent');assert.equal(evaluateBusinessAuthorization(p,{operation:'identity_fill',phase:'classify',field}).reason,'IDENTITY_PROFILE_PROVENANCE_REQUIRED');
});
test('new template or sourced value requires a new runtime context, not renewed business authorization',async()=>{
 const p=profile(),field={id:'identity',source:'unmapped.identity',kind:'text',label:'身份证号码',userOnly:true,read:{selector:'#id',kind:'value'},actions:[]},template={pages:[{fields:[field]}]},s={companyId:'company',roleId:'role',pageUrl:scope.pageUrl,officialOrigin:scope.officialOrigin,materialContext:{batchId:'batch',contentSha256:'input',companyId:'company',roleId:'role'}};
 const old=authorizedProfileContext(p,template,s);p.facts['identity.idCard.number'].value='UPDATED-SYNTHETIC';assert.equal(evaluateBusinessAuthorization(p,{operation:'identity_fill',phase:'classify',field}).decision,'allow');let observed=false;await assert.rejects(applyAuthorizedProfileFields({page:{observe:async()=>{observed=true;}},profile:p,template,scope:s,expected:old}),error=>error.message==='PROFILE_FILL_RUNTIME_CONTEXT_REFRESH_REQUIRED'&&error.continuation.requiresUser===false);assert.equal(observed,false);
});
test('identity reports distinguish a missing runtime type proof from a missing personal fact',()=>{
 const p=profile(),field={id:'identity',label:'证件号码',type:'text',userOnly:true,selector:'#identity'};registerObservedQuestions(p,{companyId:'company',pageUrl:scope.pageUrl,fields:[field],observedAt:'now'});
 let q=profileStatus(p,'company',scope.pageUrl).forms[0].questions[0];assert.equal(q.factStatus,'evidence_pending');assert.equal(q.answerStatus,'technical_pending');assert.equal(q.owner,'agent');assert.equal(q.userOnly,false);
 p.facts['identity.idCard.number']={status:'missing',value:null,sourceIds:[]};q=profileStatus(p,'company',scope.pageUrl).forms[0].questions[0];assert.equal(q.factStatus,'missing');assert.equal(q.owner,'user');assert.equal(q.reason,'IDENTITY_PROFILE_FACT_REQUIRED');assert.equal(q.authorizationStillValid,true);
});

import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {resolveDateRepresentation} from '../shared/date-representation.mjs';
const fixture=()=>{
 const scope={companyId:'sample',pageUrl:'https://example.test/form?jobAdId=role&userId=private-sentinel',roleId:'role'},field={source:'projects.example.end'},policy={mode:'as_of_date',...scope,source:'application.asof',sourceId:'approved-source',endSources:[field.source]};
 return {scope,field,policy,profile:{sources:{'approved-source':{kind:'user_reply'}},facts:{'application.asof':{status:'known',value:'2099-12-31',sourceIds:['approved-source']}},companyForms:{form:{companyId:scope.companyId,pageUrl:scope.pageUrl,ongoingDateRepresentation:policy}}}};
};
function failure(x){let error;try{resolveDateRepresentation(x.profile,x.scope,x.field);}catch(e){error=e;}assert.ok(error);assert.equal(error.message,'DATE_REPRESENTATION_SCOPE_MISMATCH');return error;}
test('missing role context diagnoses the identity binding without asking for another date',()=>{
 const x=fixture();delete x.scope.roleId;const error=failure(x);assert.deepEqual(error.details.mismatchedFields,['roleId']);assert.deepEqual(error.details.missingFields,['roleId']);
 assert.match(error.details.recovery,/原岗位当前页面/);assert.match(error.details.recovery,/page\.roleIdentity/);assert.match(error.details.recovery,/不推断 roleId/);assert.match(error.details.recovery,/不涉及获奖日期精度/);assert.match(error.details.recovery,/不要求用户重新提供日期/);
 const text=JSON.stringify(error);for(const secret of [x.scope.pageUrl,'private-sentinel','2099-12-31','approved-source'])assert.equal(text.includes(secret),false);
});
test('each unchanged scope gate identifies the mismatching field without disclosing values',()=>{
 for(const [field,mutate]of [
  ['mode',x=>x.policy.mode='other-mode'],['companyId',x=>x.policy.companyId='another-company'],['pageUrl',x=>x.policy.pageUrl='https://example.test/other?secret=redacted'],['roleId',x=>x.scope.roleId='another-role'],['sourceId',x=>delete x.profile.sources['approved-source']]
 ]){const x=fixture();mutate(x);const error=failure(x);assert.deepEqual(error.details.mismatchedFields,[field]);assert.deepEqual(error.details.missingFields,field==='sourceId'?['sourceId']:[]);assert.equal(JSON.stringify(error.details).includes('another-role'),false);assert.equal(JSON.stringify(error.details).includes('redacted'),false);}
});
test('missing policy fields and combined mismatches are explicit without weakening rejection',()=>{
 const x=fixture();delete x.policy.mode;delete x.policy.companyId;delete x.policy.pageUrl;delete x.policy.roleId;delete x.policy.sourceId;
 const error=failure(x),fields=['mode','companyId','pageUrl','roleId','sourceId'];assert.deepEqual(error.details.mismatchedFields,fields);assert.deepEqual(error.details.missingFields,fields);
});
test('matching policy preserves the original result and string-equivalent role IDs',()=>{
 const x=fixture(),before=structuredClone(x),r=resolveDateRepresentation(x.profile,x.scope,x.field);assert.deepEqual(r,{mode:'as_of_date',value:'2099-12-31',source:'application.asof',sourceIds:['approved-source'],policyHash:createHash('sha256').update(JSON.stringify(x.policy)).digest('hex')});assert.deepEqual(x,before);
 x.scope.roleId=42;x.policy.roleId='42';assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field).value,'2099-12-31');
});
test('no policy and an uncovered end source still return null without inspecting identity',()=>{
 const x=fixture();delete x.scope.roleId;x.field.source='projects.other.end';assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field),null);
 delete x.profile.companyForms.form.ongoingDateRepresentation;assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field),null);
});
test('sourced date validation failures retain their own error rather than becoming scope or award precision failures',()=>{
 for(const mutate of [x=>x.profile.facts['application.asof'].status='missing',x=>x.profile.facts['application.asof'].sourceIds=[],x=>x.profile.facts['application.asof'].value='2099']){
  const x=fixture();mutate(x);assert.throws(()=>resolveDateRepresentation(x.profile,x.scope,x.field),error=>error.message==='SOURCED_DATE_REPRESENTATION_REQUIRED');
 }
});

import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {resolveDateRepresentation} from '../shared/date-representation.mjs';
const fixture=()=>{
 const scope={companyId:'sample',pageUrl:'https://example.test/form?jobAdId=role&userId=private-sentinel',roleId:'role'},field={source:'projects.example.end'},policy={mode:'as_of_date',...scope,source:'application.asof',sourceId:'approved-source',endSources:[field.source]};
 return {scope,field,policy,profile:{sources:{'approved-source':{kind:'user_reply'}},facts:{'application.asof':{status:'known',value:'2099-12-31',sourceIds:['approved-source']}},companyForms:{sample:{companyId:scope.companyId,pageUrl:scope.pageUrl,ongoingDateRepresentation:policy}}}};
};
function failure(x){let error;try{resolveDateRepresentation(x.profile,x.scope,x.field);}catch(e){error=e;}assert.ok(error);assert.equal(error.message,'DATE_REPRESENTATION_SCOPE_MISMATCH');return error;}
test('the portal as-of date belongs to the company form: another role or address uses it too',()=>{
 const x=fixture();x.scope.roleId='another-role';
 assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field).mode,'as_of_date');
});
test('each unchanged scope gate identifies the mismatching field without disclosing values',()=>{
 for(const [field,mutate]of [
  ['mode',x=>x.policy.mode='other-mode'],['companyId',x=>x.policy.companyId='another-company'],['sourceId',x=>delete x.profile.sources['approved-source']]
 ]){const x=fixture();mutate(x);const error=failure(x);assert.deepEqual(error.details.mismatchedFields,[field]);assert.deepEqual(error.details.missingFields,field==='sourceId'?['sourceId']:[]);}
});
test('missing policy fields and combined mismatches are explicit without weakening rejection',()=>{
 const x=fixture();delete x.policy.mode;delete x.policy.companyId;delete x.policy.sourceId;
 const error=failure(x),fields=['mode','companyId','sourceId'];assert.deepEqual(error.details.mismatchedFields,fields);assert.deepEqual(error.details.missingFields,fields);
});
test('matching policy preserves the original result and string-equivalent role IDs',()=>{
 const x=fixture(),before=structuredClone(x),r=resolveDateRepresentation(x.profile,x.scope,x.field);assert.deepEqual(r,{mode:'as_of_date',value:'2099-12-31',source:'application.asof',sourceIds:['approved-source'],policyHash:createHash('sha256').update(JSON.stringify(x.policy)).digest('hex')});assert.deepEqual(x,before);
 x.scope.roleId=42;x.policy.roleId='42';assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field).value,'2099-12-31');
});
test('no policy and an uncovered end source still return null without inspecting identity',()=>{
 const x=fixture();delete x.scope.roleId;x.field.source='projects.other.end';assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field),null);
 delete x.profile.companyForms.sample.ongoingDateRepresentation;assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field),null);
});
test('sourced date validation failures retain their own error rather than becoming scope or award precision failures',()=>{
 for(const mutate of [x=>x.profile.facts['application.asof'].status='missing',x=>x.profile.facts['application.asof'].sourceIds=[],x=>x.profile.facts['application.asof'].value='2099']){
  const x=fixture();mutate(x);assert.throws(()=>resolveDateRepresentation(x.profile,x.scope,x.field),error=>error.message==='SOURCED_DATE_REPRESENTATION_REQUIRED');
 }
});

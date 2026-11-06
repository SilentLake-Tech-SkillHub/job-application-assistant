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

test('confirmed ongoing with a captured ongoing control takes precedence over a legacy as-of presentation',()=>{
 const x=fixture();x.field.ongoingSource='projects.example.ongoing';x.profile.facts[x.field.ongoingSource]={status:'known',value:true,sourceIds:['approved-source']};
 x.field.actions=[{method:'phoenix_date',ongoingSelector:'#ongoing'}];
 assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field),null);
 x.field.actions=[{method:'ant_day',ongoingLabel:'至今'}];
 assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field),null);
 x.field.actions=[{method:'phoenix_date'}];
 assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field).value,'2099-12-31');
 x.field.actions=[{method:'phoenix_date',ongoingSelector:'#ongoing'}];x.profile.facts[x.field.ongoingSource].value=false;
 assert.equal(resolveDateRepresentation(x.profile,x.scope,x.field).value,'2099-12-31');
});

test('existing as-of template compiles ongoing without an end-date action and keeps verification ongoing',async()=>{
 const {compileExecutionPlan}=await import('../shared/execution-plan.mjs');
 const {verifyDateRanges}=await import('../shared/date-range-verification.mjs');
 const f={id:'end',source:'projects.example.end',ongoingSource:'projects.example.ongoing',dateRepresentation:{mode:'as_of_date',source:'application.asof'},kind:'date',precision:'month',label:'End',required:false,inventorySelectors:['#end'],read:{selector:'#end',kind:'text',ongoingSelector:'#ongoing'},actions:[{method:'phoenix_date',selector:'#end',labelSelector:'#label',ongoingSelector:'#ongoing'}],control:{type:'month_picker',valueType:'string',readbackType:'string'}};
 const template={id:'T1',evidence:{sourceUrl:'https://example.test/form'},coverage:{allControlsMapped:true,allDriversSupported:true,allConditionalBranchesVerified:true},pages:[{pathPrefix:'/form',fields:[f]}]};
 const task={companyId:'sample',pageUrl:'https://example.test/form',templateHash:'h',values:{'projects.example.ongoing':true},sources:{},dateRepresentations:{}};
 const plan=await compileExecutionPlan(template,task);assert.equal(plan.readyForExecution,true);assert.equal(plan.pages[0].fields[0].value,'至今');assert.deepEqual(plan.constructionBlockers,[]);
 const proof=await verifyDateRanges({act:async(a,v)=>{assert.equal(v,'至今');assert.equal(a.operation,'verify');return {value:v,selectionVerified:true,precision:'month'};}},template.pages[0],{values:{'projects.example.end':'至今'}});
 assert.equal(proof.end.status,'verified');
});

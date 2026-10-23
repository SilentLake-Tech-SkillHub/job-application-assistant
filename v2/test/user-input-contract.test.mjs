import test from 'node:test';import assert from 'node:assert/strict';
import {ongoingDateUserWait} from '../shared/user-input-contract.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';
import {registerTemplateContract,resolveProfile} from '../shared/profile.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';
import {compileExpected} from '../shared/observation.mjs';import {hash} from '../shared/engine.mjs';
test('a user-approved portal as-of date freezes separately without changing a real ongoing project',async()=>{
 const companyId='sample',pageUrl='https://sample.test/form?id=1',source='projects.one.end';
 const p={schemaVersion:1,entities:{},sources:{user:{kind:'user_reply'}},fieldRegistry:{},facts:{'projects.one.ongoing':{status:'known',value:true,sourceIds:['user']},'application.asof':{status:'known',value:'2026-10-23',sourceIds:['user']}},companyForms:{current:{companyId,pageUrl,mappings:{},ongoingDateRepresentation:{mode:'as_of_date',source:'application.asof',sourceId:'user',companyId,roleId:'1',pageUrl,endSources:[source]}}}};
 const capture={companyId,pageUrl,captureId:'capture',observedAt:'synthetic',provider:'ant',controls:[{selector:'#end',label:'End',type:'text',renderer:'ant_date',contextProvider:'.ant-form-item',required:true,readonly:true}]},page={roleTitle:'Role',roleIdentity:{source:'query',parameter:'id',value:'1'},readySelector:'form',sections:[{title:'Dates'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}};
 const built=buildFormTemplate({capture,profile:p,mappings:[{selector:'#end',factKey:source}],page,templateId:'sample'});assert.equal(built.readyToRegister,true);
 const t=built.template;t.coverage={allControlsMapped:true,allDriversSupported:true,allConditionalBranchesVerified:true};registerTemplateContract(p,{companyId,template:t,templateHash:hash(t)});
 const materialContext={batchId:'batch',contentSha256:'sha',companyId,roleId:'1',materials:{schemaVersion:1,items:[{key:'referralCode',status:'absent',value:null,raw:'',requireWhenAvailable:true,evidence:{masterDataSha256:'master',roleUrl:'https://sample.test/job/1'}}]}};
 const resolved=resolveProfile(p,t,{},companyId,materialContext),task={companyId,roleId:'1',pageUrl,templateHash:hash(t),...resolved};
 const plan=await compileExecutionPlan(t,task);assert.equal(plan.readyForExecution,true);assert.equal(plan.pages[0].fields[0].value,'2026-10-23');assert.equal(compileExpected(t.pages[0],task).fields[0].value,'2026-10-23');
 assert.equal(p.facts[source].status,'missing');assert.equal(p.facts['projects.one.ongoing'].value,true);
 const changed=structuredClone(task);Object.values(changed.dateRepresentations)[0].value='2026-10-24';await assert.rejects(assertPreparedPlan(plan,t,{...changed,planId:plan.id,planHash:plan.planHash},{}),/PREPARED_PLAN_INPUTS_CHANGED/);
 assert.throws(()=>resolveProfile(p,t,{},companyId,{...materialContext,roleId:'2'}),/DATE_REPRESENTATION_SCOPE_MISMATCH/);
});
const fixture=()=>({companyId:'sample',question:'Which date representation should this form use?',selectors:['#end'],capture:{companyId:'sample',captureId:'capture',pageUrl:'https://sample.test/form',controls:[{selector:'#end',renderer:'ant_date',required:true}]},choices:{id:'choices',companyId:'sample',captureId:'capture',pageUrl:'https://sample.test/form',choices:[{selector:'#end',status:'captured_date_options',restored:true,dateOptions:{ongoingLabel:null,panelText:'Year Month Day'}}]},profile:{facts:{'projects.one.ongoing':{status:'known',value:true}},companyForms:{current:{companyId:'sample',pageUrl:'https://sample.test/form',mappings:{end:{active:true,selector:'#end',factKey:'projects.one.end'}}}}}});
test('only an evidenced website/date representation conflict grants a user-decision wait',()=>{
 const result=ongoingDateUserWait(fixture());assert.equal(result.completion.complete,false);assert.equal(result.continuation.owner,'user');assert.equal(result.continuation.shouldContinue,false);
 for(const mutate of [x=>x.capture.companyId='other',x=>x.choices.captureId='other',x=>x.choices.choices[0].dateOptions.panelText='',x=>x.choices.choices[0].dateOptions.ongoingLabel='Present',x=>x.profile.facts['projects.one.ongoing'].value=false,x=>x.capture.controls[0].required=false]){
  const input=fixture();mutate(input);assert.throws(()=>ongoingDateUserWait(input),/REQUIRED/);
 }
});

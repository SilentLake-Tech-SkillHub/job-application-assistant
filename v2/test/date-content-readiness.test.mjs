import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPending} from '../shared/field-policy.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';
import {compactConstructionResult} from '../shared/form-acquisition.mjs';
import {compileExecutionPlan} from '../shared/execution-plan.mjs';
const field=precision=>({id:'date',source:'date',label:'日期',kind:'date',precision});
const profile=value=>({facts:{date:{status:'known',value}}});
test('known coarse dates are user-owned precision gaps, never ready or driver work',()=>{
 for(const [value,requiredPrecision,sourcePrecision,missingComponents]of [['2024','day','year',['month','day']],['2024','month','year',['month']],['2024-06','day','month',['day']]]){
  const p=classifyPending(field(requiredPrecision),profile(value));assert.deepEqual(p,{kind:'answer',reason:'DATE_SOURCE_PRECISION_INSUFFICIENT',owner:'user',sourcePrecision,requiredPrecision,missingComponents});assert.equal(JSON.stringify(p).includes(value),false);
 }
});
test('existing date projection remains ready without changing a source date',()=>{
 for(const [value,precision]of [['2024-06-01','day'],['2024-06-01','month'],['2024-06-01','year'],['2024-06','month'],['2024-06','year'],['2024','year']]){
  const p=profile(value),before=JSON.stringify(p);assert.equal(classifyPending(field(precision),p).kind,'ready');assert.equal(JSON.stringify(p),before);
 }
});
test('ongoing and explicitly evidenced absence remain on their existing paths',()=>{
 const ongoing={...field('day'),ongoingSource:'date.ongoing'},p=profile('2024');p.facts['date.ongoing']={status:'known',value:true};assert.equal(classifyPending(ongoing,p).resolution,'sourced_same_record_ongoing');
 const omitted={facts:{date:{status:'not_applicable',omission:{kind:'confirmed_absent',evidence:'user-source'}}},sources:{'user-source':{kind:'user_confirmation'}}};assert.equal(classifyPending(field('day'),omitted).kind,'ready');
 const missing={facts:{date:{status:'missing'}}};assert.equal(classifyPending(field('day'),missing).reason,'CANONICAL_ANSWER_MISSING');
});
function build(values,{sensitiveLabel=false}={}){
 const controls=values.map((_,i)=>({selector:'#date'+i,label:sensitiveLabel?'证件号码':'日期'+i,tag:'input',type:'date'})),capture={companyId:'sample',captureId:'capture',pageUrl:'https://example.test/form',observedAt:new Date().toISOString(),controls};
 const p={facts:Object.fromEntries(values.map((value,i)=>['date'+i,{status:'known',value}]))};
 return buildFormTemplate({capture,profile:p,mappings:values.map((_,i)=>({selector:'#date'+i,factKey:'date'+i})),page:{roleTitle:'Example Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Dates'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}},templateId:'dates'});
}
test('structurally registerable dates expose content blockers and compact output does not hide them',()=>{
 const b=build(['2024','2022','2020','2026-10-23']),compact=compactConstructionResult(b);assert.equal(b.readyToRegister,true);assert.equal(b.contentReady,false);assert.equal(b.blockers.length,0);assert.equal(b.contentBlockers.length,3);assert.equal(compact.contentReady,false);assert.equal(compact.pendingCounts.ready,1);assert.equal(compact.pendingCounts.answer,3);assert.equal(compact.contentBlockers.length,3);assert.ok(compact.pending.every(p=>p.reason==='DATE_SOURCE_PRECISION_INSUFFICIENT'));
 assert.equal(b.template.acquisitionBlockers,undefined);assert.equal(b.nextGoals.some(g=>g.reason==='DATE_SOURCE_PRECISION_INSUFFICIENT'),false);assert.equal(JSON.stringify(compact.contentBlockers).includes('2024'),false);
 const ready=build(['2024-06-01']);assert.equal(ready.contentReady,true);assert.deepEqual(ready.contentBlockers,[]);
});
test('preflight still rejects coarse date facts rather than expanding them into fabricated dates',async()=>{
 const b=build(['2024']);await assert.rejects(compileExecutionPlan(b.template,{companyId:'sample',pageUrl:b.template.evidence.sourceUrl,values:{date0:'2024'}}),/INVALID_PREFLIGHT_DATE/);
});

test('protected human actions remain separate and cannot become ordinary missing-content facts',()=>{
 const b=build(['2024'],{sensitiveLabel:true}),compact=compactConstructionResult(b);assert.equal(b.pending[0].kind,'human_action');assert.equal(b.pending[0].reason,'sensitive_identity');assert.equal(b.contentReady,true);assert.deepEqual(b.contentBlockers,[]);assert.equal(compact.pendingCounts.human_action,1);assert.equal(compact.pending[0].kind,'human_action');
});

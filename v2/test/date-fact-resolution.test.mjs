import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDateFact,datePrecisionGap} from '../shared/date-fact-resolution.mjs';
import {classifyPending} from '../shared/field-policy.mjs';
import {resolveProfile} from '../shared/profile.mjs';
const known=value=>({status:'known',value,sourceIds:['primary']});
const setup=()=>({schemaVersion:1,entities:{},sources:{primary:{kind:'confirmed_profile'},dayPolicy:{kind:'user_reply'}},facts:{'awards.one.date':{status:'missing',value:null,sourceIds:[]},'awards.one.year':{...known('2048'),precision:'year'},'awards.one.description':known('2048年第一季度')},policy:{applicationDateDefaults:{missingDay:'01',missingMonth:'needs_user',sourceId:'dayPolicy'}}});
test('an empty date alias retains this records known year and quarter and asks only for the missing month',()=>{
 const profile=setup(),gap=datePrecisionGap(profile,'awards.one.date','day');
 assert.equal(gap.knownValue,'2048');assert.equal(gap.knownContext,'2048年第一季度');assert.deepEqual(gap.missingComponents,['month']);assert.equal(gap.approvedDayDefault,'01');
 const pending=classifyPending({kind:'date',source:'awards.one.date',precision:'day'},profile);assert.equal(pending.reason,'DATE_SOURCE_PRECISION_INSUFFICIENT');assert.equal(pending.knownDateEvidence.knownValue,'2048');
 assert.equal(profile.facts['awards.one.date'].status,'missing');assert.equal(resolveDateFact(profile,'awards.one.date').fact.value,'2048');
});
test('a known same-record month applies only the existing user-approved first-day policy',()=>{
 const profile=setup();profile.facts['awards.one.month']=known('03');const resolved=resolveDateFact(profile,'awards.one.date');assert.equal(resolved.fact.value,'2048-03-01');assert.deepEqual(resolved.fact.sourceIds,['primary','dayPolicy']);assert.equal(resolved.fact.dateNormalization.sourcePrecision,'month');
 profile.sources.dayPolicy.kind='system_inference';assert.equal(resolveDateFact(profile,'awards.one.date').fact.value,'2048-03');
});
test('another award cannot supply a missing month, and an explicit absence is never overridden',()=>{
 const profile=setup();profile.facts['awards.other.date']={...known('2048-08-01'),precision:'day'};assert.equal(resolveDateFact(profile,'awards.one.date').fact.value,'2048');
 profile.facts['awards.one.date']={status:'not_applicable',value:null,sourceIds:['primary']};assert.equal(resolveDateFact(profile,'awards.one.date').fact.status,'not_applicable');
});
test('profile resolution uses complete same-record evidence while coarse evidence never becomes an executable day',()=>{
 const profile=setup(),template={evidence:{sourceUrl:'https://example.test/form'},pages:[{fields:[{id:'award-date',source:'awards.one.date',kind:'date',precision:'day',read:{}}]}]};
 let resolved=resolveProfile(profile,template);assert.equal(resolved.values['awards.one.date'],undefined);assert.equal(resolved.sources['awards.one.date'].datePrecisionGap.knownValue,'2048');assert.deepEqual(resolved.sources['awards.one.date'].datePrecisionGap.missingComponents,['month']);
 profile.facts['awards.one.yearMonth']={...known('2048-02'),precision:'month'};resolved=resolveProfile(profile,template);assert.equal(resolved.values['awards.one.date'],'2048-02-01');assert.deepEqual(resolved.sources['awards.one.date'].derivedFrom,['awards.one.yearMonth']);assert.equal(profile.facts['awards.one.date'].value,null);
});

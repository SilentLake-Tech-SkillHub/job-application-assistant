import test from 'node:test';import assert from 'node:assert/strict';
import {rankChoices,resolveObservedChoice,applyChoiceResolution} from '../shared/choice-resolution.mjs';
const profile={facts:{'education.one.school.name.zh':{status:'known',value:'甲大学'},'education.one.school.name.en':{status:'known',value:'Alpha University'},'education.one.school.abbreviation':{status:'known',value:'AU'},'education.one.major.zh':{status:'known',value:'Applied AI'}},policy:{majorDropdownResolution:{one:'Computer Science',autoSelect:true}}};
test('school aliases select actual observed label without changing canonical fact',()=>{
 const key='education.one.school.name.zh',choice={status:'captured',restored:true,options:['Alpha University','Beta University']};const r=resolveObservedChoice({profile,factKey:key,choice});
 assert.equal(r.selectedOption,'Alpha University');assert.equal(r.sourceValue,'甲大学');assert.equal(profile.facts[key].value,'甲大学');
 const f={source:key,control:{type:'dropdown'},actions:[{method:'dropdown'}],constructionBlockers:[]};applyChoiceResolution(f,choice,profile);assert.equal(f.enumMap['甲大学'],'Alpha University');assert.equal(f.actions[0].query,'Alpha University');
});
test('fuzzy candidate ranking never silently chooses another entity',()=>{
 const key='education.one.school.name.en',r=rankChoices(profile,key,['Alpha University Singapore','Alphaa University']);assert.equal(r.selection,null);assert.equal(r.automaticFuzzySelection,false);assert.equal(r.status,'semantic_review_required');
 assert.throws(()=>resolveObservedChoice({profile,factKey:key,choice:{status:'captured',restored:true,options:['Alphaa University']},selectedOption:'Alphaa University'}),/SEMANTIC_REVIEW_REQUIRED/);
 assert.throws(()=>resolveObservedChoice({profile,factKey:key,choice:{status:'captured',restored:true,options:['Alpha University']},selectedOption:'Invented',evidence:'claim'}),/ACTUAL_CAPTURED_OPTION_REQUIRED/);
});
test('approved major mapping is policy driven and unavailable choices remain blocked',()=>{
 const key='education.one.major.zh';assert.equal(rankChoices(profile,key,['Computer Science']).selection,'Computer Science');
 assert.equal(rankChoices({...profile,policy:{}},key,['Computer Science']).selection,null);
 const f={source:key,control:{type:'dropdown'},actions:[],constructionBlockers:[]};applyChoiceResolution(f,{options:['Physics'],status:'captured',restored:true},profile);assert.ok(f.constructionBlockers.includes('CHOICE_SEMANTIC_RESOLUTION_REQUIRED'));
});
test('a previously accepted choice is rejected if actual options or source fact change',()=>{
 const key='education.one.school.name.zh',choice={status:'captured',restored:true,options:['Alpha University']};choice.resolutions={[key]:resolveObservedChoice({profile,factKey:key,choice})};choice.options=['Other'];
 assert.throws(()=>applyChoiceResolution({source:key,control:{type:'dropdown'}},choice,profile),/CHOICE_RESOLUTION_STALE/);
});

test('incremental option capture retains other controls and each option search evidence',async()=>{
 const {mergeObservedChoices}=await import('../shared/choice-resolution.mjs');
 const c=(selector,options,query)=>({selector,options,query,status:'captured',restored:true});
 let all=mergeObservedChoices([c('#degree',['Master'])],[c('#school',['Alpha University'],'Alpha')]);
 all=mergeObservedChoices(all,[c('#school',['Beta University'],'Beta')]);assert.equal(all.length,2);assert.deepEqual(all[1].options,['Alpha University','Beta University']);
 const r=resolveObservedChoice({profile,factKey:'education.one.school.name.zh',choice:all[1]});assert.equal(r.query,'Alpha');
});

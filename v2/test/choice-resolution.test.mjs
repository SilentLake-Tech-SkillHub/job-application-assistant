import test from 'node:test';import assert from 'node:assert/strict';
import {rankChoices,resolveObservedChoice,applyChoiceResolution} from '../shared/choice-resolution.mjs';
import {preferRealMajorMappings} from '../shared/major-policy.mjs';
import {registerTemplateContract,resolveProfile,recordProfileAnswers} from '../shared/profile.mjs';
import {hash} from '../shared/engine.mjs';
test('a locked portal enum still needs an evidenced presentation mapping, preserving canonical meaning and no write action',()=>{
 const key='identity.documentType',p={facts:{[key]:{status:'known',value:'Canonical document type'}}},choice={status:'captured_locked_value',restored:true,options:['Portal document type'],lockedControl:{disabled:true,selected:true,value:'Portal document type'}};
 assert.throws(()=>resolveObservedChoice({profile:p,factKey:key,choice,selectedOption:'Portal document type'}),/SEMANTIC_REVIEW_REQUIRED/);
 choice.resolutions={[key]:resolveObservedChoice({profile:p,factKey:key,choice,selectedOption:'Portal document type',evidence:'Observed locked portal label is the same sourced document type'})};
 const field={source:key,kind:'choice',readonly:true,lockedControl:choice.lockedControl,control:{type:'dropdown'},actions:[],constructionBlockers:[]};applyChoiceResolution(field,choice,p);
 assert.equal(field.enumMap['Canonical document type'],'Portal document type');assert.deepEqual(field.actions,[]);assert.equal(p.facts[key].value,'Canonical document type');
});
test('real and application majors stay separate; text uses the real major, dropdown fallback needs absence evidence',()=>{
 const key='education.sample.major.zh',p={schemaVersion:1,entities:{},sources:{user:{kind:'user_reply'}},fieldRegistry:{},facts:{[key]:{status:'known',value:'Specific Discipline',sourceIds:['user']},'education.sample.major.canonical':{status:'known',value:'General Discipline',sourceIds:['user']}},policy:{majorDropdownResolution:{autoSelect:true,whenOriginalUnavailable:true}}};
 preferRealMajorMappings(p,{evidence:'User distinguishes original and application majors'});assert.equal(p.facts[key].value,'Specific Discipline');assert.equal(p.facts['education.sample.major.application'].value,'General Discipline');assert.equal(p.facts['education.sample.major.canonical'],undefined);
 const field={id:'major',source:key,label:'Major',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},actions:[{method:'fill',selector:'#major'}],read:{kind:'value',selector:'#major'}},t={id:'t',version:1,evidence:{sourceUrl:'https://sample.test/form'},pages:[{pathPrefix:'/form',fields:[field]}]};
 registerTemplateContract(p,{companyId:'sample',template:t,templateHash:hash(t)});assert.equal(resolveProfile(p,t,{},'sample').values[key],'Specific Discipline');
 const choice={status:'captured',restored:true,options:['General Discipline'],scope:'search_results',coverage:{complete:true}};
 assert.throws(()=>resolveObservedChoice({profile:p,factKey:key,choice}),/MAJOR_ORIGINAL_OPTION_SEARCH_REQUIRED/);
 choice.searches=[{query:'Specific Discipline',options:[],restored:true}];assert.equal(resolveObservedChoice({profile:p,factKey:key,choice}).selectedOption,'General Discipline');
 choice.options.push('Specific Discipline');assert.equal(resolveObservedChoice({profile:p,factKey:key,choice}).selectedOption,'Specific Discipline');
  assert.throws(()=>resolveObservedChoice({profile:p,factKey:key,choice,selectedOption:'General Discipline',evidence:'Agent prefers fallback'}),/MAJOR_REAL_OPTION_REQUIRED/);
});
test('multi-value canonical answers accept real string arrays and reject scalar guesses',()=>{
 const p={schemaVersion:1,facts:{cities:{status:'missing',value:null,sourceIds:[]}},fieldRegistry:{cities:{canonicalType:'string[]'}},sources:{},entities:{}};
 assert.throws(()=>recordProfileAnswers(p,{evidence:'synthetic',answers:[{factKey:'cities',status:'known',value:'City'}]}),/INVALID_CANONICAL_FACT_TYPE/);
 recordProfileAnswers(p,{evidence:'synthetic',answers:[{factKey:'cities',status:'known',value:['City']}]});assert.deepEqual(p.facts.cities.value,['City']);
});
test('approved major fallback is used only when the original is unavailable and never invents an option',()=>{
 const p={facts:{'education.sample.major.zh':{status:'known',value:'Specific Discipline'}},policy:{majorDropdownResolution:{sample:'General Discipline',autoSelect:true,whenOriginalUnavailable:true}}},key='education.sample.major.zh';
 assert.equal(rankChoices(p,key,['Specific Discipline','General Discipline']).selection,'Specific Discipline');
 assert.equal(rankChoices(p,key,['General Discipline']).selection,'General Discipline');
 assert.equal(rankChoices(p,key,['Other Discipline']).selection,null);
});
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

test('manual enum mapping cannot register without its actual field-bound option confirmation',async()=>{
 const {assertStoredChoiceResolutions}=await import('../shared/choice-resolution.mjs'),key='education.one.school.name.zh',choice={selector:'#school',status:'captured',restored:true,choicesId:'actual',captureId:'capture',options:['Alpha University']},resolution=resolveObservedChoice({profile,factKey:key,choice}),field={kind:'choice',source:key,inventorySelectors:['#school'],enumMap:{'甲大学':'Alpha University'},choiceResolution:resolution},template={evidence:{sourceUrl:'https://fixture.test/form'},pages:[{fields:[field]}]},asset={companyId:'company',pageUrl:template.evidence.sourceUrl,captureId:'capture',choices:[choice]},store={get:async()=>asset};
 assert.equal(await assertStoredChoiceResolutions(template,{store,companyId:'company',profile}),true);
 delete field.choiceResolution;await assert.rejects(assertStoredChoiceResolutions(template,{store,companyId:'company',profile}),/STORED_CHOICE_CONFIRMATION_REQUIRED/);
 field.choiceResolution=resolution;asset.companyId='another';await assert.rejects(assertStoredChoiceResolutions(template,{store,companyId:'company',profile}),/STORED_CHOICE_CONFIRMATION_CHANGED/);
});

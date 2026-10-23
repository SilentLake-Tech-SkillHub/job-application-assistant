import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateChoiceGoals,assertStoredChoiceGoals,assertChoiceGoalSources} from '../shared/choice-goal-contract.mjs';
import {resolveObservedChoice} from '../shared/choice-resolution.mjs';
const factKey='education.sample.school.name.zh',selector='#school';
function fixture(value='示例科技大学',type='dropdown'){
 return {capture:{captureId:'capture-sample',controls:[{selector}]},profile:{facts:{[factKey]:{status:'known',value}}},fields:[{id:'school',source:factKey,label:'School',inventorySelectors:[selector],control:{type,options:['Fabricated option']}}],choices:[]};
}
function observed(args,options=['示例科技大学']){
 args.choices=[{selector,captureId:args.capture.captureId,choicesId:'choices-sample',status:'captured',restored:true,options,optionRecords:options.map((label,i)=>({label,value:'id-'+i,valueAttribute:'data-id',disabled:false}))}];return args;
}
test('a real exact Chinese school candidate resolves without a search',()=>{
 const args=observed(fixture()),r=evaluateChoiceGoals(args);assert.equal(r.blockers.length,0);assert.equal(r.goals[0].decision,'resolved_known_alias');assert.equal(r.goals[0].resolution.optionValue,'id-0');assert.equal(r.goals[0].executionVerified,false);assert.equal(r.nextGoals.length,0);
});
test('missing assets never borrow control.options',()=>{
 const r=evaluateChoiceGoals(fixture());assert.equal(r.blockers[0].reason,'CHOICE_GOAL_OPTION_CAPTURE_REQUIRED');assert.equal(r.nextGoals[0].nextTool,'form_search_choices');
});
test('wrong query empty evidence cannot authorize custom text',()=>{
 const args=fixture('Example University','searchable_text'),fact=args.profile.facts[factKey],sourceHash=createHash('sha256').update(JSON.stringify(fact)).digest('hex');
 args.choices=[{selector,captureId:args.capture.captureId,status:'captured_empty_search',restored:true,options:[],customValueEvidence:'No match; typed value will be used',goal:{factKey,sourceHash,captureId:args.capture.captureId,selector,decision:'observed_no_results',attempts:[{query:'Wrong University',queryApplied:true,status:'captured_empty_search',options:[],emptyEvidence:['No results']}]}}];
 assert.equal(evaluateChoiceGoals(args).goals[0].status,'blocked');
 args.choices[0].goal.attempts[0].query=fact.value;assert.equal(evaluateChoiceGoals(args).goals[0].decision,'observed_custom_value');
 const saved=structuredClone(args);delete args.choices[0].customValueEvidence;assert.equal(evaluateChoiceGoals(args).goals[0].status,'blocked');args.choices=saved.choices;
 args.choices[0].goal.attempts[0].queryApplied=false;assert.equal(evaluateChoiceGoals(args).goals[0].status,'blocked');
 args.choices[0].goal.attempts[0].queryApplied=true;fact.evidence='new source';assert.equal(evaluateChoiceGoals(args).goals[0].status,'blocked');
});
test('two confirmed school aliases stay ambiguous',()=>{
 const args=observed(fixture(),['示例科技大学','Example University']);args.profile.facts['education.sample.school.name.en']={status:'known',value:'Example University'};
 const r=evaluateChoiceGoals(args);assert.equal(r.blockers[0].reason,'CHOICE_GOAL_ALIAS_AMBIGUOUS');assert.equal(r.nextGoals[0].nextTool,'form_resolve_choices');
});
test('unrestored or another capture evidence stays blocked',()=>{
 const args=observed(fixture());args.choices[0].restored=false;assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'RESTORED_OPTION_EVIDENCE_REQUIRED');
 args.choices[0].restored=true;args.choices[0].captureId='other';assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_GOAL_CAPTURE_SCOPE_MISMATCH');
});
test('multiselect requires every exact sourced value and checks disabled options',()=>{
 const args=observed(fixture(['Alpha','Beta'],'multiselect'),['Alpha','Beta']);let r=evaluateChoiceGoals(args);assert.equal(r.goals[0].selections.length,2);assert.deepEqual(r.goals[0].selections.map(s=>s.optionValue),['id-0','id-1']);
 args.profile.facts[factKey].value.push('Gamma');assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'MULTISELECT_ARRAY_SOURCE_REQUIRES_OBSERVED_LABELS');
 args.profile.facts[factKey].value.pop();args.choices[0].optionRecords[1].disabled=true;assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_OPTION_DISABLED');
});
test('semantic resolution is rechecked against current source and option IDs',()=>{
 const args=observed(fixture('Example University'),['Example University Main Campus']),choice=args.choices[0];choice.resolutions={[factKey]:resolveObservedChoice({profile:args.profile,factKey,choice,selectedOption:choice.options[0],evidence:'Official dictionary names this campus as the same institution'})};
 assert.equal(evaluateChoiceGoals(args).goals[0].decision,'resolved_semantic_review');choice.optionRecords[0].value='changed';assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_RESOLUTION_STALE');
});
test('semantic evidence cannot be empty and stale source values stay blocked',()=>{
 const args=observed(fixture('Example University'),['Example University Campus']),choice=args.choices[0];choice.resolutions={[factKey]:resolveObservedChoice({profile:args.profile,factKey,choice,selectedOption:choice.options[0],evidence:'Official equivalent'})};
 choice.resolutions[factKey].evidence='';assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_SEMANTIC_REVIEW_REQUIRED');
 choice.resolutions[factKey].evidence='Official equivalent';args.profile.facts[factKey].value='Different University';assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_RESOLUTION_STALE');
});
test('duplicate actual labels and disabled exact matches cannot resolve',()=>{
 const args=observed(fixture());args.choices[0].optionRecords.push({...args.choices[0].optionRecords[0],value:'other-id'});assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_OPTION_NOT_UNIQUE');
 args.choices[0].optionRecords.pop();args.choices[0].optionRecords[0].disabled=true;assert.equal(evaluateChoiceGoals(args).blockers[0].reason,'CHOICE_OPTION_DISABLED');
});
test('evaluation never changes input and skips readonly, userOnly and unknown facts',()=>{
 const args=observed(fixture()),before=structuredClone(args),r=evaluateChoiceGoals(args);assert.deepEqual(args,before);assert.notEqual(r.choices,args.choices);assert.notEqual(r.choices[0],args.choices[0]);
 for(const patch of [{readonly:true},{userOnly:true}]){args.fields[0]={...before.fields[0],...patch};assert.equal(evaluateChoiceGoals(args).goals.length,0);}
 args.fields=before.fields;args.profile.facts[factKey].status='missing';assert.equal(evaluateChoiceGoals(args).goals.length,0);
});
test('registration rereads the paired capture and current options; freeze rejects changed fact or removed goal',async()=>{
 const args=observed(fixture());Object.assign(args.capture,{companyId:'sample',pageUrl:'https://sample.test/form'});
 const evaluated=evaluateChoiceGoals(args),field={...args.fields[0],choiceGoal:evaluated.goals[0]},template={evidence:{choiceGoalContract:1,captureId:args.capture.captureId,sourceUrl:args.capture.pageUrl},pages:[{fields:[field]}]};
 const asset={companyId:'sample',pageUrl:args.capture.pageUrl,captureId:args.capture.captureId,choices:evaluated.choices};
 const store={get:async(_,id)=>id===args.capture.captureId?args.capture:asset};
 await assertStoredChoiceGoals(template,{store,companyId:'sample',profile:args.profile,required:true});
 delete field.choiceGoal;assert.throws(()=>assertChoiceGoalSources(template,args.profile),/CURRENT_SOURCE_REQUIRED/);field.choiceGoal=evaluated.goals[0];
 args.profile.facts[factKey].value='Different University';assert.throws(()=>assertChoiceGoalSources(template,args.profile),/CURRENT_SOURCE_REQUIRED/);args.profile.facts[factKey].value='示例科技大学';
 asset.choices[0].optionRecords[0].value='changed-id';await assert.rejects(assertStoredChoiceGoals(template,{store,companyId:'sample',profile:args.profile}),/CHOICE_GOAL_(INCOMPLETE|EVIDENCE_CHANGED)/);
 delete template.evidence.choiceGoalContract;await assert.rejects(assertStoredChoiceGoals(template,{store,companyId:'sample',profile:args.profile,required:true}),/CONTRACT_REQUIRES_REBUILD/);
});

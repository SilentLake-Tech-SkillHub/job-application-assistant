import test from 'node:test';import assert from 'node:assert/strict';
import {planChoiceQueries} from '../shared/choice-query.mjs';
import {rankChoices} from '../shared/choice-resolution.mjs';
const key='education.sample.school.name.zh';
const profile=value=>({facts:{[key]:{status:'known',value}}});
test('institution retrieval starts with the distinctive core, full fact remains unchanged',()=>{
 const p=profile('示例理工大学'),before=structuredClone(p),plan=planChoiceQueries(p,key);
 assert.deepEqual(plan.steps.map(s=>s.query),['示例理工','示例理工大学']);assert.equal(plan.steps[0].identityAlias,false);assert.deepEqual(p,before);
 assert.equal(rankChoices(p,key,['示例理工职业学院','示例理工大学']).selection,'示例理工大学');
 assert.equal(rankChoices(p,key,['示例理工职业学院']).selection,null);
});
test('only a sourced country prefix is removed for retrieval and it never becomes a verified alias',()=>{
 const p=profile('示例国示例理工大学');p.facts['education.sample.location.country']={status:'known',value:'示例国'};
 const plan=planChoiceQueries(p,key);assert.equal(plan.steps[0].query,'示例理工');assert.equal(plan.steps[0].identityAlias,false);
 assert.equal(rankChoices(p,key,['示例理工大学']).selection,null);
 const unsourced=profile('示例国示例理工大学');assert.equal(planChoiceQueries(unsourced,key).steps[0].query,'示例国示例理工');
});
test('two-character stems are retrieval only, one-character stems stay full, and campus qualifiers remain',()=>{
 assert.equal(planChoiceQueries(profile('示例大学'),key).steps[0].query,'示例');assert.equal(planChoiceQueries(profile('示例大学'),key).steps[0].identityAlias,false);
 assert.equal(planChoiceQueries(profile('示大学'),key).steps[0].query,'示大学');
 assert.equal(planChoiceQueries(profile('示例大学深圳校区'),key).steps[0].query,'示例大学深圳校区');
});
test('non-institution fields preserve canonical values and approved aliases, not ad-hoc substrings',()=>{
 const p={facts:{'education.sample.major.zh':{status:'known',value:'应用智能'},'education.sample.major.application':{status:'known',value:'计算机科学与技术'}},policy:{majorDropdownResolution:{autoSelect:true}}};
 assert.deepEqual(planChoiceQueries(p,'education.sample.major.zh').steps.map(s=>s.query),['应用智能','计算机科学与技术']);
});

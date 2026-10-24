import test from 'node:test';
import assert from 'node:assert/strict';
import {recordProfileAnswers,registerObservedQuestions,mapProfileQuestions} from '../shared/profile.mjs';
test('user answer overwrites the current fact and removes old history',()=>{
 const p={schemaVersion:1,entities:{},sources:{old:{kind:'user_reply'}},fieldRegistry:{'application.preference':{canonicalType:'string'}},facts:{'application.preference':{value:'old',status:'known',sourceIds:['old'],history:[{value:'older'}]}}};
 recordProfileAnswers(p,{answers:[{factKey:'application.preference',status:'known',value:'current'}],evidence:'User corrected the preference'});
 assert.equal(p.facts['application.preference'].value,'current');assert.equal('history' in p.facts['application.preference'],false);assert.equal(p.facts['application.preference'].sourceIds.length,1);
});
test('remapping a company question never converts a canonical year fact into a full-date alias',()=>{
 const p={schemaVersion:1,entities:{},sources:{s:{kind:'user_reply'}},fieldRegistry:{'award.year':{canonicalType:'string',precision:'year'}},facts:{'award.year':{status:'known',value:'2022',precision:'year',sourceIds:['s']}}};
 const companyId='sample',pageUrl='https://fixture.test/form',r=registerObservedQuestions(p,{companyId,pageUrl,fields:[{selector:'#date',label:'Award date',type:'text'}]});
 const questionId=Object.keys(p.companyForms[r.pageKey].mappings)[0];
 mapProfileQuestions(p,{companyId,pageUrl,evidence:'map existing year',mappings:[{questionId,factKey:'award.year'}]});
 mapProfileQuestions(p,{companyId,pageUrl,evidence:'site requires full date',mappings:[{questionId,factKey:'award.date',define:{canonicalType:'string',precision:'day',label:'Award date'}}]});
 assert.equal(p.facts['award.year'].value,'2022');assert.equal(p.fieldRegistry['award.year'].aliasOf,undefined);assert.equal(p.facts['award.date'].status,'missing');
});

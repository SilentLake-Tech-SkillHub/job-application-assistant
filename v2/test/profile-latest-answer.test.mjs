import test from 'node:test';
import assert from 'node:assert/strict';
import {recordProfileAnswers,registerObservedQuestions,mapProfileQuestions} from '../shared/profile.mjs';
import {projectDateValue} from '../shared/value-contract.mjs';
test('explicit day answers upgrade coarse time facts without losing the day to a portal month contract',()=>{
 const p={schemaVersion:1,entities:{},sources:{},fieldRegistry:{'workProjects.example.start':{canonicalType:'string',precision:'month'}},facts:{'workProjects.example.start':{status:'missing',value:null,sourceIds:[],reason:'missing'},'certificates.example.date':{status:'missing',value:null,sourceIds:[]}}};
 recordProfileAnswers(p,{answers:[{factKey:'workProjects.example.start',status:'known',value:'2025-12-17'},{factKey:'certificates.example.date',status:'known',value:'2025-01-11'}],evidence:'User supplied exact full dates'});
 for(const key of ['workProjects.example.start','certificates.example.date'])assert.equal(p.facts[key].precision,'day');
 assert.equal(p.facts['workProjects.example.start'].value,'2025-12-17');assert.equal(p.facts['workProjects.example.start'].reason,undefined);assert.equal(projectDateValue(p.facts['workProjects.example.start'].value,'month'),'2025-12');
 const before=structuredClone(p);
 for(const value of ['2025-12','2025-02-30']){assert.throws(()=>recordProfileAnswers(p,{answers:[{factKey:'workProjects.example.start',status:'known',value}],evidence:'Invalid or downgraded date'}),/INVALID_CANONICAL_DATE/);assert.deepEqual(p,before);}
});
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {profileStatus} from '../shared/profile.mjs';
test('ongoing project resolves end-date question without inventing a date or asking again',()=>{
 const p={schemaVersion:1,entities:{},sources:{user:{}},facts:{'project.end':{status:'missing',value:null,sourceIds:[]},'project.ongoing':{status:'known',value:true,sourceIds:['user']}},companyForms:{f:{companyId:'synthetic',pageUrl:'https://example.com/form',executionContract:{fields:[{source:'project.end',ongoingSource:'project.ongoing',inventorySelectors:['#end']}]},mappings:{q:{factKey:'project.end',selector:'#end',status:'mapped',active:true}}}}};
 const row=()=>profileStatus(p,'synthetic').forms[0].questions[0];
 assert.equal(row().answerStatus,'known');assert.equal(row().factStatus,'missing');assert.equal(row().resolution.source,'project.ongoing');assert.equal(p.facts['project.end'].value,null);
 p.facts['project.ongoing'].value=false;assert.equal(row().answerStatus,'missing');
 p.facts['project.ongoing'].status='conflict';assert.equal(row().answerStatus,'missing');
});

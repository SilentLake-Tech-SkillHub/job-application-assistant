import test from 'node:test';
import assert from 'node:assert/strict';
import {recordProfileAnswers} from '../shared/profile.mjs';
test('user answer overwrites the current fact and removes old history',()=>{
 const p={schemaVersion:1,entities:{},sources:{old:{kind:'user_reply'}},fieldRegistry:{'application.preference':{canonicalType:'string'}},facts:{'application.preference':{value:'old',status:'known',sourceIds:['old'],history:[{value:'older'}]}}};
 recordProfileAnswers(p,{answers:[{factKey:'application.preference',status:'known',value:'current'}],evidence:'User corrected the preference'});
 assert.equal(p.facts['application.preference'].value,'current');assert.equal('history' in p.facts['application.preference'],false);assert.equal(p.facts['application.preference'].sourceIds.length,1);
});

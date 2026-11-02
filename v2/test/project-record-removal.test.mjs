import test from 'node:test';import assert from 'node:assert/strict';
import {performProjectRecordRemoval} from '../shared/project-record-removal.mjs';
import {CONTROL_METHODS,templateMethods} from '../shared/control-registry.mjs';
const action={authorized:true,expectedName:'Old project',label:'项目名称',section:'项目经历',selector:'phoenixq:'+JSON.stringify({section:'项目经历',label:'项目名称',occurrence:1,part:'native',controlIndex:0})};
test('project removal is explicit only and can never be placed in an ordinary fill template',()=>{assert.equal(CONTROL_METHODS.remove_project_record.inspection,false);assert.equal(CONTROL_METHODS.inspect_project_record.inspection,true);assert.equal(templateMethods().has('remove_project_record'),false);assert.equal(templateMethods().has('inspect_project_record'),false);});
test('one exact project is removed once and both readbacks preserve every other name and order',async()=>{
 let clicked=0,names=['First','Old project','Last'];const adapter={page:{evaluate:async()=>({names:[...names],removeSelector:'#remove'}),locator:()=>({count:async()=>1,click:async()=>{clicked++;names=['First','Last'];}})}};
 const r=await performProjectRecordRemoval(adapter,action);assert.equal(clicked,1);assert.equal(r.readbackStable,true);assert.deepEqual(r.remainingNames,['First','Last']);
});
test('absent or duplicated names and missing scope cannot trigger a delete click',async()=>{
 for(const names of [[],['Old project','Old project']]){const adapter={page:{evaluate:async()=>({names,removeSelector:'#remove'}),locator:()=>{throw Error('NO_CLICK');}}};await assert.rejects(performProjectRecordRemoval(adapter,action),/TARGET_REQUIRED/);}
 await assert.rejects(performProjectRecordRemoval({}, {...action,authorized:false}),/AUTHORIZATION_REQUIRED/);
});
test('an uncertain delete click is never automatically retried',async()=>{
 let clicked=0;const adapter={page:{evaluate:async()=>({names:['Old project'],removeSelector:'#remove'}),locator:()=>({count:async()=>1,click:async()=>{clicked++;throw Error('timeout');}})}};
 await assert.rejects(performProjectRecordRemoval(adapter,action),/timeout/);assert.equal(clicked,1);
});

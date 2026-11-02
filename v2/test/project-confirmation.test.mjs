import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {projectConfirmationDOM} from '../shared/project-record-removal.mjs';
function observe({far=false,message='是否要删除该组信息？',label='是',duplicate=false}={}){
 const visible={getClientRects:()=>[{}]},trigger={...visible,getBoundingClientRect:()=>({left:100,right:130,top:200,bottom:220})},popover={...visible,getBoundingClientRect:()=>far?{left:100,right:200,top:0,bottom:50}:{left:40,right:190,top:100,bottom:190}};
 const yes={...visible,id:'yes',textContent:label,className:'phoenix-button__wraper--primary',getAttribute:()=>null},confirm={...visible,closest:()=>popover,querySelector:()=>({textContent:message}),querySelectorAll:()=>[yes]};
 const doc={body:{},querySelectorAll:selector=>selector==='#remove'?[trigger]:selector==='.phoenix-popconfirm'?(duplicate?[confirm,confirm]:[confirm]):selector==='#yes'?[yes]:[]};
 return vm.runInNewContext('('+projectConfirmationDOM.toString()+')({removeSelector:"#remove",expectedName:"Old project"})',{document:doc,CSS:{escape:s=>s},getComputedStyle:()=>({visibility:'visible'})});
}
test('the actual Phoenix yes/no deletion popover is tied to its nearby captured trigger',()=>{const r=observe();assert.equal(r.associated,true);assert.equal(r.targetName,'Old project');assert.equal(r.confirmLabel,'是');assert.equal(r.confirmSelector,'#yes');});
test('remote, ambiguous or non-deletion confirmations cannot authorize a click',()=>{for(const options of [{far:true},{duplicate:true},{message:'是否提交申请？'},{label:'提交'}])assert.equal(observe(options),null);});

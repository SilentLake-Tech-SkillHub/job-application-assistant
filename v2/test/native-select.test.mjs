import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {controlDOM} from '../shared/control-dom.mjs';
import {capturedChoiceOptions} from '../shared/form-acquisition.mjs';
import {PageAdapter} from '../shared/ui-page.mjs';

const option=(label,value,extra={})=>({textContent:label,value,disabled:false,selected:false,closest:()=>null,...extra});
function fixture(options,{commit}={}){
 const node={id:'native',tagName:'SELECT',type:'select-one',options,selectedOptions:[],multiple:false,labels:[{textContent:'Selection'}],getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,getClientRects:()=>[{}]};
 const calls=[],locator={count:async()=>1,evaluate:async fn=>fn(node),press:async key=>calls.push({press:key}),selectOption:async spec=>{calls.push(spec);const found=options.find(o=>spec.value!==undefined?o.value===spec.value:o.textContent.trim()===spec.label);node.selectedOptions=commit?commit(found):[found];}};
 const page={url:()=> 'https://fixture.test/form',locator:()=>locator};
 return {node,calls,page,adapter:new PageAdapter(page,{listOpenPageUrls:async()=>[]})};
}
const action={method:'select',selector:'#native',options:['Alpha'],expectedOptionValue:'id-alpha'};
test('native inventory preserves all option labels, actual values and selection/disabled state',()=>{
 const f=fixture([option('Choose',''),option(' Alpha ','id-alpha',{selected:true}),option('Disabled','id-disabled',{disabled:true}),option('Grouped','id-grouped',{closest:()=>({disabled:true})})]);
 const document={querySelectorAll:selector=>selector==='#native'||selector.startsWith('input,textarea,select,')?[f.node]:[],querySelector:()=>null};
 const raw=vm.runInNewContext('('+controlDOM.toString()+')()',{document,location:{href:f.page.url()},getComputedStyle:()=>({visibility:'visible'}),CSS:{escape:v=>v},Date});
 const captured=JSON.parse(JSON.stringify(raw[0]));
 assert.deepEqual(captured.options,['Alpha','Grouped']);
 assert.deepEqual(captured.optionRecords,[
  {label:'Choose',value:'',valueAttribute:'value',disabled:false,selected:false},
  {label:'Alpha',value:'id-alpha',valueAttribute:'value',disabled:false,selected:true},
  {label:'Disabled',value:'id-disabled',valueAttribute:'value',disabled:true,selected:false},
  {label:'Grouped',value:'id-grouped',valueAttribute:'value',disabled:true,selected:false}
 ]);
 const choices=capturedChoiceOptions(captured);assert.deepEqual(choices.optionRecords,captured.optionRecords);assert.notEqual(choices.optionRecords,captured.optionRecords);
 assert.equal(Object.hasOwn(capturedChoiceOptions({tag:'select',options:['Alpha']}),'optionRecords'),false);
});
test('native select uses its frozen actual value and verifies label/value after blur',async()=>{
 const f=fixture([option('Alpha','id-alpha'),option('Beta','id-beta')]);
 const result=await f.adapter.act(action,'Alpha',{});assert.deepEqual(f.calls,[{value:'id-alpha'},{press:'Tab'}]);assert.equal(result.optionValue,'id-alpha');assert.equal(result.optionLabel,'Alpha');
});
test('native select refuses changed IDs, disabled options and duplicate labels before a click',async()=>{
 for(const [options,expected]of [
  [[option('Alpha','changed-id')],/CHOICE_OPTION_VALUE_CHANGED/],
  [[option('Alpha','id-alpha',{disabled:true})],/CHOICE_OPTION_DISABLED/],
  [[option('Alpha','id-alpha',{closest:()=>({disabled:true})})],/CHOICE_OPTION_DISABLED/],
  [[option('Alpha','id-alpha'),option('Alpha','id-other')],/CHOICE_NOT_UNIQUE/],
  [[option('Alpha','id-alpha'),option('Beta','id-alpha')],/CHOICE_OPTION_VALUE_NOT_UNIQUE/]
 ]){const f=fixture(options);await assert.rejects(f.adapter.act(action,'Alpha',{}),expected);assert.equal(f.calls.length,0);}
});
test('legacy evidence without an ID still requires a unique real label',async()=>{
 const f=fixture([option('Alpha',undefined)]);await f.adapter.act({...action,expectedOptionValue:undefined},'Alpha',{});assert.deepEqual(f.calls[0],{label:'Alpha'});
 const duplicate=fixture([option('Alpha',undefined),option('Alpha',undefined)]);await assert.rejects(duplicate.adapter.act({...action,expectedOptionValue:undefined},'Alpha',{}),/CHOICE_NOT_UNIQUE/);assert.equal(duplicate.calls.length,0);
 const frozen=fixture([option('Alpha',undefined)]);await assert.rejects(frozen.adapter.act(action,'Alpha',{}),/CHOICE_OPTION_VALUE_CHANGED/);assert.equal(frozen.calls.length,0);
});
test('matching readback label cannot hide a different selected native value',async()=>{
 const f=fixture([option('Alpha','id-alpha')],{commit:()=>[option('Alpha','other-id')]});await assert.rejects(f.adapter.act(action,'Alpha',{}),/CONTROL_COMMIT_NOT_VERIFIED/);
 assert.equal(f.calls.filter(c=>c.value).length,1);
});

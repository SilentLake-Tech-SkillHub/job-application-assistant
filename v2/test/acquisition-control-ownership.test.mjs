import test from 'node:test';
import assert from 'node:assert/strict';
import {controlDOM} from '../shared/control-dom.mjs';
import {primaryCandidates} from '../shared/form-visual-inventory.mjs';

const element=(tagName,id='',extra={})=>({
 tagName,id,innerText:'',children:[],getClientRects:()=>[{}],getAttribute:()=>null,
 matches:()=>false,closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[],contains:()=>false,...extra
});

function observe(nodes,run){
 const original={document:globalThis.document,CSS:globalThis.CSS,getComputedStyle:globalThis.getComputedStyle,location:globalThis.location};
 const body=element('BODY');
 try{
  globalThis.document={body,querySelectorAll:s=>s.startsWith('#')?nodes.filter(n=>n.id===s.slice(1)):nodes.filter(n=>n.discovery?.(s))};
  globalThis.CSS={escape:s=>s};globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.location={href:'https://example.test/apply'};
  return run();
 }finally{Object.assign(globalThis,original);}
}

test('a Formily field owns one ATSX combobox and preserves the separate checkbox label',()=>{
 const title=element('DIV','city-caption',{innerText:'意向城市*'});
 const root=element('DIV','city',{querySelector:s=>s.includes('label')?title:s.includes('atsx-select-selection')?widget:null});
 const label=element('LABEL','relocation-caption',{textContent:'接受调剂到其他城市'});
 const controls=s=>s.startsWith('input,textarea');
 const widget=element('DIV','city-widget',{parentElement:root,discovery:controls,
  getAttribute:k=>k==='role'?'combobox':null,matches:s=>s==='.atsx-select-selection[role="combobox"]',closest:s=>s.includes('ud-formily-item')?root:null});
 const input=element('INPUT','city-search',{type:'text',parentElement:widget,discovery:controls,
  matches:s=>s==='input.atsx-select-search__field',closest:s=>s.includes('atsx-select-selection')?widget:s.includes('ud-formily-item')?root:null});
 const checkbox=element('INPUT','relocation',{type:'checkbox',parentElement:label,labels:[label],discovery:controls,closest:s=>s.includes('ud-formily-item')?root:null});
 const controlsObserved=observe([root,title,label,widget,input,checkbox],()=>controlDOM({}));
 assert.deepEqual(controlsObserved.map(({selector,label,type})=>[selector,label,type]),[
  ['#city-widget','意向城市','combobox'],['#relocation','接受调剂到其他城市','checkbox']
 ]);
});

test('visible field titles identify a compound date while all inputs remain in the inventory',()=>{
 const heading=element('SPAN','education-title',{innerText:'教育背景'});
 const caption=element('DIV','dates-caption',{innerText:'就读时间*'});
 const block=element('DIV','education',{querySelector:()=>heading});
 const field=element('DIV','dates',{querySelector:()=>caption,querySelectorAll:()=>[year,month]});
 const part=(id,placeholder)=>element('INPUT',id,{type:'text',discovery:s=>s.startsWith('input,textarea'),
  getAttribute:key=>key==='placeholder'?placeholder:null,closest:s=>s.includes('apply-block-')?block:s.includes('apply-field-')?field:null});
 const year=part('year','年'),month=part('month','月');
 const controls=observe([heading,caption,block,field,year,month],()=>controlDOM({}));
 assert.deepEqual(controls.map(({label,section,required})=>[label,section,required]),[
  ['就读时间','教育背景',true],['就读时间','教育背景',true]
 ]);
 assert.deepEqual(primaryCandidates({controls}).map(({label,selectors})=>[label,selectors]),[
  ['就读时间',['#year','#month']]
 ]);
});

test('an icon-decorated add button is assigned to its own form block and fields',()=>{
 const field=element('INPUT','school');
 const heading=element('SPAN','education-title',{innerText:'教育背景'});
 const icon=element('SPAN','icon',{innerText:'\uE61F'});
 const button=element('BUTTON','add-education',{innerText:'\uE61F添加',children:[icon],discovery:s=>s.startsWith('button,')});
 const block=element('DIV','education',{contains:n=>n===field||n===button||n===heading,
  querySelectorAll:s=>s.includes('blockTitle-')?[heading]:[]});
 const titleBar=element('DIV','education-header',{parentElement:block});
 button.closest=s=>s.includes('apply-block-')?block:s.startsWith('button,')?button:null;
 button.parentElement=titleBar;field.parentElement=block;
 const result=observe([field,heading,icon,button,block,titleBar],()=>controlDOM({acquisitionEntrances:{controls:[{id:0,selector:'#school'}]}}));
 assert.deepEqual(result.entrances.map(({title,triggerLabel,scopeSelector,childControlIds})=>[title,triggerLabel,scopeSelector,childControlIds]),[
  ['教育背景','\uE61F添加','#education',[0]]
 ]);
});

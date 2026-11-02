import test from 'node:test';import assert from 'node:assert/strict';
import {performControl} from '../shared/control-operations.mjs';
function fixture({editable=true,noResults=false,visibleOptions=false,resetQuery=false}={}){
 let opened=false,query='',selected='',clicks=0;const writes=[];
 const hasOptions=()=>!noResults&&(visibleOptions||query==='中文');
 const none={count:async()=>0,filter(){return this;}};
 const inputNode={tagName:'INPUT',type:'text',readOnly:!editable,disabled:false,className:'phoenix-select__input',classList:{contains:c=>c==='phoenix-select__input'},closest:s=>editable&&s==='.phoenix-select--editable'?{}:null,get value(){return query;},getAttribute:()=>null};
 const input={count:async()=>1,filter(){return this;},evaluate:async fn=>fn(inputNode),fill:async value=>{query=resetQuery?'':value;writes.push(value);},press:async()=>{},click:async()=>{opened=true;}};
 const root={count:async()=>1,filter(){return this;},evaluate:async fn=>fn({tagName:'DIV',querySelector:()=>null,textContent:'',classList:{contains:c=>c==='phoenix-select'||editable&&c==='phoenix-select--editable'},getAttribute:()=>null}),click:async()=>{opened=true;},press:async()=>{},locator:s=>s==='input.phoenix-select__input'?input:s==='.phoenix-select__content'?{count:async()=>1,innerText:async()=>selected}:none};
 const record=()=>({label:'中文',value:'chinese',valueAttribute:'data-value',disabled:false,selected:selected==='中文'});
 const option={count:async()=>hasOptions()?1:0,evaluate:async()=>record(),click:async()=>{clicks++;selected='中文';query='';opened=false;}};
 const options={count:async()=>hasOptions()?1:0,allTextContents:async()=>hasOptions()?['中文']:[],filter:arg=>arg.hasText?option:options,first:()=>({waitFor:async()=>{if(!hasOptions())throw Error('OPTIONS_REQUIRE_QUERY');}})};
 const menu={count:async()=>opened?1:0,filter(){return this;},first(){return this;},waitFor:async()=>{},locator:s=>s.startsWith('input')?none:options,evaluate:async(fn,args)=>args?.operation==='options'?(hasOptions()?[record()]:[]):fn({innerText:noResults?'暂无数据':'',getClientRects:()=>[{}],querySelectorAll:()=>[],parentElement:null,clientHeight:100,scrollHeight:100})};
 const label={count:async()=>1,click:async()=>{opened=false;}};
 const page={url:()=> 'https://fixture.test/form',locator:s=>s==='#type'?root:s==='#label'?label:s.includes('area-selector-container')||s.includes('list-item-container')?none:menu};
 return {adapter:{page,resolveSpec:async a=>a,assertSingleEditor:async()=>{}},state:()=>({opened,query,selected,writes}),clicks:()=>clicks};
}
test('Phoenix editable selects search through the real input inside the trigger and restore inspection',async()=>{
 const f=fixture(),r=await performControl(f.adapter,{method:'phoenix_dropdown_inspect',selector:'#type',labelSelector:'#label',query:'中文'},null);
 assert.equal(r.queryApplied,true);assert.deepEqual(r.options,['中文']);assert.equal(r.restored,true);
 assert.deepEqual(f.state(),{opened:false,query:'',selected:'',writes:['中文','']});
});
test('Phoenix selection and independent verification use the same trigger input without choosing a search string',async()=>{
 const f=fixture(),r=await performControl(f.adapter,{method:'phoenix_dropdown',selector:'#type',labelSelector:'#label',options:['中文']},'中文');
 assert.equal(r.selectionProof.reopenedOptionSelected,true);assert.equal(r.selectionProof.value,'chinese');assert.equal(f.state().selected,'中文');
});
test('an already rendered exact Phoenix option is selected and verified without typing into its auxiliary query',async()=>{
 const f=fixture({visibleOptions:true,resetQuery:true});
 const r=await performControl(f.adapter,{method:'phoenix_dropdown',selector:'#type',labelSelector:'#label',query:'中文',options:['中文']},'中文');
 assert.equal(r.selectionProof.reopenedOptionSelected,true);
 assert.equal(f.state().selected,'中文');assert.equal(f.state().opened,false);
 assert.deepEqual(f.state().writes,[]);assert.equal(f.clicks(),1);
});
test('a readonly trigger input is never typed into',async()=>{
 const f=fixture({editable:false});await assert.rejects(performControl(f.adapter,{method:'phoenix_dropdown_inspect',selector:'#type',labelSelector:'#label',query:'中文'},null));assert.deepEqual(f.state().writes,[]);
});
test('an actual no-results marker after a real query is recorded and restored, rather than a fabricated option or timeout',async()=>{
 const f=fixture({noResults:true}),r=await performControl(f.adapter,{method:'phoenix_dropdown_inspect',selector:'#type',labelSelector:'#label',query:'中文'},null);
 assert.equal(r.status,'captured_empty_search');assert.equal(r.queryApplied,true);assert.deepEqual(r.options,[]);assert.deepEqual(r.coverage.emptyEvidence,['暂无数据']);assert.equal(r.restored,true);assert.equal(f.state().selected,'');
});

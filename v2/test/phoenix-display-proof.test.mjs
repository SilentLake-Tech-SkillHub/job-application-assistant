import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {phoenixSelectedDisplayDOM,confirmPhoenixSelectedDisplay} from '../shared/phoenix-selection.mjs';
import {PageAdapter} from '../shared/ui-page.mjs';
import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';
const evaluate=(fn,node,arg)=>vm.runInNewContext('('+fn.toString()+')(node,arg)',{node,arg,getComputedStyle:()=>({visibility:'visible'})});
const candidate={label:'Other',value:null,valueAttribute:null,selected:false,disabled:false};
function display({tagName='SPAN',editable=false,placeholder=false,values={}}={}){
 const shown={getClientRects:()=>[{}]},root={tagName:'DIV',getAttribute:k=>values[k]??null,querySelectorAll:()=>placeholder?[shown]:[]};
 const node={tagName,innerText:'Other',isContentEditable:editable,getClientRects:()=>[{}],getAttribute:()=>null,querySelectorAll:()=>[],closest:()=>root};
 return evaluate(phoenixSelectedDisplayDOM,node);
}
test('a unique noneditable selected display is authoritative even when menu rows expose no selected marker',()=>{
 const d=display(),p=confirmPhoenixSelectedDisplay(candidate,d,{expectedLabel:'Other',blurredLabel:'Other'});
 assert.equal(p.kind,'selected_display');assert.equal(p.selectedDisplayConfirmed,true);assert.equal(p.reopenedOptionSelected,false);assert.equal(p.valueCompared,false);
});
test('search inputs, editable values, placeholders and changed labels never become selected-display proof',()=>{
 for(const d of [display({tagName:'INPUT'}),display({editable:true}),display({placeholder:true}),{...display(),label:'Different'}, {...display(),visible:false}])assert.throws(()=>confirmPhoenixSelectedDisplay(candidate,d,{expectedLabel:'Other',blurredLabel:'Other'}));
});
test('exposed option IDs must match current exposed selected IDs',()=>{
 const c={...candidate,value:'code-a',valueAttribute:'data-value'};
 const p=confirmPhoenixSelectedDisplay(c,display({values:{'data-value':'code-a'}}),{expectedLabel:'Other',blurredLabel:'Other'});assert.equal(p.value,'code-a');assert.equal(p.valueCompared,true);
 for(const d of [display(),display({values:{'data-value':'code-b'}})])assert.throws(()=>confirmPhoenixSelectedDisplay(c,d,{expectedLabel:'Other',blurredLabel:'Other'}),/CHOICE_SELECTED_VALUE_MISMATCH/);
 assert.throws(()=>confirmPhoenixSelectedDisplay(candidate,display({values:{'data-value':'code-a'}}),{expectedLabel:'Other',blurredLabel:'Other'}),/PHOENIX_SELECTED_VALUE_COMPARISON_REQUIRED/);
});
test('the final verifier accepts display proof only for the declared Phoenix dropdown renderer',()=>{
 const field={id:'choice',source:'choice',label:'Choice',kind:'choice',required:true,control:{type:'dropdown',valueType:'string',readbackType:'string',options:['Other']},read:{selector:'#selected',kind:'text',selectedSelector:'#selected'},actions:[{method:'phoenix_dropdown',selector:'#select',options:['Other']}]};
 const plan={roleTitle:'Product',fields:[field]},task={pageUrl:'https://fixture.test/form',values:{choice:'Other'}},expected=compileExpected(plan,task);
 const proof={status:'verified',...confirmPhoenixSelectedDisplay(candidate,display(),{expectedLabel:'Other',blurredLabel:'Other'})},observed={source:'live_dom',readAt:new Date().toISOString(),pageUrl:task.pageUrl,roleTitle:'Product',inventoryIds:['choice'],fields:{choice:{present:true,value:'Other',selected:true,errors:[],selectionProof:proof}}};
 assert.equal(verifyForm(expected,observed).status,'verified');
 for(const patch of [{nonEditable:false},{placeholderAbsent:false},{blurConfirmed:false},{label:'Different'}])assert.notEqual(verifyForm(expected,{...observed,fields:{choice:{...observed.fields.choice,selectionProof:{...proof,...patch}}}}).status,'verified');
 const other=compileExpected({...plan,fields:[{...field,actions:[{method:'ud_dropdown',selector:'#select'}]}]},task);assert.notEqual(verifyForm(other,observed).status,'verified');
});
test('actual Phoenix selection reads a separate selected label despite a sibling search input and never invents a menu selected flag',async()=>{
 let selected='Original',opened=false,clicks=0;
 const root={tagName:'DIV',classList:{contains:c=>c==='phoenix-select'},getAttribute:k=>k==='role'?'combobox':k==='aria-expanded'?String(opened):null,querySelector:()=>null,querySelectorAll:()=>[]};
 const node={tagName:'SPAN',get innerText(){return selected;},getClientRects:()=>[{}],getAttribute:()=>null,querySelectorAll:()=>[],closest:()=>root};
 const selectedLabel={filter(){return this;},count:async()=>1,evaluate:async(fn,arg)=>evaluate(fn,node,arg)};
 const content={count:async()=>1,innerText:async()=>selected,evaluate:async()=>{throw Error('selected label must be read independently from the sibling search input');},locator:()=>selectedLabel};
 const input={count:async()=>1,filter(){return this;},evaluate:async fn=>fn(root),innerText:async()=>selected+'\n'+selected,click:async()=>{opened=true;},locator:()=>content,press:async()=>{opened=false;}};
 const label={count:async()=>1,click:async()=>{opened=false;}};
 const row={tagName:'DIV',className:'phoenix-selectList__listItem',innerText:'Other',textContent:'Other',hasAttribute:()=>false,getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>null};row.closest=()=>row;
 const option={count:async()=>1,evaluate:async(fn,arg)=>evaluate(fn,row,arg),click:async()=>{clicks++;selected='Other';opened=false;}};
 const options={count:async()=>1,first(){return this;},waitFor:async()=>{},filter:o=>o.visible?options:option,allTextContents:async()=>['Other']};
 const menuNode={clientHeight:100,scrollHeight:100,parentElement:null,querySelectorAll:()=>[row]};
 const menu={filter(){return this;},first(){return this;},waitFor:async()=>{},count:async()=>opened?1:0,locator:s=>s.startsWith('input[')?empty:options,evaluate:async(fn,arg)=>evaluate(fn,menuNode,arg)};
 const empty={filter(){return this;},count:async()=>0};
 const page={url:()=> 'https://fixture.test/form',locator:s=>s.includes('area-selector-container')||s.includes('list-item-container')?empty:s==='#select'?input:s==='#label'?label:menu};
 const adapter=new PageAdapter(page,{listOpenPageUrls:async()=>[]}),action={method:'phoenix_dropdown',selector:'#select',labelSelector:'#label',options:['Other']};
 const first=await adapter.act(action,'Other',{});assert.equal(first.selectionProof.kind,'selected_display');assert.equal(first.selectionProof.reopenedOptionSelected,false);assert.equal(clicks,1);assert.equal(opened,false);
 const independent=await adapter.act({...action,method:'phoenix_dropdown_verify'},'Other',{});assert.equal(independent.performed,false);assert.equal(independent.selectionProof.selectedDisplayConfirmed,true);assert.equal(clicks,1);assert.equal(opened,false);
});

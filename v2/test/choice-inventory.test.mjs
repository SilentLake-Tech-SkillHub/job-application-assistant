import test from 'node:test';
import assert from 'node:assert/strict';
import {collectChoiceViews} from '../shared/choice-inventory.mjs';
import {performControl} from '../shared/control-operations.mjs';
import {treeChoiceDOM,UD_TREE_LEAF_LABEL} from '../shared/tree-choice.mjs';

test('virtual options are collected with real keyboard increments and overlapping windows',async()=>{
 let i=0;const keys=[],views=[['A','B','C'],['C','D','E'],['E','F','G']];
 const r=await collectChoiceViews({read:async()=>({options:views[i],scroll:{top:i*80,height:260,viewport:100,surface:'list'}}),press:async k=>{keys.push(k);if(k==='PageDown')i=Math.min(2,i+1);}});
 assert.deepEqual(r.options,['A','B','C','D','E','F','G']);assert.equal(r.complete,true);assert.deepEqual(keys,['PageDown','PageDown']);
});
test('a menu opened at the selected item must prove it reached the beginning',async()=>{
 let i=1;const r=await collectChoiceViews({read:async()=>({options:[String(i)],scroll:{top:i*100,height:200,viewport:100,surface:'s'}}),press:async k=>{i=k==='Home'?0:1;}});
 assert.deepEqual(r.options,['0','1']);assert.equal(r.complete,true);
});
test('unsupported keyboard traversal never claims the unseen list is complete',async()=>{
 const r=await collectChoiceViews({read:async()=>({options:['first'],scroll:{top:0,height:1000,viewport:100,surface:'s'}}),press:async()=>{}});
 assert.equal(r.complete,false);assert.equal(r.reason,'keyboard_scroll_unavailable');
});
test('skipped viewports and unobserved scroll surfaces remain explicitly partial',async()=>{
 let top=0;const r=await collectChoiceViews({read:async()=>({options:[String(top)],scroll:{top,height:1000,viewport:100,surface:'s'}}),press:async()=>{top=900;}});
 assert.equal(r.complete,false);assert.equal(r.reason,'keyboard_skipped_viewport');
 const unknown=await collectChoiceViews({read:async()=>({options:['shown']}),press:async()=>{throw Error('must not press');}});assert.equal(unknown.complete,false);
});
test('a target can be located in a later virtual window without claiming a complete inventory',async()=>{
 let i=0;const r=await collectChoiceViews({target:'target',read:async()=>({options:[i?'target':'first'],scroll:{top:i*100,height:1000,viewport:100,surface:'s'}}),press:async()=>{i++;}});
 assert.equal(r.reason,'target_visible');assert.equal(r.complete,false);assert.equal(i,1);
});

function fixture({editable=true,tree=false,leaf=true,empty=false}={}){
 let opened=false,query='',selection='Original',writes=[],menuSelectors=[];
 const node={tagName:'INPUT',type:editable?'search':'text',readOnly:!editable,disabled:false,get value(){return query;},getAttribute:k=>k==='role'?'combobox':null,querySelector:()=>null};
 const input={count:async()=>1,waitFor:async()=>{},evaluate:async f=>f(node),innerText:async()=>'',filter(){return this;},fill:async v=>{query=v;writes.push(v);},press:async k=>{if(k==='Escape')opened=false;},click:async()=>{opened=true;},locator:()=>none};
 const none={count:async()=>0,filter(){return this;}};
 const display={...input,innerText:async()=>selection};
 const option={...input,evaluate:async f=>f({tagName:'DIV',textContent:'中国',hasAttribute:()=>false,getAttribute:k=>k==='aria-selected'?String(selection==='中国'):null}),click:async()=>{selection='中国';query='';opened=false;}};
 const options={...input,count:async()=>leaf&&!empty?1:0,allTextContents:async()=>query?['中国']:['阿尔巴尼亚','阿联酋'],first:()=>input,waitFor:async()=>{},filter:o=>o.visible?options:option};
 const treeRow=(depth,isLeaf)=>({querySelector:s=>s==='.ud__tree__node__label'?{innerText:'中国'}:s==='button.ud__expandButton-as-placeholder'&&isLeaf?{}:null,querySelectorAll:()=>Array(depth).fill({})});
 const menu={count:async()=>opened?1:0,filter(){return this;},waitFor:async()=>{},evaluate:async (f,args)=>f({classList:{contains:()=>tree},querySelectorAll:s=>empty&&s.includes('.ud__select__empty')?[{getClientRects:()=>[{}],textContent:'暂无数据'}]:tree&&s==='.ud__tree__node'?[treeRow(0,false),treeRow(1,false),...(leaf?[treeRow(2,true)]:[])]:[],parentElement:null,clientHeight:100,scrollHeight:100},args),locator:s=>{menuSelectors.push(s);return s.startsWith('input')?none:options;}};
 const label={...input,click:async()=>{opened=false;}};
 const page={locator:s=>s==='.ud__select__list'?menu:s.endsWith('.ud-formily-item-label')?label:s.endsWith('.ud__select__selector')?display:input};
 return {adapter:{page,resolveSpec:async a=>a,assertSingleEditor:async()=>{}},selectors:()=>menuSelectors,state:()=>({opened,query,selection,writes})};
}
const inspect={method:'ud_dropdown_inspect',selector:'#control',labelSelector:'#question > .ud-formily-item-label',query:'中国'};
test('a real no-results marker returns restored empty search evidence instead of a driver crash',async()=>{
 const f=fixture({empty:true}),r=await performControl(f.adapter,inspect,null);assert.equal(r.status,'captured_empty_search');assert.deepEqual(r.options,[]);assert.equal(r.coverage.reason,'observed_no_results');assert.equal(r.restored,true);assert.equal(f.state().selection,'Original');
});
test('UD search is executed and read back before exact search results can be claimed',async()=>{
 const f=fixture(),r=await performControl(f.adapter,inspect,null);
 assert.equal(r.searchable,true);assert.equal(r.queryApplied,true);assert.equal(r.scope,'exact_search_results');assert.deepEqual(r.options,['中国']);assert.equal(r.restored,true);
 assert.deepEqual(f.state(),{opened:false,query:'',selection:'Original',writes:['中国','']});
});
test('a requested query on a non-searchable menu never fabricates exact search evidence',async()=>{
 const f=fixture({editable:false}),r=await performControl(f.adapter,inspect,null);
 assert.equal(r.searchable,false);assert.equal(r.queryApplied,false);assert.notEqual(r.scope,'exact_search_results');assert.deepEqual(f.state().writes,[]);assert.equal(r.restored,true);
});
test('UD selection uses the same genuine search path as option inspection',async()=>{
 const f=fixture();await performControl(f.adapter,{...inspect,method:'ud_dropdown',query:undefined,options:['中国']},'中国');assert.equal(f.state().selection,'中国');
});

test('tree evidence distinguishes same-name country, region and selectable leaf by rendered indent and placeholder',()=>{
 const row=(text,depth,leaf)=>({querySelector:s=>s==='.ud__tree__node__label'?{innerText:text}:s==='button.ud__expandButton-as-placeholder'&&leaf?{}:null,querySelectorAll:()=>Array(depth).fill({})});
 const r=treeChoiceDOM({querySelectorAll:()=>[row('Same',0,false),row('Same',1,false),row('Same',2,true),row('Other',1,false)]});
 assert.deepEqual(r.leafPaths,[['Same','Same','Same']]);assert.equal(r.nodes[0].leaf,false);assert.equal(r.nodes[2].leaf,true);
 assert.notEqual(r.leafPaths[0],r.nodes[2].path);
 assert.match(UD_TREE_LEAF_LABEL,/ud__expandButton-as-placeholder/);
});
test('a virtual tree window missing its ancestor never fabricates a full path',()=>{
 const r=treeChoiceDOM({querySelectorAll:()=>[{querySelector:s=>s==='.ud__tree__node__label'?{innerText:'Leaf'}:{},querySelectorAll:()=>[{},{}]}]});
 assert.equal(r.nodes[0].path,null);assert.deepEqual(r.leafPaths,[]);
});
test('the same-name tree search captures only selectable leaves with their observed path',async()=>{
 const f=fixture({tree:true}),r=await performControl(f.adapter,inspect,null);
 assert.equal(r.renderer,'ud_tree_select');assert.deepEqual(r.tree.leafPaths,[['中国','中国','中国']]);assert.equal(r.coverage.complete,false);assert.equal(r.restored,true);
 assert.ok(f.selectors().includes(UD_TREE_LEAF_LABEL));assert.equal(f.selectors().includes('.ud__select__list__item'),false);
});
test('tree selection targets the explicit leaf locator rather than a same-name country branch',async()=>{
 const f=fixture({tree:true});await performControl(f.adapter,{...inspect,method:'ud_dropdown',options:['中国']},'中国');assert.equal(f.state().selection,'中国');assert.ok(f.selectors().includes(UD_TREE_LEAF_LABEL));
});
test('an unexpanded tree returns construction evidence, never fake selectable options',async()=>{
 const f=fixture({tree:true,leaf:false}),r=await performControl(f.adapter,inspect,null);assert.equal(r.status,'branches_only');assert.deepEqual(r.options,[]);assert.equal(r.coverage.complete,false);assert.equal(r.restored,true);
});

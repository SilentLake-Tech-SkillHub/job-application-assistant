import test from 'node:test';import assert from 'node:assert/strict';
import {performPhoenixArea,areaOptionsDOM,assertAreaSelection} from '../shared/phoenix-area.mjs';
test('selected pane needs one exact actual label and compares exposed IDs',()=>{
 const proof={count:1,text:'Example City',empty:false,values:['id-a']};assertAreaSelection(proof,'Example City','id-a');
 for(const patch of [{count:0},{empty:true},{text:'Example City extended'},{values:['id-b']}])assert.throws(()=>assertAreaSelection({...proof,...patch},'Example City','id-a'));
});
function fixture({iconCount=1}={}){
 let opened=true,selected='',draft='',query='',clicks=0,navigationClicks=0;
 const chain=object=>({...object,filter(){return this;}}),search=chain({count:async()=>1,fill:async v=>{query=v;},inputValue:async()=>query});
 const button=kind=>chain({count:async()=>1,click:async()=>{if(kind==='确定')selected=draft;else draft=selected;opened=false;}});
 const item=chain({count:async()=>1,click:async()=>{navigationClicks++;},locator:s=>s==='.area-item-name .icon-container'?chain({count:async()=>iconCount,click:async()=>{draft='Example City';clicks++;}}):chain({count:async()=>1,click:async()=>{navigationClicks++;}})});
 const menu=chain({count:async()=>opened?1:0,waitFor:async()=>{},evaluate:async fn=>fn.name==='areaOptionsDOM'?[{label:'Example City',path:'Example Province',value:null,disabled:false}]:{count:draft?1:0,text:draft,empty:!draft,values:[]},locator:s=>s.includes('area-search-input')?search:s==='.search-result'?{count:async()=>query?1:0,innerText:async()=> '搜索结果 1个'}:s.includes('area-footer-button')?{filter:({hasText})=>button(hasText.test('确定')?'确定':'取消')}:item});
 const trigger={innerText:async()=>selected?selected+'\n'+selected:'请选择',locator:s=>{assert.equal(s,'.phoenix-select__content');return {count:async()=>1,innerText:async()=>selected};},click:async()=>{opened=true;draft=selected;}};
 const adapter={page:{locator:s=>s.includes('common-unmodeled')?menu:chain({})}};
 return {adapter,trigger,state:()=>({opened,selected,draft,clicks,navigationClicks}),setSelected:v=>{selected=v;draft=v;}};
}
test('inspection searches real region rows and cancels without selecting a region',async()=>{
 const f=fixture(),r=await performPhoenixArea(f.adapter,{method:'phoenix_dropdown_inspect',query:'Example'},null,{trigger:f.trigger,initial:''});
 assert.equal(r.restored,true);assert.deepEqual(r.options,['Example City']);assert.equal(r.optionRecords[0].path,'Example Province');assert.equal(f.state().clicks,0);assert.equal(f.state().selected,'');
});
test('inspection without a query captures rendered branches instead of claiming a missing input',async()=>{
 const f=fixture(),r=await performPhoenixArea(f.adapter,{method:'phoenix_dropdown_inspect'},null,{trigger:f.trigger,initial:''});
 assert.equal(r.status,'captured');assert.equal(r.queryApplied,false);assert.equal(r.scope,'rendered_region_branches');assert.equal(r.restored,true);assert.equal(f.state().clicks,0);
});
test('region selection confirms the actual selected pane then independently reopens and cancels',async()=>{
 const f=fixture(),r=await performPhoenixArea(f.adapter,{method:'phoenix_dropdown',query:'Example',options:['Example City']},'Example City',{trigger:f.trigger,initial:''});
 assert.equal(r.performed,true);assert.equal(r.selectionProof.reopenedOptionSelected,true);assert.equal(f.state().selected,'Example City');assert.equal(f.state().clicks,1);assert.equal(f.state().opened,false);
});
test('verification cannot repair or select an unselected region',async()=>{
 const f=fixture();await assert.rejects(performPhoenixArea(f.adapter,{method:'phoenix_dropdown_verify'},'Example City',{trigger:f.trigger,initial:''}),/CURRENT_SELECTION/);assert.equal(f.state().clicks,0);
});

import vm from 'node:vm';
import {performPhoenixListPopup,listPopupOptionsDOM,listPopupSelectionDOM} from '../shared/phoenix-area.mjs';
function listFixture({selected='',ids=false,badSelectedLabel=false,duplicate=false,iconCount=1}={}){
 let opened=true,current=selected,draft=selected,query='',writes=0,confirms=0,cancels=0,navigationClicks=0;
 const chain=o=>({...o,filter(){return this;}});
 const search=chain({count:async()=>1,inputValue:async()=>query,fill:async v=>{query=v;}});
 const rows=()=>[{label:'Example Industry',value:ids?'option-a':null,valueAttribute:ids?'data-id':null,disabled:false}];
 const button=kind=>chain({count:async()=>1,click:async()=>{if(kind==='确定'){current=draft;confirms++;}else{draft=current;cancels++;}opened=false;}});
 const menu=chain({count:async()=>opened?1:0,waitFor:async()=>{},getByRole:(_,{name})=>button(name),evaluate:async fn=>fn.name==='listPopupOptionsDOM'?rows():{count:draft?1:0,text:badSelectedLabel?draft+' extra':draft,empty:!draft,values:draft&&ids?['option-a']:[],scopeValid:true},locator:s=>s==='input[placeholder="搜索"]'?search:s==='.phoenix-button'?{filter:({hasText})=>button(hasText.test('确定')?'确定':'取消')}:chain({count:async()=>duplicate?2:1,click:async()=>{navigationClicks++;},locator:s=>s==='.icon-container'?chain({count:async()=>iconCount,click:async()=>{draft='Example Industry';writes++;}}):chain({count:async()=>0,click:async()=>{navigationClicks++;}})})});
 const trigger={innerText:async()=>current?current+'\n'+current:'请选择',locator:s=>{assert.equal(s,'.phoenix-select__content');return {count:async()=>1,innerText:async()=>current};},click:async()=>{opened=true;draft=current;}};
 return {adapter:{page:{locator:()=>menu}},trigger,state:()=>({opened,current,draft,writes,confirms,cancels,navigationClicks})};
}
test('list popup inspection reads actual rows and cancels without committing a choice',async()=>{
 const f=listFixture(),r=await performPhoenixListPopup(f.adapter,{method:'phoenix_dropdown_inspect',query:'Industry'},null,{trigger:f.trigger,initial:''});assert.equal(r.restored,true);assert.deepEqual(r.options,['Example Industry']);assert.equal(r.renderer,'phoenix_list_popup');assert.equal(f.state().writes,0);assert.equal(f.state().confirms,0);
});
test('list popup selects once, confirms, reopens, independently reads selected pane and cancels',async()=>{
 const f=listFixture({ids:true}),r=await performPhoenixListPopup(f.adapter,{method:'phoenix_dropdown',options:['Example Industry'],expectedOptionValue:'option-a'},'Example Industry',{trigger:f.trigger,initial:''});assert.equal(r.selectionProof.reopenedOptionSelected,true);assert.equal(r.selectionProof.valueCompared,true);assert.equal(f.state().writes,1);assert.equal(f.state().confirms,1);assert.equal(f.state().cancels,1);assert.equal(f.state().current,'Example Industry');
});
test('list popup independent verification never selects or repairs a missing choice',async()=>{
 const f=listFixture();await assert.rejects(performPhoenixListPopup(f.adapter,{method:'phoenix_dropdown_verify'},'Example Industry',{trigger:f.trigger,initial:''}),/CURRENT_SELECTION/);assert.equal(f.state().writes,0);assert.equal(f.state().confirms,0);
 const duplicate=listFixture({duplicate:true});await assert.rejects(performPhoenixListPopup(duplicate.adapter,{method:'phoenix_dropdown',options:['Example Industry']},'Example Industry',{trigger:duplicate.trigger,initial:''}),/NOT_UNIQUE/);assert.equal(duplicate.state().writes,0);
});
test('list popup reads one right pane with actual count, limit and selected-container nodes',()=>{
 const header={innerText:'1/'},limit={innerText:'1'},item={getAttribute:a=>a==='data-id'?'option-a':null};
 const container={innerText:'Example Industry',querySelector:()=>null,querySelectorAll:()=>[item]};
 const pane={getClientRects:()=>[{}],querySelectorAll:s=>s==='.select-data-num-text'?[header]:s==='.select-data-num-limit'?[limit]:s==='.select-data-container'?[container]:[]},root={querySelectorAll:()=>[pane]};
 const read=()=>vm.runInNewContext('('+listPopupSelectionDOM.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});const proof=read();assertAreaSelection(proof,'Example Industry','option-a');
 limit.innerText='40';assert.equal(read().limit,40);assertAreaSelection(read(),'Example Industry','option-a');
 header.innerText='2/';assert.throws(()=>assertAreaSelection(read(),'Example Industry','option-a'),/AREA_CURRENT_SELECTION_NOT_VERIFIED/);
 header.innerText='0/';container.innerText='请在左侧选择内容';container.querySelector=()=>({});assert.equal(read().empty,true);assert.throws(()=>assertAreaSelection(read(),'Example Industry'));
 for(const invalid of ['0','unknown','1/40']){limit.innerText=invalid;assert.equal(read().scopeValid,false);}
 root.querySelectorAll=()=>[pane,pane];assert.equal(read().scopeValid,false);
});
test('list popup option extraction uses only actual leaf row text and exposed identities',()=>{
 const row={innerText:'Example Industry',hasAttribute:a=>a==='data-id',getAttribute:a=>a==='data-id'?'option-a':null,getClientRects:()=>[{}],classList:{contains:()=>false}},root={querySelectorAll:()=>[row]};
 const records=vm.runInNewContext('('+listPopupOptionsDOM.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});assert.equal(records[0].label,'Example Industry');assert.equal(records[0].value,'option-a');assert.equal(records[0].valueAttribute,'data-id');
});

test('region selection clicks the actual unique visible selection icon, never its navigation label',async()=>{
 const f=fixture(),r=await performPhoenixArea(f.adapter,{method:'phoenix_dropdown',query:'Example',options:['Example City']},'Example City',{trigger:f.trigger,initial:''});assert.equal(r.selectionProof.reopenedOptionSelected,true);assert.equal(f.state().clicks,1);assert.equal(f.state().navigationClicks,0);
 for(const iconCount of [0,2]){const missing=fixture({iconCount});await assert.rejects(performPhoenixArea(missing.adapter,{method:'phoenix_dropdown',query:'Example',options:['Example City']},'Example City',{trigger:missing.trigger,initial:''}),/AREA_SELECTION_ACTION_TARGET_REQUIRED/);assert.equal(missing.state().clicks,0);assert.equal(missing.state().navigationClicks,0);assert.equal(missing.state().selected,'');}
});
test('list popup requires the actual unique visible selection icon and cannot fall back to a row click',async()=>{
 const f=listFixture(),r=await performPhoenixListPopup(f.adapter,{method:'phoenix_dropdown',options:['Example Industry']},'Example Industry',{trigger:f.trigger,initial:''});assert.equal(r.selectionProof.reopenedOptionSelected,true);assert.equal(f.state().writes,1);assert.equal(f.state().navigationClicks,0);
 for(const iconCount of [0,2]){const missing=listFixture({iconCount});await assert.rejects(performPhoenixListPopup(missing.adapter,{method:'phoenix_dropdown',options:['Example Industry']},'Example Industry',{trigger:missing.trigger,initial:''}),/LIST_SELECTION_ACTION_TARGET_REQUIRED/);assert.equal(missing.state().writes,0);assert.equal(missing.state().navigationClicks,0);assert.equal(missing.state().confirms,0);assert.equal(missing.state().current,'');}
});

 test('scoped row locators tolerate rendered whitespace normalization but retain exact label and breadcrumb identity',async()=>{const {exactRenderedText}=await import('../shared/phoenix-area.mjs');const match=exactRenderedText('Product Manager\nInternet Products');assert.ok(match.test('Product Manager Internet Products'));assert.ok(match.test('Product ManagerInternet Products'));assert.ok(match.test('Product Manager\nInternet Products'));for(const wrong of ['Senior Product Manager Internet Products','Product Manager Finance','ProductManager InternetProducts'])assert.equal(match.test(wrong),false);});

import test from 'node:test';import assert from 'node:assert/strict';
import {performPhoenixAutocomplete} from '../shared/phoenix-autocomplete.mjs';
const text='Example University',warningText='没有搜索到学校，将使用您输入的学校';
function fixture({initial='',exposeId=true,markers=false,options=[{label:text,value:'school-id',valueAttribute:'data-id',disabled:false}],custom=false,ghostRestore=false}={}){
 const state={value:initial,id:initial&&exposeId?'school-id':null,selected:initial||null,open:false,fills:[],clicks:0,blurs:0};
 const container={getAttribute:k=>k==='data-entity-id'?state.id:null};
 const node={tagName:'INPUT',getAttribute:k=>k==='data-entity-id'?state.id:null,closest:s=>s==='.phoenix-auto-complete-container'?container:s==='.form-item--phoenix'?{innerText:custom&&state.value?warningText:''}:null};
 const input={count:async()=>1,evaluate:async fn=>fn(node),inputValue:async()=>state.value,click:async()=>{state.open=true;state.clicks++;},fill:async value=>{state.fills.push(value);state.value=value;state.id=ghostRestore&&!value?'ghost-id':null;state.selected=null;}};
 const label={count:async()=>1,click:async()=>{state.open=false;state.blurs++;}};
 const menu={filter(){return this;},count:async()=>state.open?1:0,evaluate:async()=>options.map(o=>({...o,selected:markers&&state.selected===o.label})),locator:()=>({filter:({hasText})=>{const matches=options.filter(o=>hasText.test(o.label));return {count:async()=>matches.length,click:async()=>{state.selected=matches[0].label;state.value=matches[0].label;state.id=exposeId?matches[0].value:null;state.open=false;}};}})};
 const adapter={page:{locator:s=>s==='#input'?input:s==='#label'?label:menu}};
 return {adapter,state};
}
const action={method:'phoenix_autocomplete',selector:'#input',labelSelector:'#label',options:[text],expectedOptionValue:'school-id'};
test('real click requires a current matching entity ID after blur',async()=>{
 const f=fixture(),r=await performPhoenixAutocomplete(f.adapter,action,text);assert.equal(r.searchableCommit.currentSelection.kind,'entity_id');assert.equal(r.searchableCommit.currentSelection.value,'school-id');
});
test('no ID and no real selected marker stays unverified after the click',async()=>{
 const f=fixture({exposeId:false});await assert.rejects(performPhoenixAutocomplete(f.adapter,action,text),/CURRENT_SELECTION_PROOF_REQUIRED/);
});
test('current selected marker proves a real selection without exposed IDs',async()=>{
 const f=fixture({exposeId:false,markers:true}),r=await performPhoenixAutocomplete(f.adapter,action,text);assert.equal(r.searchableCommit.currentSelection.kind,'selected_option');assert.equal(r.searchableCommit.currentSelection.selected,true);
});
test('independent verify never fills or clicks an option and rejects lost entity',async()=>{
 const f=fixture({initial:text});let r=await performPhoenixAutocomplete(f.adapter,{...action,method:'phoenix_autocomplete_verify'},text);assert.equal(r.currentSelection.kind,'entity_id');assert.deepEqual(f.state.fills,[]);
 f.state.id=null;f.state.selected=null;await assert.rejects(performPhoenixAutocomplete(f.adapter,{...action,method:'phoenix_autocomplete_verify'},text),/CURRENT_SELECTION_PROOF_REQUIRED/);assert.deepEqual(f.state.fills,[]);
});
test('nonempty inspection refuses before any page interaction, with or without an entity ID',async()=>{
 for(const exposeId of [true,false]){const f=fixture({initial:text,exposeId});await assert.rejects(performPhoenixAutocomplete(f.adapter,{...action,method:'phoenix_autocomplete_inspect',query:'Other'},null),/NONEMPTY_REQUIRES_RESTORE/);assert.deepEqual(f.state.fills,[]);assert.equal(f.state.clicks,0);assert.equal(f.state.blurs,0);}
});
test('empty inspection restores the actual empty unbound state',async()=>{
 const f=fixture(),r=await performPhoenixAutocomplete(f.adapter,{...action,method:'phoenix_autocomplete_inspect',query:text},null);assert.equal(r.restored,true);assert.equal(r.restorationProof.kind,'original_empty_unbound');assert.equal(f.state.value,'');assert.equal(f.state.id,null);assert.equal(f.state.open,false);
 const broken=fixture({ghostRestore:true});await assert.rejects(performPhoenixAutocomplete(broken.adapter,{...action,method:'phoenix_autocomplete_inspect',query:text},null),/INSPECTION_NOT_RESTORED/);
});
test('custom values require current same-field explicit acceptance after blur',async()=>{
 const f=fixture({options:[],custom:true}),r=await performPhoenixAutocomplete(f.adapter,{...action,expectedOptionValue:undefined,customValueEvidence:warningText},text);assert.equal(r.searchableCommit.customAcceptance.verified,true);
 const v=await performPhoenixAutocomplete(f.adapter,{...action,method:'phoenix_autocomplete_verify',expectedCommitMode:'explicit_custom_value'},text);assert.equal(v.customAcceptance.label,text);
 const noAcceptance=fixture({initial:text,options:[]});await assert.rejects(performPhoenixAutocomplete(noAcceptance.adapter,{...action,method:'phoenix_autocomplete_verify',expectedCommitMode:'explicit_custom_value'},text),/CURRENT_CUSTOM_ACCEPTANCE_REQUIRED/);
});

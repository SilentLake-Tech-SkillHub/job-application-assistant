import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performPhoenixListPopup,confirmListPopupSelection,listPopupSelectionDOM} from '../shared/phoenix-area.mjs';
import {resolveObservedChoice,mergeObservedChoices,applyChoiceResolution,assertStoredChoiceResolutions} from '../shared/choice-resolution.mjs';
import {evaluateChoiceGoals} from '../shared/choice-goal-contract.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';
import {verifyForm} from '../shared/verifier.mjs';
import {hash} from '../shared/engine.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';
const label='Product Manager',path='Internet Products',id='entity-a',selector='#function';
const profile={facts:{function:{status:'known',value:label}}};
const record=(extra={})=>({label,path,value:id,valueAttribute:'data-id',disabled:false,selected:false,...extra});
const choice=(extra={})=>({selector,captureId:'capture-example',choicesId:'choices-example',renderer:'phoenix_list_popup',choiceContract:'leaf_v2',status:'captured',restored:true,options:[label],optionRecords:[record()],...extra});
const action={method:'phoenix_dropdown_verify',choiceRenderer:'phoenix_list_popup',choiceContract:'leaf_v2',expectedOptionPath:path,expectedOptionValue:id,expectedOptionValueAttribute:'data-id',options:[label]};
const pane=(extra={})=>({scopeValid:true,count:1,text:label,empty:false,path:null,values:[],...extra});

test('incremental captures preserve distinct paths and IDs and never auto resolve duplicate leaf identities',()=>{
 const first=choice(),second=choice({optionRecords:[record({path:'Financial Products',value:'entity-b'})]});
 const merged=mergeObservedChoices([first],[second])[0];
 assert.equal(merged.optionRecords.length,2);assert.deepEqual(merged.options,[label]);
 assert.throws(()=>resolveObservedChoice({profile,factKey:'function',choice:merged}),/CHOICE_OPTION_NOT_UNIQUE/);
 const ids=mergeObservedChoices([first],[choice({optionRecords:[record({value:'entity-other'})]})])[0];
 assert.equal(ids.optionRecords.length,2);assert.throws(()=>resolveObservedChoice({profile,factKey:'function',choice:ids}),/CHOICE_OPTION_NOT_UNIQUE/);
 const repeated=mergeObservedChoices([first],[choice({optionRecords:[record({selected:true}),record({selected:true})]})])[0];
 assert.equal(repeated.optionRecords.length,1);assert.equal(repeated.optionRecords[0].selected,true);
 assert.equal(resolveObservedChoice({profile,factKey:'function',choice:repeated}).optionPath,path);
});

test('path and ID changes invalidate confirmed options, including goal reevaluation',()=>{
 for(const patch of [{path:'Other Category'},{value:'different-id'}]){
  const c=choice();c.resolutions={function:resolveObservedChoice({profile,factKey:'function',choice:c})};c.optionRecords[0]={...c.optionRecords[0],...patch};
  assert.throws(()=>applyChoiceResolution({source:'function',control:{type:'dropdown'},actions:[],constructionBlockers:[]},c,profile),/CHOICE_RESOLUTION_STALE/);
  const evaluation=evaluateChoiceGoals({capture:{captureId:c.captureId,controls:[{selector}]},profile,fields:[{id:'function',source:'function',control:{type:'dropdown'},inventorySelectors:[selector]}],choices:[c]});
  assert.equal(evaluation.blockers[0].reason,'CHOICE_RESOLUTION_STALE');
 }
});

test('legacy popup row text requires recapture rather than a newline migration',async()=>{
 const old=choice({choiceContract:undefined,options:[label+'\n'+path],optionRecords:[record({label:label+'\n'+path,path:undefined})]});
 assert.throws(()=>resolveObservedChoice({profile,factKey:'function',choice:old,selectedOption:old.options[0],evidence:'Claim'}),/LIST_POPUP_CONTRACT_REQUIRES_REBUILD/);
 const fresh=mergeObservedChoices([old],[choice()])[0];assert.deepEqual(fresh.options,[label]);assert.equal(fresh.optionRecords.length,1);
 const resolution={choicesId:old.choicesId,captureId:old.captureId,selector,selectedOption:old.options[0]};
 const t={evidence:{sourceUrl:'https://example.test/form'},pages:[{fields:[{kind:'choice',enumMap:{[label]:old.options[0]},choiceResolution:resolution}]}]};
 await assert.rejects(assertStoredChoiceResolutions(t,{companyId:'example',profile,store:{get:async()=>({choices:[old]})}}),/LIST_POPUP_CONTRACT_REQUIRES_REBUILD/);
});

test('selection proof uses current selected markers and real context, rejecting wrong labels paths IDs counts or absent marks',()=>{
 const selected=record({selected:true}),proof=confirmListPopupSelection(pane(),[selected],{label,path,value:id,valueAttribute:'data-id'});
 assert.equal(proof.label,label);assert.equal(proof.path,path);assert.equal(proof.value,id);assert.equal(proof.valueAttribute,'data-id');
 assert.equal(proof.selectedEntity,selected);
 for(const p of [pane({count:0}),pane({count:2}),pane({text:'Other label'}),pane({empty:true}),pane({values:['wrong-id']}),pane({path:'Other Category'})])assert.throws(()=>confirmListPopupSelection(p,[selected],{label,path,value:id,valueAttribute:'data-id'}));
 for(const r of [record(),record({selected:true,path:'Wrong'}),record({selected:true,value:'wrong'}),record({selected:true,disabled:true})])assert.throws(()=>confirmListPopupSelection(pane(),[r],{label,path,value:id,valueAttribute:'data-id'}));
 assert.throws(()=>confirmListPopupSelection(pane(),[selected,selected],{label,path,value:id,valueAttribute:'data-id'}));
 assert.throws(()=>confirmListPopupSelection(pane(),[record({selected:true,path:null})],{label,path,value:id,valueAttribute:'data-id'}));
 const noId=confirmListPopupSelection(pane(),[record({selected:true,value:null,valueAttribute:null})],{label,path});
 assert.equal(noId.value,null);assert.equal(noId.valueAttribute,null);
});

function popupFixture({current=label,marked=true,observedPath=path,observedId=id,count=1,displayAfterCancel=current}={}){
 let opened=true,draft=current,queries=[],selections=0,confirms=0,cancels=0;
 const chain=o=>({...o,filter(){return this;}}),search=chain({count:async()=>1,fill:async v=>queries.push(v),inputValue:async()=>queries.at(-1)||''});
 const actualRows=()=>[record({path:observedPath,value:observedId,selected:marked&&draft===label})];
 const button=kind=>chain({count:async()=>1,click:async()=>{if(kind==='确定'){confirms++;current=draft;}else{cancels++;draft=current;}opened=false;}});
 const menu=chain({count:async()=>opened?1:0,waitFor:async()=>{},evaluate:async fn=>fn.name==='listPopupOptionsDOM'?actualRows():pane({count:draft?count:0,text:draft,empty:!draft}),locator:s=>s==='input[placeholder="搜索"]'?search:s==='.phoenix-button'?{filter:({hasText})=>button(hasText.test('确定')?'确定':'取消')}:chain({count:async()=>1,evaluate:async()=>({label:[label],path:[observedPath],values:[observedId]}),locator:()=>chain({count:async()=>1,click:async()=>{selections++;draft=label;}})})});
 const trigger={locator:()=>({count:async()=>1,innerText:async()=>opened?current:displayAfterCancel}),click:async()=>{opened=true;draft=current;}};
 return {adapter:{page:{url:()=> 'https://example.test/form',locator:()=>menu}},trigger,state:()=>({opened,queries,selections,confirms,cancels})};
}

test('read-only verification searches the original popup, reads current selected context and only cancels',async()=>{
 const f=popupFixture(),result=await performPhoenixListPopup(f.adapter,action,label,{trigger:f.trigger,initial:label});
 assert.equal(result.performed,false);assert.equal(result.selectionProof.path,path);assert.equal(result.selectionProof.value,id);
 assert.deepEqual(f.state().queries,[label]);assert.equal(f.state().selections,0);assert.equal(f.state().confirms,0);assert.equal(f.state().cancels,1);assert.equal(f.state().opened,false);
});

test('read-only verification never repairs missing wrong or unmarked selections and detects failed restoration',async()=>{
 for(const options of [{current:''},{current:'Other'},{marked:false},{observedPath:'Other Category'},{observedId:'wrong-id'},{count:2},{displayAfterCancel:'Changed'}]){
  const f=popupFixture(options);await assert.rejects(performPhoenixListPopup(f.adapter,action,label,{trigger:f.trigger,initial:options.current??label}));
  assert.equal(f.state().selections,0);assert.equal(f.state().confirms,0);assert.ok(f.state().cancels>=1);assert.equal(f.state().opened,false);
 }
});

test('inspection returns actual selected pane and checked records and proves cancellation restored display',async()=>{
 const f=popupFixture(),r=await performPhoenixListPopup(f.adapter,{method:'phoenix_dropdown_inspect',query:'Product'},null,{trigger:f.trigger,initial:label});
 assert.equal(r.choiceContract,'leaf_v2');assert.equal(r.selectedPane.text,label);assert.equal(r.optionRecords[0].selected,true);assert.equal(r.restored,true);assert.equal(f.state().selections,0);assert.equal(f.state().confirms,0);
 const changed=popupFixture({displayAfterCancel:'Changed'}),bad=await performPhoenixListPopup(changed.adapter,{method:'phoenix_dropdown_inspect'},null,{trigger:changed.trigger,initial:label});assert.equal(bad.restored,false);
});

test('legacy action fails before querying or selecting the actual popup',async()=>{
 const f=popupFixture();await assert.rejects(performPhoenixListPopup(f.adapter,{method:'phoenix_dropdown_verify'},label,{trigger:f.trigger,initial:label}),/LIST_POPUP_CONTRACT_REQUIRES_REBUILD/);
 assert.deepEqual(f.state().queries,[]);assert.equal(f.state().selections,0);assert.equal(f.state().confirms,0);
});

test('one selected entity deduplicates repeated public ID wrappers but conflicting IDs remain unverified',()=>{
 const node=value=>({getAttribute:a=>a==='data-id'?value:null}),items=[node(id),node(id)];
 const container={innerText:label,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:s=>s==='[data-value],[data-id]'?items:[]};
 const p={getClientRects:()=>[{}],querySelectorAll:s=>s==='.select-data-num-text'?[{innerText:'1/'}]:s==='.select-data-num-limit'?[{innerText:'1'}]:[container]},root={querySelectorAll:()=>[p]};
 const read=()=>vm.runInNewContext('('+listPopupSelectionDOM.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});
 assert.deepEqual(Array.from(read().values),[id]);confirmListPopupSelection(read(),[record({selected:true})],{label,path,value:id,valueAttribute:'data-id'});
 items.push(node('conflict'));assert.throws(()=>confirmListPopupSelection(read(),[record({selected:true})],{label,path,value:id,valueAttribute:'data-id'}),/SELECTED_ID_MISMATCH/);
});

test('observed popup identity is frozen through builder expected and independent verification; changed proof or asset fails',async()=>{
 const c=choice(),capture={companyId:'example',captureId:c.captureId,pageUrl:'https://example.test/form',observedAt:new Date().toISOString(),provider:'phoenix',controls:[{selector,selectedSelector:'#selected',labelSelector:'#label',label:'Function',tag:'div',type:'combobox',renderer:'phoenix_select'}]},page={roleTitle:'Example Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Basic'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}};
 const built=buildFormTemplate({capture,profile,mappings:[{selector,factKey:'function'}],choices:[c],page,templateId:'example-form'});assert.equal(built.readyToRegister,true);
 const {template}=observedSeal(built.template,'example'),field=template.pages[0].fields[0];
 assert.equal(field.actions[0].choiceContract,'leaf_v2');assert.equal(field.actions[0].expectedOptionPath,path);assert.equal(field.actions[0].expectedOptionValue,id);assert.deepEqual(field.control.options,[label]);
 const task={companyId:'example',pageUrl:capture.pageUrl,templateHash:hash(template),values:{function:label}},plan=await compileExecutionPlan(template,task),expected=plan.pages[0].expected;
 assert.equal(plan.readyForExecution,true);assert.equal(expected.fields[0].value,label);assert.equal(expected.fields[0].choicePath,path);assert.equal(expected.fields[0].choiceContract,'leaf_v2');
 const selectionProof={status:'verified',...confirmListPopupSelection(pane(),[record({selected:true})],{label,path,value:id,valueAttribute:'data-id'})},observation={source:'live_dom',readAt:new Date().toISOString(),pageUrl:task.pageUrl,roleTitle:page.roleTitle,sections:page.sections,inventoryIds:[field.id],fields:{[field.id]:{present:true,value:label,selected:true,selectionProof}}};
 assert.equal(verifyForm(expected,observation).status,'verified');
 for(const patch of [{path:'Other'},{value:'wrong'},{choiceContract:'old'},{renderer:'other'}]){const o=structuredClone(observation);Object.assign(o.fields[field.id].selectionProof,patch);assert.notEqual(verifyForm(expected,o).status,'verified');}
 const asset={companyId:'example',pageUrl:task.pageUrl,captureId:c.captureId,choices:built.choices},store={get:async()=>asset};await assertStoredChoiceResolutions(template,{companyId:'example',store,profile});
 asset.choices[0].optionRecords[0].path='Changed';await assert.rejects(assertStoredChoiceResolutions(template,{companyId:'example',store,profile}),/CONFIRMATION_CHANGED/);
 const changed=structuredClone(template);changed.pages[0].fields[0].actions[0].expectedOptionPath='Changed';await assert.rejects(assertPreparedPlan(plan,changed,{...task,planId:plan.id,planHash:plan.planHash},{allowPartialPreparation:false}),/PREPARED_PLAN_CONTENT_CHANGED/);
});
test('classic selected chips keep the actual leaf and parent annotation as separate identity evidence',()=>{
 const shown={getClientRects:()=>[{}]},annotation={...shown,innerText:'('+path+')',matches:selector=>selector==='.full-label'};
 const leaf={...shown,innerText:label+'('+path+')',matches:selector=>selector==='.select-text-label',childNodes:[{nodeType:3,textContent:label},{nodeType:1,textContent:'('+path+')'}]};
 const container={innerText:leaf.innerText,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:selector=>selector.includes('.select-text-label')?[leaf]:selector.includes('.full-label')?[annotation]:[]};
 const paneNode={...shown,querySelectorAll:selector=>selector==='.select-data-num-text'?[{innerText:'1/'}]:selector==='.select-data-num-limit'?[{innerText:'1'}]:[container]},root={querySelectorAll:()=>[paneNode]};
 const actual=vm.runInNewContext('('+listPopupSelectionDOM.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});
 assert.equal(actual.text,label);assert.equal(actual.path,path);assert.equal(actual.scopeValid,true);
 confirmListPopupSelection(actual,[record({selected:true,value:null,valueAttribute:null})],{label,path});
});

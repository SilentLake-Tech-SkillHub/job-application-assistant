import {annotateRecoveredControl} from './control-recovery.mjs';
import {readPhoenixSelectedValue} from './phoenix-selection.mjs';
const popup='.common-unmodeled-layer:has(.area-selector-container)';
export const exactRenderedText=text=>new RegExp('^'+String(text).split(/(\s+)/).map(part=>/^\s+$/.test(part)?(/[\r\n]/.test(part)?'\\s*':'\\s+'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');
const exact=exactRenderedText;
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
export function areaOptionsDOM(root){
 const shown=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 return [...root.querySelectorAll('.area-data-container .area-item-container')].filter(shown).map(row=>{
  const label=row.querySelector('.area-item-name')?.innerText?.trim(),attribute=['data-value','data-id','value'].find(a=>row.hasAttribute(a))||null;
  return {label,path:row.querySelector('.area-item-path')?.innerText?.trim()||null,value:attribute?row.getAttribute(attribute):null,valueAttribute:attribute,disabled:row.getAttribute('aria-disabled')==='true'||row.classList.contains('disabled'),selected:row.getAttribute('aria-checked')==='true'||!!row.querySelector('.area-icon-RadioChecked,.area-icon-CheckboxChecked,[aria-checked="true"]')};
 }).filter(r=>r.label);
}
export function areaSelectionDOM(root){
 const container=root.querySelector('.select-data-container'),header=root.querySelector('.select-data-num-text');
 const count=Number(header?.textContent?.trim());
 return {count:Number.isInteger(count)&&header?count:null,text:container?.innerText?.trim()||'',empty:!!container?.querySelector('.select-data-empty'),values:container?[...container.querySelectorAll('[data-value],[data-id]')].map(n=>n.getAttribute('data-value')||n.getAttribute('data-id')):[]};
}
export function assertAreaSelection(proof,label,expectedId){
 if(proof?.count!==1||proof.empty||proof.text!==label)throw Error('AREA_CURRENT_SELECTION_NOT_VERIFIED');
 if(expectedId!=null&&(proof.values.length!==1||proof.values[0]!==expectedId))throw Error('AREA_SELECTED_ID_MISMATCH');
 return true;
}
export function areaReadinessDOM(root){
 const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const busy='[aria-busy="true"],[role="progressbar"],[data-loading="true"],.phoenix-spin-spinning,.phoenix-loading,.loading';
 const loaded='[aria-busy="false"],[data-loading="false"],[data-loaded="true"],[data-state="loaded"],[data-state="ready"]';
 const busyNodes=[root,...root.querySelectorAll(busy)].filter(n=>n.matches?.(busy)&&visible(n)),readyNodes=[root,...root.querySelectorAll(loaded)].filter(n=>n.matches?.(loaded)&&visible(n));
 const emptyNodes=[...root.querySelectorAll('.area-data-empty,.area-empty,[role="status"],.no-data')].filter(visible).map(n=>n.innerText?.trim()).filter(t=>t&&/无数据|暂无|无结果|未找到|无匹配|no (?:data|results|options)/i.test(t));
 return {loading:busyNodes.length>0,explicitLoaded:readyNodes.length>0,loadingEvidence:busyNodes.map(n=>({tag:n.tagName,classes:String(n.className||''),ariaBusy:n.getAttribute('aria-busy')})),emptyEvidence:emptyNodes};
}
const rowsKey=records=>JSON.stringify((records||[]).map(({label,path,value,disabled})=>({label,path,value,disabled:!!disabled})));
const normalizeQuery=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
// The clock and sampler are injectable only at this internal boundary. A tool
// caller cannot shorten the production wait by passing template action fields.
export async function waitForAreaResults({read,query=null,baseline=null,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=6000,stableMs=450,pollMs=50}){
 const started=now(),end=started+timeoutMs;let polls=0,stableSince=null,stableKey=null,sawLoading=false,loadingEnded=false,last=null;
 const evidence=(decision)=>({decision,elapsedMs:now()-started,windowMs:timeoutMs,fullWindowElapsed:now()>=end,polls,stableMs:stableSince===null?0:now()-stableSince,requiredStableMs:stableMs,sawLoading,loadingEnded,queryApplied:query!==null&&last?.input===query,loading:last?.loading===true,freshness:last?.freshness||[],lastObservation:{input:last?.input,resultText:last?.resultText??null,rowCount:last?.records?.length||0,explicitLoaded:last?.explicitLoaded===true,loadingEvidence:last?.loadingEvidence||[]}});
 for(;;){
  const state=await read();polls++;last=state;
  if(state.loading===true){sawLoading=true;stableSince=null;stableKey=null;}else if(sawLoading)loadingEnded=true;
  const applied=query===null?state.input==='':state.input===query,records=state.records||[],zero=/搜索结果\s*0\s*个|\b0\s*(?:results|options)\b/i.test(state.resultText||'');
  const changed=baseline&&(rowsKey(records)!==rowsKey(baseline.records)||(state.resultText??null)!==(baseline.resultText??null));
  const freshness=[...(changed?['rendered_results_changed']:[]),...(loadingEnded?['observed_loading_ended']:[]),...(state.explicitLoaded===true?['explicit_loaded_marker']:[])];
  last={...state,freshness};
  const relevant=query===null||records.every(r=>normalizeQuery((r.label||'')+' '+(r.path||'')).includes(normalizeQuery(query)));
  const resultCount=(state.resultText||'').match(/搜索结果\s*(\d+)\s*个/i),positive=applied&&state.loading!==true&&records.length>0&&(query===null||relevant&&resultCount&&Number(resultCount[1])>=records.length);
  if(positive)return {status:'captured',records,empty:[],waitEvidence:evidence('observed_current_rows')};
  const empty=[...(zero?[state.resultText]:[]),...(state.emptyEvidence||[])],settled=applied&&state.loading!==true&&!records.length&&empty.length>0&&freshness.length>0;
  if(settled){const signature=JSON.stringify({input:state.input,empty,freshness});if(signature!==stableKey){stableKey=signature;stableSince=now();}}
  else{stableKey=null;stableSince=null;}
  if(now()>=end){
   if(query!==null&&settled&&stableSince!==null&&now()-stableSince>=stableMs)return {status:'captured_empty_search',records:[],empty,waitEvidence:evidence('stable_current_query_empty')};
   return {status:'options_not_observed',records:[],empty:[],waitEvidence:evidence('results_not_proven_settled')};
  }
  if(query===null&&settled&&(loadingEnded||state.explicitLoaded===true)&&now()-stableSince>=stableMs)return {status:'options_not_observed',records:[],empty:[],waitEvidence:evidence('observed_loaded_empty_branches')};
  await sleep(Math.min(pollMs,end-now()));
 }
}
export async function performPhoenixArea(adapter,action,value,{trigger,initial,dismiss}={}){
 const originalPage=adapter.page.url?.();
 const menu=adapter.page.locator(popup).filter({visible:true}),inspect=action.method.endsWith('_inspect'),verify=action.method.endsWith('_verify');
 if(await menu.count()!==1)throw Error('AREA_MENU_NOT_UNIQUE');
 const button=text=>menu.locator('.area-footer-button .phoenix-button').filter({hasText:exact(text)});
 const cancel=async()=>{const control=button('取消');if(await control.count()!==1)throw Error('AREA_CANCEL_CONTROL_REQUIRED');await control.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});};
 const readDisplay=()=>readPhoenixSelectedValue(trigger);
 const proofFor=async()=>{
  const selected=await menu.evaluate(areaSelectionDOM);assertAreaSelection(selected,String(value),action.expectedOptionValue);
  return {label:String(value),value:action.expectedOptionValue??null,valueAttribute:action.expectedOptionValue==null?null:'observed_option_identity',blurConfirmed:true,reopenedOptionSelected:true,valueCompared:action.expectedOptionValue!=null,selectedRegion:selected};
 };
 try{
  if(verify){const proof=await proofFor();await cancel();if(await readDisplay()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');return {performed:false,selectionProof:proof,verification:'requires_independent_readback'};}
  const search=menu.locator('.area-search-input input'),query=action.query||String(value||'');
  if(await search.count()!==1)throw Error('AREA_SEARCH_CONTROL_REQUIRED');
  const readResults=async()=>{const input=await search.inputValue(),headers=menu.locator('.search-result'),count=await headers.count(),resultText=count===1?await headers.innerText():null;const [records,readiness]=await Promise.all([menu.evaluate(areaOptionsDOM),menu.evaluate(areaReadinessDOM)]);return {input,resultText,records,...readiness};};
  if(inspect&&!query){const result=await waitForAreaResults({read:readResults});await cancel();return {status:result.status,options:result.records.map(r=>r.label),optionRecords:result.records,renderer:'phoenix_area',searchable:true,queryApplied:false,scope:'rendered_region_branches',coverage:{complete:false,reason:result.waitEvidence.decision,waitEvidence:result.waitEvidence},restored:await readDisplay()===initial};}
  if(!query)throw Error('AREA_SEARCH_QUERY_REQUIRED');
  const baseline=await readResults();
  await search.fill(query,{timeout:10000});
  const result=await waitForAreaResults({read:readResults,query,baseline}),records=result.records,empty=result.empty;
  if(inspect){await cancel();return {status:result.status,options:records.map(r=>r.label),optionRecords:records,renderer:'phoenix_area',searchable:true,queryApplied:true,scope:'exact_search_results',coverage:{complete:false,waitEvidence:result.waitEvidence,...(empty.length?{emptyEvidence:empty,reason:'observed_no_results'}:{reason:result.waitEvidence.decision})},restored:await readDisplay()===initial};}
  if(result.status!=='captured')throw Error('AREA_SEARCH_RESULTS_NOT_READY');
  const end=Date.now()+6000;
  const matches=records.filter(r=>r.label===String(value));
  if(matches.length!==1||!action.options?.includes(String(value)))throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
  const candidate=matches[0];if(candidate.disabled)throw Error('CHOICE_OPTION_DISABLED');
  if(action.expectedOptionValue!=null&&candidate.value!==action.expectedOptionValue)throw Error('CHOICE_OPTION_VALUE_CHANGED');
  const row=menu.locator('.area-data-container .area-item-container').filter({has:adapter.page.locator('.area-item-name').filter({hasText:exact(value)})});
  if(await row.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
  const selectIcon=row.locator('.area-item-name .icon-container').filter({visible:true});
  if(await selectIcon.count()!==1)throw Error('AREA_SELECTION_ACTION_TARGET_REQUIRED');
  await selectIcon.click({timeout:10000});
  for(;;){try{await proofFor();break;}catch(error){if(Date.now()>=end)throw error;await pause();}}
  const confirm=button('确定');if(await confirm.count()!==1)throw Error('AREA_CONFIRM_CONTROL_REQUIRED');
  await confirm.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});
  if(await readDisplay()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
  await trigger.click({timeout:10000});await menu.waitFor({state:'visible',timeout:5000});
  const verified=await performPhoenixArea(adapter,{...action,method:action.method+'_verify'},value,{trigger,initial:String(value),dismiss});
  return {...verified,performed:true};
 }catch(error){if(await menu.count())await cancel().catch(()=>{});await dismiss?.().catch(()=>{});throw await annotateRecoveredControl(error,{before:initial,expected:String(value),read:()=>readPhoenixSelectedValue(trigger),isClosed:async()=>await menu.count()===0,samePage:async()=>typeof originalPage==='string'&&adapter.page.url()===originalPage});}
}

const listPopup='.common-unmodeled-layer:has(.list-item-container)';
export function listPopupOptionsDOM(root){
 const shown=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 return [...root.querySelectorAll('.list-item-container')].filter(row=>shown(row)&&!row.closest?.('.right-container')).map(row=>{
  const leaves=[...row.querySelectorAll('.item-text-label')].filter(shown),paths=[...row.querySelectorAll('.item-text-fullname')].filter(shown);
  if(leaves.length!==1||!leaves[0].innerText?.trim()||paths.length>1)throw Error('LIST_POPUP_LEAF_STRUCTURE_REQUIRED');
  const label=leaves[0].innerText.trim(),path=paths[0]?.innerText?.trim()||null;
  if(/[\r\n]/.test(label))throw Error('LIST_POPUP_LEAF_STRUCTURE_REQUIRED');
  const identities=[];
  for(const attribute of ['data-value','data-id','value'])for(const node of [row,leaves[0]]){const value=node.getAttribute(attribute);if(value!=null&&String(value).trim())identities.push({value,attribute});}
  if(new Set(identities.map(i=>i.value)).size>1)throw Error('LIST_POPUP_OPTION_ID_CONFLICT');
  const identity=identities[0];
  return {label,path,rawText:row.innerText?.trim()||'',value:identity?.value??null,valueAttribute:identity?.attribute??null,disabled:row.getAttribute('aria-disabled')==='true'||row.classList.contains('disabled'),selected:row.getAttribute('aria-checked')==='true'||row.getAttribute('aria-selected')==='true'||!!row.querySelector('.icon-container svg.RadioChecked,.icon-container svg.CheckboxChecked,.icon-container [aria-checked="true"]')};
 });
}
export function listPopupSelectionDOM(root){
 const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const panes=[...root.querySelectorAll('.right-container')].filter(visible);
 if(panes.length!==1)return {count:null,text:'',empty:true,values:[],scopeValid:false};
 const pane=panes[0],headers=pane.querySelectorAll('.select-data-num-text'),limits=pane.querySelectorAll('.select-data-num-limit'),containers=pane.querySelectorAll('.select-data-container');
 if(headers.length!==1||limits.length!==1||containers.length!==1)return {count:null,text:'',empty:true,values:[],scopeValid:false};
 const count=String(headers[0].innerText||headers[0].textContent||'').trim().match(/^(\d+)\s*\/$/),limit=String(limits[0].innerText||limits[0].textContent||'').trim(),container=containers[0];
 if(!count||!/^\d+$/.test(limit)||Number(limit)<1||Number(count[1])>Number(limit))return {count:null,text:'',empty:true,values:[],scopeValid:false};
 const leaves=[...container.querySelectorAll('.item-text-label,.select-text-label')].filter(visible),paths=[...container.querySelectorAll('.item-text-fullname,.full-label')].filter(visible);
 if(leaves.length>1||paths.length>1)return {count:Number(count[1]),text:'',empty:false,values:[],scopeValid:false};
 const values=[...new Set([container,...container.querySelectorAll('[data-value],[data-id]')].flatMap(n=>['data-value','data-id'].map(a=>n.getAttribute?.(a)).filter(v=>v!=null&&String(v).trim())))];
 const classic=leaves[0]?.matches?.('.select-text-label'),leafText=classic?[...leaves[0].childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').trim():leaves[0]?.innerText?.trim();
 const rawPath=paths[0]?.innerText?.trim()||null,classicPath=paths[0]?.matches?.('.full-label');
 if(classic&&(!leafText||classicPath&&!/^\(.+\)$/.test(rawPath)))return {count:Number(count[1]),text:'',empty:false,values:[],scopeValid:false};
 return {count:Number(count[1]),limit:Number(limit),text:leafText||String(container.innerText||'').trim(),path:classicPath?rawPath.slice(1,-1):rawPath,empty:Number(count[1])===0||!!container.querySelector('.select-data-empty'),values,scopeValid:true};
}
// Both inputs are current DOM observations. Expected data only rejects a proof;
// it never supplies the observed label, path or business ID.
export function confirmListPopupSelection(pane,records,{label,path=null,value=null,valueAttribute=null}={}){
 if(!pane.scopeValid)throw Error('LIST_POPUP_SELECTION_PANE_REQUIRED');
 assertAreaSelection(pane,label,null);
 const selected=records.filter(r=>r.selected===true);
 if(selected.length!==1||selected[0].disabled||selected[0].label!==pane.text)throw Error('LIST_POPUP_CURRENT_ENTITY_NOT_VERIFIED');
 const entity=selected[0];
 if((entity.path??null)!==path||pane.path!=null&&pane.path!==entity.path)throw Error('LIST_POPUP_SELECTED_PATH_MISMATCH');
 if((entity.value??null)!==value||(entity.valueAttribute??null)!==valueAttribute||pane.values.length>1||pane.values.length===1&&pane.values[0]!==entity.value)throw Error('LIST_POPUP_SELECTED_ID_MISMATCH');
 return {renderer:'phoenix_list_popup',choiceContract:'leaf_v2',label:pane.text,path:entity.path??null,value:entity.value??null,valueAttribute:entity.valueAttribute??null,blurConfirmed:true,reopenedOptionSelected:true,valueCompared:value!=null,selectedList:pane,selectedEntity:entity};
}
// Single-choice panels with a left list and a separate confirmed selection pane.
export async function performPhoenixListPopup(adapter,action,value,{trigger,initial,dismiss}={}){
 const originalPage=adapter.page.url?.();
 const menu=adapter.page.locator(listPopup).filter({visible:true}),inspect=action.method.endsWith('_inspect'),verify=action.method.endsWith('_verify');
 if(await menu.count()!==1)throw Error('LIST_POPUP_NOT_UNIQUE');
 const button=text=>menu.locator('.phoenix-button').filter({hasText:exact(text)});
 const cancel=async()=>{const cancelButton=button('取消');if(await cancelButton.count()!==1)throw Error('LIST_POPUP_CANCEL_REQUIRED');await cancelButton.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});};
 const display=()=>readPhoenixSelectedValue(trigger);
 try{
  if(!inspect&&(action.choiceRenderer!=='phoenix_list_popup'||action.choiceContract!=='leaf_v2'||!['expectedOptionPath','expectedOptionValue','expectedOptionValueAttribute'].every(k=>Object.hasOwn(action,k))))throw Error('LIST_POPUP_CONTRACT_REQUIRES_REBUILD');
  const search=menu.locator('input[placeholder="搜索"]'),query=action.query||String(value||'');
  if(await search.count()!==1)throw Error('LIST_POPUP_SEARCH_REQUIRED');
  const read=async()=>({pane:await menu.evaluate(listPopupSelectionDOM),records:await menu.evaluate(listPopupOptionsDOM)});
  let current=await read();
  // A verifier may search this same transient panel to expose current selected
  // markers. It never invokes a selection icon or the confirmation button.
  if(query){
   await search.fill(query,{timeout:10000});const end=Date.now()+6000;let previous=null,stableAt=null;
   for(;;){current=await read();const applied=await search.inputValue(),signature=rowsKey(current.records),relevant=current.records.length&&current.records.every(r=>normalizeQuery(r.label+' '+(r.path||'')).includes(normalizeQuery(query)));
    if(applied===query&&relevant){if(signature!==previous){previous=signature;stableAt=Date.now();}else if(Date.now()-stableAt>=90)break;}
    else{previous=null;stableAt=null;}
    if(Date.now()>=end)throw Error('LIST_POPUP_SEARCH_RESULTS_NOT_READY');await pause();
   }
  }
  const proof=()=>confirmListPopupSelection(current.pane,current.records,{label:String(value),path:action.expectedOptionPath,value:action.expectedOptionValue,valueAttribute:action.expectedOptionValueAttribute});
  if(verify){const selected=proof();await cancel();const restored=await display();if(restored!==initial||restored!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');return {performed:false,selectionProof:selected,verification:'requires_independent_readback'};}
  if(inspect){const {pane,records}=current;await cancel();return {status:'captured',options:[...new Set(records.map(r=>r.label))],optionRecords:records,selectedPane:pane,renderer:'phoenix_list_popup',choiceContract:'leaf_v2',searchable:true,queryApplied:!!query,scope:query?'current_filtered_list':'current_visible_list',coverage:{complete:false,reason:'rendered_list_popup'},restored:await display()===initial};}
  const matches=current.records.filter(r=>r.label===String(value));if(matches.length!==1||!action.options?.includes(String(value)))throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
  const candidate=matches[0];if(candidate.disabled)throw Error('CHOICE_OPTION_DISABLED');
  if((candidate.path??null)!==action.expectedOptionPath)throw Error('CHOICE_OPTION_PATH_CHANGED');
  if((candidate.value??null)!==action.expectedOptionValue||(candidate.valueAttribute??null)!==action.expectedOptionValueAttribute)throw Error('CHOICE_OPTION_VALUE_CHANGED');
  const row=menu.locator('.list-item-container').filter({has:adapter.page.locator('.item-text-label').filter({hasText:exact(value)})}).filter({visible:true});
  if(await row.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
  const live=await row.evaluate(node=>({label:[...node.querySelectorAll('.item-text-label')].filter(n=>n.getClientRects().length).map(n=>n.innerText.trim()),path:[...node.querySelectorAll('.item-text-fullname')].filter(n=>n.getClientRects().length).map(n=>n.innerText.trim()),values:[node,...node.querySelectorAll('.item-text-label')].flatMap(n=>['data-value','data-id','value'].map(a=>n.getAttribute(a)).filter(v=>v!=null&&String(v).trim()))}));
  if(live.label.length!==1||live.label[0]!==candidate.label||(live.path.length?live.path.length!==1||live.path[0]!==candidate.path:candidate.path!=null)||live.values.some(v=>v!==candidate.value)||candidate.value!=null&&!live.values.length)throw Error('CHOICE_OPTION_IDENTITY_CHANGED');
  // The captured renderer binds handleChangeCheck to the SVG, not its span.
  // Clicking the wrapper's padded center can miss that actual event target.
  const selectIcon=row.locator(':scope > .icon-container > svg.RadioUnchecked, :scope > .icon-container > svg.RadioChecked').filter({visible:true});if(await selectIcon.count()!==1)throw Error('LIST_SELECTION_ACTION_TARGET_REQUIRED');
  await selectIcon.click({timeout:10000});const end=Date.now()+6000;
  for(;;){current=await read();try{proof();break;}catch(error){if(Date.now()>=end)throw error;await pause();}}
  const confirm=button('确定');if(await confirm.count()!==1)throw Error('LIST_POPUP_CONFIRM_REQUIRED');await confirm.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});
  if(await display()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
  await trigger.click({timeout:10000});await menu.waitFor({state:'visible',timeout:5000});
  const verified=await performPhoenixListPopup(adapter,{...action,method:action.method+'_verify'},value,{trigger,initial:String(value),dismiss});return {...verified,performed:true};
 }catch(error){if(await menu.count())await cancel().catch(()=>{});await dismiss?.().catch(()=>{});throw await annotateRecoveredControl(error,{before:initial,expected:String(value),read:()=>readPhoenixSelectedValue(trigger),isClosed:async()=>await menu.count()===0,samePage:async()=>typeof originalPage==='string'&&adapter.page.url()===originalPage});}
}

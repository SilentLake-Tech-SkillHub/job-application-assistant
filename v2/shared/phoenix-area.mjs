const popup='.common-unmodeled-layer:has(.area-selector-container)';
const exact=text=>new RegExp('^'+String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');
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
export async function performPhoenixArea(adapter,action,value,{trigger,initial,dismiss}={}){
 const menu=adapter.page.locator(popup).filter({visible:true}),inspect=action.method.endsWith('_inspect'),verify=action.method.endsWith('_verify');
 if(await menu.count()!==1)throw Error('AREA_MENU_NOT_UNIQUE');
 const button=text=>menu.locator('.area-footer-button .phoenix-button').filter({hasText:exact(text)});
 const cancel=async()=>{const control=button('取消');if(await control.count()!==1)throw Error('AREA_CANCEL_CONTROL_REQUIRED');await control.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});};
 const readDisplay=async()=>String(await trigger.innerText()).trim();
 const proofFor=async()=>{
  const selected=await menu.evaluate(areaSelectionDOM);assertAreaSelection(selected,String(value),action.expectedOptionValue);
  return {label:String(value),value:action.expectedOptionValue??null,valueAttribute:action.expectedOptionValue==null?null:'observed_option_identity',blurConfirmed:true,reopenedOptionSelected:true,valueCompared:action.expectedOptionValue!=null,selectedRegion:selected};
 };
 try{
  if(verify){const proof=await proofFor();await cancel();if(await readDisplay()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');return {performed:false,selectionProof:proof,verification:'requires_independent_readback'};}
  const search=menu.locator('.area-search-input input'),query=action.query||String(value||'');
  if(await search.count()!==1)throw Error('AREA_SEARCH_CONTROL_REQUIRED');
  if(inspect&&!query){const records=await menu.evaluate(areaOptionsDOM);await cancel();return {status:records.length?'captured':'options_not_observed',options:records.map(r=>r.label),optionRecords:records,renderer:'phoenix_area',searchable:true,queryApplied:false,scope:'rendered_region_branches',coverage:{complete:false,reason:'query_not_requested'},restored:await readDisplay()===initial};}
  if(!query)throw Error('AREA_SEARCH_QUERY_REQUIRED');
  await search.fill(query,{timeout:10000});
  const end=Date.now()+6000;let records=[],empty=[];
  for(;;){
   const applied=await search.inputValue(),header=await menu.locator('.search-result').count();
   if(applied===query&&header===1){
    records=await menu.evaluate(areaOptionsDOM);const resultText=await menu.locator('.search-result').innerText();
    if(records.length)break;
    if(/(?:^|\D)0\s*个/.test(resultText)){empty=[resultText];break;}
   }
   if(Date.now()>=end)throw Error('AREA_SEARCH_RESULTS_NOT_READY');await pause();
  }
  if(inspect){await cancel();return {status:records.length?'captured':'captured_empty_search',options:records.map(r=>r.label),optionRecords:records,renderer:'phoenix_area',searchable:true,queryApplied:true,scope:'exact_search_results',coverage:{complete:false,...(empty.length?{emptyEvidence:empty,reason:'observed_no_results'}:{reason:'rendered_region_search_results'})},restored:await readDisplay()===initial};}
  const matches=records.filter(r=>r.label===String(value));
  if(matches.length!==1||!action.options?.includes(String(value)))throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
  const candidate=matches[0];if(candidate.disabled)throw Error('CHOICE_OPTION_DISABLED');
  if(action.expectedOptionValue!=null&&candidate.value!==action.expectedOptionValue)throw Error('CHOICE_OPTION_VALUE_CHANGED');
  const row=menu.locator('.area-data-container .area-item-container').filter({has:adapter.page.locator('.area-item-name').filter({hasText:exact(value)})});
  if(await row.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
  await row.locator('.area-item-name').click({timeout:10000});
  for(;;){try{await proofFor();break;}catch(error){if(Date.now()>=end)throw error;await pause();}}
  const confirm=button('确定');if(await confirm.count()!==1)throw Error('AREA_CONFIRM_CONTROL_REQUIRED');
  await confirm.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});
  if(await readDisplay()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
  await trigger.click({timeout:10000});await menu.waitFor({state:'visible',timeout:5000});
  const verified=await performPhoenixArea(adapter,{...action,method:action.method+'_verify'},value,{trigger,initial:String(value),dismiss});
  return {...verified,performed:true};
 }catch(error){if(await menu.count())await cancel().catch(()=>{});await dismiss?.().catch(()=>{});throw error;}
}

const listPopup='.common-unmodeled-layer:has(.list-item-container)';
export function listPopupOptionsDOM(root){
 const shown=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 return [...root.querySelectorAll('.list-item-container')].filter(shown).map(row=>{
  const label=row.innerText?.trim(),attribute=['data-value','data-id','value'].find(a=>row.hasAttribute(a))||null;
  return {label,value:attribute?row.getAttribute(attribute):null,valueAttribute:attribute,disabled:row.getAttribute('aria-disabled')==='true'||row.classList.contains('disabled')};
 }).filter(row=>row.label);
}
export function listPopupSelectionDOM(root){
 const panes=[...root.querySelectorAll('.right-container')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
 if(panes.length!==1)return {count:null,text:'',empty:true,values:[],scopeValid:false};
 const pane=panes[0],headers=pane.querySelectorAll('.select-data-num-text'),limits=pane.querySelectorAll('.select-data-num-limit'),containers=pane.querySelectorAll('.select-data-container');
 if(headers.length!==1||limits.length!==1||containers.length!==1)return {count:null,text:'',empty:true,values:[],scopeValid:false};
 const count=String(headers[0].innerText||headers[0].textContent||'').trim().match(/^(\d+)\s*\/$/),limit=String(limits[0].innerText||limits[0].textContent||'').trim(),container=containers[0];
 if(!count||limit!=='1')return {count:null,text:'',empty:true,values:[],scopeValid:false};
 return {count:Number(count[1]),text:String(container.innerText||'').trim(),empty:Number(count[1])===0||!!container.querySelector('.select-data-empty'),values:[...container.querySelectorAll('[data-value],[data-id]')].map(n=>n.getAttribute('data-value')||n.getAttribute('data-id')),scopeValid:true};
}
// Single-choice panels with a left list and a separate confirmed selection pane.
export async function performPhoenixListPopup(adapter,action,value,{trigger,initial,dismiss}={}){
 const menu=adapter.page.locator(listPopup).filter({visible:true}),inspect=action.method.endsWith('_inspect'),verify=action.method.endsWith('_verify');
 if(await menu.count()!==1)throw Error('LIST_POPUP_NOT_UNIQUE');
 const button=text=>menu.locator('.phoenix-button').filter({hasText:exact(text)});
 const cancel=async()=>{const cancelButton=button('取消');if(await cancelButton.count()!==1)throw Error('LIST_POPUP_CANCEL_REQUIRED');await cancelButton.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});};
 const display=async()=>String(await trigger.innerText()).trim();
 const selectedProof=async()=>{const selected=await menu.evaluate(listPopupSelectionDOM);if(!selected.scopeValid)throw Error('LIST_POPUP_SELECTION_PANE_REQUIRED');assertAreaSelection(selected,String(value),action.expectedOptionValue);return {label:String(value),value:action.expectedOptionValue??null,valueAttribute:action.expectedOptionValue==null?null:'observed_option_identity',blurConfirmed:true,reopenedOptionSelected:true,valueCompared:action.expectedOptionValue!=null,selectedList:selected};};
 try{
  if(verify){const proof=await selectedProof();await cancel();if(await display()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');return {performed:false,selectionProof:proof,verification:'requires_independent_readback'};}
  const search=menu.locator('input[placeholder="搜索"]'),query=action.query||String(value||'');
  if(await search.count()!==1)throw Error('LIST_POPUP_SEARCH_REQUIRED');
  const before=await menu.evaluate(listPopupOptionsDOM);let records=before;
  if(query){
   const previous=await search.inputValue();await search.fill(query,{timeout:10000});const end=Date.now()+6000;
   for(;;){records=await menu.evaluate(listPopupOptionsDOM);const applied=await search.inputValue();
    const changed=JSON.stringify(records)!==JSON.stringify(before),filtered=records.length>0&&records.every(r=>r.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    if(applied===query&&records.length&&(previous===query||changed||filtered))break;
    if(Date.now()>=end)throw Error('LIST_POPUP_SEARCH_RESULTS_NOT_READY');await pause();
   }
  }
  if(inspect){await cancel();return {status:'captured',options:records.map(r=>r.label),optionRecords:records,renderer:'phoenix_list_popup',searchable:true,queryApplied:!!query,scope:query?'current_filtered_list':'current_visible_list',coverage:{complete:false,reason:'rendered_list_popup'},restored:await display()===initial};}
  const matches=records.filter(r=>r.label===String(value));if(matches.length!==1||!action.options?.includes(String(value)))throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
  if(matches[0].disabled)throw Error('CHOICE_OPTION_DISABLED');if(action.expectedOptionValue!=null&&matches[0].value!==action.expectedOptionValue)throw Error('CHOICE_OPTION_VALUE_CHANGED');
  const row=menu.locator('.list-item-container').filter({hasText:exact(value)});if(await row.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
  await row.click({timeout:10000});const end=Date.now()+6000;
  for(;;){try{await selectedProof();break;}catch(error){if(Date.now()>=end)throw error;await pause();}}
  const confirm=button('确定');if(await confirm.count()!==1)throw Error('LIST_POPUP_CONFIRM_REQUIRED');await confirm.click({timeout:10000});await menu.waitFor({state:'hidden',timeout:5000});
  if(await display()!==String(value))throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
  await trigger.click({timeout:10000});await menu.waitFor({state:'visible',timeout:5000});
  const verified=await performPhoenixListPopup(adapter,{...action,method:action.method+'_verify'},value,{trigger,initial:String(value),dismiss});return {...verified,performed:true};
 }catch(error){if(await menu.count())await cancel().catch(()=>{});await dismiss?.().catch(()=>{});throw error;}
}

import {choiceProofDOM} from './choice-proof.mjs';
const popup='.common-unmodeled-layer:has(.phoenix-selectList)',item='.phoenix-selectList__listItem';
const escape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
export async function performPhoenixAutocomplete(adapter,action,value){
 const input=adapter.page.locator(action.selector),label=adapter.page.locator(action.labelSelector);
 if(await input.count()!==1||await label.count()!==1||!await input.evaluate(n=>n.tagName==='INPUT'&&!!n.closest('.phoenix-auto-complete-container')))throw Error('PHOENIX_AUTOCOMPLETE_CAPTURE_REQUIRED');
 const read=()=>input.inputValue(),warning=()=>input.evaluate(n=>{const root=n.closest('.form-item--phoenix'),text=root?.innerText||'';return /没有搜索到.{0,20}将使用.{0,20}输入/.test(text)?text.split('\n').find(s=>s.includes('没有搜索到')):null;});
 const before=await read(),inspect=action.method.endsWith('_inspect'),verify=action.method.endsWith('_verify');
 const websiteId=()=>input.evaluate(n=>{for(const target of [n,n.closest('.phoenix-auto-complete-container')])for(const attribute of ['data-school-id','data-entity-id','data-value','data-id']){const value=target?.getAttribute?.(attribute);if(typeof value==='string'&&value.trim())return {value,attribute};}return null;});
 const close=()=>label.click({timeout:10000});
 const waitValue=async expected=>{const end=Date.now()+2500;while(await read()!==expected){if(Date.now()>=end)throw Error('AUTOCOMPLETE_COMMIT_NOT_VERIFIED');await new Promise(r=>setTimeout(r,20));}};
 const menu=adapter.page.locator(popup).filter({visible:true});
 const selectedEvidence=async(expected,expectedId)=>{
  const id=await websiteId();
  if(id&&expectedId!=null){if(id.value!==expectedId)throw Error('AUTOCOMPLETE_SELECTED_ID_MISMATCH');return {verified:true,kind:'entity_id',label:expected,value:id.value,websiteId:id};}
  // Opening a menu is observational. Never type a query or click an option
  // during independent verification: a search result is not selected state.
  await input.click({timeout:10000});let records=[];
  try{if(await menu.count()===1)records=await menu.evaluate(choiceProofDOM,{operation:'options',selector:item});}
  finally{await close();}
  const selected=records.filter(r=>r.selected===true),same=records.filter(r=>r.label===expected);
  if(selected.length!==1||same.length!==1||selected[0].label!==expected||selected[0].disabled)throw Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');
  if(expectedId!=null&&selected[0].value!==expectedId)throw Error('AUTOCOMPLETE_SELECTED_ID_MISMATCH');
  return {verified:true,kind:'selected_option',label:expected,value:selected[0].value??null,selected:true};
 };
 const currentProof=async(mode,expected,expectedId)=>{
  await close();await waitValue(expected);
  const first={value:await read(),websiteId:await websiteId(),warning:await warning()};
  if(mode==='explicit_custom_value'){
   const second={value:await read(),websiteId:await websiteId(),warning:await warning()};
   if(first.value!==expected||second.value!==expected||first.websiteId||second.websiteId||!nonempty(first.warning)||first.warning!==second.warning)throw Error('AUTOCOMPLETE_CURRENT_CUSTOM_ACCEPTANCE_REQUIRED');
   return {...second,customAcceptance:{verified:true,label:expected,websiteEvidence:second.warning},blurConfirmed:true,readbackStable:true};
  }
  if(first.warning)throw Error('AUTOCOMPLETE_DICTIONARY_SELECTION_NOT_ACCEPTED');
  const currentSelection=await selectedEvidence(expected,expectedId);
  if(await read()!==expected||await warning())throw Error('AUTOCOMPLETE_COMMIT_NOT_VERIFIED');
  if(currentSelection.kind==='entity_id'){const second=await websiteId();if(!second||second.value!==currentSelection.value)throw Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');}
  return {value:expected,websiteId:await websiteId(),warning:null,currentSelection,blurConfirmed:true,readbackStable:true};
 };
 if(verify)return currentProof(action.expectedCommitMode||'actual_option_click',String(value),action.expectedOptionValue);
 // Replacing a nonempty input can clear its bound dictionary entity. Until a
 // generic restoration driver exists, reject before any focus or mutation.
 if(inspect&&(before!==''||await websiteId()))throw Error('AUTOCOMPLETE_INSPECTION_NONEMPTY_REQUIRES_RESTORE');
 const restoreEmpty=async()=>{await input.fill('',{timeout:10000});await close();await waitValue('');if(await websiteId()||await read()!=='')throw Error('AUTOCOMPLETE_INSPECTION_NOT_RESTORED');return true;};
 const query=action.query||String(value||'');if(!query)throw Error('AUTOCOMPLETE_QUERY_REQUIRED');
 let queryApplied=false;
 try{
  await input.click({timeout:10000});if(await read()!==query){await input.fill(query,{timeout:10000});await waitValue(query);}queryApplied=true;
  const end=Date.now()+5000;let records=[],empty=null;
  do{
   if(await menu.count()===1)records=await menu.evaluate(choiceProofDOM,{operation:'options',selector:item});
   empty=await warning();if(records.length||empty)break;if(Date.now()>=end)throw Error('AUTOCOMPLETE_RESULTS_NOT_READY');await new Promise(r=>setTimeout(r,30));
  }while(true);
  if(inspect){
   await restoreEmpty();
   return {options:records.map(r=>r.label),optionRecords:records,restored:true,restorationProof:{kind:'original_empty_unbound',value:'',websiteId:null},queryApplied,searchable:true,scope:'exact_search_results',coverage:{complete:true,...(empty?{reason:'observed_no_results',emptyEvidence:[empty]}:{reason:'rendered_search_results'})},status:records.length?'captured':'captured_empty_search',customValueEvidence:empty};
  }
  const matches=records.filter(r=>r.label===String(value));let proof;
  if(matches.length===1){
   const candidate=matches[0];if(candidate.disabled)throw Error('CHOICE_OPTION_DISABLED');
   if(!action.options?.includes(candidate.label)||action.expectedOptionValue!=null&&candidate.value!==action.expectedOptionValue)throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
   const target=menu.locator(item).filter({visible:true,hasText:new RegExp('^'+escape(candidate.label)+'$')});if(await target.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
   await target.click({timeout:10000});proof={mode:'actual_option_click',optionLabel:candidate.label,optionValue:candidate.value??null,valueAttribute:candidate.valueAttribute,optionClicked:true};
  }else if(!records.length&&empty&&action.customValueEvidence){proof={mode:'explicit_custom_value',optionLabel:String(value),optionValue:null,optionClicked:false,customValueEvidence:empty};}
  else throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
  const current=await currentProof(proof.mode,String(value),proof.optionValue);
  return {searchableCommit:{...proof,...current},verification:'requires_independent_readback'};
 }catch(error){if(inspect){try{await restoreEmpty();}catch{throw Error('AUTOCOMPLETE_INSPECTION_NOT_RESTORED');}}throw error;}
}

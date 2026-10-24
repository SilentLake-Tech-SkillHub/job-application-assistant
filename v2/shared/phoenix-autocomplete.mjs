import {choiceProofDOM} from './choice-proof.mjs';
import {createHash} from 'node:crypto';
const popup='.common-unmodeled-layer:has(.phoenix-selectList)',item='.phoenix-selectList__listItem';
const escape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const diagnosticCount=value=>Number.isInteger(value)?Math.max(0,Math.min(1000,value)):0;
// Internal dependency injection keeps rerender timing tests deterministic. Tool
// callers cannot override the production deadline or stability requirement.
export async function waitForAutocompleteCandidate({read,query,expectedLabel,expectedOptionValue,allowedOptions,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=3000,stableMs=90,pollMs=30}){
 const end=now()+timeoutMs;let stableSince=null,signature=null,last=null,lastReason='CHOICE_NOT_UNIQUE_OR_NOT_PRESENT';
 for(;;){
  const state=await read(),records=state.records||[],exactRecords=records.filter(r=>r.label===expectedLabel);last={candidateCount:diagnosticCount(records.length),exactCandidateCount:diagnosticCount(exactRecords.length),visibleTargetCount:diagnosticCount(state.visibleTargetCount)};
  const candidate=exactRecords.length===1?exactRecords[0]:null,allowed=allowedOptions?.includes(expectedLabel),identityMatches=expectedOptionValue==null||candidate?.value===expectedOptionValue;
  const ready=state.queryBefore===query&&state.queryAfter===query&&state.menuCount===1&&candidate&&!candidate.disabled&&allowed&&identityMatches&&state.visibleTargetCount===1;
  if(candidate?.disabled)lastReason='CHOICE_OPTION_DISABLED';else if(candidate&&(!allowed||!identityMatches))lastReason='ACTUAL_CAPTURED_OPTION_REQUIRED';else lastReason='CHOICE_NOT_UNIQUE_OR_NOT_PRESENT';
  if(ready){const key=JSON.stringify({label:candidate.label,value:candidate.value??null,valueAttribute:candidate.valueAttribute??null,disabled:!!candidate.disabled});if(signature!==key){signature=key;stableSince=now();}if(now()-stableSince>=stableMs)return {candidate,target:state.target};}
  else{signature=null;stableSince=null;}
  if(now()>=end){const error=Error(lastReason);error.details=last;throw error;}
  await sleep(Math.min(pollMs,end-now()));
 }
}
export async function performPhoenixAutocomplete(adapter,action,value){
 const input=adapter.page.locator(action.selector),label=adapter.page.locator(action.labelSelector);
 if(await input.count()!==1||await label.count()!==1||!await input.evaluate(n=>n.tagName==='INPUT'&&!!n.closest('.phoenix-auto-complete-container')))throw Error('PHOENIX_AUTOCOMPLETE_CAPTURE_REQUIRED');
 const read=()=>input.inputValue(),warning=()=>input.evaluate(n=>{const root=n.closest('.form-item--phoenix'),text=root?.innerText||'';return /没有搜索到.{0,20}将使用.{0,20}输入/.test(text)?text.split('\n').find(s=>s.includes('没有搜索到')):null;});
 const before=await read(),inspect=action.method.endsWith('_inspect'),verify=action.method.endsWith('_verify');
 const websiteId=()=>input.evaluate(n=>{for(const target of [n,n.closest('.phoenix-auto-complete-container')])for(const attribute of ['data-school-id','data-entity-id','data-value','data-id']){const value=target?.getAttribute?.(attribute);if(typeof value==='string'&&value.trim())return {value,attribute};}return null;});
 const close=()=>label.click({timeout:10000});
 const phase=async(name,expected,run)=>{try{return await run();}catch(error){let observed;try{observed=await read();}catch{}const digest=value=>createHash('sha256').update(String(value)).digest('hex');const counts=name==='candidate_resolution'?Object.fromEntries(['candidateCount','exactCandidateCount','visibleTargetCount'].map(key=>[key,diagnosticCount(error.details?.[key])])):{};error.details={phase:name,expectedValueHash:digest(expected),observedValueHash:typeof observed==='string'?digest(observed):null,valueMatches:observed===expected,readbackAvailable:typeof observed==='string',...counts};throw error;}};
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
 const currentProof=async(mode,expected,expectedId,independent=false)=>{
  await phase(independent?'independent_verify':'after_blur',expected,async()=>{await close();await waitValue(expected);});
  return phase('independent_verify',expected,async()=>{
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
  });
 };
 if(verify)return currentProof(action.expectedCommitMode||'actual_option_click',String(value),action.expectedOptionValue,true);
 // Replacing a nonempty input can clear its bound dictionary entity. Until a
 // generic restoration driver exists, reject before any focus or mutation.
 if(inspect&&(before!==''||await websiteId()))throw Error('AUTOCOMPLETE_INSPECTION_NONEMPTY_REQUIRES_RESTORE');
 const restoreEmpty=async()=>{await input.fill('',{timeout:10000});await close();await waitValue('');if(await websiteId()||await read()!=='')throw Error('AUTOCOMPLETE_INSPECTION_NOT_RESTORED');return true;};
 const query=action.query||String(value||'');if(!query)throw Error('AUTOCOMPLETE_QUERY_REQUIRED');
 let queryApplied=false;
 try{
  await input.click({timeout:10000});
  // A restored editor may show the old query without having issued this
  // session's search. Reapply through the real input even when text matches.
  await input.fill(query,{timeout:10000});await waitValue(query);queryApplied=true;
  const end=Date.now()+5000;let records=[],empty=null;
  do{
   if(await menu.count()===1)records=await menu.evaluate(choiceProofDOM,{operation:'options',selector:item});
   empty=await warning();if(records.length||empty)break;if(Date.now()>=end)throw Error('AUTOCOMPLETE_RESULTS_NOT_READY');await new Promise(r=>setTimeout(r,30));
  }while(true);
  if(inspect){
   await restoreEmpty();
   return {options:records.map(r=>r.label),optionRecords:records,restored:true,restorationProof:{kind:'original_empty_unbound',value:'',websiteId:null},queryApplied,searchable:true,scope:'exact_search_results',coverage:{complete:true,...(empty?{reason:'observed_no_results',emptyEvidence:[empty]}:{reason:'rendered_search_results'})},status:records.length?'captured':'captured_empty_search',customValueEvidence:empty};
  }
  let proof;
  if(records.length||!empty){
   const resolveCandidate=(search,optionValue,stableMs)=>phase('candidate_resolution',String(value),()=>waitForAutocompleteCandidate({query:search,expectedLabel:String(value),expectedOptionValue:optionValue,allowedOptions:action.options,...(stableMs?{stableMs}:{}),read:async()=>{
    const queryBefore=await read(),menuCount=await menu.count();
    const actual=menuCount===1?await menu.evaluate(choiceProofDOM,{operation:'options',selector:item}):[];
    const target=menu.locator(item).filter({visible:true,hasText:new RegExp('^'+escape(String(value))+'$')});
    const visibleTargetCount=menuCount===1?await target.count():0,queryAfter=await read();
    return {queryBefore,queryAfter,menuCount,records:actual,visibleTargetCount,target};
   }}));
   let {candidate,target}=await resolveCandidate(query,action.expectedOptionValue);
   // Recall queries are not selection labels. Some controlled autocomplete
   // wrappers commit their blur input asynchronously; converge to the observed
   // candidate before the real click so an old prefix cannot overwrite it.
   // This never substitutes input text for the click or independent entity proof.
   if(query!==candidate.label){
    const optionValue=candidate.value??action.expectedOptionValue;
    await input.fill(candidate.label,{timeout:10000});await waitValue(candidate.label);
    ({candidate,target}=await resolveCandidate(candidate.label,optionValue,500));
   }
   await target.click({timeout:10000});await phase('after_option_click',candidate.label,async()=>{
    const deadline=Date.now()+2500;
    while(await read()!==candidate.label||await menu.count()!==0){if(Date.now()>=deadline)throw Error('AUTOCOMPLETE_COMMIT_NOT_VERIFIED');await new Promise(r=>setTimeout(r,20));}
   });proof={mode:'actual_option_click',optionLabel:candidate.label,optionValue:candidate.value??null,valueAttribute:candidate.valueAttribute,optionClicked:true};
  }else if(!records.length&&empty&&action.customValueEvidence){proof={mode:'explicit_custom_value',optionLabel:String(value),optionValue:null,optionClicked:false,customValueEvidence:empty};}
  else throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
  const current=await currentProof(proof.mode,String(value),proof.optionValue);
  return {searchableCommit:{...proof,...current},verification:'requires_independent_readback'};
 }catch(error){if(inspect){try{await restoreEmpty();}catch{throw Error('AUTOCOMPLETE_INSPECTION_NOT_RESTORED');}}throw error;}
}

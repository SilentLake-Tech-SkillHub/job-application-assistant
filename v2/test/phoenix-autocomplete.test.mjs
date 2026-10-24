import test from 'node:test';import assert from 'node:assert/strict';
import {performPhoenixAutocomplete,waitForAutocompleteCandidate} from '../shared/phoenix-autocomplete.mjs';
const text='Example University',warningText='没有搜索到学校，将使用您输入的学校';
function fixture({initial='',exposeId=true,markers=false,options=[{label:text,value:'school-id',valueAttribute:'data-id',disabled:false}],custom=false,ghostRestore=false,commitDelayMs=0,neverCommit=false,rollbackAfterBlur=false,targetCounts=[],onFill}={}){
 const state={value:initial,id:initial&&exposeId?'school-id':null,selected:initial||null,open:false,fills:[],clicks:0,blurs:0,optionClicks:0,pendingCommit:false,prematureBlurs:0,query:initial,targetReads:0};
 const container={getAttribute:k=>k==='data-entity-id'?state.id:null};
 const node={tagName:'INPUT',getAttribute:k=>k==='data-entity-id'?state.id:null,closest:s=>s==='.phoenix-auto-complete-container'?container:s==='.form-item--phoenix'?{innerText:custom&&state.value?warningText:''}:null};
 const input={count:async()=>1,evaluate:async fn=>fn(node),inputValue:async()=>state.value,click:async()=>{state.open=true;state.clicks++;},fill:async value=>{state.fills.push(value);state.value=value;state.query=value;state.id=ghostRestore&&!value?'ghost-id':null;state.selected=null;onFill?.(value,options);}};
 const label={count:async()=>1,click:async()=>{state.open=false;state.blurs++;if(state.pendingCommit){state.pendingCommit=false;state.prematureBlurs++;state.value=state.query;state.id=null;state.selected=null;}else if(rollbackAfterBlur&&state.selected){state.value='Rejected input';state.id=null;state.selected=null;}}};
 const menu={filter(){return this;},count:async()=>state.open?1:0,evaluate:async()=>options.map(o=>({...o,selected:markers&&state.selected===o.label})),locator:()=>({filter:({hasText})=>{const matches=options.filter(o=>hasText.test(o.label));return {count:async()=>targetCounts.length?targetCounts[Math.min(state.targetReads++,targetCounts.length-1)]:matches.length,click:async()=>{state.optionClicks++;const commit=()=>{state.pendingCommit=false;state.selected=matches[0].label;state.value=matches[0].label;state.id=exposeId?matches[0].value:null;state.open=false;};if(commitDelayMs||neverCommit){state.pendingCommit=true;if(!neverCommit)setTimeout(()=>{if(state.pendingCommit)commit();},commitDelayMs);}else commit();}};}})};
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

test('asynchronous candidate commit must render the exact label before blur can roll back a stale query',async()=>{
 const f=fixture({commitDelayMs:70}),r=await performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text);assert.equal(r.searchableCommit.currentSelection.kind,'entity_id');assert.equal(f.state.value,text);assert.equal(f.state.optionClicks,1);assert.equal(f.state.prematureBlurs,0);assert.equal(f.state.pendingCommit,false);
});
test('candidate-label input without a committed entity never becomes successful selection',async()=>{
 const f=fixture({neverCommit:true});await assert.rejects(performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text),error=>{assert.equal(error.message,'AUTOCOMPLETE_COMMIT_NOT_VERIFIED');assert.equal(error.details.phase,'after_option_click');assert.equal(error.details.valueMatches,true);assert.match(error.details.expectedValueHash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(error.details).includes('Example'),false);return true;});assert.equal(f.state.optionClicks,1);assert.equal(f.state.id,null);assert.equal(f.state.blurs,1);assert.equal(f.state.open,false);
});
test('recall query converges to the real candidate before one click and still requires current ID',async()=>{
 const f=fixture(),r=await performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text);
 assert.deepEqual(f.state.fills,['Example',text]);assert.equal(f.state.optionClicks,1);assert.equal(r.searchableCommit.currentSelection.value,'school-id');
 const lost=fixture({exposeId:false});await assert.rejects(performPhoenixAutocomplete(lost.adapter,{...action,query:'Example'},text),/CURRENT_SELECTION_PROOF_REQUIRED/);assert.equal(lost.state.optionClicks,1);
});
test('candidate identity changes during full-label convergence reject before any option click',async()=>{
 const f=fixture({onFill:(value,options)=>{if(value===text)options[0].value='different-id';}});
 await assert.rejects(performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text),/ACTUAL_CAPTURED_OPTION_REQUIRED/);assert.equal(f.state.optionClicks,0);
});
test('post-blur rollback and independent verification failure are reported in distinct phases',async()=>{
 const f=fixture({rollbackAfterBlur:true});await assert.rejects(performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text),error=>{assert.equal(error.message,'AUTOCOMPLETE_COMMIT_NOT_VERIFIED');assert.equal(error.details.phase,'after_blur');assert.equal(error.details.valueMatches,false);return true;});
 const lost=fixture({initial:text,exposeId:false,markers:false});await assert.rejects(performPhoenixAutocomplete(lost.adapter,{...action,method:'phoenix_autocomplete_verify'},text),error=>{assert.equal(error.message,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');assert.equal(error.details.phase,'independent_verify');assert.equal(error.details.valueMatches,true);assert.equal(JSON.stringify(error.details).includes(text),false);return true;});assert.equal(lost.state.optionClicks,0);assert.deepEqual(lost.state.fills,[]);
});

test('candidate resolution waits through a transient exact-locator rerender before clicking once',async()=>{
 const f=fixture({targetCounts:[0,0,1]}),r=await performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text);assert.equal(r.searchableCommit.currentSelection.kind,'entity_id');assert.equal(f.state.optionClicks,1);assert.ok(f.state.targetReads>=5);
});
function candidateSampler({visibleTargetCount=1,query='Example',records=[{label:text,value:'school-id',valueAttribute:'data-id',disabled:false}],menuCount=1}={}){
 let clock=0,clicks=0;const target={click:async()=>{clicks++;}},read=async()=>({queryBefore:query,queryAfter:query,menuCount,records,visibleTargetCount,target});
 return {read,target,now:()=>clock,sleep:async ms=>{clock+=ms;},clicks:()=>clicks};
}
test('persistent missing or ambiguous exact candidates remain rejected at the bounded deadline',async()=>{
 for(const visibleTargetCount of [0,2]){const f=candidateSampler({visibleTargetCount});await assert.rejects(waitForAutocompleteCandidate({...f,query:'Example',expectedLabel:text,expectedOptionValue:'school-id',allowedOptions:[text],timeoutMs:120,stableMs:60,pollMs:20}),error=>{assert.equal(error.message,'CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');assert.deepEqual(error.details,{candidateCount:1,exactCandidateCount:1,visibleTargetCount});return true;});assert.equal(f.clicks(),0);}
});
test('candidate stability requires applied query, unique actual exact record and unchanged ID/disabled contract',async()=>{
 const variants=[{query:'Other'}, {records:[{label:text,value:'wrong',disabled:false}]}, {records:[{label:text,value:'school-id',disabled:true}]}, {records:[{label:text,value:'school-id'},{label:text,value:'school-id'}]}, {menuCount:2}];
 for(const variant of variants){const f=candidateSampler(variant);await assert.rejects(waitForAutocompleteCandidate({...f,query:'Example',expectedLabel:text,expectedOptionValue:'school-id',allowedOptions:[text],timeoutMs:120,stableMs:60,pollMs:20}));assert.equal(f.clicks(),0);}
 const stable=candidateSampler();const r=await waitForAutocompleteCandidate({...stable,query:'Example',expectedLabel:text,expectedOptionValue:'school-id',allowedOptions:[text],timeoutMs:120,stableMs:60,pollMs:20});assert.equal(r.target,stable.target);assert.ok(stable.now()>=60);assert.equal(stable.clicks(),0);
});
test('preclick rejection reports candidate_resolution with only hashes, booleans and bounded counts',async()=>{
 const f=fixture({targetCounts:[0]});await assert.rejects(performPhoenixAutocomplete(f.adapter,{...action,query:'Example'},text),error=>{assert.equal(error.message,'CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');assert.equal(error.details.phase,'candidate_resolution');assert.equal(error.details.candidateCount,1);assert.equal(error.details.exactCandidateCount,1);assert.equal(error.details.visibleTargetCount,0);assert.match(error.details.expectedValueHash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(error.details).includes('Example'),false);return true;});assert.equal(f.state.optionClicks,0);assert.equal(f.state.blurs,1);assert.equal(f.state.open,false);
});

test('a restored same-text query is reapplied through the input before resolving and clicking a real candidate',async()=>{const rows=[];const f=fixture({initial:text,options:rows,onFill:(_,options)=>{if(!options.length)options.push({label:text,value:'school-id',valueAttribute:'data-id',disabled:false});}});const r=await performPhoenixAutocomplete(f.adapter,action,text);assert.deepEqual(f.state.fills,[text]);assert.equal(f.state.optionClicks,1);assert.equal(r.searchableCommit.currentSelection.value,'school-id');});

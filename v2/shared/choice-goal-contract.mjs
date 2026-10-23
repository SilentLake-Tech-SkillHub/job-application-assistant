import {createHash} from 'node:crypto';
import {rankChoices,resolveObservedChoice} from './choice-resolution.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const types=new Set(['dropdown','radio','multiselect','searchable_text']);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;

function currentResolution(profile,factKey,choice,stored){
 if(stored.factKey!==factKey||!equal(stored.sourceValue,profile.facts[factKey].value)||
    stored.captureId&&stored.captureId!==choice.captureId||stored.selector&&stored.selector!==choice.selector||
    stored.choicesId&&stored.choicesId!==choice.choicesId)throw Error('CHOICE_RESOLUTION_STALE');
 const ranked=rankChoices(profile,factKey,choice.options||[]);
 if(ranked.selection!==stored.selectedOption&&(stored.method!=='agent_semantic_review'||!nonempty(stored.evidence)))throw Error('CHOICE_SEMANTIC_REVIEW_REQUIRED');
 const fresh=resolveObservedChoice({profile,factKey,choice,selectedOption:stored.selectedOption,evidence:stored.evidence});
 if(stored.optionsHash!==fresh.optionsHash||!equal(stored.optionValue,fresh.optionValue)||
    !equal(stored.optionValueAttribute,fresh.optionValueAttribute)||stored.majorPolicyHash!==fresh.majorPolicyHash)throw Error('CHOICE_RESOLUTION_STALE');
 return fresh;
}

function customEvidence(choice,factKey,fact,capture,sourceHash){
 const goal=choice.goal;
 if(!nonempty(fact.value)||choice.restored!==true||choice.options?.length||choice.status!=='captured_empty_search'||
    !['observed_no_results','observed_custom_value'].includes(goal?.decision)||goal.factKey!==factKey||goal.sourceHash!==sourceHash||
    goal.captureId!==capture.captureId||goal.selector!==choice.selector||!nonempty(choice.customValueEvidence))return null;
 const attempt=goal.attempts?.find(a=>a.query===fact.value&&a.queryApplied===true&&a.status==='captured_empty_search'&&
   Array.isArray(a.options)&&a.options.length===0&&Array.isArray(a.emptyEvidence)&&a.emptyEvidence.some(nonempty));
 return attempt?{mode:'explicit_custom_value',query:attempt.query,emptyEvidence:attempt.emptyEvidence,customValueEvidence:choice.customValueEvidence}:null;
}

// Construction decisions only. A resolved goal never certifies a UI selection,
// a saved form or submission. Choices must carry their asset's captureId.
export function evaluateChoiceGoals({capture,profile,fields=[],choices=[]}){
 const output=structuredClone(choices),goals=[],blockers=[],nextGoals=[];
 for(const field of fields){
  const factKey=field.source,fact=profile?.facts?.[factKey];
  if(field.userOnly||field.readonly||!types.has(field.control?.type)||fact?.status!=='known')continue;
  const sourceHash=hash(fact),selectors=field.inventorySelectors||[],captured=selectors.filter(s=>capture?.controls?.some(c=>c.selector===s));
  const matches=output.filter(c=>captured.includes(c.selector));
  const base={fieldId:field.id,factKey,sourceHash,captureId:capture?.captureId||null,inventorySelectors:[...selectors],selector:captured[0]||null,executionVerified:false};
  const block=(reason,nextTool='form_search_choices',extra={})=>{
   goals.push({...base,status:'blocked',decision:'unresolved',reason,...extra});
   blockers.push({id:field.id,fieldId:field.id,label:field.label,factKey,selector:base.selector,reason});
   nextGoals.push({...base,nextTool,tool:nextTool,reason});
  };
  if(!capture?.captureId||!captured.length){block('CHOICE_GOAL_CAPTURED_FIELD_REQUIRED','capture_controls');continue;}
  if(!matches.length){block('CHOICE_GOAL_OPTION_CAPTURE_REQUIRED');continue;}
  if(matches.length!==1){block('CHOICE_GOAL_EVIDENCE_AMBIGUOUS','capture_choice_options');continue;}
  const choice=matches[0];base.selector=choice.selector;base.choicesId=choice.choicesId||null;
  if(choice.captureId!==capture.captureId){block('CHOICE_GOAL_CAPTURE_SCOPE_MISMATCH','capture_choice_options');continue;}
  if(choice.restored!==true){block('RESTORED_OPTION_EVIDENCE_REQUIRED','capture_choice_options');continue;}
  const succeed=(decision,details)=>{
   const goal={...base,status:'resolved',decision,...details};goals.push(goal);
   choice.goal={...(choice.goal||{}),...goal};
  };
  if(field.control.type==='searchable_text'){
   const evidence=customEvidence(choice,factKey,fact,capture,sourceHash);
   if(evidence){succeed('observed_custom_value',{evidence});continue;}
  }
  if(choice.status!=='captured'||!Array.isArray(choice.options)||!choice.options.length){block('CHOICE_GOAL_OBSERVED_OPTIONS_REQUIRED');continue;}
  try{
   if(field.control.type==='multiselect'){
    if(!Array.isArray(fact.value)||!fact.value.length||new Set(fact.value).size!==fact.value.length)throw Error('MULTISELECT_ARRAY_SOURCE_REQUIRES_OBSERVED_LABELS');
    if(fact.value.some(v=>typeof v!=='string'||!choice.options.includes(v)))throw Error('MULTISELECT_ARRAY_SOURCE_REQUIRES_OBSERVED_LABELS');
    const selections=fact.value.map(value=>resolveObservedChoice({profile:{...profile,facts:{...profile.facts,[factKey]:{...fact,value}}},factKey,choice,selectedOption:value}));
    succeed('resolved_observed_array',{selections,evidence:{status:choice.status,optionsHash:selections[0].optionsHash}});continue;
   }
   const stored=choice.resolutions?.[factKey],ranked=rankChoices(profile,factKey,choice.options);
   const resolution=stored?currentResolution(profile,factKey,choice,stored):ranked.selection?resolveObservedChoice({profile,factKey,choice}):null;
   if(!resolution){block(ranked.status==='ambiguous_alias'?'CHOICE_GOAL_ALIAS_AMBIGUOUS':'CHOICE_SEMANTIC_RESOLUTION_REQUIRED','form_resolve_choices',{candidates:ranked.candidates});continue;}
   choice.resolutions={...(choice.resolutions||{}),[factKey]:resolution};
   succeed(resolution.method==='known_alias'?'resolved_known_alias':'resolved_semantic_review',{resolution,evidence:{status:choice.status,optionsHash:resolution.optionsHash}});
  }catch(error){
   const reason=/^[A-Z_]+$/.test(error.message)?error.message:'CHOICE_GOAL_RESOLUTION_FAILED';
   block(reason,/STALE|DISABLED|NOT_UNIQUE/.test(reason)?'capture_choice_options':reason.includes('MULTISELECT')?'form_search_choices':'form_resolve_choices');
  }
 }
 return {goals,blockers,choices:output,nextGoals};
}

export function assertChoiceGoalSources(template,profile){
 if(template.evidence?.choiceGoalContract!==1)return true; // Existing sealed assets keep their original contract until rebuilt.
 for(const field of template.pages.flatMap(p=>p.fields)){
  const fact=profile.facts?.[field.source];
  if(field.userOnly||field.readonly||!types.has(field.control?.type)||fact?.status!=='known')continue;
  const goal=field.choiceGoal;
  if(!goal||goal.status!=='resolved'||goal.fieldId!==field.id||goal.factKey!==field.source||goal.captureId!==template.evidence.captureId||!goal.choicesId||goal.sourceHash!==hash(fact))throw Error('CHOICE_GOAL_CURRENT_SOURCE_REQUIRED');
 }
 return true;
}

export async function assertStoredChoiceGoals(template,{store,companyId,profile,required=false}){
 if(template.evidence?.choiceGoalContract!==1){
  if(required&&template.pages.some(p=>p.fields.some(f=>!f.userOnly&&!f.readonly&&types.has(f.control?.type)&&profile.facts?.[f.source]?.status==='known')))throw Error('CHOICE_GOAL_CONTRACT_REQUIRES_REBUILD');
  return true;
 }
 assertChoiceGoalSources(template,profile);
 const capture=await store.get('runs',template.evidence.captureId);
 if(capture.companyId!==companyId||capture.pageUrl!==template.evidence.sourceUrl)throw Error('CHOICE_GOAL_CAPTURE_SCOPE_MISMATCH');
 const fields=template.pages.flatMap(p=>p.fields),choices=[];
 for(const id of new Set(fields.map(f=>f.choiceGoal?.choicesId).filter(Boolean))){
  const asset=await store.get('runs',id);
  if(asset.companyId!==companyId||asset.captureId!==capture.captureId||asset.pageUrl!==capture.pageUrl)throw Error('CHOICE_GOAL_CAPTURE_SCOPE_MISMATCH');
  choices.push(...asset.choices.map(c=>({...c,choicesId:id,captureId:capture.captureId})));
 }
 const current=evaluateChoiceGoals({capture,profile,fields,choices});
 if(current.blockers.length)throw Error('CHOICE_GOAL_INCOMPLETE');
 for(const goal of current.goals)if(hash(fields.find(f=>f.id===goal.fieldId).choiceGoal)!==hash(goal))throw Error('CHOICE_GOAL_EVIDENCE_CHANGED');
 return true;
}

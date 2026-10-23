import {createHash} from 'node:crypto';
import {rankChoices,resolveObservedChoice,mergeObservedChoices} from './choice-resolution.mjs';
import {humanActionReason} from './field-policy.mjs';
import {lookupCompanyForm} from './profile.mjs';
import {planChoiceQueries} from './choice-query.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The caller supplies only a captured field. Search targets always come from
// its current profile mapping; a guessed display string is not a search goal.
export async function discoverMappedChoice({profile,capture,selector,prior=[],inspect,choicesId}){
 const field=capture.controls.find(control=>control.selector===selector);
 if(!field||humanActionReason(field))throw Error('ORDINARY_CAPTURED_CHOICE_REQUIRED');
 const form=lookupCompanyForm(profile,capture.companyId,capture.pageUrl).form,mapping=Object.values(form?.mappings||{}).find(m=>m.selector===selector&&m.active!==false);
 if(!mapping||mapping.factKey.startsWith('unmapped.'))throw Error('CHOICE_GOAL_MAPPING_REQUIRED');
 const factKey=mapping.factKey,fact=profile.facts?.[factKey];
 if(fact?.status!=='known')throw Error('CHOICE_GOAL_KNOWN_FACT_REQUIRED');
 const queryPlan=planChoiceQueries(profile,factKey),queries=queryPlan.steps.map(step=>step.query);
 if(!queries.length)throw Error('CHOICE_GOAL_QUERIES_REQUIRED');
 const goal={factKey,sourceHash:hash(fact),queryPlan,queries,selector,captureId:capture.captureId},attempts=[];let choices=prior.filter(choice=>choice.selector!==selector);
 for(const query of queries){
  const result=await inspect(field,query);
  if(result.restored!==true||!['captured','captured_empty_search','captured_locked_value'].includes(result.status))throw Error('CHOICE_GOAL_OBSERVED_RESULTS_REQUIRED');
  if(result.status==='captured'&&!result.options?.length)throw Error('CHOICE_GOAL_EMPTY_EVIDENCE_REQUIRED');
  if(result.status==='captured_empty_search'&&!result.coverage?.emptyEvidence?.length)throw Error('CHOICE_GOAL_EMPTY_EVIDENCE_REQUIRED');
  attempts.push({query,queryApplied:result.queryApplied===true,status:result.status,options:result.options,emptyEvidence:result.coverage?.emptyEvidence||[]});
  choices=mergeObservedChoices(choices,[{...result,selector,query,queryApplied:result.queryApplied===true,label:field.label}]);
  const choice=choices.find(c=>c.selector===selector),ranked=rankChoices(profile,factKey,result.options||[]);
  choice.goal={...goal,attempts,decision:ranked.selection?'resolved_known_alias':'searching'};
  if(ranked.selection){const resolution=resolveObservedChoice({profile,factKey,choice:{...choice,choicesId,captureId:capture.captureId},selectedOption:ranked.selection});choice.resolutions={...(choice.resolutions||{}),[factKey]:resolution};return {choices,goal:choice.goal,resolution,candidates:ranked.candidates,status:'choice_resolved',executionVerified:false};}
 }
 const choice=choices.find(c=>c.selector===selector),ranked=rankChoices(profile,factKey,choice?.options||[]);
 if(choice)choice.goal={...goal,attempts,decision:ranked.candidates.length?'semantic_review_required':'observed_no_results'};
 return {choices,goal:choice?.goal||{...goal,attempts},candidates:ranked.candidates,status:ranked.candidates.length?'choice_semantic_review_required':'choice_observed_no_results',executionVerified:false};
}

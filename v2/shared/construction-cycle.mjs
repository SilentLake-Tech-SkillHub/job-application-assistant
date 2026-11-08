import {createHash} from 'node:crypto';
import {captureContentHash} from './acquisition-chain.mjs';
import {validateControlContract} from './value-contract.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const constructionCaptureHash=capture=>hash({capture:captureContentHash(capture),repeatGroups:capture.repeatGroups||[]});
export function reviewCompleteness(capture,{reviewedSelectors,findings=[],evidence}){
 const actual=[...new Set(capture.controls.map(c=>c.selector))],reviewed=new Set(reviewedSelectors);
 if(!evidence?.trim()||reviewed.size!==reviewedSelectors.length||actual.some(s=>!reviewed.has(s))||[...reviewed].some(s=>!actual.includes(s)))throw Error('COMPLETE_AGENT_CONTROL_REVIEW_REQUIRED');
 if(findings.some(f=>!f.description?.trim()||f.selector&&!actual.includes(f.selector)))throw Error('AGENT_REVIEW_FINDING_INVALID');
 return {captureHash:constructionCaptureHash(capture),status:findings.length?'needs_backfill':'passed',reviewedSelectors:[...reviewed],findings,evidence,reviewedAt:new Date().toISOString()};
}
export function assertCompleteness(capture,review=capture.completenessReview){
 if(!review||review.captureHash!==constructionCaptureHash(capture)||review.status!=='passed')throw Error('AGENT_COMPLETENESS_REVIEW_REQUIRED');
 reviewCompleteness(capture,review);return review;
}
export function interactionFields(template){return template.pages.flatMap(p=>p.fields).filter(f=>!f.userOnly&&!f.readonly).map(f=>f.id);}
export function assertInteractionEvidence(template,run){
 if(!run||run.operation!=='form_interaction_test'||run.templateHash!==hash(template)||run.companyId!==template.id||run.status!=='verified'||run.browserExecuted!==true)throw Error('VERIFIED_CONTROL_INTERACTION_REQUIRED');
 const fields=interactionFields(template),passed=new Set([...(run.testedFieldIds||[]),...(run.omittedFieldIds||[])]);
 for(const id of run.inactiveFieldIds||[])if(template.pages.some(p=>p.fields.some(f=>f.id===id&&f.when)))passed.add(id);
 if(fields.some(id=>!passed.has(id))||run.failures?.length)throw Error('CONTROL_INTERACTION_INCOMPLETE');
 return run;
}
// Edits are data-only operations on already captured fields. Personal source
// mappings stay with profile_map_questions; each action keeps a captured target.
export function patchCapturedControls(template,capture,{patches=[],repeatSections=[]}){
 const next=structuredClone(template),controls=new Set(capture.controls.flatMap(c=>[c.selector,c.actionSelector,c.readSelector,c.selectedSelector,c.questionSelector].filter(Boolean)));
 const fields=next.pages.flatMap(p=>p.fields);
 for(const patch of patches){
  const field=fields.find(f=>f.id===patch.fieldId);if(!field)throw Error('PATCH_FIELD_NOT_IN_COMPANY_TEMPLATE');
  if(field.userOnly)throw Error('USER_ONLY_CONTROL_PATCH_FORBIDDEN');
  for(const action of patch.actions||[])if(!controls.has(action.selector)||Object.hasOwn(action,'value')||Object.hasOwn(action,'code'))throw Error('PATCH_ACTION_CAPTURE_REQUIRED');
  if(patch.actions)field.actions=structuredClone(patch.actions);
  if(patch.read){if(!controls.has(patch.read.selector))throw Error('PATCH_READBACK_CAPTURE_REQUIRED');field.read={...field.read,...patch.read};}
  validateControlContract(field);
 }
 for(const section of repeatSections){
  const observed=(capture.repeatGroups||[]).filter(g=>(g.sectionKey||g.title)===section);
  if(observed.length!==1)throw Error('PATCH_REPEAT_CAPTURE_REQUIRED');
  const group=observed[0],page=next.pages.find(p=>p.groups?.some(g=>g.id===section||g.sectionKey===section))||next.pages[0];
  page.groups=[...(page.groups||[]).filter(g=>g.id!==section&&g.sectionKey!==section),{id:section,sectionKey:section,selector:group.selector,addSelector:group.addSelector,addLabel:group.addLabel}];
 }
 next.evidence={...next.evidence,sourceUrl:capture.pageUrl,observedAt:capture.observedAt,captureId:capture.captureId};
 next.version++;delete next.construction;
 return next;
}
export function constructionNext({capture,template,interaction}){
 if(!capture?.controls?.length)return {stage:'parse',nextTools:['capture_controls']};
 try{assertCompleteness(capture);}catch{return {stage:'agent_completeness',nextTools:['form_review_completeness']};}
 if(!template)return {stage:'build',nextTools:['form_mapping_candidates','form_build_template']};
 if(interaction&&interaction.templateHash===hash(template)&&interaction.status!=='verified')return {stage:'backfill',nextTools:['form_patch_controls','capture_controls']};
 try{assertInteractionEvidence(template,interaction);}catch{return {stage:'interaction_test',nextTools:['form_test_interactions']};}
 return {stage:'confirm',nextTools:['template_finalize']};
}

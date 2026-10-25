import {materialAudit,effectiveRequired,materialKey} from './business-materials.mjs';
import {projectDateValue} from './value-contract.mjs';
export {controlDOM as observeDOM} from './control-dom.mjs';

export function compileExpected(plan,task) {
  return {pageUrl:task.pageUrl,roleTitle:plan.roleTitle,...(plan.rolePrefix!==undefined?{rolePrefix:plan.rolePrefix,roleSelector:plan.roleSelector}:{}),...(plan.roleIdentity?{roleIdentity:plan.roleIdentity}:{}),contentPolicy:task.contentPolicy,materialAudit:materialAudit(plan.fields,task),groups:plan.groups||[],sections:plan.sections,fields:plan.fields.filter(f=>!f.when||task.values?.[f.when.source]===f.when.equals).map(f=>{
    let value=task.values?.[f.source];const fileSourceSha256=f.kind==='file'?task.files?.[value]?.sha256:null;
    if(f.enumMap && value!==undefined)value=f.enumMap[value];
    if(f.ongoingSource&&task.values?.[f.ongoingSource]===true)value=task.dateRepresentations?.[f.id]?.value||'至今';
    if(f.read.normalize==='phone_cn'&&value!==undefined)value=String(value).replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
    if(f.kind==='date')value=projectDateValue(value,f.precision);
    if(f.kind==='file')value=task.files?.[value]?.displayNames;
    const profileBinding=task.profileFillContext?.fields?.find(field=>field.fieldId===f.id);
    return {id:f.id,label:f.label,...(task.sources?.[f.source]?.datePrecisionGap?{datePrecisionGap:task.sources[f.source].datePrecisionGap}:{}),...(fileSourceSha256?{fileSourceSha256}:{}),...(f.choiceResolution?.choiceRenderer==='phoenix_list_popup'?{choiceRenderer:f.choiceResolution.choiceRenderer,choiceContract:f.choiceResolution.choiceContract,choicePath:f.choiceResolution.optionPath??null,choiceValueAttribute:f.choiceResolution.optionValueAttribute??null}:{}),lockedControl:f.lockedControl||null,searchableCommitRequired:f.control?.type==='searchable_text',profileFillBinding:profileBinding?{contextHash:task.profileFillContext.contextHash,sourceHash:profileBinding.sourceHash}:null,choiceValue:f.choiceResolution?.optionValue??null,selectionDisplayProofAllowed:f.control?.type==='dropdown'&&f.read.kind==='text'&&f.actions?.some(a=>a.method==='phoenix_dropdown')===true,selectionVerificationRequired:f.control?.type==='dropdown'&&!f.read.nativeSelect&&!f.userOnly&&!f.readonly,dateSelectionProofRequired:f.actions?.some(a=>a.method==='phoenix_date')===true,dateRangeProofRequired:f.actions?.some(a=>a.method==='ant_day'&&a.rangePeerSelector)===true,inventoryLabel:f.inventoryLabel,inventoryType:f.inventoryType,kind:f.kind,value,required:effectiveRequired(f,task),sensitive:!!f.sensitive,userOnly:!!f.userOnly,precision:f.precision,allowOngoing:!!f.ongoingSource,omission:task.omissions?.[f.id]};
  })};
}

export function attachInventory(observation,plan,inventory){
  observation.materialDestinationKeys=[...new Set(inventory.map(materialKey).filter(Boolean))];
  observation.inventoryIds=inventory.map(control=>{
    const f=plan.fields.find(f=>(f.inventorySelectors||[f.read.selector]).includes(control.selector));
    return f?.id||`unmapped:${control.selector}`;
  });
  return observation;
}

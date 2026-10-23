import {materialAudit,effectiveRequired} from './business-materials.mjs';
import {projectDateValue} from './value-contract.mjs';
export {controlDOM as observeDOM} from './control-dom.mjs';

export function compileExpected(plan,task) {
  return {pageUrl:task.pageUrl,roleTitle:plan.roleTitle,...(plan.roleIdentity?{roleIdentity:plan.roleIdentity}:{}),contentPolicy:task.contentPolicy,materialAudit:materialAudit(plan.fields,task),groups:plan.groups||[],sections:plan.sections,fields:plan.fields.filter(f=>!f.when||task.values?.[f.when.source]===f.when.equals).map(f=>{
    let value=task.values?.[f.source];
    if(f.enumMap && value!==undefined)value=f.enumMap[value];
    if(f.ongoingSource&&task.values?.[f.ongoingSource]===true)value=task.dateRepresentations?.[f.id]?.value||'至今';
    if(f.read.normalize==='phone_cn'&&value!==undefined)value=String(value).replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
    if(f.kind==='date')value=projectDateValue(value,f.precision);
    if(f.kind==='file')value=task.files?.[value]?.displayNames;
    return {id:f.id,label:f.label,lockedControl:f.lockedControl||null,choiceValue:f.choiceResolution?.optionValue??null,selectionVerificationRequired:f.control?.type==='dropdown'&&!f.read.nativeSelect&&!f.userOnly&&!f.readonly,dateRangeProofRequired:f.actions?.some(a=>a.method==='ant_day'&&a.rangePeerSelector)===true,inventoryLabel:f.inventoryLabel,inventoryType:f.inventoryType,kind:f.kind,value,required:effectiveRequired(f,task),sensitive:!!f.sensitive,userOnly:!!f.userOnly,precision:f.precision,allowOngoing:!!f.ongoingSource,omission:task.omissions?.[f.id]};
  })};
}

export function attachInventory(observation,plan,inventory){
  observation.inventoryIds=inventory.map(control=>{
    const f=plan.fields.find(f=>(f.inventorySelectors||[f.read.selector]).includes(control.selector));
    return f?.id||`unmapped:${control.selector}`;
  });
  return observation;
}

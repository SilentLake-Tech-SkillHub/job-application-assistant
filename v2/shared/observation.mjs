export {controlDOM as observeDOM} from './control-dom.mjs';

export function compileExpected(plan,task) {
  return {pageUrl:task.pageUrl,roleTitle:plan.roleTitle,...(plan.roleIdentity?{roleIdentity:plan.roleIdentity}:{}),contentPolicy:task.contentPolicy,groups:plan.groups||[],sections:plan.sections,fields:plan.fields.filter(f=>!f.when||task.values?.[f.when.source]===f.when.equals).map(f=>{
    let value=task.values?.[f.source];
    if(f.enumMap && value!==undefined)value=f.enumMap[value];
    if(f.ongoingSource&&task.values?.[f.ongoingSource]===true)value='至今';
    if(f.read.normalize==='phone_cn'&&value!==undefined)value=String(value).replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
    if(f.kind==='file')value=task.files?.[value]?.displayNames;
    return {id:f.id,label:f.label,kind:f.kind,value,required:!!f.required,sensitive:!!f.sensitive,userOnly:!!f.userOnly,precision:f.precision,allowOngoing:!!f.ongoingSource,omission:task.omissions?.[f.id]};
  })};
}

export function attachInventory(observation,plan,inventory){
  observation.inventoryIds=inventory.map(control=>{
    const f=plan.fields.find(f=>(f.inventorySelectors||[f.read.selector]).includes(control.selector));
    return f?.id||`unmapped:${control.selector}`;
  });
  return observation;
}

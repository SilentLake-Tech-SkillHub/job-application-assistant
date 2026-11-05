// Local repair: a built form whose controls changed on the company's site is
// updated only where the real fill failed. No REA, no re-capture of other
// controls, and existing mappings, options and record counts stay as they are.
const selectorsOf=field=>field.inventorySelectors||[field.read?.selector];
function moveField(field,from,to){
 const quoted=value=>JSON.stringify(value).slice(1,-1);
 return JSON.parse(JSON.stringify(field).split(quoted(from)).join(quoted(to)));
}
export function repairFields({template,failedIds,controls,mappings=[]}){
 const next=structuredClone(template),fields=next.pages.flatMap(page=>page.fields),repaired=[],unresolved=[];
 const live=new Set(controls.map(control=>control.selector));
 const taken=new Set(fields.flatMap(selectorsOf).filter(Boolean));
 for(const id of failedIds){
  const page=next.pages.find(p=>p.fields.some(f=>f.id===id)),index=page?.fields.findIndex(f=>f.id===id);
  if(!page){unresolved.push({id,reason:'FIELD_NOT_IN_TEMPLATE'});continue;}
  const field=page.fields[index],current=selectorsOf(field);
  if(current.some(selector=>live.has(selector))){repaired.push({id,selector:current[0],moved:false});continue;}
  const open=controls.filter(control=>!taken.has(control.selector)&&control.type===field.inventoryType);
  const chosen=mappings.find(m=>m.fieldId===id)?.selector,picks=chosen?open.filter(c=>c.selector===chosen):open.filter(c=>c.label===field.inventoryLabel);
  if(current.length!==1||picks.length!==1){unresolved.push({id,label:field.inventoryLabel||field.label,reason:picks.length>1?'REPAIR_TARGET_AMBIGUOUS':'REPAIR_TARGET_NOT_FOUND',candidates:open.map(c=>({selector:c.selector,label:c.label}))});continue;}
  page.fields[index]=moveField(field,current[0],picks[0].selector);
  taken.delete(current[0]);taken.add(picks[0].selector);
  repaired.push({id,from:current[0],selector:picks[0].selector,moved:true});
 }
 return {template:next,repaired,unresolved};
}

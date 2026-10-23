// Compare captured question semantics as well as position. The same selector
// can point at a different question after a site edit or résumé reparse.
export function controlContractChanges(plan,inventory){
 const changes=[];
 for(const c of inventory){
  const f=plan.fields.find(f=>(f.inventorySelectors||[f.read.selector]).includes(c.selector));
  if(!f){changes.push({selector:c.selector,reason:'unmapped'});continue;}
  if(f.inventoryLabel!==undefined&&f.inventoryLabel!==c.label||f.inventoryType!==undefined&&f.inventoryType!==c.type||!!f.required!==!!c.required)
   changes.push({id:f.id,selector:c.selector,reason:'question_type_label_or_requirement_changed'});
  if(f.inventoryDisabled!==undefined&&!!f.inventoryDisabled!==!!c.disabled)changes.push({id:f.id,selector:c.selector,reason:'disabled_state_changed'});
 }
 return changes;
}

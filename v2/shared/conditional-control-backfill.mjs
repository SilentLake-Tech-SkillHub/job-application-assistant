import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Reuse only a captured conditional question whose old and new locators were
// compared against the same live DOM while that branch was selected.
export function conditionalControlBackfill({capture,previous,probe,mappings=[]}){
 const empty={controls:[],obsoleteSelectors:[],mappings:[]},template=previous.find(template=>hash(template)===probe?.templateHash);
 if(!template||probe.operation!=='internal_condition_probe'||probe.restoration!=='verified'||probe.companyId!==capture.companyId||probe.pageUrl!==capture.pageUrl||probe.pageId!==capture.pageId||probe.browserBinding?.generation!==capture.visualPage?.generation||probe.browserBinding?.sessionId!==capture.visualPage?.sessionId)return empty;
 const fields=template.pages.flatMap(page=>page.fields),baseline=new Set(capture.controls.map(control=>control.selector)),controls=new Map(),obsolete=new Set(),updates=[];
 for(const branch of probe.branches||[]){
  const parent=fields.find(field=>field.source===branch.source&&field.kind==='choice'&&field.control.options?.includes(branch.value));
  if(!parent||branch.selected!==true||branch.roleMatched!==true)continue;
  const expected=fields.filter(field=>field.when?.source===branch.source&&field.when.equals===branch.value);
  for(const control of branch.inventory||[]){
   if(baseline.has(control.selector))continue;
   const aliases=(branch.selectorEquivalences||[]).filter(pair=>pair.reference===control.selector).map(pair=>pair.selector);
   const prior=expected.filter(field=>field.inventoryLabel===control.label&&field.inventoryType===control.type&&!!field.required===!!control.required&&field.inventorySelectors.some(selector=>selector===control.selector||aliases.includes(selector)));
   if(!prior.length||new Set(prior.map(field=>field.source)).size!==1)continue;
   const when={source:branch.source,equals:branch.value},old=controls.get(control.selector);
   if(old&&JSON.stringify(old.when)!==JSON.stringify(when))throw Error('CONDITIONAL_CONTROL_SCOPE_AMBIGUOUS');
   controls.set(control.selector,{...control,when});
   for(const selector of aliases)if(selector!==control.selector)obsolete.add(selector);
   const key=hash({selector:control.selector,label:control.label}).slice(0,20),mapping=mappings.find(mapping=>mapping.selector===control.selector);
   if(mapping&&mapping.factKey!==prior[0].source&&(mapping.factKey.startsWith('unmapped.')||mapping.mappingEvidence==='Observed exact role-material question semantic'))updates.push({questionId:key,factKey:prior[0].source});
  }
 }
 return {controls:[...controls.values()],obsoleteSelectors:[...obsolete],mappings:updates};
}

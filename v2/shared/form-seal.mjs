import {createHash} from 'node:crypto';
import {validateControlContract} from './value-contract.mjs';
import {templateConstructionIssues} from './field-policy.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// An imported model-authored asset cannot certify its own execution readiness.
export function unsealedTemplate(template){
 const t=structuredClone(template);
 t.coverage={...t.coverage,allConditionalBranchesVerified:false,allControlsMapped:false,allDriversSupported:false};
 delete t.coverage.proof;
 t.validation={livePassed:false};return t;
}
export function sealFormTemplate(template,probe,{companyId,profileMapped,channel}){
 if(templateConstructionIssues(template).length)throw Error('FORM_CONSTRUCTION_GAPS_REQUIRE_REPAIR');
 if(probe.operation!=='internal_condition_probe'||probe.companyId!==companyId||probe.templateHash!==digest(template)||probe.status!=='verified'||probe.restoration!=='verified'||!probe.branches?.length||probe.branches.some(b=>b.status!=='verified'||b.newQuestions!==0))throw Error('VERIFIED_CONDITION_PROOF_REQUIRED');

 const allFields=template.pages.flatMap(p=>p.fields),dependencies=[...new Set(allFields.map(f=>f.when?.source).filter(Boolean))];
 const expected=dependencies.length?dependencies.flatMap(source=>{
  const parents=allFields.filter(f=>f.source===source);if(parents.length!==1||!parents[0].control?.options?.length)throw Error('SEAL_INVALID_CONDITION_PARENT');
  return parents[0].control.options.map(value=>JSON.stringify([source,value]));
 }):[JSON.stringify(['__baseline__',null])];
 const actual=probe.branches.map(b=>JSON.stringify([b.source,b.value]));
 if(new Set(actual).size!==actual.length||JSON.stringify([...expected].sort())!==JSON.stringify([...actual].sort())||probe.branches.some(b=>b.selected!==true||b.roleMatched!==true||b.conditionFieldsMatched!==true))throw Error('SEAL_INCOMPLETE_BRANCH_PROOF');
 if(!profileMapped)throw Error('FORM_PROFILE_MAPPING_INCOMPLETE');
 const fields=template.pages.flatMap(p=>p.fields),controls=probe.branches.flatMap(b=>b.inventory||[]);
 for(const c of controls)if(!fields.some(f=>f.inventorySelectors?.includes(c.selector)&&f.inventoryLabel===c.label&&f.inventoryType===c.type&&!!f.required===!!c.required))throw Error('SEAL_HAS_UNMAPPED_CONTROL');
 for(const f of fields){validateControlContract(f);if(!f.userOnly&&!controls.some(c=>f.inventorySelectors?.includes(c.selector)))throw Error('SEAL_FIELD_NOT_OBSERVED');if((f.actions||[]).some(a=>a.method==='upload')&&channel==='iab')throw Error('IAB_UPLOAD_DRIVER_NOT_AVAILABLE');}
 const result=structuredClone(template);result.version++;
 result.coverage={...result.coverage,allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true,proof:{runId:probe.id,sourceTemplateHash:probe.templateHash,probeScope:probe.scope||'declared_conditions',restoration:probe.restoration,completedAt:probe.finishedAt}};
 result.validation={livePassed:false};return result;
}

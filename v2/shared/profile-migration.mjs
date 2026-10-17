import {hash} from './engine.mjs';
import {formLocation} from './profile.mjs';
// Retired page-position identities are historical observations, not current
// coverage requirements. Keep their facts and audit trail, and only retire
// them after the replacement form has a genuine complete restored UI probe.
export function retireLegacyQuestionMappings(profile,{companyId,template,probe}){
 if(probe.operation!=='internal_condition_probe'||probe.companyId!==companyId||probe.templateHash!==hash(template)||probe.status!=='verified'||probe.restoration!=='verified'||!probe.branches?.length||probe.branches.some(b=>b.status!=='verified'||b.newQuestions!==0))throw Error('VERIFIED_MIGRATION_PROOF_REQUIRED');
 const key=hash({companyId,pageUrl:formLocation(template.evidence.sourceUrl)}).slice(0,20),form=profile.companyForms?.[key];
 if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');
 const observed=new Set(probe.branches.flatMap(b=>(b.inventory||[]).map(c=>c.selector)));
 const planned=new Set(template.pages.flatMap(p=>p.fields.flatMap(f=>f.inventorySelectors||[f.read.selector])));
 if([...observed].some(s=>!planned.has(s)))throw Error('MIGRATION_HAS_UNMAPPED_CURRENT_CONTROL');
 const retired=[];
 for(const [id,m]of Object.entries(form.mappings)){
  const obsolete=!m.selector||/^\s*body\s*>/i.test(m.selector)&&/:nth-(?:of-type|child)\(/.test(m.selector);
  if(m.active!==false||!m.coverageRequired||!obsolete||observed.has(m.selector)||planned.has(m.selector))continue;
  m.coverageRequired=false;m.retiredBy={probeRunId:probe.id,templateHash:probe.templateHash,reason:'superseded_page_position_identity',at:probe.finishedAt};retired.push(id);
 }
 return {retired:retired.length,questionIds:retired,factsDeleted:0};
}

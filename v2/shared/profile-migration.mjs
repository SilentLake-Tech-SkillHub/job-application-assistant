import {hash} from './engine.mjs';
import {lookupCompanyForm} from './profile.mjs';
// Reconcile superseded locator mappings only after complete restored UI proof.
// Preserve canonical facts; retain only the current question mapping.
export function retireLegacyQuestionMappings(profile,{companyId,template,probe}){
 if(probe.operation!=='internal_condition_probe'||probe.companyId!==companyId||probe.templateHash!==hash(template)||probe.status!=='verified'||probe.restoration!=='verified'||!probe.branches?.length||probe.branches.some(b=>b.status!=='verified'||b.newQuestions!==0))throw Error('VERIFIED_MIGRATION_PROOF_REQUIRED');
 const {form}=lookupCompanyForm(profile,companyId,template.evidence.sourceUrl,{migrate:true});
 if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');
 const observed=new Set(probe.branches.flatMap(b=>(b.inventory||[]).map(c=>c.selector)));
 const planned=new Set(template.pages.flatMap(p=>p.fields.flatMap(f=>f.inventorySelectors||[f.read.selector])));
 if([...observed].some(s=>!planned.has(s)))throw Error('MIGRATION_HAS_UNMAPPED_CURRENT_CONTROL');
 const retired=[];
 for(const [id,m]of Object.entries(form.mappings)){
  const replacements=template.pages.flatMap(p=>p.fields).filter(f=>f.source===m.factKey&&(f.inventorySelectors||[f.read.selector]).some(s=>observed.has(s)));
  const replaced=m.status==='mapped'&&replacements.length===1;
  const obsolete=replaced||!m.selector||/^\s*body\s*>/i.test(m.selector)&&/:nth-(?:of-type|child)\(/.test(m.selector);
  if(m.active!==false||!m.coverageRequired||!obsolete||observed.has(m.selector)||planned.has(m.selector))continue;
  delete form.mappings[id];retired.push(id);
 }
 return {retired:retired.length,questionIds:retired,factsDeleted:0};
}

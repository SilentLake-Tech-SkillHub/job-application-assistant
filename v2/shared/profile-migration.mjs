import {hash} from './engine.mjs';
import {scopeOf} from './repeat-groups.mjs';
import {lookupCompanyForm} from './profile.mjs';
const semanticQuestion=selector=>{try{if(!selector?.startsWith('phoenixq:'))return null;const ref=JSON.parse(selector.slice(9));return typeof ref.section==='string'&&typeof ref.label==='string'?{section:ref.section,label:ref.label}:null;}catch{return null;}};
// Reconcile superseded locator mappings only after complete restored UI proof.
// Preserve canonical facts; retain only the current question mapping.
export function retireLegacyQuestionMappings(profile,{companyId,template,probe}){
 if(probe.operation!=='internal_condition_probe'||probe.companyId!==companyId||probe.templateHash!==hash(template)||probe.status!=='verified'||probe.restoration!=='verified'||!probe.branches?.length||probe.branches.some(b=>b.status!=='verified'||b.newQuestions!==0))throw Error('VERIFIED_MIGRATION_PROOF_REQUIRED');
 const {form}=lookupCompanyForm(profile,companyId,template.evidence.sourceUrl,{migrate:true});
 if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');
 const observed=new Set(probe.branches.flatMap(b=>(b.inventory||[]).map(c=>c.selector)));
 const planned=new Set(template.pages.flatMap(p=>p.fields.flatMap(f=>f.inventorySelectors||[f.read.selector])));
 if([...observed].some(s=>!planned.has(s)))throw Error('MIGRATION_HAS_UNMAPPED_CURRENT_CONTROL');
 const observedRecords=new Set([...observed].map(scopeOf).filter(Boolean).map(scope=>JSON.stringify(scope)));
 const retired=[];
 const aliases=probe.selectorEquivalences;
 if(aliases&&(aliases.companyId!==companyId||aliases.pageUrl!==template.evidence.sourceUrl||aliases.templateHash!==hash(template)))throw Error('SELECTOR_EQUIVALENCE_SCOPE_MISMATCH');
 for(const [id,m]of Object.entries(form.mappings)){
  let replacements=template.pages.flatMap(p=>p.fields).filter(f=>f.source===m.factKey&&(f.inventorySelectors||[f.read.selector]).some(s=>observed.has(s)));
  // One fact may answer distinct questions (e.g. job title and duties). Only
  // an observed semantic section/label can disambiguate their replacements.
  const old=semanticQuestion(m.selector);
  if(replacements.length>1&&old)replacements=replacements.filter(f=>(f.inventorySelectors||[f.read.selector]).some(s=>{const current=semanticQuestion(s);return observed.has(s)&&current?.section===old.section&&current.label===old.label;}));
  const replaced=m.status==='mapped'&&replacements.length===1;
  const equivalent=aliases?.pairs?.some(pair=>pair.selector===m.selector&&observed.has(pair.reference)&&planned.has(pair.reference));
  const record=scopeOf(m.selector);
  const removedFromObservedRecord=record&&observedRecords.has(JSON.stringify(record));
  const obsolete=equivalent||replaced||removedFromObservedRecord||!m.selector||/^\s*body\s*>/i.test(m.selector)&&/:nth-(?:of-type|child)\(/.test(m.selector);
  if(m.active!==false||!m.coverageRequired||!obsolete||observed.has(m.selector)||planned.has(m.selector))continue;
  delete form.mappings[id];retired.push(id);
 }
 return {retired:retired.length,questionIds:retired,factsDeleted:0};
}

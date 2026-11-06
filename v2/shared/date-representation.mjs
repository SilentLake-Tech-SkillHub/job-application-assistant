import {lookupCompanyForm} from './profile.mjs';
import {validDate} from './value-contract.mjs';
import {createHash} from 'node:crypto';
export function supportsOngoing(field){return (field.actions||[]).some(a=>a.method==='phoenix_date'&&!!a.ongoingSelector||['phoenix_date','ant_day','ud_date','feishu_month'].includes(a.method)&&a.ongoingLabel==='至今');}
// Portal presentation is distinct from a real project end date. The value is
// stored once as a sourced private fact and limited to explicitly approved ends.
// It belongs to the company's form: another role on that form uses it too.
export function resolveDateRepresentation(profile,{companyId,pageUrl},field){
 const ongoing=profile.facts?.[field.ongoingSource];
 if(ongoing?.status==='known'&&ongoing.value===true&&supportsOngoing(field))return null;
 const policy=lookupCompanyForm(profile,companyId,pageUrl).form?.ongoingDateRepresentation;
 if(!policy||!policy.endSources?.includes(field.source))return null;
 const mismatches={mode:policy.mode!=='as_of_date',companyId:policy.companyId!==companyId,sourceId:!profile.sources?.[policy.sourceId]};
 if(Object.values(mismatches).some(Boolean)){
  const absent=value=>value===undefined||value===null||value==='';
  const missing={mode:absent(policy.mode),companyId:absent(companyId)||absent(policy.companyId),sourceId:absent(policy.sourceId)||!profile.sources?.[policy.sourceId]};
  const error=Error('DATE_REPRESENTATION_SCOPE_MISMATCH');
  error.details={mismatchedFields:Object.keys(mismatches).filter(key=>mismatches[key]),missingFields:Object.keys(missing).filter(key=>missing[key]),recovery:'核对既有日期表达的 mode/companyId/sourceId。本错误不涉及获奖日期精度，不要求用户重新提供日期。'};
  throw error;
 }
 const fact=profile.facts[policy.source];
 if(fact?.status!=='known'||!fact.sourceIds?.includes(policy.sourceId)||!validDate(fact.value,'day'))throw Error('SOURCED_DATE_REPRESENTATION_REQUIRED');
 return {mode:'as_of_date',value:fact.value,source:policy.source,sourceIds:fact.sourceIds,policyHash:createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
}

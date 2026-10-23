import {lookupCompanyForm} from './profile.mjs';
import {validDate} from './value-contract.mjs';
import {createHash} from 'node:crypto';
// Portal presentation is distinct from a real project end date. The value is
// stored once as a sourced private fact and limited to explicitly approved ends.
export function resolveDateRepresentation(profile,{companyId,pageUrl,roleId},field){
 const policy=lookupCompanyForm(profile,companyId,pageUrl).form?.ongoingDateRepresentation;
 if(!policy||!policy.endSources?.includes(field.source))return null;
 const mismatches={mode:policy.mode!=='as_of_date',companyId:policy.companyId!==companyId,pageUrl:policy.pageUrl!==pageUrl,roleId:String(policy.roleId)!==String(roleId),sourceId:!profile.sources?.[policy.sourceId]};
 if(Object.values(mismatches).some(Boolean)){
  const absent=value=>value===undefined||value===null||value==='';
  const missing={mode:absent(policy.mode),companyId:absent(companyId)||absent(policy.companyId),pageUrl:absent(pageUrl)||absent(policy.pageUrl),roleId:absent(roleId)||absent(policy.roleId),sourceId:absent(policy.sourceId)||!profile.sources?.[policy.sourceId]};
  const error=Error('DATE_REPRESENTATION_SCOPE_MISMATCH');
  error.details={mismatchedFields:Object.keys(mismatches).filter(key=>mismatches[key]),missingFields:Object.keys(missing).filter(key=>missing[key]),recovery:'核对原岗位当前页面身份与既有日期表达的 mode/companyId/pageUrl/roleId/sourceId 绑定。缺少岗位身份时，依据原岗当前页面的真实身份证据补齐 page.roleIdentity 后重新验证，不推断 roleId。本错误不涉及获奖日期精度，不要求用户重新提供日期。'};
  throw error;
 }
 const fact=profile.facts[policy.source];
 if(fact?.status!=='known'||!fact.sourceIds?.includes(policy.sourceId)||!validDate(fact.value,'day'))throw Error('SOURCED_DATE_REPRESENTATION_REQUIRED');
 return {mode:'as_of_date',value:fact.value,source:policy.source,sourceIds:fact.sourceIds,policyHash:createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
}

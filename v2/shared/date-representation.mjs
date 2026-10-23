import {lookupCompanyForm} from './profile.mjs';
import {validDate} from './value-contract.mjs';
import {createHash} from 'node:crypto';
// Portal presentation is distinct from a real project end date. The value is
// stored once as a sourced private fact and limited to explicitly approved ends.
export function resolveDateRepresentation(profile,{companyId,pageUrl,roleId},field){
 const policy=lookupCompanyForm(profile,companyId,pageUrl).form?.ongoingDateRepresentation;
 if(!policy||!policy.endSources?.includes(field.source))return null;
 if(policy.mode!=='as_of_date'||policy.companyId!==companyId||policy.pageUrl!==pageUrl||String(policy.roleId)!==String(roleId)||!profile.sources?.[policy.sourceId])throw Error('DATE_REPRESENTATION_SCOPE_MISMATCH');
 const fact=profile.facts[policy.source];
 if(fact?.status!=='known'||!fact.sourceIds?.includes(policy.sourceId)||!validDate(fact.value,'day'))throw Error('SOURCED_DATE_REPRESENTATION_REQUIRED');
 return {mode:'as_of_date',value:fact.value,source:policy.source,sourceIds:fact.sourceIds,policyHash:createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
}

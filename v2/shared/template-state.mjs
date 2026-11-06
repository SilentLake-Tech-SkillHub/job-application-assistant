import {wasBuilt} from './template-validation.mjs';
const result=(reason,blockers=[])=>({status:reason==='available'?'sealed':'unsealed',reason,route:({available:'reuse',real_fill_failure:'incremental',never_built:'acquire'})[reason],blockers});

// Availability and repair metadata belong to the company's own template.
export async function templateState(template){
 if(!template)return result('never_built',['COMPANY_FORM_ASSET_MISSING']);
 if(!wasBuilt(template))return result('never_built',['FORM_BUILD_NOT_COMPLETED']);
 const failed=template.validation?.realFillFailure;
 return failed?.fields?.length?result('real_fill_failure',failed.fields):result('available');
}
export async function clearTemplateFailures(store,template){
 if(!template.validation?.realFillFailure)return;
 delete template.validation.realFillFailure;
 await store.put('templates',template.id,template);
}
export async function recordRealFillFailure(store,template,companyId,fields){
 template.validation={...template.validation,realFillFailure:{fields:[...new Set(fields)],at:new Date().toISOString()}};
 await store.put('templates',template.id,template);
}
export async function assertReaRequired({store,template}){
 if(template){const state=await templateState(template);if(state.reason!=='never_built')throw Object.assign(Error('REA_NOT_REQUIRED'),{details:state});}
}

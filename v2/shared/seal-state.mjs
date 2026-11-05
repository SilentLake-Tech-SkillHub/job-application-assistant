import {wasBuilt} from './form-seal.mjs';
export const sealKey=t=>'seal-'+t.id;
const result=(reason,blockers=[])=>({status:reason==='available'?'sealed':'unsealed',reason,route:({available:'reuse',real_fill_failure:'incremental',never_built:'acquire'})[reason],blockers});
const read=async(store,group,id)=>{try{return await store.get(group,id);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export const structureBaseline=(structure,capture)=>structure.baselineCapture||capture;
// The record only says the form was built. Nothing re-derives it afterwards.
export async function certifySeal(store,template,companyId){
 const record={id:sealKey(template),operation:'form_seal',formId:template.id,companyId,sealedAt:new Date().toISOString()};
 await store.put('runs',record.id,record);return record;
}
// A form that was built stays usable until a real fill finds the company changed it.
export async function storedSeal(store,template){
 if(!template)return result('never_built',['COMPANY_FORM_ASSET_MISSING']);
 if(!wasBuilt(template))return result('never_built',['FORM_BUILD_NOT_COMPLETED']);
 const failed=(await read(store,'runs',sealKey(template)))?.realFillFailure;
 return failed?.fields?.length?result('real_fill_failure',failed.fields):result('available');
}
export async function recordRealFillFailure(store,template,companyId,fields){
 const previous=await read(store,'runs',sealKey(template));
 await store.put('runs',sealKey(template),{...(previous||{id:sealKey(template),operation:'form_seal',formId:template.id,companyId}),realFillFailure:{fields,at:new Date().toISOString()}});
}
// REA only serves the first build; a built form is repaired locally.
export async function assertReaRequired({store,template}){
 if(template){const state=await storedSeal(store,template);if(state.reason!=='never_built')throw Object.assign(Error('REA_NOT_REQUIRED'),{details:state});}
}

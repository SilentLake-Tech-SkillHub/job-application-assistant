// Form identities are allocated once by code under the profile write lock.
// URLs, content fingerprints and names are values, never storage identities.
export const FORM_CODE=/^F\d{6}$/;
export function formAssetKeys(formId){
 if(!FORM_CODE.test(formId))throw Error('FORM_CODE_REQUIRED');
 return {capture:'capture-'+formId,structure:'form-structure-'+formId,choices:'choices-'+formId,
  receipt:'acquisition-'+formId,draft:'form-draft-'+formId,definition:'definition-'+formId};
}
export function allocateFormCode(profile){
 const used=Object.keys(profile.companyForms||{}).filter(key=>FORM_CODE.test(key)).map(key=>Number(key.slice(1)));
 const previous=Math.max(profile.formCodeSequence||0,0,...used);
 if(!Number.isSafeInteger(previous)||previous>=999999)throw Error('FORM_CODE_SEQUENCE_EXHAUSTED');
 profile.formCodeSequence=previous+1;
 return 'F'+String(profile.formCodeSequence).padStart(6,'0');
}
export function validateFormIdentities(profile){
 for(const [id,form] of Object.entries(profile.companyForms||{})){
  if(!FORM_CODE.test(id)||form.formId!==id||form.companyId!==form.siteId||!/^S\d{4}$/.test(form.siteId)||!/^C\d{5}$/.test(form.companyCode))throw Error('FORM_CODE_MIGRATION_REQUIRED');
 }
 const highest=Math.max(0,...Object.keys(profile.companyForms||{}).map(id=>Number(id.slice(1))));
 if(highest&&(!Number.isSafeInteger(profile.formCodeSequence)||profile.formCodeSequence<highest))throw Error('FORM_CODE_SEQUENCE_REQUIRED');
 return true;
}

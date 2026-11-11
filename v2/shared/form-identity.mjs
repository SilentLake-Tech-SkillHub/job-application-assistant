// Company codes come from the upstream master table. Application assets do not
// allocate a second form/site identity, and URLs remain values rather than keys.
import {keyOK} from './ids.mjs';
export const COMPANY_CODE=/^C\d{5}$/;
export function formAssetKeys(companyId){
 if(!keyOK(companyId))throw Error('COMPANY_CODE_REQUIRED');
 return {capture:'capture-'+companyId,structure:'form-structure-'+companyId,choices:'choices-'+companyId,
  receipt:'acquisition-'+companyId,draft:'form-draft-'+companyId,definition:'definition-'+companyId,visual:'form-visual-'+companyId,coverage:'form-coverage-'+companyId};
}
export function validateFormIdentities(profile){
 for(const [id,form] of Object.entries(profile.companyForms||{})){
  if(!COMPANY_CODE.test(id)||form.formId!==id||form.companyId!==id||form.companyCode!==id)throw Error('COMPANY_CODE_MIGRATION_REQUIRED');
 }
 return true;
}

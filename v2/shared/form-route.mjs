import {storedSeal} from './seal-state.mjs';
import {contractRebuildRequired} from './rebuild-mark.mjs';
import {hash} from './engine.mjs';
export class FormRouter {
 constructor({store,companies,validateTemplate,loadProfile=async()=>null}){Object.assign(this,{store,companies,validateTemplate,loadProfile});}
 async resolve({companyId,roleId,pageUrl}){
  const company=this.companies.find(c=>c.id===companyId);
  if(!company||new URL(pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  const templateId=company.roleTemplates?.[roleId]||company.templateId;
  const out=(state,reason,extra={})=>({companyId,templateId,...state,reasonCode:state.reason,reason,routeCode:state.route,nextStage:state.route==='reuse'?'local_profile_preflight':state.route==='migrate'?'offline_contract_migration':'form_acquisition',recapture:state.route==='reuse'?'none':'missing_or_different_parts',fullAcquisitionRequired:state.route==='acquire',lightweightStructureCheckRequired:state.route==='reuse',browserAccess:false,requiresUser:false,nextTools:state.route==='reuse'?['prepare_plan']:state.route==='migrate'?['form_migrate_contract']:state.route==='incremental'?['capture_controls','form_mapping_candidates','form_build_template']:['capture_rea_structure','form_mapping_candidates','form_build_template'],...extra});
  let template=null;
  if(templateId)try{template=await this.store.get('templates',templateId);}catch(e){if(e.code!=='ENOENT')throw e;}
  let state=await storedSeal(this.store,template,companyId);
  if(!template)return out(state,templateId?'COMPANY_FORM_ASSET_MISSING':'NO_COMPANY_FORM_ASSET');
  if(template.pages.filter(p=>new URL(pageUrl).pathname.startsWith(p.pathPrefix)).length!==1)return out({status:'unsealed',reason:'page_changed',route:'incremental',blockers:['FORM_PATH_NOT_COVERED']},'FORM_PATH_NOT_COVERED');
  if(contractRebuildRequired(await this.loadProfile(),hash(template)))state={status:'unsealed',reason:'page_changed',route:'incremental',blockers:['PROFILE_EXECUTION_CONTRACT_REQUIRES_REBUILD']};
  if(state.status==='sealed')try{this.validateTemplate(template);}catch(e){state={status:'unsealed',reason:'contract_upgrade',route:'migrate',blockers:[e.message]};}
  return out(state,state.route==='reuse'?'COMPANY_FORM_ASSET_AVAILABLE':'COMPANY_FORM_ASSET_'+state.reason.toUpperCase());
 }
}

import {companyContext} from './company-directory.mjs';
import {templateState} from './template-state.mjs';
import {contractRebuildRequired} from './rebuild-mark.mjs';
import {hash} from './engine.mjs';
export class FormRouter {
 constructor({store,companies,validateTemplate,loadProfile=async()=>null,routeTemplate=async t=>t}){Object.assign(this,{store,companies,validateTemplate,loadProfile,routeTemplate});}
 async resolve({companyId,roleId,pageUrl}){
  const company=companyContext(this.companies.find(c=>c.id===companyId),{pageUrl});
  if(!company||new URL(pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  const templateId=company.templateId;
  const out=(state,reason,extra={})=>({companyId,templateId,...state,reasonCode:state.reason,reason,routeCode:state.route,nextStage:state.route==='reuse'?'local_profile_preflight':'form_acquisition',recapture:state.route==='reuse'?'none':'missing_or_different_parts',fullAcquisitionRequired:state.route==='acquire',lightweightStructureCheckRequired:state.route==='reuse',browserAccess:false,requiresUser:false,nextTools:state.route==='reuse'?['prepare_plan']:state.route==='incremental'?['form_repair_fields']:['capture_rea_structure','form_mapping_candidates','form_build_template'],...extra});
  let template=null;
  if(templateId)try{template=await this.store.get('templates',templateId);}catch(e){if(e.code!=='ENOENT')throw e;}
  let state=await templateState(template);
  if(!template)return out(state,templateId?'COMPANY_FORM_ASSET_MISSING':'NO_COMPANY_FORM_ASSET');
  const routed=await this.routeTemplate(template,{companyId,roleId,pageUrl});
  if(routed.pages.filter(p=>new URL(pageUrl).pathname.startsWith(p.pathPrefix)).length!==1)return out({status:'unsealed',reason:'real_fill_failure',route:'incremental',blockers:['FORM_PATH_NOT_COVERED']},'FORM_PATH_NOT_COVERED');
  if(contractRebuildRequired(await this.loadProfile(),hash(template)))return out(
   {status:'unsealed',reason:'real_fill_failure',route:'incremental',blockers:['PROFILE_EXECUTION_CONTRACT_REQUIRES_REBUILD']},
   'COMPANY_FORM_ASSET_REAL_FILL_FAILURE',
   {repairKind:'question_definition',nextTools:['capture_controls','form_mapping_candidates','form_build_template']}
  );
  return out(state,state.route==='reuse'?'COMPANY_FORM_ASSET_AVAILABLE':'COMPANY_FORM_ASSET_'+state.reason.toUpperCase());
 }
}

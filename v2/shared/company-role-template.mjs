import {resolveEntry,matchEntryPath} from './entry-recipe.mjs';
import {rolePageContract} from './role-identity.mjs';
import {samePage} from './page-scope.mjs';
const roleCode=/^J\d{6}$/;

export function roleMatchesPage(role,pageUrl,config){
 if([role.applyUrl,role.url].some(url=>url&&samePage(url,pageUrl)))return true;
 const entry=resolveEntry(config);
 if(entry?.kind==='detail_to_form'&&role.url){
  const source=new URL(role.url),target=new URL(pageUrl);
  return source.origin===target.origin&&matchEntryPath(entry,source.pathname).expectedApplyPath===target.pathname;
 }
 return false;
}
export function selectCompanyRole(roles,{roleId,pageUrl},config){
 const matches=roleId?roles.filter(r=>r.roleId===roleId):roles.filter(r=>roleMatchesPage(r,pageUrl,config));
 if(matches.length!==1)throw Error(roleId?'ROLE_NOT_IN_COMPANY':'ROLE_CODE_REQUIRED');
 return matches[0];
}

export function ensureRoleBindings(template,roles){
 if(template.companyTemplateVersion!==2)throw Error('COMPANY_ROLE_TEMPLATE_MIGRATION_REQUIRED');
 const pageKeys=template.pages.map(p=>p.pageKey),bindings={...template.roleBindings};let changed=false;
 for(const role of roles){
  if(!roleCode.test(role.roleId))throw Error('INVALID_ROLE_CODE');
  if(!bindings[role.roleId]){bindings[role.roleId]={pageKeys:[...pageKeys]};changed=true;}
 }
 return changed?{...template,roleBindings:bindings}:template;
}

// One company owns the controls. A role binding contains references only.
// Capture source URLs remain evidence; no captured job path is executable here.
export function toCompanyRoleTemplate(template,roles){
 if(template.companyTemplateVersion===2)return ensureRoleBindings(template,roles);
 const pages=template.pages.map((page,index)=>{
  const {pathPrefix,sourcePathPrefix,roleTitle,...shared}=page;
  if(shared.roleIdentity){const {value,...identity}=shared.roleIdentity;shared.roleIdentity=identity;}
  return {...shared,pageKey:'page-'+(index+1)};
 });
 return ensureRoleBindings({...template,companyTemplateVersion:2,pages,roleBindings:{}},roles);
}

export function resolveCompanyRoleTemplate(template,{companyId,role,pageUrl},config){
 if(template.id!==companyId||role.companyId&&role.companyId!==companyId)throw Error('ROLE_TEMPLATE_COMPANY_MISMATCH');
 if(template.companyTemplateVersion!==2)throw Error('COMPANY_ROLE_TEMPLATE_MIGRATION_REQUIRED');
 const binding=template.roleBindings?.[role.roleId];
 if(!binding?.pageKeys?.length)throw Error('ROLE_TEMPLATE_BINDING_REQUIRED');
 if(Object.keys(binding).some(key=>key!=='pageKeys'))throw Error('ROLE_BINDING_MUST_SHARE_CONTROLS');
 const target=new URL(pageUrl);if(target.origin!==config.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
 const entry=resolveEntry(config);
 if(entry?.kind==='detail_to_form'&&!roleMatchesPage(role,pageUrl,config))throw Error('ROLE_TEMPLATE_PAGE_MISMATCH');
 const pages=binding.pageKeys.map(pageKey=>{
  const shared=template.pages.find(p=>p.pageKey===pageKey);if(!shared)throw Error('ROLE_TEMPLATE_PAGE_MISSING');
  return rolePageContract({...shared,pathPrefix:target.pathname},{title:role.title,officialId:role.officialId});
 });
 if(pages.length!==1)throw Error('ROLE_PAGE_BINDING_REQUIRES_CAPTURE');
 return {...template,pages};
}

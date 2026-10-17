// Offline company-form lookup. A profile answer gap is not a reason to recapture
// an existing form. An incomplete or incompatible form asset still needs work.
export class FormRouter {
  constructor({store,companies,validateTemplate}) {Object.assign(this,{store,companies,validateTemplate});}
  async resolve({companyId,roleId,pageUrl}) {
    const company=this.companies.find(c=>c.id===companyId);
    if(!company||new URL(pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
    const acquire=(reason,extra={})=>({companyId,route:'acquire',nextStage:'form_acquisition',reason,recapture:'missing_or_different_parts',browserAccess:false,...extra});
    const templateId=company.roleTemplates?.[roleId]||company.templateId;
    if(!templateId)return acquire('NO_COMPANY_FORM_ASSET');
    let template;
    try{template=await this.store.get('templates',templateId);}catch(e){if(e.code!=='ENOENT')throw e;return acquire('COMPANY_FORM_ASSET_MISSING',{templateId});}
    try{this.validateTemplate(template);}catch{return acquire('COMPANY_FORM_ASSET_INVALID',{templateId});}
    const url=new URL(pageUrl),pages=template.pages.filter(p=>url.pathname.startsWith(p.pathPrefix));
    if(pages.length!==1)return acquire('FORM_PATH_NOT_COVERED',{templateId});
    const blockers=['allConditionalBranchesVerified','allControlsMapped','allDriversSupported'].filter(k=>template.coverage?.[k]!==true);
    const legacySelectors=pages.flatMap(p=>p.fields).some(f=>[f.read?.selector,...(f.inventorySelectors||[]),...(f.actions||[]).flatMap(a=>[a.selector,a.labelSelector,a.openSelector])].some(s=>/^\s*(?:html\s*>\s*)?body\s*>/i.test(s||'')&&/:nth-(?:of-type|child)\(/.test(s)));
    if(legacySelectors)blockers.push('PAGE_GLOBAL_POSITIONAL_LOCATORS');
    if(blockers.length)return acquire('COMPANY_FORM_ASSET_INCOMPLETE',{templateId,blockers});
    return {companyId,templateId,route:'reuse',nextStage:'local_profile_preflight',reason:'COMPANY_FORM_ASSET_AVAILABLE',fullAcquisitionRequired:false,lightweightStructureCheckRequired:true,browserAccess:false};
  }
}

import {stableTaskId} from './role-queue.mjs';
import {hash} from './engine.mjs';
import {loadProfile} from './profile.mjs';
import {compileExecutionPlan} from './execution-plan.mjs';
import {attachmentFileDescriptor,attachmentFileMetadata} from './attachment-source-renderer.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const materialPlanId=companyId=>stableTaskId('material-import',companyId);
function capturedPageBinding(capture){const pageId=capture.pageId,binding=capture.browserBinding;if(!pageId||!binding?.sessionId||binding.generation===undefined||binding.generation===null||!binding.pageId||binding.pageUrl!==capture.pageUrl||!['navigation','verified_role'].includes(binding.kind))throw Error('MATERIAL_PAGE_BINDING_REFRESH_REQUIRED');const channel=pageId.match(/^(iab|chrome):/)?.[0],boundId=channel&&!/^(?:iab|chrome):/.test(binding.pageId)?channel+binding.pageId:binding.pageId;if(boundId!==pageId||binding.companyId&&binding.companyId!==capture.companyId)throw Error('MATERIAL_PAGE_BINDING_MISMATCH');return {pageId,browserBinding:{...binding,pageId}};}
async function assertMaterialSource(plan,asset){if(!plan.fileDescriptor||!plan.fileMetadata)throw Error('MATERIAL_PLAN_REFRESH_REQUIRED');let metadata;try{metadata=await attachmentFileMetadata(asset);}catch{throw Error('MATERIAL_SOURCE_UNAVAILABLE');}if(!same(attachmentFileDescriptor(asset),plan.fileDescriptor)||!same(metadata,plan.fileMetadata))throw Error('MATERIAL_INPUT_CHANGED');}
// First-time construction: stage an approved résumé in the portal parser, then
// recapture. This never certifies the resulting application form as complete.
export class MaterialImport{
 constructor({store,browser,profileFile,companies,withCompanyLease}){Object.assign(this,{store,browser,profileFile,companies,withCompanyLease});}
 async inspect({planId,planHash}){
  const plan=await this.store.get('plans',planId),{id,planHash:saved,...body}=plan;
  if(id!==planId||saved!==planHash||hash(body)!==saved)throw Error('MATERIAL_PLAN_CHANGED');
  return this.withCompanyLease(plan.companyId,async()=>{
   const profile=await loadProfile(this.profileFile);await assertMaterialSource(plan,profile.files[plan.ref]);
   if(profile.facts['materials.resume.zh.reference']?.value!==plan.ref)throw Error('MATERIAL_INPUT_CHANGED');
   const page=await this.browser.existingPage(plan.pageUrl,{pageId:plan.pageId,roleBinding:plan.browserBinding});await page.assertLocation(new URL(plan.pageUrl).origin,new URL(plan.pageUrl).pathname);
   const capture=await this.store.get('runs',plan.captureId),inventory=await page.inventory(capture.provider?{provider:capture.provider}:{}),control=inventory.find(control=>control.selector===plan.selector&&control.type==='file');
   if(!control?.uploadContainerSelector||!control.filenameSelector||!control.uploadedSelector)throw Error('UPLOAD_SITE_READBACK_REQUIRED');
   const observed=await page.observe({fields:[{id:'resume',kind:'file',read:{selector:control.uploadContainerSelector,filenameSelector:control.filenameSelector,uploadedSelector:control.uploadedSelector,kind:'files'}}]});
   const portal=observed.fields.resume,expected=plan.fileDescriptor.displayNames,matched=portal?.uploadState==='site_rendered_uploaded'&&same(portal.value,expected);
   const pageHealth=matched?undefined:await page.observe({entryHealth:true});
   let networkErrors;if(!matched)try{networkErrors=await page.act({method:'wait',operation:'recent_network_errors',selector:plan.containerSelector},null,{});}catch{networkErrors={status:'unavailable',errors:[]};}
   return {planId,planHash,companyId:plan.companyId,status:matched?'portal_attachment_ready':'portal_attachment_unverified',portal,expectedFilenames:expected,...(pageHealth?{pageHealth,networkErrors}:{}),fullFormVerified:false,submission:'not_performed',continuation:{state:matched?'construct':'repair',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:matched?['capture_controls','form_capture_visual','capture_rea_structure']:['form_template_audit']}};
  });
 }
 async prepare({companyId,pageUrl,captureId,selector,containerSelector}){
  return this.withCompanyLease(companyId,async()=>{
  const c=this.companies.find(c=>c.id===companyId),capture=await this.store.get('runs',captureId);
  if(!c||new URL(pageUrl).origin!==c.origin||capture.companyId!==companyId||capture.pageUrl!==pageUrl)throw Error('MATERIAL_CAPTURE_SCOPE_MISMATCH');
  const pageBinding=capturedPageBinding(capture);
  if(!capture.controls.some(f=>f.selector===selector&&f.type==='file'))throw Error('CAPTURED_FILE_CONTROL_REQUIRED');
  const p=await loadProfile(this.profileFile),ref=p.facts['materials.resume.zh.reference']?.value;
  if(!ref||p.facts['materials.resume.zh.reference'].status!=='known')throw Error('APPROVED_RESUME_REQUIRED');
  const template={pages:[{pathPrefix:new URL(pageUrl).pathname,fields:[{id:'resume-import',label:'简历附件',source:'materials.resume.zh.reference',kind:'file',required:true,control:{type:'file_upload',valueType:'string',readbackType:'string[]'},actions:[{method:'upload',selector}],read:{selector:containerSelector,kind:'files',filenameSelector:'a',uploadedSelector:containerSelector}}]}]};
  const plan=await compileExecutionPlan(template,{companyId,pageUrl,templateHash:hash(template),values:{'materials.resume.zh.reference':ref},files:p.files});
  const body={companyId,pageUrl,...pageBinding,captureId,captureHash:hash(capture.controls),selector,containerSelector,ref,fileDescriptor:attachmentFileDescriptor(p.files[ref]),fileMetadata:plan.fileMetadata[ref],preflightHash:plan.planHash};const id=materialPlanId(companyId),planHash=hash(body);await this.store.put('plans',id,{id,planHash,...body});return {planId:id,planHash,browserAccess:false,status:'ready_for_material_staging'};
  });
 }
 async run({planId,planHash,authorization,recoverHttp1=false}){
  if(!authorization?.uploads||!authorization.evidence?.trim())throw Error('MATERIAL_UPLOAD_AUTHORIZATION_REQUIRED');
  const {companyId}=await this.store.get('plans',planId);
  if(planId!==materialPlanId(companyId))throw Error('MATERIAL_PLAN_REFRESH_REQUIRED');
  return this.withCompanyLease(companyId,async()=>{
   const plan=await this.store.get('plans',planId),{id,planHash:saved,...body}=plan;
   if(id!==planId||plan.companyId!==companyId||saved!==planHash||hash(body)!==saved)throw Error('MATERIAL_PLAN_CHANGED');
   const p=await loadProfile(this.profileFile),capture=await this.store.get('runs',plan.captureId);const currentBinding=capturedPageBinding(capture);if(!same(currentBinding,{pageId:plan.pageId,browserBinding:plan.browserBinding}))throw Error('MATERIAL_PAGE_BINDING_CHANGED');await assertMaterialSource(plan,p.files[plan.ref]);if(p.facts['materials.resume.zh.reference']?.value!==plan.ref||hash(capture.controls)!==plan.captureHash)throw Error('MATERIAL_INPUT_CHANGED');
   const previousId='material-'+planId;let previous;try{previous=await this.store.get('runs',previousId);}catch(e){if(e.code!=='ENOENT')throw e;}if(!recoverHttp1&&previous&&(previous.planHash===planHash||previous.status!=='input_uploaded_server_unverified'))throw Error('MATERIAL_ATTEMPT_ALREADY_RECORDED');
   const page=await this.browser.existingPage(plan.pageUrl,{pageId:plan.pageId,roleBinding:plan.browserBinding});await page.assertLocation(new URL(plan.pageUrl).origin,new URL(plan.pageUrl).pathname);
   const inventory=await page.inventory({...(capture.provider?{provider:capture.provider}:{})});if(!inventory.some(c=>c.selector===plan.selector&&c.type==='file'))throw Error('MATERIAL_CONTROL_CHANGED');
   const o=await page.observe({fields:[{id:'container',read:{selector:plan.containerSelector,kind:'text'}}],groups:[{id:'target',selector:plan.containerSelector,containsSelector:plan.selector}]});
   const captured=capture.controls.find(control=>control.selector===plan.selector&&control.type==='file');
   const live=inventory.find(control=>control.selector===plan.selector&&control.type==='file');
   const resumeQuestion=control=>control&&/^(?:简历(?:附件)?|resume(?:\s+attachment)?)$/iu.test(control.label?.trim()||'')&&[control.questionSelector,control.uploadContainerSelector].includes(plan.containerSelector);
   const sameResumeQuestion=resumeQuestion(captured)&&resumeQuestion(live)&&captured.label===live.label;
   if(o.groups.target!==1||!sameResumeQuestion&&!/上传文件简历|简历附件|上传简历|将你的简历|Resume/i.test(o.fields.container.value||''))throw Error('MATERIAL_RESUME_CONTAINER_REQUIRED');
   let http1Resource;
   if(recoverHttp1){
    if(!previous||previous.status!=='input_uploaded_server_unverified'||previous.http1RecoveryAttempted)throw Error('MATERIAL_PROTOCOL_RECOVERY_NOT_READY');
    const observed=await page.observe({fields:[{id:'resume',kind:'file',read:{selector:live.uploadContainerSelector,filenameSelector:live.filenameSelector,uploadedSelector:live.uploadedSelector,kind:'files'}}]}),portal=observed.fields.resume;
    if(portal?.uploadState!=='site_rendered_uploaded'||portal.uploadReadback?.pending||same(portal.value,plan.fileDescriptor.displayNames))throw Error('MATERIAL_PROTOCOL_RECOVERY_NOT_READY');
    const errors=await page.act({method:'wait',operation:'recent_network_errors',selector:plan.containerSelector},null,{});
    http1Resource=errors.errors?.find(error=>error.code==='net::ERR_HTTP2_PROTOCOL_ERROR'&&error.resource?.startsWith(new URL(plan.pageUrl).origin+'/')&&!error.resource.includes('[id]'))?.resource;
    if(!http1Resource)throw Error('OBSERVED_HTTP2_UPLOAD_FAILURE_REQUIRED');
   }
   await assertMaterialSource(plan,p.files[plan.ref]);
   const result={id:previousId,planHash,companyId:plan.companyId,pageUrl:plan.pageUrl,startedAt:new Date().toISOString(),status:'upload_attempt_started',...(http1Resource?{http1RecoveryAttempted:true}:{}),submission:'not_performed'};await this.store.put('runs',previousId,result);
   try{const action=await page.act({method:'upload',selector:plan.selector,...(http1Resource?{http1Resource}:{})},plan.ref,{[plan.ref]:attachmentFileDescriptor(p.files[plan.ref])});if(action?.uploadOrigin)result.uploadOrigin=action.uploadOrigin;result.status='input_uploaded_server_unverified';}catch(e){result.status='upload_result_uncertain';result.error=/^[A-Z_]+$/.test(e.message)?e.message:'MATERIAL_UPLOAD_FAILED';}
   result.finishedAt=new Date().toISOString();await this.store.put('runs',previousId,result);return {...result,next:'recapture_all_controls_and_verify_portal_parser_result'};
  });
 }
}

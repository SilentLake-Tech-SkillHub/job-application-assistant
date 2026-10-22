import {randomUUID} from 'node:crypto';
import {hash} from './engine.mjs';
import {loadProfile} from './profile.mjs';
import {compileExecutionPlan} from './execution-plan.mjs';
// First-time construction: stage an approved résumé in the portal parser, then
// recapture. This never certifies the resulting application form as complete.
export class MaterialImport{
 constructor({store,browser,profileFile,companies,withCompanyLease}){Object.assign(this,{store,browser,profileFile,companies,withCompanyLease});}
 async prepare({companyId,pageUrl,captureId,selector,containerSelector}){
  const c=this.companies.find(c=>c.id===companyId),capture=await this.store.get('runs',captureId);
  if(!c||new URL(pageUrl).origin!==c.origin||capture.companyId!==companyId||capture.pageUrl!==pageUrl)throw Error('MATERIAL_CAPTURE_SCOPE_MISMATCH');
  if(!capture.controls.some(f=>f.selector===selector&&f.type==='file'))throw Error('CAPTURED_FILE_CONTROL_REQUIRED');
  const p=await loadProfile(this.profileFile),ref=p.facts['materials.resume.zh.reference']?.value;
  if(!ref||p.facts['materials.resume.zh.reference'].status!=='known')throw Error('APPROVED_RESUME_REQUIRED');
  const template={pages:[{pathPrefix:new URL(pageUrl).pathname,fields:[{id:'resume-import',label:'简历附件',source:'materials.resume.zh.reference',kind:'file',required:true,control:{type:'file_upload',valueType:'string',readbackType:'string[]'},actions:[{method:'upload',selector}],read:{selector:containerSelector,kind:'files',filenameSelector:'a',uploadedSelector:containerSelector}}]}]};
  const plan=await compileExecutionPlan(template,{companyId,pageUrl,templateHash:hash(template),values:{'materials.resume.zh.reference':ref},files:p.files});
  const body={companyId,pageUrl,captureId,captureHash:hash(capture.controls),selector,containerSelector,ref,assetHash:hash(p.files[ref]),preflightHash:plan.planHash};const id=randomUUID(),planHash=hash(body);await this.store.put('plans',id,{id,planHash,...body});return {planId:id,planHash,browserAccess:false,status:'ready_for_material_staging'};
 }
 async run({planId,planHash,authorization}){
  if(!authorization?.uploads||!authorization.evidence?.trim())throw Error('MATERIAL_UPLOAD_AUTHORIZATION_REQUIRED');
  const plan=await this.store.get('plans',planId),{id,planHash:saved,...body}=plan;
  if(id!==planId||saved!==planHash||hash(body)!==saved)throw Error('MATERIAL_PLAN_CHANGED');
  return this.withCompanyLease(plan.companyId,async()=>{
   const p=await loadProfile(this.profileFile),capture=await this.store.get('runs',plan.captureId);if(hash(p.files[plan.ref])!==plan.assetHash||p.facts['materials.resume.zh.reference']?.value!==plan.ref||hash(capture.controls)!==plan.captureHash)throw Error('MATERIAL_INPUT_CHANGED');
   const previousId='material-'+planId;let previous;try{previous=await this.store.get('runs',previousId);}catch(e){if(e.code!=='ENOENT')throw e;}if(previous)throw Error('MATERIAL_ATTEMPT_ALREADY_RECORDED');
   const page=await this.browser.existingPage(plan.pageUrl);await page.assertLocation(new URL(plan.pageUrl).origin,new URL(plan.pageUrl).pathname);
   const inventory=await page.inventory({...(capture.provider?{provider:capture.provider}:{})});if(!inventory.some(c=>c.selector===plan.selector&&c.type==='file'))throw Error('MATERIAL_CONTROL_CHANGED');
   const o=await page.observe({fields:[{id:'container',read:{selector:plan.containerSelector,kind:'text'}}],groups:[{id:'target',selector:plan.containerSelector+':has(:is('+plan.selector+'))'}]});
   if(o.groups.target!==1||!/上传文件简历|简历附件|上传简历|将你的简历|Resume/i.test(o.fields.container.value||''))throw Error('MATERIAL_RESUME_CONTAINER_REQUIRED');
   const result={id:previousId,companyId:plan.companyId,pageUrl:plan.pageUrl,startedAt:new Date().toISOString(),status:'upload_attempt_started',submission:'not_performed'};await this.store.put('runs',previousId,result);
   try{await page.act({method:'upload',selector:plan.selector},plan.ref,p.files);result.status='input_uploaded_server_unverified';}catch(e){result.status='upload_result_uncertain';result.error=/^[A-Z_]+$/.test(e.message)?e.message:'MATERIAL_UPLOAD_FAILED';}
   result.finishedAt=new Date().toISOString();await this.store.put('runs',previousId,result);return {...result,next:'recapture_all_controls_and_verify_portal_parser_result'};
  });
 }
}

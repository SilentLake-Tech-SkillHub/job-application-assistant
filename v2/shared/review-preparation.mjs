import {attachmentFileDescriptor,attachmentFileMetadata} from './attachment-source-renderer.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Called only after exact submission authority and fresh full-form verification.
// A partial write alone is never a reviewed application. Its frozen complete
// plan can, however, bind files after a verified incremental recovery without
// forcing another résumé upload merely to manufacture a full-fill run.
export async function reviewedPreparationFiles({store,state,role,templateHash,files}){
 let frozen;
 if(state.selectedFieldRunId){
  const run=await store.get('runs',state.selectedFieldRunId);
  if(run.operation==='selected_field_prepare'&&run.status==='prepared'&&run.companyId===role.companyId&&run.roleId===role.roleId&&run.pageUrl===state.returnUrl&&run.templateHash===templateHash&&run.planId&&run.fieldIds?.length&&new Set(run.fieldIds).size===run.fieldIds.length&&run.fields?.length===run.fieldIds.length&&new Set(run.fields.map(f=>f.id)).size===run.fieldIds.length&&run.fields.every(f=>run.fieldIds.includes(f.id)&&['matching_current_value','prepared_pending_full_verification'].includes(f.status))){
   const plan=await store.get('plans',run.planId),selected=plan.pages?.flatMap(p=>p.fields).filter(f=>run.fieldIds.includes(f.id));
   const {id,createdAt,planHash,...body}=plan;
   if(id===run.planId&&hash(body)===planHash&&planHash===run.planHash&&plan.companyId===role.companyId&&plan.pageUrl===state.returnUrl&&plan.templateHash===templateHash&&plan.readyForExecution===true&&plan.counts?.needs_user===0&&selected?.length===run.fieldIds.length&&selected.every(f=>f.disposition==='fill'&&!f.sensitive&&!f.userOnly&&['text','choice','date'].includes(f.kind)))frozen=plan;
  }
 }
 if(!frozen&&state.fillRunId){const fill=await store.get('runs',state.fillRunId),filled=fill.results?.find(r=>r.companyId===role.companyId&&r.roleId===role.roleId);if(filled?.planId)frozen=await store.get('plans',filled.planId);}
 if(!frozen)throw Error('SUBMISSION_VERIFIED_FILL_REQUIRED');
 for(const[ref,file]of Object.entries(frozen.files||{})){if(!files?.[ref]||JSON.stringify(attachmentFileDescriptor(file))!==JSON.stringify(attachmentFileDescriptor(files[ref])))throw Error('SUBMISSION_APPROVED_FILE_CHANGED');if(!frozen.fileMetadata?.[ref])throw Error('SUBMISSION_FILE_METADATA_REFRESH_REQUIRED');let current;try{current=await attachmentFileMetadata(files[ref]);}catch{throw Error('SUBMISSION_APPROVED_FILE_UNAVAILABLE');}if(JSON.stringify(frozen.fileMetadata[ref])!==JSON.stringify(current))throw Error('SUBMISSION_APPROVED_FILE_CHANGED');}
 return frozen;
}

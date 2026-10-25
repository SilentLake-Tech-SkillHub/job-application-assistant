import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const supportedPreviewBundles=new Set(['41fc1cf6ef8e3eec2fd29c7d5f5cef292a635f90d6d29535981e4216376208e1']);
export function assertPreviewSource(structure,loadedScripts,{allowedHashes=supportedPreviewBundles}={}){
 const loaded=new Set(loadedScripts||[]);
 for(const script of structure?.scriptInventory?.items||[]){const artifact=script.source?.included&&script.source.artifact;
  if(artifact&&allowedHashes.has(artifact.sha256)&&hash(artifact.text)===artifact.sha256&&loaded.has(script.url))return artifact.sha256;
 }
 throw Error('SUBMISSION_PREVIEW_SOURCE_NOT_VERIFIED');
}
export async function prepareSubmissionPreview({args,boundRole,resolveTask,engine,browser,queues,store,verifySource=assertPreviewSource}){
 if(args.authorization?.preview!==true||!args.authorization.evidence?.trim())throw Error('ROLE_PREVIEW_AUTHORIZATION_REQUIRED');
 const {t,state,template}=await boundRole(args),templateHash=hash(template);
 if(state.submissionAttempt)throw Error('SUBMISSION_ALREADY_ATTEMPTED');
 if(args.authorization.templateHash!==templateHash)throw Error('SUBMISSION_APPROVED_TEMPLATE_CHANGED');
 const id='submission-preview-'+t.taskId;
 if(state.previewAttempt){
  const prior=await store.get('runs',id);
  if(prior.status==='preview_captured'&&prior.templateHash===templateHash)return {status:prior.status,previewRunId:id,questionCount:prior.snapshot.questions.length,buttons:prior.controls.buttons,submission:'not_performed'};
  throw Error('SUBMISSION_PREVIEW_ALREADY_ATTEMPTED');
 }
 const review=await store.get('runs',args.authorization.reviewRunId);
 if(review.status!=='verified'||review.operation!=='verify_current'||review.companyId!==t.companyId||review.roleId!==t.roleId||review.templateHash!==templateHash||review.pageUrl!==state.returnUrl)throw Error('SUBMISSION_VERIFIED_REVIEW_REQUIRED');
 const task=await resolveTask(t,state,template),fresh=await engine.verifyCurrentLocked(task);
 const signature=run=>hash(run.checks.map(({id,status,expected,actual})=>({id,status,expected,actual})).sort((a,b)=>a.id.localeCompare(b.id)));
 if(fresh.status!=='verified'||signature(review)!==signature(fresh))throw Error('SUBMISSION_REVIEW_CONTENT_CHANGED');
 const protectedSources=async run=>{const observation=await store.get('runs',run.observationRunId);return hash(Object.fromEntries(Object.entries(observation.observation.fields).filter(([,f])=>f.profileFillProof).map(([id,f])=>[id,f.profileFillProof.sourceHash])));};
 if(await protectedSources(review)!==await protectedSources(fresh))throw Error('SUBMISSION_REVIEW_CONTENT_CHANGED');
 const page=await browser.existingPage(state.returnUrl),before=await page.observe({operation:'submission_controls'});
 if(before.pageUrl!==state.returnUrl||before.receipt)throw Error('SUBMISSION_EXISTING_RECEIPT_REQUIRES_RECONCILIATION');
 const structure=await store.get('runs',template.evidence.pipeline.structureId),sourceHash=verifySource(structure,before.scripts);
 const buttons=before.buttons.filter(b=>!b.disabled&&/^(?:预览并提交|Preview and submit)$/i.test(b.label));
 if(!buttons.length||new Set(buttons.map(({selector,...b})=>JSON.stringify(b))).size!==1)throw Error('SUBMISSION_PREVIEW_BUTTON_NOT_UNIQUE');
 const button=buttons.at(-1),startedAt=new Date().toISOString(),approvalHash=hash({templateHash,reviewRunId:review.id,evidence:args.authorization.evidence,sourceHash});
 state.previewAttempt={startedAt,approvalHash,status:'started'};await queues.put(t.taskId,state);
 let controls,snapshot,errorCode;
 try{
  await page.act({method:'authorized_preview',button,approvalHash},null,{});
  const end=Date.now()+8000;
  do{controls=await page.observe({operation:'submission_controls'});if(controls.receipt)throw Error('SUBMISSION_PREVIEW_UNEXPECTED_RECEIPT');if(controls.validationErrors)throw Error('SUBMISSION_PREVIEW_VALIDATION_ERROR');
   if(controls.pageUrl===state.returnUrl&&controls.buttons.some(b=>/^(?:确认投递|确认提交|Submit application|Confirm submission)$/i.test(b.label))&&!controls.buttons.some(b=>/^(?:预览并提交|Preview and submit)$/i.test(b.label)))break;
   if(Date.now()>=end)throw Error('SUBMISSION_PREVIEW_TRANSITION_NOT_OBSERVED');await new Promise(r=>setTimeout(r,100));
  }while(true);
  snapshot=await page.observe({operation:'submission_preview'});
  if(snapshot.pageUrl!==state.returnUrl||snapshot.truncated)throw Error('SUBMISSION_PREVIEW_CAPTURE_INCOMPLETE');
 }catch(error){errorCode=/^[A-Z_]+$/.test(error.message)?error.message:'SUBMISSION_PREVIEW_OPERATION_FAILED';}
 const status=errorCode?'preview_failed':'preview_captured';state.previewAttempt.status=status;state.previewAttempt.runId=id;await queues.put(t.taskId,state);
 await store.put('runs',id,{id,operation:'submission_preview',companyId:t.companyId,roleId:t.roleId,taskId:t.taskId,pageId:state.pageId,pageUrl:state.returnUrl,templateHash,reviewRunId:review.id,freshRunId:fresh.id,startedAt,sourceHash,status,controls,snapshot,errorCode:errorCode||'SUBMISSION_PREVIEW_DRIVER_REQUIRED'});
 return {status,previewRunId:id,sourceHash,questionCount:snapshot?.questions?.length||0,buttons:controls?.buttons||[],error:errorCode||null,submission:'not_performed',completion:{complete:false,status:'requires_preview_verification'},continuation:{state:'technical_block',owner:'agent',requiresUser:false,nextTools:['workflow_handoff']}};
}

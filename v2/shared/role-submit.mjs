import {randomUUID,createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {reviewedPreparationFiles} from './review-preparation.mjs';
import {evaluateBusinessAuthorization} from './business-authorization.mjs';
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const signature=(run,excluded=new Set())=>hash(run.checks.filter(c=>!excluded.has(c.id)).map(({id,status,expected,actual})=>({id,status,expected,actual})).sort((a,b)=>a.id.localeCompare(b.id)));
const proofs=async(store,run)=>{const o=await store.get('runs',run.observationRunId);return Object.fromEntries(Object.entries(o.observation.fields).filter(([,f])=>f.profileFillProof).map(([id,f])=>[id,f.profileFillProof.sourceHash]));};
const rolePage=(browser,state,readOnly=false)=>browser.existingPage(state.returnUrl,{pageId:state.pageId,readOnly,roleBinding:state.browserBinding});
const isPreviewButton=b=>/^(?:预览并提交|Preview and submit)$/i.test(b.label);
// A summary page shows an enabled final action and no enabled preview action.
const isSummary=controls=>controls.buttons.some(b=>!b.disabled&&!isPreviewButton(b))&&!controls.buttons.some(b=>!b.disabled&&isPreviewButton(b));
// Final submission. The edit form is re-verified once before leaving it. A site's summary
// step ("预览并提交") is entered directly and nothing on the summary is compared again; only an
// unticked agreement checkbox there is ticked under business switch 1 (switch 0: the user ticks it).
export async function submitReviewedRole({args,boundRole,resolveTask,engine,browser,queues,store,evaluateAuthorization,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),previewWaitMs=30000}){
 if(args.authorization?.submit!==true||!args.authorization.evidence?.trim())throw Error('ROLE_SUBMISSION_AUTHORIZATION_REQUIRED');
 const {q,t,state,template}=await boundRole(args),templateHash=hash(template);
 if(state.submissionAttempt)throw Error('SUBMISSION_ALREADY_ATTEMPTED');
 if(templateHash!==args.authorization.templateHash)throw Error('SUBMISSION_APPROVED_TEMPLATE_CHANGED');
 const review=await store.get('runs',args.authorization.reviewRunId);
 if(review.operation!=='verify_current'||review.status!=='verified'||review.companyId!==t.companyId||review.roleId!==t.roleId||review.pageUrl!==state.returnUrl||review.templateHash!==templateHash)throw Error('SUBMISSION_VERIFIED_REVIEW_REQUIRED');
 const reviewProofs=await proofs(store,review);
 const task=await resolveTask(t,state,template);let fresh=null;
 const page=await rolePage(browser,state),controlsNow=async()=>{const c=await page.observe({operation:'submission_controls'});if(c.pageUrl!==state.returnUrl||c.receipt)throw Error('SUBMISSION_EXISTING_RECEIPT_REQUIRES_RECONCILIATION');return c;};
 const previewButtonsOf=c=>c.buttons.filter(b=>!b.disabled&&isPreviewButton(b));
 let preview=await controlsNow();
 // Decide from the live page, not from the stored attempt alone: the edit form is skipped only when
 // an earlier preview click of this task really reached the summary (no preview button left).
 const onSummaryFromPreview=!!state.previewAttempt&&!previewButtonsOf(preview).length&&isSummary(preview);
 if(onSummaryFromPreview&&state.previewAttempt.status!=='summary_entered'){state.previewAttempt.status='summary_entered';await queues.put(t.taskId,state);}
 if(!onSummaryFromPreview){
  fresh=await engine.verifyCurrentLocked(task);
  const fileIds=new Set((template.pages||[]).flatMap(p=>p.fields||[]).filter(f=>f.kind==='file').map(f=>f.id));
  if(fresh.status!=='verified'||signature(review,fileIds)!==signature(fresh,fileIds)||hash(reviewProofs)!==hash(await proofs(store,fresh)))throw Error('SUBMISSION_REVIEW_CONTENT_CHANGED');
  preview=await controlsNow();
 }
 await reviewedPreparationFiles({store,state,role:t,templateHash,files:task.files});
 const previewButtons=previewButtonsOf(preview);
 if(previewButtons.length){
  if(new Set(previewButtons.map(({selector,...b})=>JSON.stringify(b))).size!==1||previewButtons.some(b=>!b.selector))throw Error('SUBMISSION_PREVIEW_BUTTON_NOT_UNIQUE');
  // An earlier click that never left the edit form gets exactly one more click, after the edit form was re-verified above.
  const clicks=state.previewAttempt?.status==='started'?(state.previewAttempt.clicks||1):0;
  if(clicks>=2)throw Object.assign(Error('SUBMISSION_PREVIEW_TRANSITION_NOT_OBSERVED'),{details:{previewClicks:clicks,nextStep:'the preview button did not lead to a summary twice; look at the page with the user before another submit call'}});
  state.previewAttempt={startedAt:new Date().toISOString(),status:'started',clicks:clicks+1,reviewRunId:review.id,freshRunId:fresh?.id||null};await queues.put(t.taskId,state);
  await page.act({method:'authorized_preview',button:previewButtons.at(-1),approvalHash:hash({templateHash,reviewRunId:review.id,evidence:args.authorization.evidence})},null,{});
  const end=now()+Math.max(100,Math.min(previewWaitMs,45000));
  do{preview=await controlsNow();if(isSummary(preview))break;if(preview.validationErrors)throw Error('SUBMISSION_PREVIEW_VALIDATION_ERROR');if(now()>=end)throw Error('SUBMISSION_PREVIEW_TRANSITION_NOT_OBSERVED');await sleep(100);}while(true);
  state.previewAttempt.status='summary_entered';await queues.put(t.taskId,state);
 }
 const consentScope={operation:'recruiting_privacy',stage:'application',companyId:t.companyId,officialOrigin:new URL(t.url||state.returnUrl).origin,pageUrl:state.returnUrl,confirmedRole:{companyId:t.companyId,roleId:t.roleId}};
 for(const agreement of (preview.agreements||[]).filter(a=>a.checked!==true)){
  const permission=evaluateAuthorization?await evaluateAuthorization(consentScope):evaluateBusinessAuthorization({policy:task.agreementPolicy||{}},consentScope);
  if(permission.decision!=='allow')return {status:'needs_user_consent',agreement:{label:agreement.label},businessAuthorization:{decision:permission.decision,reason:permission.reason,switchValue:permission.switchValue},submission:'not_performed',completion:{complete:false,status:'waiting_for_user_consent'},continuation:{state:'user_action',owner:permission.decision==='technical_pending'?'agent':'user',requiresUser:permission.decision!=='technical_pending',shouldContinue:permission.decision==='technical_pending',nextTools:['role_submit'],reason:permission.reason}};
  if(!agreement.selector)throw Error('SUBMISSION_AGREEMENT_TARGET_REQUIRED');
  await page.act({method:'check',selector:agreement.selector},true,{});
 }
 if((preview.agreements||[]).some(a=>a.checked!==true)){preview=await controlsNow();if(preview.agreements?.some(a=>a.checked!==true))throw Error('SUBMISSION_AGREEMENT_NOT_COMMITTED');}
 const buttons=preview.buttons.filter(button=>!button.disabled);
 // Responsive layouts may render the same submit action at the top and bottom.
 // Only identical captured actions qualify; select the last exact live node.
 if(!buttons.length||new Set(buttons.map(({selector,...data})=>JSON.stringify(data))).size!==1||buttons.some(b=>!b.selector))throw Error('SUBMISSION_BUTTON_NOT_UNIQUE_OR_ENABLED');
 const button=buttons.at(-1);
 const current=await boundRole(args);if(current.state.pageId!==state.pageId||hash(current.template)!==templateHash)throw Error('SUBMISSION_ROLE_OR_TEMPLATE_CHANGED');
 const attemptId=randomUUID(),startedAt=new Date().toISOString(),approval={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash,reviewRunId:review.id,evidence:args.authorization.evidence,...(state.previewAttempt?{previewEntered:true}:{})};
 if(fresh){state.verifyRunId=fresh.id;state.verifiedAt=fresh.readAt;}state.status='ready_for_user_review';state.submissionAttempt={attemptId,startedAt,approvalHash:hash(approval),status:'attempt_started'};await queues.put(t.taskId,state);
 const id='submission-'+t.taskId;await store.put('runs',id,{id,operation:'role_submission',attemptId,approval,startedAt,status:'attempt_started'});
 let clickError=null,observation=null;
 try{await page.act({method:'authorized_submit',button,approvalHash:hash(approval)},null,{});}catch(error){clickError=/^[A-Z_]+$/.test(error.message)?error.message:'SUBMISSION_CLICK_RESULT_UNCERTAIN';}
 const deadline=Date.now()+10000;
 do{try{const identity=await browser.request('pageIdentity',{pageId:state.pageId});if(new URL(identity.pageUrl).origin!==new URL(t.url).origin)break;const currentPage=await browser.existingPage(identity.pageUrl,{pageId:state.pageId,readOnly:true});observation=await currentPage.observe({operation:'submission_receipt'});if(observation.receipt||observation.validationErrors)break;}catch{}
  if(Date.now()>=deadline)break;await new Promise(r=>setTimeout(r,200));
 }while(true);
 const confirmed=!!observation?.receipt&&observation.source==='live_dom'&&Date.parse(observation.readAt)>=Date.parse(startedAt),event=confirmed?'submission_confirmed':'submission_uncertain';
 const proofId='submission-proof-'+t.taskId;await store.put('runs',proofId,{operation:'official_submission_observation',attemptId,companyId:t.companyId,roleId:t.roleId,originalPageId:state.pageId,accountMatched:true,button,observation,clickError});
 const proofFile=path.join(store.root,'runs',proofId+'.json'),artifact={file:proofFile,sha256:hash(await readFile(proofFile))},evidenceId='submission-evidence-'+t.taskId,evidence={schemaVersion:1,event,batchId:q.batchId,companyId:t.companyId,roleId:t.roleId,roleUrl:t.url,roleTitle:t.title,observedAt:observation?.readAt||new Date().toISOString(),sourceUrl:observation?.pageUrl||state.returnUrl,result:confirmed?'official_receipt_confirmed':'receipt_not_confirmed',reviewer:'MCP role_submit',artifacts:[artifact]};
 await store.put('runs',evidenceId,evidence);const evidenceFile=path.join(store.root,'runs',evidenceId+'.json'),outcome={schemaVersion:1,eventId:attemptId,event,batchId:q.batchId,companyId:t.companyId,roleId:t.roleId,roleUrl:t.url,roleTitle:t.title,evidence:{file:evidenceFile,sha256:hash(await readFile(evidenceFile))}};
 let screenshot=null;if(confirmed)try{screenshot=await browser.request('screenshot',{pageId:state.pageId});}catch{}
 state.submissionAttempt.status=confirmed?'official_receipt_confirmed':'receipt_not_confirmed';state.submissionAttempt.runId=id;await queues.put(t.taskId,state);
 const result={id,operation:'role_submission',attemptId,status:confirmed?'official_receipt_confirmed':'submission_uncertain',outcome,receiptText:observation?.receipt?.text||null,screenshot,clickError,save:'not_separately_verified',submission:confirmed?'official_receipt_confirmed':'uncertain',completion:{complete:false,status:'requires_result_closeout'},continuation:{state:'route',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['application_closeout']}};await store.put('runs',id,result);return result;
}

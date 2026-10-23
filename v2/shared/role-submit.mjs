import {randomUUID,createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';import path from 'node:path';
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const signature=run=>hash(run.checks.map(({id,status,expected,actual})=>({id,status,expected,actual})).sort((a,b)=>a.id.localeCompare(b.id)));
const proofs=async(store,run)=>{const o=await store.get('runs',run.observationRunId);return Object.fromEntries(Object.entries(o.observation.fields).filter(([,f])=>f.profileFillProof).map(([id,f])=>[id,f.profileFillProof.sourceHash]));};
export async function submitReviewedRole({args,boundRole,resolveTask,engine,browser,queues,store}){
 if(args.authorization?.submit!==true||!args.authorization.evidence?.trim())throw Error('ROLE_SUBMISSION_AUTHORIZATION_REQUIRED');
 const {q,t,state,template}=await boundRole(args),templateHash=hash(template);
 if(state.submissionAttempt)throw Error('SUBMISSION_ALREADY_ATTEMPTED');
 if(templateHash!==args.authorization.templateHash)throw Error('SUBMISSION_APPROVED_TEMPLATE_CHANGED');
 const review=await store.get('runs',args.authorization.reviewRunId);
 if(review.operation!=='verify_current'||review.status!=='verified'||review.companyId!==t.companyId||review.roleId!==t.roleId||review.pageUrl!==state.returnUrl||review.templateHash!==templateHash)throw Error('SUBMISSION_VERIFIED_REVIEW_REQUIRED');
 const task=await resolveTask(t,state,template),fresh=await engine.verifyCurrentLocked(task);
 if(fresh.status!=='verified'||signature(review)!==signature(fresh)||hash(await proofs(store,review))!==hash(await proofs(store,fresh)))throw Error('SUBMISSION_REVIEW_CONTENT_CHANGED');
 if(!state.fillRunId)throw Error('SUBMISSION_VERIFIED_FILL_REQUIRED');
 const fill=await store.get('runs',state.fillRunId),filled=fill.results?.find(r=>r.companyId===t.companyId&&r.roleId===t.roleId),frozen=filled&&await store.get('plans',filled.planId);
 if(!frozen||Object.entries(frozen.files||{}).some(([ref,file])=>!task.files?.[ref]||hash(file)!==hash(task.files[ref])))throw Error('SUBMISSION_APPROVED_FILE_CHANGED');
 const page=await browser.existingPage(state.returnUrl),preview=await page.observe({operation:'submission_controls'});
 if(preview.pageUrl!==state.returnUrl||preview.receipt)throw Error('SUBMISSION_EXISTING_RECEIPT_REQUIRES_RECONCILIATION');
 const buttons=preview.buttons.filter(button=>!button.disabled);
 // Responsive layouts may render the same submit action at the top and bottom.
 // Only identical captured actions qualify; select the last exact live node.
 if(!buttons.length||new Set(buttons.map(({selector,...data})=>JSON.stringify(data))).size!==1||buttons.some(b=>!b.selector))throw Error('SUBMISSION_BUTTON_NOT_UNIQUE_OR_ENABLED');
 const button=buttons.at(-1);
 const current=await boundRole(args);if(current.state.pageId!==state.pageId||hash(current.template)!==templateHash)throw Error('SUBMISSION_ROLE_OR_TEMPLATE_CHANGED');
 const attemptId=randomUUID(),startedAt=new Date().toISOString(),approval={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash,reviewRunId:review.id,evidence:args.authorization.evidence};
 state.verifyRunId=fresh.id;state.verifiedAt=fresh.readAt;state.status='ready_for_user_review';state.submissionAttempt={attemptId,startedAt,approvalHash:hash(approval),status:'attempt_started'};await queues.put(t.taskId,state);
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

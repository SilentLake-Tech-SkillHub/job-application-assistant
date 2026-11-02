import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {attachmentFileMetadata} from '../shared/attachment-source-renderer.mjs';
import {Store,hash} from '../shared/engine.mjs';import {submitReviewedRole} from '../shared/role-submit.mjs';import {templateMethods} from '../shared/control-registry.mjs';
async function fixture(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'role-submit-')),store=new Store(root),pageUrl='https://recruit.example/apply',template={id:'fixture'},t={taskId:'task',companyId:'company',roleId:'role',url:'https://recruit.example/job/role',title:'Product'},q={batchId:'batch'};
 const filePath=path.join(root,'resume.pdf');await writeFile(filePath,'fixture resume');const files={resume:{paths:[filePath],displayNames:['resume.pdf']}},fileMetadata={resume:await attachmentFileMetadata(files.resume)};
 const state={pageId:'original-page',returnUrl:pageUrl,fillRunId:'fill'},review={id:'approved-review',operation:'verify_current',status:'verified',companyId:t.companyId,roleId:t.roleId,pageUrl,templateHash:hash(template),checks:[{id:'field',status:'match',expected:'value',actual:'value'}],observationRunId:'observed'};
 await store.put('runs',review.id,review);await store.put('runs','observed',{observation:{fields:{identity:{profileFillProof:{sourceHash:'source'}}}}});
 await store.put('runs','fill',{results:[{companyId:t.companyId,roleId:t.roleId,planId:'plan'}]});await store.put('plans','plan',{files,fileMetadata});
 const button={label:'Submit application',tag:'BUTTON',type:'button',disabled:false,selector:'#submit'},written=[];let clicks=0;
 const observation=()=>({source:'live_dom',readAt:new Date(Date.now()+1).toISOString(),pageUrl,buttons:[button],receipt:null,validationErrors:0});
 const page={observe:async spec=>spec.operation==='submission_controls'?observation():({...observation(),receipt:{text:'提交成功',selector:'#receipt'}}),act:async()=>{clicks++;assert.ok(state.submissionAttempt);}};
 const context={args:{authorization:{submit:true,templateHash:hash(template),reviewRunId:review.id,evidence:'user authorized this reviewed role'}},boundRole:async()=>({q,t,state,template}),resolveTask:async()=>({files,fileMetadata}),engine:{verifyCurrentLocked:async()=>({...review,id:'fresh-review'})},browser:{existingPage:async()=>page,request:async method=>method==='pageIdentity'?{pageId:state.pageId,pageUrl}:{path:'receipt.png'}},queues:{put:async(id,s)=>written.push(structuredClone(s))},store};
 try{await fn({context,state,page,button,review,store,written,files,fileMetadata,clicks:()=>clicks});}finally{await rm(root,{recursive:true,force:true});}
}
test('submission is excluded from ordinary templates and requires specific authorization',()=>fixture(async({context,clicks})=>{
 assert.equal(templateMethods().has('authorized_submit'),false);context.args.authorization.submit=false;
 await assert.rejects(submitReviewedRole(context),/AUTHORIZATION_REQUIRED/);assert.equal(clicks(),0);
}));
test('verified incremental recovery retains final authority and frozen file binding without another upload',()=>fixture(async({context,state,review,store,files,fileMetadata,clicks})=>{
 delete state.fillRunId;state.selectedFieldRunId='selected';
 const body={companyId:'company',pageUrl:state.returnUrl,templateHash:review.templateHash,files,fileMetadata,pages:[{fields:[{id:'field',kind:'text',disposition:'fill'}]}],readyForExecution:true,counts:{needs_user:0}};
 await store.put('plans','incremental-plan',{id:'incremental-plan',createdAt:'time',...body,planHash:hash(body)});
 await store.put('runs','selected',{operation:'selected_field_prepare',status:'prepared',companyId:'company',roleId:'role',pageUrl:state.returnUrl,templateHash:review.templateHash,planId:'incremental-plan',planHash:hash(body),fieldIds:['field'],fields:[{id:'field',status:'prepared_pending_full_verification'}]});
 context.args.authorization.submit=false;await assert.rejects(submitReviewedRole(context),/AUTHORIZATION_REQUIRED/);assert.equal(clicks(),0);
 context.args.authorization.submit=true;const result=await submitReviewedRole(context);assert.equal(result.status,'official_receipt_confirmed');assert.equal(clicks(),1);
}));
test('changed template, reviewed fields, or file provenance rejects before click',()=>fixture(async({context,review,clicks})=>{
 context.args.authorization.templateHash='0'.repeat(64);await assert.rejects(submitReviewedRole(context),/TEMPLATE_CHANGED/);
 context.args.authorization.templateHash=review.templateHash;context.engine.verifyCurrentLocked=async()=>({...review,checks:[{id:'field',status:'match',expected:'changed',actual:'changed'}]});await assert.rejects(submitReviewedRole(context),/REVIEW_CONTENT_CHANGED/);
 context.engine.verifyCurrentLocked=async()=>review;context.resolveTask=async()=>({files:{}});await assert.rejects(submitReviewedRole(context),/APPROVED_FILE_CHANGED/);assert.equal(clicks(),0);
}));
test('one durable attempt, exact responsive duplicate target, official receipt, and closeout evidence',()=>fixture(async({context,state,page,button,store,clicks})=>{
 const read=page.observe;page.observe=async spec=>spec.operation==='submission_controls'?{...await read(spec),buttons:[button,{...button,selector:'#footer-submit'}]}:read(spec);
 const act=page.act;page.act=async action=>{assert.equal(action.button.selector,'#footer-submit');await act(action);};
 const result=await submitReviewedRole(context);assert.equal(result.status,'official_receipt_confirmed');assert.equal(result.outcome.event,'submission_confirmed');assert.equal(clicks(),1);assert.equal(state.submissionAttempt.status,'official_receipt_confirmed');assert.deepEqual(result.continuation.nextTools,['application_closeout']);
 const evidence=await store.get('runs','submission-evidence-task');assert.equal(evidence.result,'official_receipt_confirmed');assert.equal(evidence.artifacts.length,1);
 await assert.rejects(submitReviewedRole(context),/ALREADY_ATTEMPTED/);assert.equal(clicks(),1);
}));
test('validation errors produce uncertain outcome and protect against a second click',()=>fixture(async({context,page,clicks})=>{
 const read=page.observe;page.observe=async spec=>spec.operation==='submission_controls'?read(spec):{...await read(spec),receipt:null,validationErrors:1};
 const result=await submitReviewedRole(context);assert.equal(result.status,'submission_uncertain');assert.equal(result.outcome.event,'submission_uncertain');await assert.rejects(submitReviewedRole(context),/ALREADY_ATTEMPTED/);assert.equal(clicks(),1);
}));
test('ambiguous distinct submit actions never click',()=>fixture(async({context,page,button,clicks})=>{
 const read=page.observe;page.observe=async spec=>({...await read(spec),buttons:[button,{...button,label:'Apply',selector:'#other'}]});await assert.rejects(submitReviewedRole(context),/NOT_UNIQUE/);assert.equal(clicks(),0);
}));
test('preview-and-submit is entered directly; the summary page is not compared again',()=>fixture(async({context,state,page,button,review})=>{
 let summary=false,verifications=0;const acts=[],ops=[],preview={label:'预览并提交',tag:'BUTTON',type:'button',disabled:false,selector:'#preview'},confirm={...button,label:'确认投递',selector:'#confirm'};
 context.engine.verifyCurrentLocked=async()=>{verifications++;return {...review,id:'fresh-review'};};
 page.observe=async spec=>{ops.push(spec.operation);const base={source:'live_dom',readAt:new Date(Date.now()+1).toISOString(),pageUrl:state.returnUrl,receipt:null,validationErrors:0,agreements:[]};if(spec.operation==='submission_controls')return {...base,buttons:summary?[confirm]:[preview]};return {...base,buttons:[],receipt:{text:'投递成功',selector:'#r'}};};
 page.act=async action=>{acts.push(action.method);if(action.method==='authorized_preview')summary=true;else assert.ok(state.submissionAttempt);};
 const r=await submitReviewedRole({...context,sleep:async()=>{}});
 assert.equal(r.status,'official_receipt_confirmed');assert.deepEqual(acts,['authorized_preview','authorized_submit']);assert.equal(verifications,1);assert.equal(ops.includes('submission_preview'),false);assert.equal(state.previewAttempt.status,'summary_entered');
}));
test('an unticked agreement on the summary follows the business switch',async()=>{
 for(const value of [1,0])await fixture(async({context,state,page,button,files,fileMetadata})=>{
  let checked=false;const acts=[];context.resolveTask=async()=>({files,fileMetadata,agreementPolicy:{businessAuthorization:value}});
  page.observe=async spec=>{const base={source:'live_dom',readAt:new Date(Date.now()+1).toISOString(),pageUrl:state.returnUrl,receipt:null,validationErrors:0};if(spec.operation==='submission_controls')return {...base,buttons:[button],agreements:[{label:'我已阅读并同意《隐私政策》',checked,selector:'#agree'}]};return {...base,buttons:[],receipt:{text:'投递成功',selector:'#r'}};};
  page.act=async(action,v)=>{acts.push(action.method);if(action.method==='check')checked=v;};
  const r=await submitReviewedRole(context);
  if(value===1){assert.equal(r.status,'official_receipt_confirmed');assert.deepEqual(acts,['check','authorized_submit']);}
  else{assert.equal(r.status,'needs_user_consent');assert.equal(r.continuation.owner,'user');assert.deepEqual(r.continuation.nextTools,['role_submit']);assert.deepEqual(acts,[]);assert.equal(state.submissionAttempt,undefined);}
 });
});
test('a summary entered earlier is submitted without re-verifying the edit form',()=>fixture(async({context,state,clicks})=>{
 state.previewAttempt={status:'summary_entered'};context.engine.verifyCurrentLocked=async()=>{throw Error('MUST_NOT_REVERIFY');};
 const r=await submitReviewedRole(context);assert.equal(r.status,'official_receipt_confirmed');assert.equal(clicks(),1);
}));
test('a preview click that never reaches the summary stops before any final attempt',()=>fixture(async({context,state,page,clicks})=>{
 const preview={label:'预览并提交',tag:'BUTTON',type:'button',disabled:false,selector:'#preview'};let t=0;
 page.observe=async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:state.returnUrl,buttons:[preview],receipt:null,validationErrors:0});page.act=async()=>{};
 await assert.rejects(submitReviewedRole({...context,now:()=>(t+=1000),sleep:async()=>{},previewWaitMs:2000}),/PREVIEW_TRANSITION_NOT_OBSERVED/);assert.equal(state.submissionAttempt,undefined);assert.equal(clicks(),0);
}));
test('after a preview timeout, a second call re-verifies the edit form, clicks at most once more, then stops',()=>fixture(async({context,state,page})=>{
 const preview={label:'预览并提交',tag:'BUTTON',type:'button',disabled:false,selector:'#preview'};let t=0,previewClicks=0,verifications=0;
 page.observe=async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:state.returnUrl,buttons:[preview],receipt:null,validationErrors:0});page.act=async a=>{if(a.method==='authorized_preview')previewClicks++;};
 const verify=context.engine.verifyCurrentLocked;context.engine.verifyCurrentLocked=async(...x)=>{verifications++;return verify(...x);};
 const call=()=>submitReviewedRole({...context,now:()=>(t+=1000),sleep:async()=>{},previewWaitMs:2000});
 await assert.rejects(call(),/PREVIEW_TRANSITION_NOT_OBSERVED/);assert.equal(previewClicks,1);assert.equal(verifications,1);assert.equal(state.previewAttempt.clicks,1);
 await assert.rejects(call(),/PREVIEW_TRANSITION_NOT_OBSERVED/);assert.equal(previewClicks,2);assert.equal(verifications,2);
 await assert.rejects(call(),error=>error.message==='SUBMISSION_PREVIEW_TRANSITION_NOT_OBSERVED'&&error.details?.previewClicks===2);assert.equal(previewClicks,2);assert.equal(state.submissionAttempt,undefined);
}));
test('a late summary after a timed-out preview click is submitted without another preview click or edit re-verification',()=>fixture(async({context,state,page,button})=>{
 state.previewAttempt={status:'started',clicks:1};const acts=[];context.engine.verifyCurrentLocked=async()=>{throw Error('MUST_NOT_REVERIFY');};
 page.act=async a=>{acts.push(a.method);};
 const r=await submitReviewedRole(context);assert.equal(r.status,'official_receipt_confirmed');assert.deepEqual(acts,['authorized_submit']);assert.equal(state.previewAttempt.status,'summary_entered');
}));
test('a stored summary_entered flag never skips the edit check while the page still shows the edit form',()=>fixture(async({context,state,page})=>{
 const preview={label:'预览并提交',tag:'BUTTON',type:'button',disabled:false,selector:'#preview'};let summary=false,verifications=0;
 state.previewAttempt={status:'summary_entered'};
 page.observe=async spec=>({source:'live_dom',readAt:new Date(Date.now()+1).toISOString(),pageUrl:state.returnUrl,buttons:summary?[{label:'确认投递',tag:'BUTTON',type:'button',disabled:false,selector:'#c'}]:[preview],receipt:spec.operation==='submission_receipt'?{text:'ok'}:null,validationErrors:0,agreements:[]});
 page.act=async a=>{if(a.method==='authorized_preview')summary=true;};
 const verify=context.engine.verifyCurrentLocked;context.engine.verifyCurrentLocked=async(...x)=>{verifications++;return verify(...x);};
 await submitReviewedRole(context);assert.equal(verifications,1);
}));

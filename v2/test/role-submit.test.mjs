import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store,hash} from '../shared/engine.mjs';import {submitReviewedRole} from '../shared/role-submit.mjs';import {templateMethods} from '../shared/control-registry.mjs';
async function fixture(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'role-submit-')),store=new Store(root),pageUrl='https://recruit.example/apply',template={id:'fixture'},t={taskId:'task',companyId:'company',roleId:'role',url:'https://recruit.example/job/role',title:'Product'},q={batchId:'batch'};
 const state={pageId:'original-page',returnUrl:pageUrl,fillRunId:'fill'},review={id:'approved-review',operation:'verify_current',status:'verified',companyId:t.companyId,roleId:t.roleId,pageUrl,templateHash:hash(template),checks:[{id:'field',status:'match',expected:'value',actual:'value'}],observationRunId:'observed'};
 await store.put('runs',review.id,review);await store.put('runs','observed',{observation:{fields:{identity:{profileFillProof:{sourceHash:'source'}}}}});
 await store.put('runs','fill',{results:[{companyId:t.companyId,roleId:t.roleId,planId:'plan'}]});await store.put('plans','plan',{files:{resume:{sha256:['pdf-hash']}}});
 const button={label:'Submit application',tag:'BUTTON',type:'button',disabled:false,selector:'#submit'},written=[];let clicks=0;
 const observation=()=>({source:'live_dom',readAt:new Date(Date.now()+1).toISOString(),pageUrl,buttons:[button],receipt:null,validationErrors:0});
 const page={observe:async spec=>spec.operation==='submission_controls'?observation():({...observation(),receipt:{text:'提交成功',selector:'#receipt'}}),act:async()=>{clicks++;assert.ok(state.submissionAttempt);}};
 const context={args:{authorization:{submit:true,templateHash:hash(template),reviewRunId:review.id,evidence:'user authorized this reviewed role'}},boundRole:async()=>({q,t,state,template}),resolveTask:async()=>({files:{resume:{sha256:['pdf-hash']}}}),engine:{verifyCurrentLocked:async()=>({...review,id:'fresh-review'})},browser:{existingPage:async()=>page,request:async method=>method==='pageIdentity'?{pageId:state.pageId,pageUrl}:{path:'receipt.png'}},queues:{put:async(id,s)=>written.push(structuredClone(s))},store};
 try{await fn({context,state,page,button,review,store,written,clicks:()=>clicks});}finally{await rm(root,{recursive:true,force:true});}
}
test('submission is excluded from ordinary templates and requires specific authorization',()=>fixture(async({context,clicks})=>{
 assert.equal(templateMethods().has('authorized_submit'),false);context.args.authorization.submit=false;
 await assert.rejects(submitReviewedRole(context),/AUTHORIZATION_REQUIRED/);assert.equal(clicks(),0);
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

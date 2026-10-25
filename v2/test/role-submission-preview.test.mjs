import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {prepareSubmissionPreview,assertPreviewSource} from '../shared/role-submission-preview.mjs';
import {templateMethods} from '../shared/control-registry.mjs';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fixture=()=>{
 let clicks=0,mode='edit',validationErrors=0;
 const t={taskId:'task',companyId:'example',roleId:'role'},state={pageId:'original',returnUrl:'https://example.test/form'},template={id:'example',evidence:{pipeline:{structureId:'structure'}}};
 const checks=[{id:'name',status:'match',expected:'Example',actual:'Example'}],review={id:'review',operation:'verify_current',status:'verified',companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),checks,observationRunId:'observed'};
 const data=new Map([['review',review],['structure',{}],['observed',{observation:{fields:{}}}]]),store={get:async(_,id)=>{if(!data.has(id))throw Error('missing');return data.get(id);},put:async(_,id,x)=>data.set(id,x)};
 const button=label=>({label,tag:'BUTTON',type:'button',disabled:false,selector:'#'+(label==='预览并提交'?'preview':'confirm')});
 const page={observe:async spec=>spec.operation==='submission_preview'?{source:'live_dom',pageUrl:state.returnUrl,truncated:false,questions:[{label:'Name',value:'Example'}]}:{pageUrl:state.returnUrl,receipt:null,validationErrors,buttons:[button(mode==='edit'?'预览并提交':'确认投递')],scripts:[]},act:async action=>{assert.equal(action.method,'authorized_preview');assert.equal(action.button.label,'预览并提交');assert.ok(state.previewAttempt);assert.equal(state.submissionAttempt,undefined);clicks++;mode='preview';}};
 const context={args:{authorization:{preview:true,evidence:'User explicitly authorized the current application',templateHash:hash(template),reviewRunId:'review'}},boundRole:async()=>({t,state,template}),resolveTask:async()=>({}),engine:{verifyCurrentLocked:async()=>({...review,id:'fresh'})},browser:{existingPage:async()=>page},queues:{put:async()=>{}},store,verifySource:()=>hash('synthetic source')};
 return {context,state,page,data,clicks:()=>clicks,setError:()=>{validationErrors=1;}};
};
test('preview capture is a bounded separate operation and never clicks final confirmation',async()=>{
 const f=fixture(),r=await prepareSubmissionPreview(f.context);assert.equal(r.status,'preview_captured');assert.equal(r.submission,'not_performed');assert.equal(f.clicks(),1);assert.equal(f.state.submissionAttempt,undefined);assert.equal(f.data.get(r.previewRunId).snapshot.questions.length,1);
 await prepareSubmissionPreview(f.context);assert.equal(f.clicks(),1);assert.equal(templateMethods().has('authorized_preview'),false);
});
test('unauthorized or changed reviewed content cannot open preview',async()=>{
 const f=fixture();f.context.args.authorization.preview=false;await assert.rejects(prepareSubmissionPreview(f.context),/AUTHORIZATION_REQUIRED/);assert.equal(f.clicks(),0);
 f.context.args.authorization.preview=true;f.context.engine.verifyCurrentLocked=async()=>({status:'needs_attention',checks:[]});await assert.rejects(prepareSubmissionPreview(f.context),/REVIEW_CONTENT_CHANGED/);assert.equal(f.clicks(),0);
});
test('failed preview is recorded and cannot be blindly clicked again',async()=>{
 const f=fixture();f.setError();const r=await prepareSubmissionPreview(f.context);assert.equal(r.status,'preview_failed');assert.equal(f.clicks(),1);await assert.rejects(prepareSubmissionPreview(f.context),/ALREADY_ATTEMPTED/);assert.equal(f.clicks(),1);
});
test('preview source proof requires actual loaded URL, pinned checksum and unchanged captured bytes',()=>{
 const text='synthetic preview-only handler',sha256=hash(text),script={url:'https://assets.example.test/preview.js',source:{included:true,artifact:{sha256,text}}},structure={scriptInventory:{items:[script]}};
 assert.equal(assertPreviewSource(structure,[script.url],{allowedHashes:new Set([sha256])}),sha256);
 for(const urls of [[],['https://other.example.test/preview.js']])assert.throws(()=>assertPreviewSource(structure,urls,{allowedHashes:new Set([sha256])}),/SOURCE_NOT_VERIFIED/);
 script.source.artifact.text+='changed';assert.throws(()=>assertPreviewSource(structure,[script.url],{allowedHashes:new Set([sha256])}),/SOURCE_NOT_VERIFIED/);
});

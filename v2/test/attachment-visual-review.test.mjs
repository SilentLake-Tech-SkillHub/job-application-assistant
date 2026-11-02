import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {reviewRoleAttachments,createModelVisionReviewer,createSamplingVisionReviewer,createSocketVisionReviewer} from '../shared/attachment-visual-review.mjs';import {verifyForm} from '../shared/verifier.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const answer=(ids,verdict='match',findings=[])=>({attachments:ids.map(fieldId=>({fieldId,verdict:typeof verdict==='function'?verdict(fieldId):verdict,reviewedPages:{website:[1],source:[1]},findings}))});
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'attachment-model-'));try{
 const photo=path.join(root,'photo.png'),resume=path.join(root,'resume.png');await writeFile(photo,png);await writeFile(resume,png);const rows=new Map();let calls=0,captures=0,result=null;
 const scope=fieldId=>({companyId:'fixture',roleId:'J000001',taskId:'task',pageUrl:'https://example.test/form',fieldId,selector:'#'+fieldId,label:fieldId});
 const items=()=>[{scope:scope('photo'),asset:{paths:[photo],displayNames:['photo.png']},actual:{present:true,uploadState:'site_rendered_uploaded',value:['renamed.png'],attachmentRevision:'site-photo-1'}},{scope:scope('resume'),asset:{paths:[resume],displayNames:['resume.png']},actual:{present:true,uploadState:'site_rendered_uploaded',value:['resume.png'],attachmentRevision:'site-resume-1'}}];
 const capture=async item=>{captures++;const file=item.asset.paths[0];return {website:{pages:[{pageNumber:1,path:file}],pageCount:1,complete:true},source:{pages:[{pageNumber:1,path:file}],pageCount:1,complete:true}};};
 const reviewer=createModelVisionReviewer({requestModel:async request=>{calls++;const prompt=JSON.parse(request.messages[0].content.text);const ids=prompt.attachments.map(a=>a.fieldId);assert.equal(request.messages.filter(m=>m.content.type==='image').length,ids.length*2);return {role:'assistant',model:'fixture-real-call',content:{type:'text',text:JSON.stringify(result||answer(ids))},_meta:{provider:'fixture',providerResponseId:'provider-call-'+calls}};}});
 const store={get:async(_,id)=>{if(!rows.has(id))throw Object.assign(Error('missing'),{code:'ENOENT'});return rows.get(id);},put:async(_,id,row)=>rows.set(id,row)};
 await fn({input:{store,items:items(),capture,visionReviewer:reviewer},items,photo,resume,rows,counts:()=>({calls,captures}),setResult:r=>result=r});}finally{await rm(root,{recursive:true,force:true});}}
test('every attachment of a role is judged in one model call; later verifications of the same upload reuse it',()=>fixture(async f=>{
 const first=await reviewRoleAttachments(f.input);assert.equal(first.photo.status,'verified');assert.equal(first.resume.status,'verified');assert.equal(first.photo.kind,'model_visual_review');assert.equal(first.photo.fileBytesHashed,false);assert.equal(first.photo.downloaded,false);assert.deepEqual(f.counts(),{calls:1,captures:2});
 const second=await reviewRoleAttachments({...f.input,items:f.items()});assert.equal(second.photo.reused,true);assert.equal(second.resume.reused,true);assert.deepEqual(f.counts(),{calls:1,captures:2});
}));
test('a new site upload or a changed local source is judged again; no first-time registry exists',()=>fixture(async f=>{
 await reviewRoleAttachments(f.input);const items=f.items();items[0].actual.attachmentRevision='site-photo-2';const again=await reviewRoleAttachments({...f.input,items});assert.equal(again.photo.reused,undefined);assert.equal(again.resume.reused,true);assert.equal(f.counts().calls,2);
 const other=f.items().map(i=>({...i,scope:{...i.scope,roleId:'J000002',taskId:'task-2'}}));const r=await reviewRoleAttachments({...f.input,items:other});assert.equal(r.photo.reused,undefined);assert.equal(f.counts().calls,3);
}));
test('no reachable vision model: the site uploaded state is accepted without capture',()=>fixture(async f=>{
 for(const reviewer of [createSamplingVisionReviewer({getClientCapabilities:()=>({})}),createSocketVisionReviewer('/tmp/absent-recruiting-vision-socket'),undefined]){f.rows.clear();const r=await reviewRoleAttachments({...f.input,items:f.items(),visionReviewer:reviewer});assert.equal(r.photo.status,'verified');assert.equal(r.photo.kind,'site_upload_state');assert.equal(r.photo.reason,'VISION_UNAVAILABLE_SITE_STATE_ACCEPTED');}
 assert.deepEqual(f.counts(),{calls:0,captures:0});
}));
test('a failed call, forged receipt or incomplete result falls back to the site state; only a mismatch blocks',()=>fixture(async f=>{
 let r=await reviewRoleAttachments({...f.input,visionReviewer:Object.assign(async()=>{throw Error('VISION_BRIDGE_TIMEOUT');},{isAvailable:async()=>true})});assert.equal(r.photo.reason,'VISION_CALL_FAILED_SITE_STATE_ACCEPTED');
 f.rows.clear();r=await reviewRoleAttachments({...f.input,items:f.items(),visionReviewer:Object.assign(async()=>({...answer(['photo','resume']),receipt:{kind:'trusted_visual_call',callId:'forged',model:'x',completedAt:new Date().toISOString()}}),{isAvailable:async()=>true})});assert.equal(r.photo.kind,'site_upload_state');
 f.rows.clear();f.setResult({attachments:[{fieldId:'photo',verdict:'match',reviewedPages:{website:[],source:[1]}}]});r=await reviewRoleAttachments({...f.input,items:f.items()});assert.equal(r.photo.reason,'VISION_RESULT_INCOMPLETE_SITE_STATE_ACCEPTED');assert.equal(r.resume.reason,'VISION_RESULT_INCOMPLETE_SITE_STATE_ACCEPTED');
 f.rows.clear();f.setResult(answer(['photo','resume'],id=>id==='photo'?'unreadable':'mismatch',['Wrong document']));r=await reviewRoleAttachments({...f.input,items:f.items()});assert.equal(r.photo.status,'verified');assert.equal(r.photo.reason,'ATTACHMENT_PREVIEW_UNREADABLE_SITE_STATE_ACCEPTED');assert.equal(r.resume.status,'mismatch');assert.equal(r.resume.reason,'ATTACHMENT_VISUAL_CONTENT_DIFFERS');
}));
test('a preview that cannot be captured is accepted by site state; an upload the site does not show is left to the verifier',()=>fixture(async f=>{
 const items=f.items();items[1].actual={...items[1].actual,uploadState:'unverified'};const r=await reviewRoleAttachments({...f.input,items,capture:async()=>({status:'technical_pending',reason:'IMAGE_PREVIEW_UNAVAILABLE'})});assert.equal(r.photo.reason,'ATTACHMENT_PREVIEW_UNAVAILABLE_SITE_STATE_ACCEPTED');assert.equal(r.resume,undefined);assert.equal(f.counts().calls,0);
}));
test('the verifier accepts a model or site-state proof only for this field and role',()=>fixture(async f=>{
 const proofs=await reviewRoleAttachments(f.input),item=f.items()[0],expected={companyId:'fixture',roleId:'J000001',pageUrl:item.scope.pageUrl,roleTitle:'Role',fields:[{id:'photo',kind:'file',label:'Photo',value:['photo.png']}]},observation={source:'live_dom',readAt:new Date().toISOString(),pageUrl:item.scope.pageUrl,roleTitle:'Role',inventoryIds:['photo'],fields:{photo:{...item.actual,attachmentVisualProof:proofs.photo}}};
 assert.equal(verifyForm(expected,observation).status,'verified');observation.fields.photo.attachmentVisualProof={...proofs.photo,scope:{...proofs.photo.scope,roleId:'J000002'}};assert.equal(verifyForm(expected,observation).status,'needs_attention');
 observation.fields.photo.attachmentVisualProof={...proofs.photo,kind:'site_upload_state',callId:undefined,model:undefined};assert.equal(verifyForm(expected,observation).status,'verified');
 observation.fields.photo.attachmentVisualProof={...proofs.photo,status:'mismatch'};assert.equal(verifyForm(expected,observation).checks.find(c=>c.id==='photo').status,'mismatch');
}));
test('a source changed during capture or an attachment changed during the call stays pending',()=>fixture(async f=>{
 let r=await reviewRoleAttachments({...f.input,capture:async item=>{const images=await f.input.capture(item);if(item.scope.fieldId==='photo')await writeFile(f.photo,Buffer.concat([png,Buffer.from('x')]));return images;}});assert.equal(r.photo.reason,'ATTACHMENT_SOURCE_CHANGED_DURING_REVIEW');assert.equal(r.resume.status,'verified');
 f.rows.clear();r=await reviewRoleAttachments({...f.input,items:f.items(),capture:async item=>({...await f.input.capture(item),confirmCurrent:async()=>false})});assert.equal(r.photo.reason,'ATTACHMENT_CHANGED_DURING_REVIEW');
}));
test('model findings are bounded strings with government number redaction',()=>fixture(async f=>{
 const dummy='123456789012345678';f.setResult(answer(['photo','resume'],'match',['Unexpected identity '+dummy,{private:dummy},42,'x'.repeat(2000),'These files are byte-identical (sha256 deadbeef)']));const r=await reviewRoleAttachments(f.input);
 assert.equal(r.photo.findings.length,2);assert.ok(r.photo.findings.every(x=>typeof x==='string'&&x.length<=1000));assert.ok(r.photo.findings[0].includes('[protected]'));assert.equal(JSON.stringify([...f.rows.values()]).includes(dummy),false);assert.equal(JSON.stringify(r).includes('deadbeef'),false);
}));
test('a private host socket is used only when it reports a real image model, and its receipt is kept',()=>fixture(async f=>{
 const socketPath=path.join(path.dirname(f.photo),'vision.sock');let available=false,reviews=0;
 const host=http.createServer((req,res)=>{if(req.url==='/status'){res.end(JSON.stringify({available,model:available?'fixture-configured-model':null}));return;}let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{reviews++;const input=JSON.parse(raw),ids=JSON.parse(input.messages[0].content.text).attachments.map(a=>a.fieldId);res.end(JSON.stringify({model:'fixture-configured-model',content:{type:'text',text:JSON.stringify(answer(ids))},_meta:{provider:'fixture-host',providerResponseId:'actual-host-response'}}));});});
 await new Promise(resolve=>host.listen(socketPath,resolve));await chmod(socketPath,0o600);
 try{const reviewer=createSocketVisionReviewer(socketPath);let r=await reviewRoleAttachments({...f.input,visionReviewer:reviewer});assert.equal(r.photo.kind,'site_upload_state');assert.equal(f.counts().captures,0);
  available=true;f.rows.clear();r=await reviewRoleAttachments({...f.input,items:f.items(),visionReviewer:reviewer});assert.equal(r.photo.kind,'model_visual_review');assert.equal(r.photo.model,'fixture-configured-model');assert.equal(reviews,1);}
 finally{await new Promise(resolve=>host.close(resolve));}
}));

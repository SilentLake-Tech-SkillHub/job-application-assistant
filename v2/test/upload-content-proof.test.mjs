import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {verifyUploadedContent,attachUploadContentProofs} from '../shared/upload-content-proof.mjs';
import {verifyForm} from '../shared/verifier.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(bytes,{selector='#actual-download',failure=null}={}){
 let clicks=0,deleted=0;
 const download={failure:async()=>failure,createReadStream:async()=>Readable.from([Buffer.from(bytes)]),delete:async()=>{deleted++;}};
 const page={url:()=> 'https://example.test/form',evaluate:async()=>selector,locator:()=>({count:async()=>1,click:async()=>{clicks++;}}),waitForEvent:async event=>{assert.equal(event,'download');return download;}};
 return {adapter:{page,resolveSpec:async spec=>spec},state:()=>({clicks,deleted})};
}
test('a renamed current file requires exact downloaded bytes of the approved source and leaves no downloaded copy',async()=>{
 const f=fixture('approved bytes'),result=await verifyUploadedContent(f.adapter,{selector:'#file',filename:'photo.jpeg',expectedSha256:sha('approved bytes')});
 assert.equal(result.status,'verified');assert.equal(result.actualSha256,sha('approved bytes'));assert.deepEqual(f.state(),{clicks:1,deleted:1});
 const wrong=fixture('other bytes'),mismatch=await verifyUploadedContent(wrong.adapter,{selector:'#file',filename:'photo.jpeg',expectedSha256:sha('approved bytes')});assert.equal(mismatch.status,'mismatch');assert.equal(wrong.state().deleted,1);
});
test('missing source-verified download actions and failed downloads never establish provenance',async()=>{
 const absent=fixture('x',{selector:null});await assert.rejects(verifyUploadedContent(absent.adapter,{selector:'#file',filename:'photo.jpeg',expectedSha256:sha('x')}),/UPLOAD_VERIFIED_DOWNLOAD_CONTROL_REQUIRED/);assert.equal(absent.state().clicks,0);
 const failed=fixture('x',{failure:'interrupted'});await assert.rejects(verifyUploadedContent(failed.adapter,{selector:'#file',filename:'photo.jpeg',expectedSha256:sha('x')}),/UPLOAD_DOWNLOAD_FAILED/);assert.equal(failed.state().deleted,1);
});
test('an empty browser stream uses only the actual HTTPS download URL with authenticated context',async()=>{
 const f=fixture(''),bytes=Buffer.from('approved');let requests=0;
 f.adapter.page.waitForEvent=async()=>({failure:async()=>null,createReadStream:async()=>Readable.from([]),url:()=> 'https://files.example.test/actual-upload',delete:async()=>{}});
 f.adapter.page.request={get:async url=>{requests++;assert.equal(url,'https://files.example.test/actual-upload');return {ok:()=>true,headers:()=>({'content-type':'image/jpeg'}),body:async()=>bytes};}};
 const result=await verifyUploadedContent(f.adapter,{selector:'#file',filename:'photo.jpeg',expectedSha256:sha(bytes)});assert.equal(requests,1);assert.equal(result.status,'verified');assert.equal(result.retrieval,'authenticated_observed_download_url');
 delete f.adapter.page.request;await assert.rejects(verifyUploadedContent(f.adapter,{selector:'#file',filename:'photo.jpeg',expectedSha256:sha(bytes)}),/UPLOAD_DOWNLOAD_EMPTY/);
});
test('independent readback accepts different filenames only with current-source exact byte proof',()=>{
 const source=sha('approved'),plan={pageUrl:'https://example.test/form',roleTitle:'Role',fields:[{id:'photo',kind:'file',value:['source.jpg'],fileSourceSha256:[source]}]},observation={pageUrl:plan.pageUrl,roleTitle:'Role',source:'live_dom',readAt:new Date().toISOString(),inventoryIds:['photo'],fields:{photo:{present:true,value:['photo.jpeg'],uploadState:'site_rendered_uploaded',uploadContentProof:{status:'verified',kind:'downloaded_content_sha256',expectedSha256:source,actualSha256:source,observedFilename:'photo.jpeg'}}}};
 assert.equal(verifyForm(plan,observation).status,'verified');
 observation.fields.photo.uploadContentProof.actualSha256=sha('other');assert.equal(verifyForm(plan,observation).status,'needs_attention');
 observation.fields.photo.uploadContentProof.actualSha256=source;plan.fields[0].fileSourceSha256=[sha('new source')];assert.equal(verifyForm(plan,observation).status,'needs_attention');
});
test('a transformed artifact needs both the approved source checksum and the acknowledged current artifact identity',async()=>{
 const f=fixture('server reencoded bytes');f.adapter.page.waitForEvent=async()=>({failure:async()=>null,createReadStream:async()=>Readable.from([Buffer.from('server reencoded bytes')]),url:()=> 'https://files.example.test/artifact_12345678/photo.jpeg',delete:async()=>{}});
 const origin={status:'verified',sourceSha256:sha('approved source'),resourcePaths:['https://files.example.test/artifact_12345678/photo.jpeg']};
 const action={selector:'#file',filename:'photo.jpeg',expectedSha256:sha('approved source'),uploadOrigin:origin};
 const matched=await verifyUploadedContent(f.adapter,action);assert.equal(matched.status,'verified');assert.equal(matched.kind,'source_upload_artifact_identity');assert.equal(matched.uploadOriginMatched,true);
 origin.sourceSha256=sha('wrong source');assert.equal((await verifyUploadedContent(f.adapter,action)).status,'mismatch');
});
test('the verifier never reuploads and ordinary same-name files retain the existing readback path',async()=>{
 let calls=0;const plan={fields:[{id:'photo',kind:'file',source:'photo',read:{selector:'#photo'}}]},task={values:{photo:'approved'},files:{approved:{sha256:[sha('x')],displayNames:['source.jpg']}}},observation={fields:{photo:{uploadState:'site_rendered_uploaded',value:['source.jpg']}}};
 await attachUploadContentProofs({act:async()=>{calls++;}},observation,plan,task);assert.equal(calls,0);
 observation.fields.photo.value=['photo.jpeg'];await attachUploadContentProofs({act:async action=>{calls++;assert.equal(action.method,'verify_uploaded_file');assert.equal(action.expectedSha256,sha('x'));return {status:'verified'};}},observation,plan,task);assert.equal(calls,1);
});

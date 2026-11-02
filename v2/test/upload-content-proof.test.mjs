import test from 'node:test';import assert from 'node:assert/strict';
import {attachUploadContentProofs} from '../shared/upload-content-proof.mjs';import {verifyForm} from '../shared/verifier.mjs';import {templateMethods,CONTROL_METHODS} from '../shared/control-registry.mjs';
test('legacy byte verification and photo hand-confirmation methods no longer exist',()=>{
 for(const method of ['verify_uploaded_file','capture_uploaded_image_preview','close_readonly_disclosure','capture_recruiting_disclosure'])assert.equal(CONTROL_METHODS[method],undefined,method);
 assert.equal(templateMethods().has('capture_attachment_preview'),false);
});
test('without a vision model the site uploaded state passes; an old byte SHA proof is not accepted',async()=>{
 const field={id:'file',kind:'file',source:'resume',read:{selector:'#file'}},actual={present:true,uploadState:'site_rendered_uploaded',value:['resume.pdf']};
 const task={companyId:'fixture',roleId:'J000001',pageUrl:'https://example.test/form',values:{resume:'approved'},files:{approved:{paths:[process.argv[1]],displayNames:['resume.pdf']}}};
 await attachUploadContentProofs({act:async()=>assert.fail('No preview capture without a vision model')},{fields:{file:actual}},{fields:[field]},task);
 assert.equal(actual.attachmentVisualProof.kind,'site_upload_state');assert.equal(actual.attachmentVisualProof.status,'verified');
 const plan={companyId:'fixture',roleId:'J000001',pageUrl:task.pageUrl,roleTitle:'Role',fields:[{id:'file',label:'Resume',kind:'file',value:['resume.pdf']}]},observation={source:'live_dom',readAt:new Date().toISOString(),pageUrl:task.pageUrl,roleTitle:'Role',inventoryIds:['file'],fields:{file:{...actual}}};
 assert.equal(verifyForm(plan,observation).status,'verified');
 observation.fields.file={...actual,attachmentVisualProof:{status:'verified',kind:'downloaded_content_sha256',actualSha256:'a'.repeat(64)}};assert.equal(verifyForm(plan,observation).status,'needs_attention');
});

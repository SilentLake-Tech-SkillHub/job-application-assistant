import test from 'node:test';import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {screenshotUploadedImage} from '../shared/image-preview-screenshot.mjs';
import {CONTROL_METHODS,templateMethods} from '../shared/control-registry.mjs';
test('an already-loaded image uses the native screenshot bridge without injecting or claiming new pixels',async()=>{
 let options;
 const page={request:{get:()=>{throw Error('MUST_NOT_FETCH');}},evaluate:async()=>({status:'visible',selector:'#portrait',width:90,height:116,naturalWidth:225,naturalHeight:290,ancestors:['#photo','body']}),locator:selector=>{assert.equal(selector,'#portrait');return {count:async()=>1,screenshot:async opts=>{options=opts;await writeFile(opts.path,'synthetic screenshot');}};}};
 const result=await screenshotUploadedImage({page,resolveSpec:async spec=>spec},{selector:'#photo',reviewKey:'0'.repeat(64)});
 try{assert.deepEqual(result.renderedSize,{width:90,height:116});assert.equal(options.style,undefined);assert.deepEqual(result.naturalSize,{width:225,height:290});assert.equal(result.downloaded,false);assert.equal(result.byteIdentityVerified,false);}finally{await unlink(result.path);}
 assert.equal(CONTROL_METHODS.capture_attachment_preview.inspection,true);assert.equal(templateMethods().has('capture_attachment_preview'),false);
});
test('missing or ambiguous visible images and arbitrary output paths cannot be captured',async()=>{
 const adapter={resolveSpec:async s=>s,page:{evaluate:async()=>({status:'unavailable'})}};
 await assert.rejects(screenshotUploadedImage(adapter,{selector:'#photo',reviewKey:'../escape'}),/SCOPE_REQUIRED/);
 await assert.rejects(screenshotUploadedImage(adapter,{selector:'#photo',reviewKey:'1'.repeat(64)}),/PREVIEW_UNAVAILABLE/);
});

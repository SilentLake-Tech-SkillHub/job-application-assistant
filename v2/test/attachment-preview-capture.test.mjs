import test from 'node:test';import assert from 'node:assert/strict';import {writeFile,rm} from 'node:fs/promises';import {captureAttachmentPreview,attachmentPreviewTargetDOM,previewPagesDOM} from '../shared/image-preview-screenshot.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function fixture({pages=2,count=2,popup=false,beforeDialogs=[],known=true,blockedInteraction=false}={}){
 let previewClicks=0,closed=0,downloadCalls=0,handler,original='https://example.test/form';const captured=[];
 const close={count:async()=>1,evaluate:async()=>true,click:async()=>closed++},dialog={filter(){return this;},count:async()=>1,locator:()=>close};
 const frame={url:()=> 'https://viewer.example.test/actual-document',evaluate:async()=>({blockedInteraction,pages:known?Array.from({length:pages},(_,i)=>({number:i+1,selector:'#page-'+(i+1)})):[],declaredCounts:count?[count]:[],documentDialogSelector:'#new-document'}),locator:selector=>({count:async()=>1,scrollIntoViewIfNeeded:async()=>{},evaluate:async()=>true,screenshot:async options=>{assert.equal(options.style,undefined);captured.push(selector);await writeFile(options.path,png);}})};
 const popupPage={frames:()=>[frame],close:async()=>closed++};
 const control={count:async()=>1,click:async()=>{previewClicks++;if(popup)handler(popupPage);}};
 const page={url:()=>original,request:{get:()=>{downloadCalls++;assert.fail('No file fetch');}},on:(event,fn)=>{if(event==='popup')handler=fn;},off:()=>{},frames:()=>[frame],evaluate:async fn=>fn===attachmentPreviewTargetDOM?{kind:'preview_control',selector:'#actual-preview'}:fn===previewPagesDOM?{pages:[],declaredCounts:[],dialogSelectors:beforeDialogs}:null,locator:selector=>selector==='#actual-preview'?control:dialog};
 const adapter={page,resolveSpec:async spec=>spec};return {adapter,state:()=>({previewClicks,closed,downloadCalls,captured}),setUrl:url=>original=url};
}
const action={selector:'#current-file',filename:'resume.pdf',reviewKey:'d'.repeat(64)};
test('the current preview control yields every real declared PDF page with no download',async()=>{
 const f=fixture(),result=await captureAttachmentPreview(f.adapter,action,{timeoutMs:20});try{assert.equal(result.complete,true);assert.equal(result.pageCount,2);assert.deepEqual(result.pages.map(p=>p.pageNumber),[1,2]);assert.deepEqual(f.state(),{previewClicks:1,closed:1,downloadCalls:0,captured:['#page-1','#page-2']});}finally{if(result.pages?.[0])await rm(new URL('.', 'file://'+result.pages[0].path),{recursive:true,force:true});}
});
test('a page-count or coverage gap is never called a complete capture',async()=>{
 for(const params of [{pages:1,count:2},{pages:2,count:null}]){const f=fixture(params),result=await captureAttachmentPreview(f.adapter,action,{timeoutMs:20});assert.equal(result.status,'technical_pending');assert.equal(result.reason,'PDF_PREVIEW_PAGE_COVERAGE_INCOMPLETE');assert.equal(f.state().captured.length,0);assert.equal(f.state().downloadCalls,0);}
});
test('unknown, login or CAPTCHA popup contents remain open and pending',async()=>{
 for(const popup of [false,true]){const f=fixture({known:false,popup}),result=await captureAttachmentPreview(f.adapter,action,{timeoutMs:5});assert.equal(result.status,'technical_pending');assert.equal(result.reason,'PDF_PREVIEW_PAGE_COUNT_UNAVAILABLE');assert.equal(f.state().closed,0);assert.equal(f.state().downloadCalls,0);}
});
test('an existing unrelated dialog is never closed even when preview pages are observable',async()=>{
 const f=fixture({beforeDialogs:['#new-document']}),result=await captureAttachmentPreview(f.adapter,{...action,reviewKey:'e'.repeat(64)},{timeoutMs:20});try{assert.equal(result.complete,true);assert.equal(f.state().closed,0);}finally{if(result.pages?.[0])await rm(new URL('.', 'file://'+result.pages[0].path),{recursive:true,force:true});}
});

test('a login or CAPTCHA control preserves its popup even when PDF nodes are underneath',async()=>{const f=fixture({popup:true,blockedInteraction:true}),result=await captureAttachmentPreview(f.adapter,action,{timeoutMs:10});assert.equal(result.reason,'ATTACHMENT_PREVIEW_REQUIRES_USER_AUTHENTICATION');assert.equal(f.state().closed,0);assert.equal(f.state().captured.length,0);});

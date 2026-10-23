import test from 'node:test';import assert from 'node:assert/strict';
import {performAttachmentRemoval} from '../shared/uploaded-file-removal.mjs';
import {templateMethods,CONTROL_METHODS} from '../shared/control-registry.mjs';
import {controlDOM} from '../shared/control-dom.mjs';
const ref=(part,filename)=>'uploadq:'+JSON.stringify({label:'Other attachments',occurrence:0,part,...(filename?{filename}:{})});
const action=()=>({method:'remove_uploaded_file',authorized:true,selector:ref('input'),containerSelector:ref('container'),filenameSelector:'.filename',removeSelector:ref('remove','photo.jpg'),expectedFilename:'photo.jpg'});
function fixture(names=['photo.jpg','keep.pdf']){let clicks=0;const root={count:async()=>1,locator:()=>({filter(){return this;},allTextContents:async()=>names})},button={filter(){return this;},count:async()=>1,click:async()=>{clicks++;names.splice(names.indexOf('photo.jpg'),1);}};return {adapter:{resolveSelector:async s=>s,page:{locator:s=>s===ref('container')?root:button}},names,clicks:()=>clicks};}
test('attachment removal needs exact authorized captured file identity and preserves every other file',async()=>{
 const f=fixture();assert.deepEqual(await performAttachmentRemoval(f.adapter,action()),{status:'removed_verified',remaining:1});assert.deepEqual(f.names,['keep.pdf']);assert.equal(f.clicks(),1);
 assert.equal(templateMethods().has('remove_uploaded_file'),false);assert.equal(CONTROL_METHODS.remove_uploaded_file.inspection,false);
 for(const patch of [{authorized:false},{removeSelector:ref('remove','another.jpg')},{selector:'button.delete'}]){const b=fixture();await assert.rejects(performAttachmentRemoval(b.adapter,{...action(),...patch}),/AUTHORIZATION_REQUIRED|SCOPE_MISMATCH/);assert.equal(b.clicks(),0);}
 const ambiguous=fixture(['photo.jpg','photo.jpg']);await assert.rejects(performAttachmentRemoval(ambiguous.adapter,action()),/PREVIOUS_FILE_CHANGED/);assert.equal(ambiguous.clicks(),0);
});
test('upload identity ignores filename headings and empty upload placeholders',()=>{
 const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;let uploaded=true;
 const node=(tagName,innerText='',extra={})=>({tagName,innerText,getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[],...extra});
 const body=node('BODY'),heading=node('H2','Other attachments'),name=node('H3','photo.jpg'),placeholder=node('H3','Upload attachment');
 const button=node('BUTTON'),icon=node('SPAN','',{getAttribute:k=>k==='aria-label'?'delete':null,closest:()=>button});
 const row=node('DIV','',{parentElement:null,querySelectorAll:s=>s==='input[type="file"]'?[input]:s.includes('file-name')?[uploaded?name:placeholder]:s.startsWith('button,')&&uploaded?[icon]:[]});
 name.parentElement=row;placeholder.parentElement=row;
 const outer=node('DIV','',{parentElement:body,querySelectorAll:s=>s==='input[type="file"]'?[input]:s.startsWith('h1,')?[heading,uploaded?name:placeholder]:s.includes('file-name')?[uploaded?name:placeholder]:[]});row.parentElement=outer;
 const input=node('INPUT','',{parentElement:row,closest:s=>s==='.ant-upload'?row:null});
 try{
  globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.document={body,querySelectorAll:s=>s==='input[type="file"]'?[input]:[]};
  const reference=part=>'uploadq:'+JSON.stringify({label:'Other attachments',occurrence:0,part});
  assert.ok(controlDOM({operation:'resolveUpload',references:[reference('filenames')]})[0]);
  uploaded=false;assert.equal(controlDOM({operation:'resolveUpload',references:[reference('filenames')]})[0],null);
  assert.equal(controlDOM({operation:'resolveUpload',references:[reference('uploaded')]})[0],null);
 }finally{globalThis.document=previousDocument;globalThis.getComputedStyle=previousStyle;}
});
test('custom upload uses the rendered filename and completion marker, never a local FileList',()=>{
 const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;let complete=true;
 const node=(tagName,innerText='',extra={})=>({tagName,innerText,getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[],...extra}),body=node('BODY'),heading=node('H2','Resume attachment'),name=node('SPAN','current.pdf'),status=node('SPAN','0.29M·已完成');
 const row=node('DIV','',{querySelectorAll:s=>s==='input[type="file"]'?[input]:s.startsWith('a,span,')?[name]:s==='*'&&complete?[name,status]:[]});name.parentElement=row;
 const outer=node('DIV','',{parentElement:body,querySelectorAll:s=>s==='input[type="file"]'?[input]:s.startsWith('h1,')?[heading]:s.startsWith('a,span,')?[name]:s==='*'&&complete?[name,status]:[]});row.parentElement=outer;
 const input=node('INPUT','',{parentElement:row,files:[{name:'local-only.pdf'}],closest:s=>s==='.ant-upload'?row:null});
 try{globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.document={body,querySelectorAll:s=>s==='input[type="file"]'?[input]:[]};const reference='uploadq:'+JSON.stringify({label:'Resume attachment',occurrence:0,part:'filenames'});assert.ok(controlDOM({operation:'resolveUpload',references:[reference]})[0]);complete=false;assert.equal(controlDOM({operation:'resolveUpload',references:[reference]})[0],null);}finally{globalThis.document=previousDocument;globalThis.getComputedStyle=previousStyle;}
});

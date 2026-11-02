import {mkdir,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
// Capture only the already-loaded image through the trusted native screenshot
// bridge. No DOM style injection, src assignment, resizing claim or file fetch.
export async function screenshotUploadedImage(adapter,action){
 if(!/^[a-f0-9]{64}$/.test(action.reviewKey||''))throw Error('IMAGE_PREVIEW_SCOPE_REQUIRED');
 const resolved=await adapter.resolveSpec({selector:action.selector});
 const reader=new URL('./control-dom.mjs',import.meta.url);reader.searchParams.set('revision',String((await stat(reader)).mtimeMs));const {controlDOM}=await import(reader.href);
 const info=await adapter.page.evaluate(controlDOM,{operation:'resolveImagePreview',containerSelector:resolved.selector});
 if(info?.status!=='visible'||!info.selector)throw Error('IMAGE_PREVIEW_UNAVAILABLE');
 const target=adapter.page.locator(info.selector);if(await target.count()!==1)throw Error('IMAGE_PREVIEW_NOT_UNIQUE');
 const width=info.width||info.naturalWidth,height=info.height||info.naturalHeight;
 const dir=path.join(tmpdir(),'recruiting-image-preview-'+process.getuid());await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,action.reviewKey+'.png');
 await target.screenshot({path:file,timeout:10000});await chmod(file,0o600);
 return {path:file,scope:'visible_image_preview',renderedSize:{width,height},naturalSize:{width:info.naturalWidth,height:info.naturalHeight},downloaded:false,byteIdentityVerified:false};
}

// Resolve only an actual preview action inside the selected file card. A
// download control or a filename-only link never qualifies as a preview.
export function attachmentPreviewTargetDOM(spec){
 const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const roots=[...document.querySelectorAll(spec.containerSelector)].filter(visible);if(roots.length!==1)return null;const root=roots[0];
 const images=[...root.querySelectorAll('img')].filter(n=>visible(n)&&n.complete&&n.naturalWidth>=100&&n.naturalHeight>=100);
 if(images.length===1)return {kind:'image',resource:images[0].currentSrc||images[0].src,naturalWidth:images[0].naturalWidth,naturalHeight:images[0].naturalHeight};
 const leaves=[...root.querySelectorAll('a,span,p,div')].filter(n=>visible(n)&&n.innerText?.trim()===spec.filename&&![...n.children].some(c=>visible(c)&&c.innerText?.trim()===spec.filename));if(leaves.length!==1)return null;
 let row=leaves[0];while(row.parentElement&&row.parentElement!==root&&!row.parentElement.classList?.contains('file-uploader__list-view'))row=row.parentElement;
 const named=[...row.querySelectorAll('button,a,[role="button"],[title],[aria-label]')].filter(n=>visible(n)&&/^(?:预览|查看|查看附件|查看文件|查看简历|preview|view|view file)$/i.test((n.getAttribute('aria-label')||n.getAttribute('title')||n.innerText||'').trim()));
 const previewPath='M.156 8.464c.117-.185.33-.487.633-.868.5-.628 1.079-1.254 1.735-1.841C4.437 4.042 6.608 3 9 3c2.38 0 4.549 1.042 6.466 2.754a15.213 15.213 0 0 1 1.74 1.84c.304.38.518.682.636.867a1 1 0 0 1-.002 1.081c-.118.184-.333.486-.64.866a15.36 15.36 0 0 1-1.744 1.839C13.535 13.958 11.37 15 9 15c-2.38 0-4.549-1.042-6.466-2.754a15.213 15.213 0 0 1-1.74-1.84c-.304-.38-.518-.682-.636-.867a1 1 0 0 1-.002-1.075zM1 9s3.2 5 8 5c4.775 0 8-5 8-5s-3.2-5-8-5C4.175 4 1 9 1 9zm5 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm1 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0z';
 for(const svg of row.querySelectorAll('svg'))if(visible(svg)&&[...svg.querySelectorAll('path')].some(p=>p.getAttribute('d')===previewPath))named.push(svg.parentElement);
 const candidates=[...new Set(named)];if(candidates.length!==1)return null;const n=candidates[0];
 if(/下载|删除|提交|投递|同意|download|delete|submit|agree/i.test(n.getAttribute('aria-label')||n.getAttribute('title')||n.innerText||''))return null;
 const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
 return {kind:'preview_control',selector:'body > '+parts.join(' > '),label:(n.getAttribute('aria-label')||n.getAttribute('title')||n.innerText||'').trim()};
}
export function previewPagesDOM(){
 const selector=n=>{const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}return 'body > '+parts.join(' > ');};
 const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const blockedInteraction=[...document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],input[name*="captcha" i],input[id*="captcha" i],iframe[src*="recaptcha"],iframe[src*="captcha"]')].some(visible);
 const pageNodes=[...document.querySelectorAll('.page[data-page-number],[data-page-number].pdf-page')].filter(visible);
 const pages=pageNodes.map(n=>({number:Number(n.getAttribute('data-page-number')),selector:'[data-page-number="'+n.getAttribute('data-page-number')+'"]'}));
 const declared=[...document.querySelectorAll('[data-page-count],#numPages,input#pageNumber[max]')].filter(visible).map(n=>Number(n.getAttribute('data-page-count')||n.getAttribute('max')||(n.innerText||'').match(/\d+/g)?.at(-1))).filter(n=>Number.isInteger(n)&&n>0);
 const dialogs=[...document.querySelectorAll('[role="dialog"],.phoenix-modal')].filter(visible),owners=[...new Set(pageNodes.map(n=>n.closest('[role="dialog"],.phoenix-modal')).filter(Boolean))];
 return {blockedInteraction,pages,declaredCounts:[...new Set(declared)],dialogSelectors:dialogs.map(selector),documentDialogSelector:owners.length===1?selector(owners[0]):null};
}
export async function captureAttachmentPreview(adapter,action,{timeoutMs=8000,renderTimeoutMs=5000}={}){
 const pending=reason=>({status:'technical_pending',reason,downloaded:false,fileBytesHashed:false});
 if(!action.filename||!/^[a-f0-9]{64}$/.test(action.reviewKey||''))return pending('ATTACHMENT_PREVIEW_SCOPE_REQUIRED');
 const resolved=await adapter.resolveSpec({selector:action.selector}),before=adapter.page.url(),target=await adapter.page.evaluate(attachmentPreviewTargetDOM,{containerSelector:resolved.selector,filename:action.filename});
 if(!target)return pending('ATTACHMENT_PREVIEW_NOT_OFFERED');
 if(target.kind==='image'){
  const artifact=await screenshotUploadedImage(adapter,{...action,selector:resolved.selector});
  return {status:'captured',pages:[{pageNumber:1,path:artifact.path,mimeType:'image/png'}],pageCount:1,complete:true,previewId:JSON.stringify([target.resource,target.naturalWidth,target.naturalHeight]),artifactRevision:JSON.stringify([target.resource,target.naturalWidth,target.naturalHeight]),downloaded:false,fileBytesHashed:false};
 }
 const control=adapter.page.locator(target.selector);if(await control.count()!==1)return pending('ATTACHMENT_PREVIEW_TARGET_CHANGED');
 let popup=null,opened=false,identifiedDocument=false,ownedDialog=null;const notice=p=>popup=p;adapter.page.on?.('popup',notice);
 const dir=path.join(tmpdir(),'recruiting-document-preview-'+process.getuid(),action.reviewKey);await mkdir(dir,{recursive:true,mode:0o700});
 try{
  const beforeDialogs=(await adapter.page.evaluate(previewPagesDOM)).dialogSelectors||[];
  await control.click({timeout:10000});opened=true;const deadline=Date.now()+timeoutMs;let owner=null,observed;
  do{
   const host=popup||adapter.page,frames=typeof host.frames==='function'?host.frames():[host],hits=[];let blockedInteraction=false;
   for(const frame of frames){try{const data=await frame.evaluate(previewPagesDOM);if(data.blockedInteraction)blockedInteraction=true;if(data.pages.length)hits.push({frame,data});}catch{}}
   if(blockedInteraction)return pending('ATTACHMENT_PREVIEW_REQUIRES_USER_AUTHENTICATION');
   if(hits.length===1){owner=hits[0].frame;observed=hits[0].data;identifiedDocument=true;ownedDialog=observed.documentDialogSelector&&!beforeDialogs.includes(observed.documentDialogSelector)?observed.documentDialogSelector:null;if(!popup&&typeof owner.frameElement==='function'){const element=await owner.frameElement().catch(()=>null);if(element&&!ownedDialog)ownedDialog=await element.evaluate(n=>{const d=n.closest('[role="dialog"],.phoenix-modal');if(!d)return null;const parts=[];for(let p=d;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}return 'body > '+parts.join(' > ');});if(beforeDialogs.includes(ownedDialog))ownedDialog=null;}break;}
   if(hits.length>1)return pending('ATTACHMENT_PREVIEW_DOCUMENT_AMBIGUOUS');
   if(Date.now()>=deadline)return pending('PDF_PREVIEW_PAGE_COUNT_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));
  }while(true);
  const pages=observed.pages.sort((a,b)=>a.number-b.number),count=observed.declaredCounts.length===1?observed.declaredCounts[0]:null;
  if(!count||count>40||pages.length!==count||pages.some((p,i)=>p.number!==i+1))return pending('PDF_PREVIEW_PAGE_COVERAGE_INCOMPLETE');
  const artifacts=[];
  for(const item of pages){
   const node=owner.locator(item.selector);if(await node.count()!==1)return pending('PDF_PREVIEW_PAGE_AMBIGUOUS');await node.scrollIntoViewIfNeeded({timeout:5000});
   const end=Date.now()+renderTimeoutMs;let ready=false;
   do{ready=await node.evaluate(n=>{const canvas=n.querySelector('canvas'),img=n.querySelector('img');return !!(canvas&&canvas.width>=600&&canvas.height>=600||img&&img.complete&&img.naturalWidth>=600&&img.naturalHeight>=600);});if(ready)break;if(Date.now()>=end)return pending('PDF_PREVIEW_PAGE_NOT_RENDERED');await new Promise(r=>setTimeout(r,100));}while(true);
   const file=path.join(dir,'page-'+item.number+'.png');await node.screenshot({path:file,timeout:10000});await chmod(file,0o600);artifacts.push({pageNumber:item.number,path:file,mimeType:'image/png'});
  }
  if(adapter.page.url()!==before)return pending('ATTACHMENT_PREVIEW_CHANGED_APPLICATION_PAGE');
  const previewId=typeof owner.url==='function'?owner.url():before;
  return {status:'captured',pages:artifacts,pageCount:count,complete:true,previewId,artifactRevision:action.artifactRevision||previewId,downloaded:false,fileBytesHashed:false};
 }finally{
  adapter.page.off?.('popup',notice);
  if(popup&&identifiedDocument&&adapter.page.url()===before){await popup.close().catch(()=>{});}
  else if(opened&&identifiedDocument&&ownedDialog&&adapter.page.url()===before){
   const dialogs=adapter.page.locator(ownedDialog).filter({visible:true});
   if(await dialogs.count()===1){const close=dialogs.locator('button.phoenix-modal__close,button.ant-modal-close');if(await close.count()===1&&await close.evaluate(n=>n.tagName==='BUTTON'&&n.type==='button'&&!/同意|提交|投递|agree|submit/i.test(n.innerText||n.getAttribute('aria-label')||'')))await close.click({timeout:5000}).catch(()=>{});}
  }
 }
}

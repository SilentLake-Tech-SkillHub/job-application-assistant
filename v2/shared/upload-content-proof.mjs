import {createHash} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {uploadOriginMatches,uploadOriginKey,uploadOriginScope} from './upload-origin.mjs';

// The current uploaded file is retrieved from the site and hashed. Retrieval is
// located generically inside that file's own row (see control-dom
// resolveUploadDownload). A renamed file passes only when its bytes match the
// frozen approved source.
//   UPLOAD_RETRIEVAL_NOT_OFFERED: the site shows no retrieval for this file.
//   UPLOAD_DOWNLOAD_HOST_REQUIRED: the site offers it, the browser host cannot.
//   UPLOAD_LINK_NOT_FILE: the file's link answers with a page/error, not a file.
const LIMIT=30*1024*1024;
async function fetchBody(page,url){
 if(!url||new URL(url).protocol!=='https:')throw Error('UPLOAD_DOWNLOAD_EMPTY');
 const response=await page.request.get(url,{timeout:15000,failOnStatusCode:false});
 if(!response.ok()||/html|json/i.test(response.headers()['content-type']||''))throw Error('UPLOAD_DOWNLOAD_RESPONSE_INVALID');
 const body=await response.body();if(!body.length||body.length>LIMIT)throw Error('UPLOAD_DOWNLOAD_EMPTY_OR_TOO_LARGE');
 return body;
}
const result=(action,actualSha256,bytes,retrieval,url)=>{
 const transformed=action.uploadOrigin?.sourceSha256===action.expectedSha256&&uploadOriginMatches(action.uploadOrigin,url);
 return {status:actualSha256===action.expectedSha256||transformed?'verified':'mismatch',kind:transformed?'source_upload_artifact_identity':'downloaded_content_sha256',expectedSha256:action.expectedSha256,actualSha256,uploadOriginMatched:!!transformed,bytes,retrieval,observedFilename:action.filename};
};
export async function verifyUploadedContent(adapter,action){
 if(typeof action.filename!=='string'||!action.filename||!/^[a-f0-9]{64}$/.test(action.expectedSha256||''))throw Error('UPLOAD_CONTENT_SCOPE_REQUIRED');
 const readerUrl=new URL('./control-dom.mjs',import.meta.url);readerUrl.searchParams.set('revision',String((await stat(readerUrl)).mtimeMs));const {controlDOM}=await import(readerUrl.href);
 const resolved=await adapter.resolveSpec({selector:action.selector});
 const target=await adapter.page.evaluate(controlDOM,{operation:'resolveUploadDownload',containerSelector:resolved.selector,filename:action.filename});
 if(!target?.selector)throw Error('UPLOAD_RETRIEVAL_NOT_OFFERED');
 const before=adapter.page.url(),control=adapter.page.locator(target.selector);
 if(await control.count()!==1)throw Error('UPLOAD_DOWNLOAD_CONTROL_CHANGED');
 if(target.via==='file_link'){
  if(typeof adapter.page.request?.get!=='function')throw Error('UPLOAD_DOWNLOAD_HOST_REQUIRED');
  // A link that answers with a page or an error is not the file (often an
  // online viewer): retrieval is unavailable, not a failed upload. Bytes that
  // do come back still have to match.
  let body;try{body=await fetchBody(adapter.page,target.url);}catch(error){if(/^UPLOAD_DOWNLOAD_(?:RESPONSE_INVALID|EMPTY|EMPTY_OR_TOO_LARGE)$/.test(error.message))throw Error('UPLOAD_LINK_NOT_FILE');throw error;}
  return {...result(action,createHash('sha256').update(body).digest('hex'),body.length,'authenticated_file_link',target.url),via:target.via};
 }
 if(typeof adapter.page.waitForEvent!=='function')throw Error('UPLOAD_DOWNLOAD_HOST_REQUIRED');
 const [download]=await Promise.all([adapter.page.waitForEvent('download',{timeout:15000}),control.click({timeout:10000})]);
 try{
  if(await download.failure())throw Error('UPLOAD_DOWNLOAD_FAILED');
  const stream=await download.createReadStream();if(!stream)throw Error('UPLOAD_DOWNLOAD_UNREADABLE');
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of stream){bytes+=chunk.length;if(bytes>LIMIT)throw Error('UPLOAD_DOWNLOAD_TOO_LARGE');digest.update(chunk);}
  if(adapter.page.url()!==before)throw Error('UPLOAD_DOWNLOAD_PAGE_CHANGED');
  let actualSha256=digest.digest('hex'),retrieval='browser_download';
  if(bytes===0){
   const url=typeof download.url==='function'?download.url():null;
   if(typeof adapter.page.request?.get!=='function')throw Error('UPLOAD_DOWNLOAD_EMPTY');
   const body=await fetchBody(adapter.page,url);bytes=body.length;
   actualSha256=createHash('sha256').update(body).digest('hex');retrieval='authenticated_observed_download_url';
  }
  return {...result(action,actualSha256,bytes,retrieval,download.url?.()),via:target.via};
 }finally{await download.delete?.();}
}

// Only a file the site shows under a different name needs its content
// retrieved: the upload step already checked the local bytes against the
// frozen source and observed the site accept them, so a same-name row is ours.
export async function attachUploadContentProofs(page,observation,plan,task,store){
 for(const field of plan.fields.filter(field=>field.kind==='file')){
  const actual=observation.fields?.[field.id],asset=task.files?.[task.values?.[field.source]];
  if(actual?.uploadState!=='site_rendered_uploaded'||actual.value?.length!==1||asset?.sha256?.length!==1||JSON.stringify(actual.value)===JSON.stringify(asset.displayNames))continue;
  try{let origin;if(store)try{origin=await store.get('runs',uploadOriginKey(task,field));if(origin.scopeHash!==uploadOriginScope(task,field))origin=null;}catch(error){if(error.code!=='ENOENT')throw error;}actual.uploadContentProof=await page.act({method:'verify_uploaded_file',selector:field.read.selector,filename:actual.value[0],expectedSha256:asset.sha256[0],...(origin?{uploadOrigin:origin}:{})},null,{});}
  catch(error){actual.uploadContentProof={status:'unverified',reason:/^[A-Z_]+$/.test(error.message)?error.message:'UPLOAD_DOWNLOAD_FAILED'};}
 }
 return observation;
}

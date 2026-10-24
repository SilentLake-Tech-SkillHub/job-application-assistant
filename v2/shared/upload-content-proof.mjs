import {createHash} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {uploadOriginMatches,uploadOriginKey,uploadOriginScope} from './upload-origin.mjs';

// Only the exact current card's source-verified download action is used. A
// renamed file passes only when its bytes match the frozen approved source.
export async function verifyUploadedContent(adapter,action){
 if(typeof action.filename!=='string'||!action.filename||!/^[a-f0-9]{64}$/.test(action.expectedSha256||''))throw Error('UPLOAD_CONTENT_SCOPE_REQUIRED');
 if(typeof adapter.page.waitForEvent!=='function')throw Error('UPLOAD_DOWNLOAD_HOST_REQUIRED');
 const readerUrl=new URL('./control-dom.mjs',import.meta.url);readerUrl.searchParams.set('revision',String((await stat(readerUrl)).mtimeMs));const {controlDOM}=await import(readerUrl.href);
 const resolved=await adapter.resolveSpec({selector:action.selector});
 const selector=await adapter.page.evaluate(controlDOM,{operation:'resolveUploadDownload',containerSelector:resolved.selector,filename:action.filename});
 if(!selector)throw Error('UPLOAD_VERIFIED_DOWNLOAD_CONTROL_REQUIRED');
 const before=adapter.page.url(),control=adapter.page.locator(selector);
 if(await control.count()!==1)throw Error('UPLOAD_DOWNLOAD_CONTROL_CHANGED');
 const [download]=await Promise.all([adapter.page.waitForEvent('download',{timeout:15000}),control.click({timeout:10000})]);
 try{
  if(await download.failure())throw Error('UPLOAD_DOWNLOAD_FAILED');
  const stream=await download.createReadStream();if(!stream)throw Error('UPLOAD_DOWNLOAD_UNREADABLE');
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of stream){bytes+=chunk.length;if(bytes>30*1024*1024)throw Error('UPLOAD_DOWNLOAD_TOO_LARGE');digest.update(chunk);}
  if(adapter.page.url()!==before)throw Error('UPLOAD_DOWNLOAD_PAGE_CHANGED');
  let actualSha256=digest.digest('hex'),retrieval='browser_download';
  if(bytes===0){
   const url=typeof download.url==='function'?download.url():null;
   if(!url||new URL(url).protocol!=='https:'||typeof adapter.page.request?.get!=='function')throw Error('UPLOAD_DOWNLOAD_EMPTY');
   const response=await adapter.page.request.get(url,{timeout:15000,failOnStatusCode:false});
   if(!response.ok()||/html|json/i.test(response.headers()['content-type']||''))throw Error('UPLOAD_DOWNLOAD_RESPONSE_INVALID');
   const body=await response.body();bytes=body.length;if(!bytes||bytes>30*1024*1024)throw Error('UPLOAD_DOWNLOAD_EMPTY_OR_TOO_LARGE');
   actualSha256=createHash('sha256').update(body).digest('hex');retrieval='authenticated_observed_download_url';
  }
  const transformed=action.uploadOrigin?.sourceSha256===action.expectedSha256&&uploadOriginMatches(action.uploadOrigin,download.url?.());
  return {status:actualSha256===action.expectedSha256||transformed?'verified':'mismatch',kind:transformed?'source_upload_artifact_identity':'downloaded_content_sha256',expectedSha256:action.expectedSha256,actualSha256,uploadOriginMatched:!!transformed,bytes,retrieval,observedFilename:action.filename};
 }finally{await download.delete?.();}
}

export async function attachUploadContentProofs(page,observation,plan,task,store){
 for(const field of plan.fields.filter(field=>field.kind==='file')){
  const actual=observation.fields?.[field.id],asset=task.files?.[task.values?.[field.source]];
  if(actual?.uploadState!=='site_rendered_uploaded'||actual.value?.length!==1||asset?.sha256?.length!==1||JSON.stringify(actual.value)===JSON.stringify(asset.displayNames))continue;
  try{let origin;if(store)try{origin=await store.get('runs',uploadOriginKey(task,field));if(origin.scopeHash!==uploadOriginScope(task,field))origin=null;}catch(error){if(error.code!=='ENOENT')throw error;}actual.uploadContentProof=await page.act({method:'verify_uploaded_file',selector:field.read.selector,filename:actual.value[0],expectedSha256:asset.sha256[0],...(origin?{uploadOrigin:origin}:{})},null,{});}
  catch(error){actual.uploadContentProof={status:'unverified',reason:/^[A-Z_]+$/.test(error.message)?error.message:'UPLOAD_DOWNLOAD_FAILED'};}
 }
 return observation;
}

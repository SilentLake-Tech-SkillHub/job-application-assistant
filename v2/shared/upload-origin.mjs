import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const uploadOriginScope=(task,field)=>hash({companyId:task.companyId,roleId:task.roleId||null,pageUrl:task.pageUrl,templateHash:task.templateHash,fieldId:field.id});
export const uploadOriginKey=(task,field)=>'upload-origin-'+uploadOriginScope(task,field).slice(0,24);

export function uploadArtifactBindings(value){
 const paths=new Set(),ids=new Set();
 const visit=(item,key='',fileObject=false)=>{
  if(item&&typeof item==='object'){
   if(Array.isArray(item)){item.slice(0,50).forEach(value=>visit(value,key,fileObject));return;}
   const file=Object.keys(item).some(key=>/^(?:fileName|originalName)$/i.test(key));
   for(const [key,value]of Object.entries(item))if(!/token|secret|cookie|password|authorization/i.test(key))visit(value,key,file);
  }else if(typeof item==='string'&&item.length<=2048){
   if(/^https:\/\//.test(item)&&(!key||/url|path/i.test(key))){const url=new URL(item);if(!url.username&&!url.password)paths.add(url.origin+url.pathname);}
   else if((/^(?:file|attachment|material|resource)(?:id|key)$/i.test(key)||fileObject&&/^id$/i.test(key))&&/^[a-z0-9_-]{8,100}$/i.test(item))ids.add(item);
  }
 };
 visit(value);return {resourcePaths:[...paths].slice(0,20),fileIds:[...ids].slice(0,20)};
}
export function uploadOriginMatches(origin,url){
 if(origin?.status!=='verified')return false;
 let parsed;try{parsed=new URL(url);}catch{return false;}
 if(parsed.protocol!=='https:')return false;
 if(origin.resourcePaths?.includes(parsed.origin+parsed.pathname))return true;
 const parts=[...parsed.pathname.split('/'),...[...parsed.searchParams].filter(([key])=>/^(?:file|attachment|material|resource)?id$/i.test(key)).map(([,value])=>value)].map(part=>decodeURIComponent(part));
 return (origin.fileIds||[]).some(id=>parts.some(part=>part===id||part.replace(/\.[a-z0-9]+$/i,'')===id));
}

// Observe the acknowledgement of this native file-selection action. This is
// artifact metadata only, never proof of source bytes; visual review decides
// content matching. No file read, digest or POST-body comparison occurs here.
export async function uploadWithOrigin(page,input,asset,_legacyBuffers,{timeoutMs=2500,http1Resource}={}){
 if(!asset?.paths?.length){throw Error('FILE_REFERENCE_MISSING');}
 let matcher,handler,transportRecovery;
 if(http1Resource){
  const resource=new URL(http1Resource);if(resource.protocol!=='https:'||resource.origin!==new URL(page.url()).origin||resource.search||resource.hash||typeof page.route!=='function'||typeof page.on!=='function')throw Error('UPLOAD_TRANSPORT_SCOPE_MISMATCH');
  transportRecovery={mode:'http1',attempted:false};matcher=url=>url.origin+url.pathname===http1Resource;
  handler=async route=>{if(!['POST','PUT'].includes(route.request().method()))return route.continue();transportRecovery.attempted=true;try{const response=await route.fetch({timeout:40000,maxRetries:0,maxRedirects:0});transportRecovery.responseStatus=response.status();await route.fulfill({response});}catch{transportRecovery.error='HTTP1_UPLOAD_FAILED';await route.abort('failed');}};
  await page.route(matcher,handler,{times:1});
 }
 if(typeof page.on!=='function'){await input.setInputFiles(asset.paths);return {status:'unverified',reason:'UPLOAD_ACK_HOST_UNAVAILABLE'};}
 let receipt=null,finish;const ready=new Promise(resolve=>finish=resolve);
 const response=async event=>{try{if(!event.ok()||event.request().method()!=='POST')return;const data=await event.json(),bindings=uploadArtifactBindings(data);if(!bindings.resourcePaths.length&&!bindings.fileIds.length)return;receipt={status:'ack_observed',kind:'upload_artifact_metadata',responseStatus:event.status(),...bindings,sourceBytesVerified:false};finish();}catch{}};
 page.on('response',response);let timer;
 try{await input.setInputFiles(asset.paths);await Promise.race([ready,new Promise(resolve=>timer=setTimeout(resolve,http1Resource?45000:timeoutMs))]);return {...(receipt||{status:'unverified',reason:'UPLOAD_ACK_NOT_OBSERVED',sourceBytesVerified:false}),...(transportRecovery?{transportRecovery}:{})};}
 finally{clearTimeout(timer);page.off('response',response);if(matcher)await page.unroute(matcher,handler);}
}

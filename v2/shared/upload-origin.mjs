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

// Arm only around this field's frozen upload. A success response is useful
// solely when the request actually contained the approved source bytes and
// returned an artifact identity that independent retrieval can match.
export async function uploadWithOrigin(page,input,asset,buffers,{timeoutMs=8000}={}){
 if(asset.sha256?.length!==1||buffers.length!==1||!buffers[0].length||typeof page.on!=='function'){
  await input.setInputFiles(asset.paths);return {status:'unverified',reason:'UPLOAD_ORIGIN_HOST_REQUIRED'};
 }
 const matches=new Set();let receipt=null,release;
 const ready=new Promise(resolve=>{release=resolve;});
 const request=event=>{try{if(event.method()!=='POST'||new URL(event.url()).protocol!=='https:')return;const body=event.postDataBuffer();if(body&&(body.includes(buffers[0])||body.includes(Buffer.from(buffers[0].toString('base64')))))matches.add(event);}catch{}};
 const response=async event=>{
  try{
   const req=event.request();if(!matches.has(req)||!event.ok())return;
   const data=await event.json(),bindings=uploadArtifactBindings(data);
   if(!bindings.resourcePaths.length&&!bindings.fileIds.length)return;
   receipt={status:'verified',kind:'source_bytes_upload_ack',sourceSha256:asset.sha256[0],requestUrlHash:hash(req.url()),responseStatus:event.status(),...bindings};release();
  }catch{}
 };
 page.on('request',request);page.on('response',response);let timer;
 try{await input.setInputFiles(asset.paths);await Promise.race([ready,new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);return receipt||{status:'unverified',reason:'UPLOAD_SOURCE_ACK_NOT_OBSERVED'};}
 finally{clearTimeout(timer);page.off('request',request);page.off('response',response);}
}

import {genericSourceManifest} from '../shared/runtime-identity.mjs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,lstat,chmod,unlink} from 'node:fs/promises';

export const name='recruiting-vision-bridge';
export const inject=['llm','attachments'];
const safeError=error=>/^[A-Z_]+$/.test(error?.message||'')?error.message:'HOST_VISION_CALL_FAILED';
export async function reviewWithHost(ctx,config,request,{signal}={}){
 const provider=config.provider,model=config.model;
 if(!provider||!model)throw Error('HOST_VISION_MODEL_REQUIRED');
 const llm=ctx.get?.('llm')||ctx.llm,attachments=ctx.get?.('attachments')||ctx.attachments;
 if(!llm||!attachments)throw Error('HOST_VISION_SERVICES_UNAVAILABLE');
 const info=await llm.resolveModelInfo(provider,model,signal);
 if(!info.inputModalities?.includes('image'))throw Error('HOST_VISION_MODEL_IMAGE_CAPABILITY_REQUIRED');
 if(!Array.isArray(request.messages)||request.messages.length>180||request.includeContext!=='none')throw Error('HOST_VISION_REQUEST_INVALID');
 let imageCount=0;const messages=[];
 for(const message of request.messages){
  if(message.role!=='user')throw Error('HOST_VISION_REQUEST_INVALID');
  const content=[];
  for(const block of Array.isArray(message.content)?message.content:[message.content]){
   if(block?.type==='text'&&typeof block.text==='string'&&block.text.length<120000)content.push({type:'text',text:block.text});
   else if(block?.type==='image'&&['image/png','image/jpeg'].includes(block.mimeType)&&typeof block.data==='string'){
    const data=Buffer.from(block.data,'base64');if(!data.length||data.length>8*1024*1024)throw Error('HOST_VISION_IMAGE_INVALID');
    const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=data[0]===255&&data[1]===216;
    if(block.mimeType==='image/png'?!png:!jpeg)throw Error('HOST_VISION_IMAGE_INVALID');
    const [attachment]=await attachments.saveImages([{data,mediaType:block.mimeType}]);
    if(!attachment)throw Error('HOST_VISION_IMAGE_STORAGE_FAILED');
    content.push({type:'image',attachment});imageCount++;
   }else throw Error('HOST_VISION_CONTENT_UNSUPPORTED');
  }
  messages.push({role:'user',content});
 }
 if(imageCount<2||imageCount>80)throw Error('HOST_VISION_IMAGE_COVERAGE_REQUIRED');
 const callId=randomUUID(),parts=new Map();let providerResponseId=null,finished=false;
 for await(const chunk of llm.stream({provider,model,messages,system:request.systemPrompt,maxTokens:Math.min(4000,request.maxTokens||2200),signal})){
  if(chunk.type==='text-delta')parts.set(chunk.index,(parts.get(chunk.index)||'')+chunk.text);
  if(chunk.type==='block-end'&&chunk.block?.type==='text')parts.set(chunk.index,chunk.block.text);
  if(chunk.type==='finish'){if((typeof chunk.reason==='string'?chunk.reason:chunk.reason?.kind)!=='stop')throw Error('HOST_VISION_RESPONSE_INCOMPLETE');finished=true;providerResponseId=chunk.replayState?.response?.id||chunk.replayState?.responseId||null;}
 }
 const text=[...parts].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join('\n');
 if(!finished||!text.trim())throw Error('HOST_VISION_RESPONSE_INCOMPLETE');
 return {role:'assistant',model,content:{type:'text',text},_meta:{provider,callId,providerResponseId}};
}
export async function startVisionBridge(ctx,config){
 const runtime=await genericSourceManifest();
 const socketPath=config.socketPath;
 if(!path.isAbsolute(socketPath||'')||Buffer.byteLength(socketPath)>100)throw Error('HOST_VISION_SOCKET_INVALID');
 await mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});
 try{
  const existing=await lstat(socketPath);
  if(!existing.isSocket()||typeof process.getuid==='function'&&existing.uid!==process.getuid())throw Error('HOST_VISION_SOCKET_ALREADY_EXISTS');
  const stale=await new Promise(resolve=>{const socket=net.createConnection(socketPath);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',error=>resolve(['ENOENT','ECONNREFUSED'].includes(error.code)));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});
  if(!stale)throw Error('HOST_VISION_SOCKET_ALREADY_EXISTS');
  const current=await lstat(socketPath);
  if(current.ino!==existing.ino||current.dev!==existing.dev)throw Error('HOST_VISION_SOCKET_CHANGED');
  await unlink(socketPath);
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let busy=false;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  const reply=(status,result)=>{res.writeHead(status);res.end(JSON.stringify(result));};
  if(req.method==='GET'&&req.url==='/status'){
   try{const llm=ctx.get?.('llm')||ctx.llm,info=await llm.resolveModelInfo(config.provider,config.model);reply(200,{available:info.inputModalities?.includes('image')===true,provider:config.provider,model:config.model,implementation:'host_llm',sampling:false,runtime});}catch{reply(503,{available:false,error:'HOST_VISION_SERVICES_UNAVAILABLE'});}return;
  }
  if(req.method!=='POST'||req.url!=='/review'){reply(404,{error:'HOST_VISION_ROUTE_NOT_FOUND'});return;}
  if(busy){reply(409,{error:'HOST_VISION_BUSY'});return;}busy=true;
  const controller=new AbortController(),timer=setTimeout(()=>{controller.abort();if(!req.complete)req.destroy();},85000);timer.unref?.();
  try{
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>48*1024*1024)throw Error('HOST_VISION_REQUEST_TOO_LARGE');chunks.push(chunk);}
   let request;try{request=JSON.parse(Buffer.concat(chunks));}catch{throw Error('HOST_VISION_REQUEST_INVALID');}
   const timeout=new Promise((_,reject)=>{if(controller.signal.aborted)reject(Error('HOST_VISION_TIMEOUT'));else controller.signal.addEventListener('abort',()=>reject(Error('HOST_VISION_TIMEOUT')),{once:true});});
   const result=await Promise.race([reviewWithHost(ctx,config,request,{signal:controller.signal}),timeout]);reply(200,{result});
  }catch(error){reply(422,{error:safeError(error)});}finally{clearTimeout(timer);busy=false;}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);
 const identity=await lstat(socketPath);
 return {server,close:async()=>{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));try{const current=await lstat(socketPath);if(current.ino===identity.ino)await unlink(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}}};
}
export function apply(ctx,config){
 let bridge;const ready=startVisionBridge(ctx,config).then(value=>{bridge=value;return value;});
 // Cordis owns lifetime. The plugin uses only host services: no key copies,
 // additional provider endpoint, conversation replay, or agent-supplied verdict.
 ctx.effect(()=>()=>ready.then(value=>value.close()),'recruiting-vision-bridge lifetime');
 return ready.then(()=>undefined);
}

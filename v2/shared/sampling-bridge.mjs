// Per-call host capability. It is never persisted in company or task data.
import {AsyncLocalStorage} from 'node:async_hooks';
import http from 'node:http';import {mkdtemp,chmod,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createSocketVisionReviewer} from './attachment-visual-review.mjs';
const current=new AsyncLocalStorage();
export const withHostCapabilities=(capabilities,fn)=>current.run(capabilities||{},fn);
export function delegatedVisionReviewer(){
 const reviewer=()=>{const socket=current.getStore()?.visionSocket;return socket?createSocketVisionReviewer(socket):null;};
 const fn=async request=>{const r=reviewer();if(!r)throw Error('VISION_SAMPLING_UNAVAILABLE');return r(request);};
 fn.isAvailable=async()=>await reviewer()?.isAvailable()||false;return fn;
}
export async function openSamplingBridge(server){
 const dir=await mkdtemp('/tmp/recruiting-sampling-'),socket=path.join(dir,'host.sock');
 const listener=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  try{
   const available=!!server.getClientCapabilities()?.sampling;
   if(req.url==='/status'){res.end(JSON.stringify({available,model:'host-selected'}));return;}
   if(req.url!=='/review'||req.method!=='POST'||!available)throw Error('VISION_SAMPLING_UNAVAILABLE');
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>48*1024*1024)throw Error('VISION_REQUEST_TOO_LARGE');chunks.push(chunk);}
   const result=await server.createMessage(JSON.parse(Buffer.concat(chunks)),{timeout:90000});res.end(JSON.stringify(result));
  }catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(socket,resolve);});await chmod(socket,0o600);
 return {socket,close:async()=>{await new Promise(resolve=>listener.close(resolve));await rm(dir,{recursive:true,force:true});}};
}

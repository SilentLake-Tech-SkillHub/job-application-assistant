import {createHash} from 'node:crypto';
import http from 'node:http';import {fork} from 'node:child_process';
import {mkdir,chmod,unlink,readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const [socket,mode]=process.argv.slice(2);if(!socket||!path.isAbsolute(socket)||!['login','application'].includes(mode))throw Error('CORE_HOST_ARGUMENTS_REQUIRED');
await mkdir(path.dirname(socket),{recursive:true,mode:0o700});
const managerFingerprint=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
let worker,metadata,active=0,paused=false,reloading=false,reloadRequested=false,lastError=null,sequence=0;const pending=new Map();
async function startWorker(){
 const child=fork(fileURLToPath(new URL('./core-worker.mjs',import.meta.url)),[mode],{env:process.env,stdio:['ignore','ignore',process.stderr,'ipc']});
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('CORE_START_TIMEOUT'));},30000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('CORE_START_FAILED'));});child.on('message',m=>{if(m.ready){clearTimeout(timer);resolve(m);}});});
 child.on('message',m=>{if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.result);}}});
 child.on('exit',()=>{for(const[id,p]of pending)if(p.child===child){pending.delete(id);p.reject(Error('CORE_WORKER_EXITED'));}});
 return {child,ready};
}
async function replaceWorker(){
 if(reloading)return;reloading=true;
 try{const next=await startWorker(),previous=worker;worker=next.child;metadata=next.ready;lastError=null;if(previous?.connected)previous.disconnect();reloadRequested=false;paused=false;}
 catch(e){lastError=e.message;reloadRequested=false;paused=true;}
 finally{reloading=false;}
}
await replaceWorker();if(!worker)throw Error(lastError);
const status=()=>({protocolVersion:3,managerFingerprint,sourceFingerprint:metadata.info.sourceFingerprint,mode,hostPid:process.pid,workerPid:worker.pid,version:metadata.info.version,active,paused,reloading,reloadRequested,lastError});
const server=http.createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 try{
  if(req.method==='GET'&&req.url==='/status'){res.end(JSON.stringify(status()));return;}
  const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8*1024*1024)throw Error('CORE_REQUEST_TOO_LARGE');chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');let result;
  if(req.url==='/control'){
   if(body.action==='stop'){
    if(active||reloading)throw Error('CORE_BUSY');paused=true;
    res.end(JSON.stringify({...status(),stopping:true}));
    server.close(()=>{if(worker.connected)worker.disconnect();void unlink(socket).finally(()=>process.exit(0));});return;
   }
   if(body.action==='pause')paused=true;
   else if(body.action==='resume'){if(reloading||reloadRequested)throw Error('CORE_UPDATE_PENDING');paused=false;}
   else if(body.action==='reload'){paused=true;reloadRequested=true;if(!active)await replaceWorker();}
   else if(body.action!=='status')throw Error('UNKNOWN_CORE_CONTROL');
   result=status();
  }else if(req.url==='/operations'){if(!body.expected?.sourceFingerprint||body.expected.sourceFingerprint!==metadata.info.sourceFingerprint||body.expected.version!==metadata.info.version)throw Error('RUNTIME_VERSION_MISMATCH');result=metadata.operations;}
  else if(req.url==='/execute'){
   if(!worker.connected&&!paused)await replaceWorker();
   if(paused||reloading||reloadRequested)throw Error('CORE_PAUSED');
   if(!body.expected?.sourceFingerprint)throw Error('RUNTIME_FINGERPRINT_REQUIRED');
   if(body.expected.sourceFingerprint!==metadata.info.sourceFingerprint||body.expected.version!==metadata.info.version)throw Error('RUNTIME_VERSION_MISMATCH');
   active++;const id=String(++sequence);
   try{result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,child:worker});worker.send({id,operation:body.operation,args:body.args,capabilities:body.capabilities,expected:body.expected});});}
   finally{active--;if(!active&&reloadRequested)void replaceWorker();}
  }else throw Error('UNKNOWN_CORE_REQUEST');
  res.end(JSON.stringify(result));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({isError:true,error:error.message}));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await chmod(socket,0o600);
process.on('SIGTERM',()=>{paused=true;server.close(()=>{worker?.disconnect();void unlink(socket).finally(()=>process.exit(0));});});

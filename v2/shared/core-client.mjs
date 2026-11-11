import {CORE_PROTOCOL_VERSION,installedRelease,interfaceFingerprint,requireSameRelease} from './runtime-release.mjs';
const loadedInterfaceFingerprint=await interfaceFingerprint();
import http from 'node:http';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {unlink,lstat,mkdir,open,readFile} from 'node:fs/promises';
import {configurePaths} from './runtime-paths.mjs';import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';import {hostRole} from './host-role.mjs';
export class CoreClient{
 constructor(mode,{env=process.env,workspace}={}){
  if(!['login','application'].includes(mode))throw Error('INVALID_CORE_MODE');
  const paths=configurePaths({workspace,env});
  this.mode=mode;
  this.env=env;
  const host=env.RECRUITING_HOST_ID||'standalone';
  const executor=env.RECRUITING_AGENT_ID?host+'\0'+env.RECRUITING_AGENT_ID:host;
  const workspaceKey=createHash('sha256').update(paths.workspace).digest('hex').slice(0,12);
  const executorKey=createHash('sha256').update(executor).digest('hex').slice(0,6);
  this.socket=path.join('/tmp','recruiting-core-'+process.getuid(),workspaceKey,mode+'-'+hostRole(env)+'-'+executorKey+'.sock');
 }
 request(route,body={},timeout=120000){
  return new Promise((resolve,reject)=>{
   const data=JSON.stringify(body);
   const request=http.request({socketPath:this.socket,path:route,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{reject(Error('CORE_RESPONSE_INVALID'));}});
   });
   request.on('error',reject);request.setTimeout(timeout,()=>request.destroy(Error('CORE_RESPONSE_TIMEOUT')));request.end(data);
  });
 }

 async connect(){
  const probe=()=>this.request('/control',{action:'status'},1000).catch(()=>null);const expectedManager=createHash('sha256').update(await readFile(new URL('./core-host.mjs',import.meta.url))).digest('hex');const compatible=s=>s?.protocolVersion===CORE_PROTOCOL_VERSION&&s.managerFingerprint===expectedManager;const initial=await probe();if(compatible(initial))return;
  const release=await acquireLease(leasePath(defaultLeaseRoot(),'core-start:'+this.socket),{waitMs:5000,busyCode:'CORE_START_BUSY'});
  try{let existing=await probe();if(compatible(existing))return;if(existing){const deadline=Date.now()+35000;while(existing.active||existing.reloading){if(Date.now()>deadline)throw Error('CORE_INTERFACE_UPGRADE_PENDING');await new Promise(r=>setTimeout(r,50));existing=await probe();if(!existing)break;}if(existing){const stop=await this.request('/control',{action:'stop'});if(stop.isError)throw Error('CORE_INTERFACE_UPGRADE_BUSY');for(let i=0;i<50&&await probe();i++)await new Promise(r=>setTimeout(r,20));if(await probe())throw Error('CORE_INTERFACE_UPGRADE_PENDING');}}const info=await lstat(this.socket).catch(()=>null);if(info){if(!info.isSocket())throw Error('CORE_SOCKET_PATH_OCCUPIED');await unlink(this.socket);}await mkdir(path.dirname(this.socket),{recursive:true,mode:0o700});
   const log=await open(this.socket+'.log','w',0o600);let child;try{child=spawn(process.execPath,[fileURLToPath(new URL('./core-host.mjs',import.meta.url)),this.socket,this.mode],{env:this.env,detached:true,stdio:['ignore','ignore',log.fd]});}finally{await log.close();}child.unref();const end=Date.now()+35000;while(Date.now()<end){if(compatible(await probe()))return;if(child.exitCode!==null||child.signalCode)throw Error('CORE_HOST_START_FAILED: '+this.socket+'.log');await new Promise(r=>setTimeout(r,100));}throw Error('CORE_HOST_START_TIMEOUT');
  }finally{await release();}
 }
 async freshRelease(){
  if(await interfaceFingerprint()!==loadedInterfaceFingerprint)throw Error('INTERFACE_CODE_STALE');
  await this.connect();const expected=await installedRelease();let actual=await this.request('/control',{action:'status'});
  if(actual.sourceFingerprint!==expected.sourceFingerprint||actual.version!==expected.version){
   if(actual.active||actual.reloading||actual.reloadRequested){actual=await this.control('update');requireSameRelease(actual,expected);return expected;}
   if(actual.paused)throw Error('CORE_PAUSED');
   actual=await this.request('/control',{action:'reload'});
  }
  requireSameRelease(actual,expected);return expected;
 }
 async execute(operation,args={},capabilities={}){const expected=await this.freshRelease();return this.request('/execute',{operation,args,capabilities,expected});}
 async listOperations(){const expected=await this.freshRelease();return this.request('/operations',{expected});}
 async control(action){
  await this.connect();if(action!=='update')return this.request('/control',{action});
  const expected=await installedRelease();let actual=await this.request('/control',{action:'reload'});const deadline=Date.now()+35000;
  while(actual.reloading||actual.reloadRequested||actual.active){if(Date.now()>deadline)throw Error('CORE_UPDATE_PENDING');await new Promise(r=>setTimeout(r,50));actual=await this.request('/control',{action:'status'});}
  if(actual.lastError)throw Error(actual.lastError);requireSameRelease(actual,expected);
  return {...actual,verified:true};
 }
}

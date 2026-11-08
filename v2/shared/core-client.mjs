import http from 'node:http';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {unlink,lstat,mkdir,open} from 'node:fs/promises';
import {configurePaths} from './runtime-paths.mjs';import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';import {hostRole} from './host-role.mjs';
export class CoreClient{
 constructor(mode,{env=process.env,workspace}={}){if(!['login','application'].includes(mode))throw Error('INVALID_CORE_MODE');const paths=configurePaths({workspace,env});this.mode=mode;this.env=env;this.socket=path.join('/tmp','recruiting-core-'+process.getuid(),createHash('sha256').update(paths.workspace).digest('hex').slice(0,12),mode+'-'+hostRole(env)+'-'+createHash('sha256').update(env.RECRUITING_HOST_ID||'standalone').digest('hex').slice(0,6)+'.sock');}
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
  const probe=()=>this.request('/control',{action:'status'},1000).catch(()=>null);if(await probe())return;
  const release=await acquireLease(leasePath(defaultLeaseRoot(),'core-start:'+this.socket),{waitMs:5000,busyCode:'CORE_START_BUSY'});
  try{if(await probe())return;const info=await lstat(this.socket).catch(()=>null);if(info){if(!info.isSocket())throw Error('CORE_SOCKET_PATH_OCCUPIED');await unlink(this.socket);}await mkdir(path.dirname(this.socket),{recursive:true,mode:0o700});
   const log=await open(this.socket+'.log','w',0o600);let child;try{child=spawn(process.execPath,[fileURLToPath(new URL('./core-host.mjs',import.meta.url)),this.socket,this.mode],{env:this.env,detached:true,stdio:['ignore','ignore',log.fd]});}finally{await log.close();}child.unref();const end=Date.now()+35000;while(Date.now()<end){if(await probe())return;if(child.exitCode!==null||child.signalCode)throw Error('CORE_HOST_START_FAILED: '+this.socket+'.log');await new Promise(r=>setTimeout(r,100));}throw Error('CORE_HOST_START_TIMEOUT');
  }finally{await release();}
 }
 async execute(operation,args={},capabilities={}){await this.connect();return this.request('/execute',{operation,args,capabilities});}
 async listOperations(){await this.connect();return this.request('/operations');}
 async control(action){await this.connect();return this.request('/control',{action});}
}

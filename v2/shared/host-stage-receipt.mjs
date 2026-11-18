import {watch} from 'node:fs';
import {mkdtemp,open,readFile,realpath,rename,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const prefix='recruiting-host-stage-';
const receiptName='result.json';

export async function createCliStageDirectory(input){
 const directory=await mkdtemp(path.join(await realpath(tmpdir()),prefix));
 const inputFile=path.join(directory,'input.json');
 try{await writeFile(inputFile,JSON.stringify(input),{flag:'wx',mode:0o600});}
 catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 return {directory,inputFile,dispose:()=>rm(directory,{recursive:true,force:true})};
}

export async function claimCliStage(directory,uid){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('HOST_BROWSER_CLI_STAGE_DIRECTORY_REQUIRED');
 const resolved=await realpath(directory),root=await realpath(tmpdir()),info=await stat(resolved);
 if(path.dirname(resolved)!==root||!path.basename(resolved).startsWith(prefix)||!info.isDirectory()||info.uid!==uid||(info.mode&0o077))throw Error('HOST_BROWSER_CLI_STAGE_DIRECTORY_INVALID');
 const claim=await open(path.join(resolved,'operation'), 'wx',0o600);
 await claim.close();
 return resolved;
}

export async function writeCliStageReceipt(directory,value){
 const partial=path.join(directory,'result.pending');
 await writeFile(partial,JSON.stringify(value),{flag:'wx',mode:0o600});
 await rename(partial,path.join(directory,receiptName));
}

export function waitForCliStageReceipt(directory,signal){
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted();
  let finished=false;
  const listener=watch(directory,()=>{void check();});
  const stop=()=>finish(signal.reason||Error('HOST_BROWSER_CLI_STAGE_CANCELLED'));
  function finish(error,receipt){
   if(finished)return;
   finished=true;
   listener.close();
   signal.removeEventListener('abort',stop);
   if(error)reject(error);else resolve(receipt);
  }
  async function check(){
   if(finished)return;
   try{finish(null,JSON.parse(await readFile(path.join(directory,receiptName),'utf8')));}
   catch(error){if(error.code!=='ENOENT')finish(error);}
  }
  listener.on('error',finish);
  signal.addEventListener('abort',stop,{once:true});
  void check();
 });
}

import {mkdir,open,link,unlink,readFile,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';

export const defaultLeaseRoot=()=>`/tmp/recruiting-form-${process.getuid()}/leases`;
export const leasePath=(root,scope)=>path.join(root,createHash('sha256').update(scope).digest('hex')+'.lock');
const readOwner=async file=>{
  try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('LEASE_METADATA_INVALID');}
};
const alive=pid=>{
  if(!Number.isInteger(pid)||pid<=0)throw Error('LEASE_METADATA_INVALID');
  try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error;}
};
const exists=async file=>{try{await stat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const removeOwn=async(file,token)=>{
  const owner=await readOwner(file);
  if(owner?.token===token)await unlink(file);
};

// Publish a complete record with an atomic hard link: another process can never
// see an empty lock file while its owner is still writing metadata.
async function publish(file,owner){
  const claim=file+'.'+owner.token+'.claim';let handle;
  try{
    handle=await open(claim,'wx',0o600);await handle.writeFile(JSON.stringify(owner));await handle.close();handle=null;
    await link(claim,file);return true;
  }catch(error){if(error.code==='EEXIST')return false;throw error;}
  finally{await handle?.close();await unlink(claim).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

async function recoverDead(file,observed){
  if(alive(observed.pid))return false;
  const guard=file+'.recovery',owner={pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()};
  if(!await publish(guard,owner)){
    const prior=await readOwner(guard);
    if(prior&&!alive(prior.pid))throw Error('LEASE_RECOVERY_OWNER_DEAD');
    return false;
  }
  try{
    const current=await readOwner(file);
    if(current?.token!==observed.token||alive(current.pid))return false;
    await unlink(file);return true;
  }finally{await removeOwn(guard,owner.token);}
}

export async function acquireLease(file,{waitMs=0,busyCode='RESOURCE_ALREADY_RUNNING'}={}){
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const dir=await stat(path.dirname(file));
  if(dir.uid!==process.getuid()||(dir.mode&0o077))throw Error('PRIVATE_LEASE_DIRECTORY_REQUIRED');
  const owner={pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()},guard=file+'.recovery',deadline=Date.now()+waitMs;
  while(true){
    if(!await exists(guard)){
      if(await publish(file,owner)){
        if(!await exists(guard)){
          let released=false;
          return async()=>{if(!released){await removeOwn(file,owner.token);released=true;}};
        }
        await removeOwn(file,owner.token);
      }else{
        const current=await readOwner(file);
        if(!current)continue;
        if(!alive(current.pid)&&await recoverDead(file,current))continue;
      }
    }else{
      const current=await readOwner(guard);
      if(current&&!alive(current.pid))throw Error('LEASE_RECOVERY_OWNER_DEAD');
    }
    if(Date.now()>=deadline)throw Error(busyCode);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}

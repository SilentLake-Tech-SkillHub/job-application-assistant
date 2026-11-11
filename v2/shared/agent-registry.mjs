import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {acquireLease,defaultLeaseRoot,leasePath} from './leases.mjs';

const identifier=/^[a-z][a-z0-9-]{1,63}$/;
export async function registerAgent({workspace,host,instance,mode='independent',group=null}){
 if(!path.isAbsolute(workspace||'')||!identifier.test(host||'')||!identifier.test(instance||''))throw Error('AGENT_STABLE_IDENTITY_REQUIRED');
 if(!['independent','multi_agent'].includes(mode)||(mode==='multi_agent'?!identifier.test(group||''):group!==null))throw Error('AGENT_REGISTRATION_MODE_INVALID');
 const file=path.join(workspace,'.runtime','agents.json');
 const release=await acquireLease(leasePath(defaultLeaseRoot(),'agent-registry:'+file),{waitMs:30000,busyCode:'AGENT_REGISTRY_BUSY'});
 let temp;
 try{
  const doc=await readFile(file,'utf8').then(JSON.parse).catch(error=>{
   if(error.code!=='ENOENT')throw error;
   return {schemaVersion:1,next:1,agents:{}};
  });
  if(doc.schemaVersion!==1||!Number.isInteger(doc.next)||doc.next<1||!doc.agents||Array.isArray(doc.agents))throw Error('AGENT_REGISTRY_INVALID');
  const existing=Object.values(doc.agents).find(agent=>agent.host===host&&agent.instance===instance&&agent.group===group);
  if(existing){
   if(existing.mode!==mode)throw Error('AGENT_REGISTRATION_MODE_CONFLICT');
   return existing;
  }
  if(doc.next>9999)throw Error('AGENT_CODE_RANGE_EXHAUSTED');
  const id='A'+String(doc.next).padStart(4,'0');
  if(Object.hasOwn(doc.agents,id))throw Error('AGENT_REGISTRY_SEQUENCE_CONFLICT');
  const agent={id,host,instance,mode,group};
  doc.agents[id]=agent;
  doc.next++;
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  temp=file+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(doc,null,2)+'\n',{mode:0o600,flag:'wx'});
  await rename(temp,file);
  return agent;
 }finally{
  try{if(temp)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  finally{await release();}
 }
}

// The deployment supplies identity. Conversation, model and browser sessions
// never participate in the Agent registry key.
export async function runtimeAgent(env=process.env){
 const workspace=env.RECRUITING_WORKSPACE_ROOT,host=env.RECRUITING_HOST_ID,configuredId=env.RECRUITING_AGENT_ID;
 if(!workspace||!path.isAbsolute(workspace)||!identifier.test(host||''))return null;
 try{
  let agent;
  if(configuredId){
   const registry=JSON.parse(await readFile(path.join(workspace,'.runtime','agents.json'),'utf8'));
   agent=registry.agents?.[configuredId];
   if(agent?.id!==configuredId||agent.host!==host)return null;
  }else{
   agent=await registerAgent({workspace,host,instance:'default'});
  }
  const {id,instance,mode,group}=agent;
  return {id,instance,mode,group,executionKey:group?'group:'+group:'agent:'+id};
 }catch{
  // Identity attribution is independent of MCP availability and site login.
  return null;
 }
}

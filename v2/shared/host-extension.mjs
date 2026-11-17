// Plugin ownership is deployment data, separate from browser choice and company assets.
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
const validId=id=>/^[a-z][a-z0-9-]{1,63}$/.test(id||'');
export function validateExtension(extension){
 if(!extension||!validId(extension.id)||!['host_sdk','webbridge'].includes(extension.transport)||typeof extension.name!=='string'||!extension.name.trim())throw Error('HOST_EXTENSION_DECLARATION_INVALID');
 if(extension.endpoint){const u=new URL(extension.endpoint);if(extension.transport!=='webbridge'||u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password)throw Error('HOST_EXTENSION_ENDPOINT_INVALID');}
 return extension;
}
export function resolveHostExtension({registry,hostId,capability}){
 if(!validId(hostId))throw Error('HOST_EXTENSION_ID_INVALID');
 const entry=registry?.agents?.find(a=>a.hostId===hostId);
 if(!entry?.['浏览器']?.includes('chrome_main_extension')||!entry.mainChromeExtension)throw Error('HOST_EXTENSION_NOT_REGISTERED');
 const extension=validateExtension(entry.mainChromeExtension);assertExtensionCapability(extension,capability);
 return {...extension,hostId,agent:entry.agent};
}
export function assertExtensionCapability(extension,capability){if(capability&&(extension.id!==capability.id||extension.transport!==capability.transport))throw Error('HOST_EXTENSION_IDENTITY_MISMATCH');}
export function extensionSocketPath(browserSocket,hostId){
 if(!validId(hostId))throw Error('HOST_EXTENSION_ID_INVALID');
 if(!path.isAbsolute(browserSocket||''))throw Error('HOST_EXTENSION_SOCKET_REQUIRED');
 const result=path.join(path.dirname(browserSocket),'extension-'+hostId+'.sock');if(Buffer.byteLength(result)>100)throw Error('SHORT_ABSOLUTE_SOCKET_PATH_REQUIRED');return result;
}
export async function registerHostExtension({workspace,hostId,agent=hostId,extension,file=path.join(workspace,'产品管理','Agent浏览器兜底登记.json')}){
 if(!path.isAbsolute(workspace||'')||!validId(hostId))throw Error('HOST_EXTENSION_ID_INVALID');validateExtension(extension);
 const {loadAdapter}=await import('../host/adapters/registry.mjs');assertExtensionCapability(extension,(await loadAdapter(hostId)).mainChromeExtension);
 const release=await acquireLease(leasePath(defaultLeaseRoot(),'host-extension:'+file),{waitMs:30000,busyCode:'HOST_EXTENSION_REGISTRY_BUSY'});let temp;
 try{
  const data=await readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return {schemaVersion:1,'浏览器':{},agents:[]};});
  if(data.schemaVersion!==1||!Array.isArray(data.agents))throw Error('AGENT_FALLBACK_REGISTRY_INVALID');
  let entry=data.agents.find(a=>a.hostId===hostId);if(!entry){entry={agent,hostId,'浏览器':[]};data.agents.push(entry);}
  if(!entry['浏览器'].includes('chrome_main_extension'))entry['浏览器'].push('chrome_main_extension');
  entry.mainChromeExtension=structuredClone(extension);data['浏览器']??={};data['浏览器'].chrome_main_extension??='当前Agent对应的主用Chrome扩展';
  const text=JSON.stringify(data,null,2)+'\n';if(await readFile(file,'utf8').catch(()=>null)===text)return {hostId,extension:entry.mainChromeExtension,written:false};
  await mkdir(path.dirname(file),{recursive:true});temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,file);temp=null;
  if(await readFile(file,'utf8')!==text)throw Error('HOST_EXTENSION_REGISTRY_READBACK_FAILED');return {hostId,extension:entry.mainChromeExtension,written:true};
 }finally{if(temp)await unlink(temp).catch(()=>{});await release();}
}
export function assertExtensionExecutor(status,expected){
 const actual=status?.executor;
 if(!actual?.verified||actual.hostId!==expected.hostId||actual.extensionId!==expected.id||actual.browserType!=='extension')throw Error('HOST_EXTENSION_IDENTITY_MISMATCH');
 return status;
}

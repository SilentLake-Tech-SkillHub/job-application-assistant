#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {loadAdapter} from '../host/adapters/registry.mjs';import {registerHostExtension} from '../shared/host-extension.mjs';
export async function registerExtension({workspace,hostId,extension}){
 const adapter=await loadAdapter(hostId),spec=extension||adapter.mainChromeExtension;
 if(!spec)throw Error('HOST_EXTENSION_CAPABILITY_NOT_DECLARED');
 return registerHostExtension({workspace,hostId,agent:adapter.displayName,extension:spec});
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const args=process.argv.slice(2),flag=k=>{const i=args.indexOf('--'+k);return i>=0?args[i+1]:undefined;};
 try{const extension=args.includes('--extension-id')?{id:flag('extension-id'),name:flag('extension-name')||flag('extension-id'),transport:flag('extension-transport')||'host_sdk'}:undefined;
 console.log(JSON.stringify(await registerExtension({workspace:flag('workspace'),hostId:flag('host'),extension}),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}

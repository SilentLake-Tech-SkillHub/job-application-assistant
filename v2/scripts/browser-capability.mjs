#!/usr/bin/env node
// 浏览器能力文件（RECRUITING_BROWSER_CAPABILITY_FILE）的查看与维护入口。本命令不打开任何浏览器。
// Chrome 通道固定是组件自己的 Chrome 分身（shared/chrome-clone.mjs），全机一条记录；只按执行端检测内置浏览器。
// 用法：
//   node scripts/browser-capability.mjs status                         # 当前执行端（RECRUITING_HOST_ID）的检测结果（含 Chrome 分身记录）
//   node scripts/browser-capability.mjs detect                         # 执行端内置浏览器不对组件代码开放（agent_only/unverified/无）时，按适配器写入结果；
//                                                                       # 内置浏览器对代码开放时必须在执行端内运行 detectHostBrowsers
//   node scripts/browser-capability.mjs refresh-version                # Chrome 升级后只更新记录的版本号
//   node scripts/browser-capability.mjs reset --quote "<用户原话>"     # 用户要求重新检测时清除本执行端记录
import {pathToFileURL} from 'node:url';import {readFile,writeFile,rename} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {capabilityFile,capabilityHostId,capabilityRecordKey,hostCapability,refreshChromeVersion,readCapabilities,detectBrowserCapability} from '../shared/browser-capability.mjs';
import {loadAdapter} from '../host/adapters/registry.mjs';
export async function detectWithoutHostSdk({file,host,env=process.env}){
 const adapter=await loadAdapter(host);
 if(adapter.browsers.iab?.exposure==='code')throw Error('RUN_DETECTION_INSIDE_HOST');
 return detectBrowserCapability({file,host,adapter,env});
}
export async function resetHost({file,host,quote,env,now=()=>new Date().toISOString()}){
 if(typeof quote!=='string'||!quote.trim())throw Error('USER_QUOTE_REQUIRED');
 const doc=await readCapabilities(file);delete doc.replacedSchema;const key=capabilityRecordKey(host,env),had=!!doc.hosts[key];delete doc.hosts[key];(doc.resets??=[]).push({host,quote:quote.trim(),at:now()});doc.resets=doc.resets.slice(-20);
 const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(doc,null,1),{mode:0o600});await rename(temp,file);return {host,cleared:had};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const args=process.argv.slice(2),flag=n=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:undefined;};
 try{const file=capabilityFile(),host=capabilityHostId();
  if(args[0]==='status')console.log(JSON.stringify(await hostCapability({file,host,env:process.env}),null,1));
  else if(args[0]==='detect')console.log(JSON.stringify(await detectWithoutHostSdk({file,host}),null,1));
  else if(args[0]==='refresh-version')console.log(JSON.stringify(await refreshChromeVersion({file}),null,1));
  else if(args[0]==='reset')console.log(JSON.stringify(await resetHost({file,host,quote:flag('quote'),env:process.env}),null,1));
  else throw Error('USAGE: status | detect | refresh-version | reset --quote "<用户原话>"');
 }catch(error){console.error(error.message);process.exitCode=1;}
}

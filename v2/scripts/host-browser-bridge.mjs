// Import this in the live, trusted host browser SDK tool context. It cannot
// discover a browser by a guessed mode, create a replacement browser or transfer
// login state. The supplied agent must be the actual initialized host runtime.
import {startHostBrowserBridge} from '../shared/host-browser-bridge.mjs';
import {capabilityFile,capabilityHostId,hostCapability,channelsOf,detectBrowserCapability} from '../shared/browser-capability.mjs';
import {loadAdapter} from '../host/adapters/registry.mjs';
export async function registerHostBrowser({agent,browserId,channel='iab',socketPath,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls=true}){
 // Only the host's built-in browser is bridged. The Chrome channel is the component's own dedicated
 // Chrome clone, attached over CDP by the broker; no host plugin ever stands in for it.
 if(channel!=='iab')throw Error('ONLY_BUILT_IN_BROWSER_IS_BRIDGED');
 if(!agent?.browsers?.list||!agent?.browsers?.get||!browserId)throw Error('TRUSTED_HOST_BROWSER_RUNTIME_REQUIRED');
 const inventory=()=>agent.browsers.list(),entries=await inventory(),entry=entries.find(item=>item.id===browserId);
 if(!entry||entry.type!=='iab')throw Error('HOST_BROWSER_PROVIDER_NOT_VERIFIED');
 const browser=await agent.browsers.get(browserId);
 return startHostBrowserBridge({browser,inventory,mode:'iab',socketPath,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls});
}
// One-time detection for this host (three steps, see shared/browser-capability.mjs). Run it once per
// executor host, or again only when the user asks; the result file decides every later call.
export async function detectHostBrowsers({hostContext,agent,fileUpload,screenshot,env=process.env}){
 const host=capabilityHostId(env),adapter=await loadAdapter(host);
 // Only an adapter whose browsers are exposed to code can hand over a live browser SDK.
 const live=adapter.browsers.iab?.exposure==='code'?await adapter.connect(hostContext):{};
 return detectBrowserCapability({file:capabilityFile(env),host,adapter,agent:agent||live.agent,fileUpload:fileUpload||live.fileUpload,screenshot:screenshot||live.screenshot,env});
}
// Each session: bridge the built-in browser only when the capability file marks it usable. The Chrome
// clone needs no registration. A missing file is an explicit stop, never a guess.
export async function registerFromCapability({agent,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls=true,env=process.env}){
 const {status,entry,reason}=await hostCapability({file:capabilityFile(env),host:capabilityHostId(env),env});
 if(status!=='detected')throw Error(reason||'BROWSER_CAPABILITY_DETECTION_REQUIRED');
 const bridges={};
 if(channelsOf(entry).includes('iab')){
  const spec=entry.iab,found=(await agent.browsers.list()).filter(e=>e?.type==='iab');
  if(found.length!==1)throw Error('IAB_HOST_BROWSER_NOT_PRESENT');
  if(!spec.call?.socket)throw Error('BROWSER_CAPABILITY_SOCKET_REQUIRED');
  bridges.iab=await registerHostBrowser({agent,browserId:found[0].id,channel:'iab',socketPath:spec.call.socket,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls});
 }
 return {channels:channelsOf(entry),bridges};
}
export async function pumpHostBrowser(bridge,{maxJobs=20}={}){
 if(!bridge||typeof bridge.pump!=='function'||!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>100)throw Error('HOST_BROWSER_PUMP_REQUIRED');
 let completed=0;while(completed<maxJobs&&await bridge.pump())completed++;return {completed,pending:bridge.pendingCount(),executor:bridge.executor};
}

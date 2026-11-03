import {readFile,writeFile,rename,mkdir,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';import {randomUUID} from 'node:crypto';
import {readChromeProcessInventory} from './browser-environment.mjs';
import {cloneConfig,cloneRecord,readChromeVersion,fetchTabs} from './chrome-clone.mjs';
export {readChromeVersion};
// Browser capability is written to ONE private file; every start, batch and bridge registration
// reads it and nothing re-guesses which browser exists.
//
//   chrome  machine-wide, one record for all hosts: the dedicated Chrome clone (shared/chrome-clone.mjs)
//           — installed Chrome, fixed profile, local DevTools port. The component attaches to it over
//           CDP; no host plugin or extension is involved.
//   hosts.<id>.iab  per executor host, detected ONCE: the host's built-in browser, three steps:
//     1 declared   the host lists it (agent.browsers.list type 'iab'), or its adapter says it exists
//     2 loadable   the component can drive it: open a local probe page, read, type, click, screenshot, upload
//     3 identity   it is not a Chrome/Chromium started for the occasion: no new Chrome process, the probe
//                  tab does not show up in the Chrome clone, no headless/automation user agent
// Built-in passes all three -> channels ['chrome','iab'] (dual); otherwise the clone only.
// Re-detection happens only for a new host or on the user's request; a Chrome update only refreshes
// the recorded version (a cheap Info.plist read).
export const CAPABILITY_SCHEMA=2,DETECTOR_VERSION=3;
export const REQUIRED_ACTIONS=['navigate','evaluate','fill','click','screenshot','upload'];
export const SEARCH_ACTIONS=['navigate','evaluate'];
export function iabUsage(iab){
 const verified=iab?.identity?.verified===true;
 const application=iab?.result==='usable';
 const search=application||iab?.declared===true&&iab?.exposure==='agent_only'||verified&&SEARCH_ACTIONS.every(action=>iab?.actions?.[action]===true);
 return {search:{usable:!!search,reason:search?'search_interface_available':iab?.reason||iab?.result||'not_detected'},application:{usable:application,reason:application?'component_actions_and_identity_verified':iab?.reason||iab?.result||'not_detected'}};
}
export function capabilityFile(env=process.env){const f=env.RECRUITING_BROWSER_CAPABILITY_FILE;if(!f||!path.isAbsolute(f))throw Error('BROWSER_CAPABILITY_FILE_REQUIRED');return f;}
export function capabilityHostId(env=process.env){const id=env.RECRUITING_HOST_ID;if(!id||!/^[a-z][a-z0-9-]{1,31}$/.test(id))throw Error('RECRUITING_HOST_ID_REQUIRED');return id;}
// A schema-1 file (Chrome via a host plugin) is obsolete: it is treated as "not detected", never reused.
export async function readCapabilities(file){try{const doc=JSON.parse(await readFile(file,'utf8'));if(doc?.schemaVersion!==CAPABILITY_SCHEMA||typeof doc.hosts!=='object')return {schemaVersion:CAPABILITY_SCHEMA,chrome:null,hosts:{},...(doc?.schemaVersion?{replacedSchema:doc.schemaVersion}:{})};return doc;}catch(error){if(error.code==='ENOENT')return {schemaVersion:CAPABILITY_SCHEMA,chrome:null,hosts:{}};throw error;}}
async function writeCapabilities(file,doc){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const {replacedSchema,...clean}=doc;const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(clean,null,1),{mode:0o600});await rename(temp,file);}
const channelsFor=(chrome,iab)=>{const c=chrome?.result==='usable',i=iab?.result==='usable';return c&&i?['chrome','iab']:c?['chrome']:i?['iab']:[];};
const modeOf=channels=>channels.length===2?'dual':channels.length===1?'single':'none';
// The view every caller uses: the host's iab record merged with the machine-wide clone record.
// A host whose profile/port differ from the recorded clone is a configuration error, not a second Chrome.
export async function hostCapability({file,host,env}){
 const doc=await readCapabilities(file),own=doc.hosts[host];
 if(!own||!doc.chrome)return {status:'detection_required',host,entry:null,reason:'BROWSER_CAPABILITY_DETECTION_REQUIRED'};
 if(env){let config=null;try{config=cloneConfig(env);}catch{}if(config&&(config.profileDir!==doc.chrome.profileDir||config.port!==doc.chrome.cdpPort))return {status:'config_mismatch',host,entry:null,reason:'CHROME_CLONE_CONFIG_MISMATCH',expected:{profileDir:doc.chrome.profileDir,cdpPort:doc.chrome.cdpPort},actual:{profileDir:config.profileDir,cdpPort:config.port}};}
 const usage=iabUsage(own.iab),channels=channelsFor(doc.chrome,{result:usage.application.usable?'usable':'unavailable'}),searchChannels=channelsFor(doc.chrome,{result:usage.search.usable?'usable':'unavailable'});
 return {status:'detected',host,entry:{...own,iab:{...own.iab,...usage},chrome:doc.chrome,channels,applicationChannels:channels,searchChannels,mode:modeOf(channels)}};
}
export const channelsOf=entry=>Array.isArray(entry?.channels)?entry.channels.filter(ch=>['iab','chrome'].includes(ch)):[];
export async function refreshChromeVersion({file,now=()=>new Date().toISOString(),read}){
 const doc=await readCapabilities(file),chrome=doc.chrome;if(!chrome?.executable)return {changed:false};
 const current=await readChromeVersion(chrome.executable,read?{read}:{});if(!current||current===chrome.version)return {changed:false,version:chrome.version};
 const previous=chrome.version;chrome.version=current;chrome.versionCheckedAt=now();await writeCapabilities(file,doc);return {changed:true,previous,version:current};
}
// Write (or rewrite) the machine-wide clone record. Every host's detection calls this with its own env;
// a later host with a different profile/port is refused instead of silently replacing the first.
export async function recordChromeClone({file,env=process.env,now,versionReader,exists,replace=false}){
 const config=cloneConfig(env),doc=await readCapabilities(file);
 if(doc.chrome&&!replace&&(doc.chrome.profileDir!==config.profileDir||doc.chrome.cdpPort!==config.port))throw Error('CHROME_CLONE_CONFIG_MISMATCH');
 doc.chrome=await cloneRecord({config,...(now?{now}:{}),...(versionReader?{versionReader}:{}),...(exists?{exists}:{})});
 await writeCapabilities(file,doc);return doc.chrome;
}
// Local probe page: one nonce, a text box, a button and a file input. Records each request's user agent.
export async function startProbeServer(){
 const nonce=randomUUID(),requests=[];
 const html=`<!doctype html><meta charset="utf-8"><title>probe ${nonce}</title><input id="t"><button id="b" onclick="window.__clicked=true">b</button><input id="f" type="file"><p id="n">${nonce}</p>`;
 const server=http.createServer((req,res)=>{requests.push({path:req.url,userAgent:String(req.headers['user-agent']||'')});res.setHeader('content-type','text/html; charset=utf-8');res.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/probe/${nonce}`;
 return {nonce,url,requests,close:()=>new Promise(r=>server.close(r))};
}
const automationAgent=ua=>/HeadlessChrome|Playwright|puppeteer|Electron\/[\d.]+.*\bheadless\b/i.test(ua);
const step=async fn=>{try{return await fn()===true;}catch{return false;}};
async function probeCandidate({agent,entry,probe,fileUpload,screenshot,uploadFile}){
 const actions={},browser=await agent.browsers.get(entry.id);let tab=null;
 actions.navigate=await step(async()=>{tab=await browser.tabs.new();await tab.goto(probe.url);return true;});
 actions.evaluate=actions.navigate&&await step(async()=>await tab.playwright.evaluate(()=>location.href)===probe.url);
 actions.fill=actions.navigate&&await step(async()=>{await tab.playwright.locator('#t').fill('probe');return await tab.playwright.evaluate(()=>document.querySelector('#t').value)==='probe';});
 actions.click=actions.navigate&&await step(async()=>{await tab.playwright.locator('#b').click();return await tab.playwright.evaluate(()=>window.__clicked===true);});
 actions.screenshot=actions.navigate&&typeof screenshot==='function'&&await step(async()=>{const shot=await screenshot({tab});return typeof shot?.path==='string'&&!!shot.path;});
 actions.upload=actions.navigate&&typeof fileUpload==='function'&&await step(async()=>{await fileUpload({tab,selector:'#f',paths:[uploadFile]});return await tab.playwright.evaluate(()=>document.querySelector('#f').files?.[0]?.name||null)===path.basename(uploadFile);});
 return {browser,tab,actions,loadable:REQUIRED_ACTIONS.every(a=>actions[a]===true)};
}
// What a host adapter already knows about its built-in browser without probing: not present, only
// usable by the model ("agent_only"), or not yet verified. Only an exposure of 'code' is probed.
export function adapterIabRecord(adapter){
 const b=adapter?.browsers?.iab;if(!b)return null;
 const by='adapter:'+adapter.id;
 if(!b.declared)return {declared:false,result:'not_declared',reason:'BUILT_IN_BROWSER_NOT_PRESENT',evidence:b.evidence,declaredBy:by};
 if(b.exposure==='agent_only')return {declared:true,exposure:'agent_only',loadable:false,result:'agent_only',reason:'HOST_BROWSER_AGENT_ONLY',evidence:b.evidence,declaredBy:by};
 if(b.exposure==='unverified')return {declared:true,exposure:'unverified',loadable:false,result:'unverified',reason:'HOST_BROWSER_EXPOSURE_UNVERIFIED',evidence:b.evidence,declaredBy:by};
 return null;
}
export async function detectBrowserCapability({file,host,agent,adapter,fileUpload,screenshot,processInventory=readChromeProcessInventory,probeServer=startProbeServer,cloneTabs=fetchTabs,now=()=>new Date().toISOString(),env=process.env,versionReader,exists}){
 if(!file||!host)throw Error('BROWSER_CAPABILITY_TARGET_REQUIRED');
 if(adapter&&adapter.id!==host)throw Error('HOST_ADAPTER_MISMATCH');
 // Detection runs once per host: an existing record of this detector version is returned unchanged.
 // Only scripts/browser-capability.mjs reset (with the user's words) clears it for a new detection.
 {const existing=await readCapabilities(file);const own=existing.hosts[host];if(own?.detectorVersion===DETECTOR_VERSION&&existing.chrome){const view=await hostCapability({file,host});return {...view.entry,alreadyDetected:true};}}
 const chrome=await recordChromeClone({file,env,...(now?{now}:{}),...(versionReader?{versionReader}:{}),...(exists?{exists}:{})});
 const fixed=adapterIabRecord(adapter);
 let listed=[];if(!fixed){try{listed=typeof agent?.browsers?.list==='function'?await agent.browsers.list():[];}catch{listed=[];}}
 const iabEntry=fixed?null:listed.find(e=>e?.type==='iab')||null;
 const record={detectorVersion:DETECTOR_VERSION,detectedAt:now(),host,...(adapter?{adapter:{id:adapter.id,displayName:adapter.displayName,vision:adapter.vision}}:{})};
 if(iabEntry){
  const dir=await mkdtemp(path.join(tmpdir(),'browser-capability-')),uploadFile=path.join(dir,'probe-upload.txt');await writeFile(uploadFile,'probe');
  const probe=await probeServer();
  try{
   const before=await processInventory();
   const candidate=await probeCandidate({agent,entry:iabEntry,probe,fileUpload,screenshot,uploadFile});
   const after=await processInventory(),started=(after.processes||[]).filter(p=>!(before.processes||[]).some(b=>b.pid===p.pid)),agents=probe.requests.map(r=>r.userAgent);
   const inClone=(await cloneTabs(chrome.endpoint)).some(t=>String(t.url||'').includes(probe.nonce));
   // "No new browser process" is evidence only when both process lists were actually read.
   const processEvidence=before.available!==false&&after.available!==false;
   const fake=started.length>0||inClone||agents.some(automationAgent),reached=probe.requests.length>0,verified=reached&&!fake&&processEvidence;
   record.iab={declared:true,declaredBy:'agent.browsers.list type=iab',browserType:'iab',loadable:candidate.loadable,actions:candidate.actions,identity:{verified,probeReached:reached,processEvidence,...(processEvidence?{}:{processInventoryReason:before.reason||after.reason||'PROCESS_INVENTORY_UNAVAILABLE'}),newChromeProcesses:started.length,probeTabSeenInChromeClone:inClone,automationUserAgent:agents.some(automationAgent)},result:fake?'declared_but_fake':!candidate.loadable?'not_loadable':!verified?'identity_not_verified':'usable',call:{mode:'iab',socket:env.RECRUITING_IAB_SOCKET||null,register:'scripts/host-browser-bridge.mjs#registerFromCapability',channel:'iab'}};
   try{await candidate.tab?.close?.();}catch{}
  }finally{await probe.close();await rm(dir,{recursive:true,force:true});}
 }else record.iab=fixed||{declared:false,result:'not_declared'};
 record.iab={...record.iab,...iabUsage(record.iab)};
 const doc=await readCapabilities(file);doc.hosts[host]=record;await writeCapabilities(file,doc);
 const channels=channelsFor(chrome,record.iab);
 return {...record,chrome,channels,applicationChannels:channels,searchChannels:channelsFor(chrome,{result:record.iab.search.usable?'usable':'unavailable'}),mode:modeOf(channels)};
}

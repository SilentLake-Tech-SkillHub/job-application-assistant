import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import http from 'node:http';import path from 'node:path';import os from 'node:os';import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {detectBrowserCapability,hostCapability,refreshChromeVersion,readChromeVersion,channelsOf} from '../shared/browser-capability.mjs';
import {registerFromCapability,registerHostBrowser} from '../scripts/host-browser-bridge.mjs';
import {resetHost} from '../scripts/browser-capability.mjs';
const get=(url,ua)=>new Promise((resolve,reject)=>{http.get(url,{headers:{'user-agent':ua}},res=>{res.resume();res.on('end',resolve);}).on('error',reject);});
// A host browser double for the built-in browser.
function hostBrowser({ua='Mozilla/5.0 Chrome/155.0',sharedWith=null,onOpen=()=>{}}={}){
 const tabs=sharedWith?sharedWith._tabs:[];
 const browser={tabs:{list:async()=>tabs.map(t=>({id:t.id,url:t.url})),new:async()=>{const state={'#t':{value:''},'#f':{files:[]}},ctx={location:{href:'about:blank'},document:{querySelector:s=>state[s]},__clicked:false};ctx.window=ctx;
  const tab={id:'tab-'+tabs.length,url:'about:blank',goto:async url=>{await get(url,ua);tab.url=url;ctx.location.href=url;onOpen();},close:async()=>{tabs.splice(tabs.indexOf(tab),1);},
   playwright:{evaluate:async fn=>vm.runInNewContext('('+fn.toString()+')()',ctx),locator:s=>({fill:async v=>{state[s].value=v;},click:async()=>{ctx.__clicked=true;}})},_state:state};tabs.push(tab);return tab;},get:async id=>tabs.find(t=>t.id===id)}};
 browser._tabs=tabs;return browser;
}
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'capability-'));try{
 const app=path.join(dir,'Google Chrome.app'),exe=path.join(app,'Contents/MacOS/Google Chrome');await mkdir(path.dirname(exe),{recursive:true});await writeFile(exe,'');
 const plist=v=>writeFile(path.join(app,'Contents/Info.plist'),`<plist><dict><key>CFBundleShortVersionString</key>\n<string>${v}</string></dict></plist>`);await plist('155.0.8059.86');
 let processes=[{pid:10,executable:exe,profileExplicit:false}],cloneTabList=[];
 const env={RECRUITING_IAB_SOCKET:'/tmp/x/iab.sock',RECRUITING_BROWSER_PROFILE_DIR:path.join(dir,'chrome-profile'),RECRUITING_CHROME_EXECUTABLE:exe};
 const base={file:path.join(dir,'browser-capability.json'),host:'dsh',env,processInventory:async()=>({available:true,processes:[...processes]}),cloneTabs:async()=>cloneTabList.map(t=>({id:t.id,url:t.url})),fileUpload:async({tab,selector,paths})=>{tab._state[selector].files=[{name:path.basename(paths[0])}];},screenshot:async()=>({path:'/tmp/probe.png'})};
 await fn({dir,exe,plist,base,env,setProcesses:p=>{processes=p;},processes:()=>processes,setCloneTabs:t=>{cloneTabList=t;}});}finally{await rm(dir,{recursive:true,force:true});}}
const redetect=async opts=>{await resetHost({file:opts.file,host:opts.host,quote:'用户要求重新检测'});return detectBrowserCapability(opts);};
const agentWith=browsers=>({browsers:{list:async()=>Object.entries(browsers).map(([id,b])=>({id,type:b.type})),get:async id=>browsers[id].browser}});
test('a genuine built-in browser plus the Chrome clone are recorded as dual; the clone record is machine-wide with path, version, profile and CDP endpoint',()=>fixture(async f=>{
 const iab=hostBrowser({ua:'Mozilla/5.0 Codex/1.0 Chrome/150.0'});
 const r=await redetect({...f.base,agent:agentWith({i:{type:'iab',browser:iab}})});
 assert.deepEqual(r.channels,['chrome','iab']);assert.equal(r.mode,'dual');assert.equal(r.iab.result,'usable');assert.ok(Object.values(r.iab.actions).every(Boolean));assert.equal(r.iab.call.socket,'/tmp/x/iab.sock');
 assert.equal(r.chrome.kind,'dedicated_clone');assert.equal(r.chrome.result,'usable');assert.equal(r.chrome.version,'155.0.8059.86');assert.equal(r.chrome.executable,f.exe);assert.equal(r.chrome.profileDir,f.env.RECRUITING_BROWSER_PROFILE_DIR);assert.equal(r.chrome.cdpPort,9333);assert.equal(r.chrome.call.mode,'cdp');assert.equal(r.chrome.call.url,'http://127.0.0.1:9333');assert.equal(r.chrome.extensions,'allowed');
 const saved=await hostCapability({file:f.base.file,host:'dsh'});assert.equal(saved.status,'detected');assert.deepEqual(channelsOf(saved.entry),['chrome','iab']);assert.equal(saved.entry.chrome.kind,'dedicated_clone');
 const doc=JSON.parse(await readFile(f.base.file,'utf8'));assert.equal(doc.schemaVersion,2);assert.equal('chrome' in doc.hosts.dsh,false);assert.equal(doc.chrome.profileDir,f.env.RECRUITING_BROWSER_PROFILE_DIR);
 assert.equal(JSON.stringify(saved).includes('@'),false);
}));
test('a built-in browser that is really Chrome (probe tab in the Chrome clone, a new Chrome process, or a headless agent) is recorded as fake and never used',()=>fixture(async f=>{
 const sneaky=hostBrowser();sneaky.tabs.new=(orig=>async()=>{const t=await orig();f.setCloneTabs(sneaky._tabs);return t;})(sneaky.tabs.new);
 let r=await redetect({...f.base,agent:agentWith({i:{type:'iab',browser:sneaky}})});
 assert.equal(r.iab.result,'declared_but_fake');assert.equal(r.iab.identity.probeTabSeenInChromeClone,true);assert.deepEqual(r.channels,['chrome']);
 f.setCloneTabs([]);const spawning=hostBrowser({onOpen:()=>f.setProcesses([...f.processes(),{pid:99,executable:f.exe,profileExplicit:true}])});
 r=await redetect({...f.base,agent:agentWith({i:{type:'iab',browser:spawning}})});
 assert.equal(r.iab.result,'declared_but_fake');assert.equal(r.iab.identity.newChromeProcesses,1);assert.deepEqual(r.channels,['chrome']);
 r=await redetect({...f.base,agent:agentWith({i:{type:'iab',browser:hostBrowser({ua:'Mozilla/5.0 HeadlessChrome/150'})}})});
 assert.equal(r.iab.result,'declared_but_fake');
}));
test('a built-in browser that cannot upload is not loadable; no built-in browser leaves the clone alone; no Chrome installed leaves nothing for Chrome',()=>fixture(async f=>{
 let r=await redetect({...f.base,fileUpload:undefined,agent:agentWith({i:{type:'iab',browser:hostBrowser()}})});
 assert.equal(r.iab.result,'not_loadable');assert.equal(r.iab.actions.upload,false);assert.equal(r.iab.search.usable,true);assert.equal(r.iab.application.usable,false);assert.deepEqual(r.searchChannels,['chrome','iab']);assert.deepEqual(r.channels,['chrome']);assert.equal(r.mode,'single');
 r=await redetect({...f.base,agent:undefined});assert.equal(r.iab.result,'not_declared');assert.deepEqual(r.channels,['chrome']);
 r=await redetect({...f.base,exists:async()=>false,agent:agentWith({i:{type:'iab',browser:hostBrowser()}})});assert.equal(r.chrome.result,'not_installed');assert.deepEqual(r.channels,['iab']);
 r=await redetect({...f.base,exists:async()=>false});assert.deepEqual(r.channels,[]);assert.equal(r.mode,'none');
}));
test('every host shares one clone: a different profile or port is refused, never recorded as a second Chrome',()=>fixture(async f=>{
 await detectBrowserCapability({...f.base});
 await assert.rejects(detectBrowserCapability({...f.base,host:'codex',env:{...f.env,RECRUITING_BROWSER_CDP_PORT:'9444'}}),/CHROME_CLONE_CONFIG_MISMATCH/);
 await assert.rejects(detectBrowserCapability({...f.base,host:'codex',env:{...f.env,RECRUITING_BROWSER_PROFILE_DIR:path.join(f.dir,'other')}}),/CHROME_CLONE_CONFIG_MISMATCH/);
 const mismatch=await hostCapability({file:f.base.file,host:'dsh',env:{...f.env,RECRUITING_BROWSER_CDP_PORT:'9444'}});assert.equal(mismatch.status,'config_mismatch');assert.equal(mismatch.reason,'CHROME_CLONE_CONFIG_MISMATCH');
 assert.equal((await hostCapability({file:f.base.file,host:'dsh',env:f.env})).status,'detected');
 await assert.rejects(detectBrowserCapability({...f.base,host:'zcode',env:{...f.env,RECRUITING_BROWSER_PROFILE_DIR:path.join(os.homedir(),'Library/Application Support/Google/Chrome')}}),/PRIVATE_AUTOMATION_PROFILE_REQUIRED/);
}));
test('an old plugin-era capability file is not reused',()=>fixture(async f=>{
 await writeFile(f.base.file,JSON.stringify({schemaVersion:1,hosts:{dsh:{channels:['chrome'],chrome:{result:'usable',call:{mode:'host'}}}}}));
 assert.equal((await hostCapability({file:f.base.file,host:'dsh'})).status,'detection_required');
 await detectBrowserCapability({...f.base});const doc=JSON.parse(await readFile(f.base.file,'utf8'));assert.equal(doc.schemaVersion,2);assert.equal('replacedSchema' in doc,false);
}));
test('a Chrome update only refreshes the recorded version; a reset needs the user words',()=>fixture(async f=>{
 await detectBrowserCapability({...f.base});
 assert.deepEqual(await refreshChromeVersion({file:f.base.file}),{changed:false,version:'155.0.8059.86'});
 await f.plist('156.0.8078.79');const r=await refreshChromeVersion({file:f.base.file});assert.equal(r.changed,true);assert.equal(r.previous,'155.0.8059.86');
 const saved=(await hostCapability({file:f.base.file,host:'dsh'})).entry;assert.equal(saved.chrome.version,'156.0.8078.79');assert.equal(saved.chrome.result,'usable');assert.equal(await readChromeVersion('/usr/bin/google-chrome'),null);
 await assert.rejects(resetHost({file:f.base.file,host:'dsh',quote:''}),/USER_QUOTE_REQUIRED/);assert.deepEqual(await resetHost({file:f.base.file,host:'dsh',quote:'重新检测浏览器'}),{host:'dsh',cleared:true});assert.equal((await hostCapability({file:f.base.file,host:'dsh'})).status,'detection_required');
}));
test('session registration bridges only the built-in browser and stops explicitly when no detection exists',()=>fixture(async f=>{
 const env={...f.env,RECRUITING_BROWSER_CAPABILITY_FILE:f.base.file,RECRUITING_HOST_ID:'dsh'};
 await assert.rejects(registerFromCapability({agent:agentWith({}),env}),/BROWSER_CAPABILITY_DETECTION_REQUIRED/);
 await detectBrowserCapability({...f.base});
 assert.deepEqual(await registerFromCapability({agent:agentWith({}),env}),{channels:['chrome'],bridges:{}});
 await redetect({...f.base,agent:agentWith({i:{type:'iab',browser:hostBrowser()}})});
 await assert.rejects(registerFromCapability({agent:agentWith({}),env}),/IAB_HOST_BROWSER_NOT_PRESENT/);
 await assert.rejects(registerHostBrowser({agent:agentWith({}),browserId:'c',channel:'chrome'}),/ONLY_BUILT_IN_BROWSER_IS_BRIDGED/);
}));
import {HOST_IDS,loadAdapter,validateAdapter} from '../host/adapters/registry.mjs';
import {detectWithoutHostSdk} from '../scripts/browser-capability.mjs';
test('every listed host has a valid adapter that describes only its built-in browser and never decides routing',async()=>{
 assert.deepEqual(HOST_IDS,['codex','claude-code','antigravity','kimi-code','zcode','dsh']);
 for(const id of HOST_IDS){const a=await loadAdapter(id);assert.equal(a.id,id);assert.equal('channels' in a,false);assert.equal('mode' in a,false);assert.deepEqual(Object.keys(a.browsers),['iab']);}
 await assert.rejects(loadAdapter('unknown-host'),/UNKNOWN_HOST_ADAPTER/);
 assert.throws(()=>validateAdapter({id:'x',displayName:'X',mcpConfig:{format:'json',project:'.x.json',serversPath:['mcpServers']},browsers:{iab:{declared:true,exposure:'code',evidence:'e'}}},'x'),/CONNECT_REQUIRED/);
 assert.throws(()=>validateAdapter({id:'x',displayName:'X',mcpConfig:{format:'json',project:'.x.json',serversPath:['mcpServers']},browsers:{iab:{declared:false,evidence:'e'},chrome:{declared:true,exposure:'agent_only',evidence:'plugin'}}},'x'),/BROWSER_INVALID/);
});
test('a model-only built-in browser is recorded as agent_only without probing; Chrome still runs on the clone',()=>fixture(async f=>{
 let probed=false;const agent={browsers:{list:async()=>{probed=true;return [];},get:async()=>{probed=true;}}};
 const r=await redetect({...f.base,host:'codex',adapter:await loadAdapter('codex'),agent});
 assert.equal(probed,false);assert.equal(r.iab.result,'agent_only');assert.equal(r.iab.reason,'HOST_BROWSER_AGENT_ONLY');assert.equal(r.iab.search.usable,true);assert.equal(r.iab.application.usable,false);assert.deepEqual(r.channels,['chrome']);assert.equal(r.mode,'single');assert.equal(r.adapter.id,'codex');
 const k=await detectBrowserCapability({...f.base,host:'kimi-code',adapter:await loadAdapter('kimi-code')});assert.equal(k.iab.result,'not_declared');assert.deepEqual(k.channels,['chrome']);
 await assert.rejects(detectBrowserCapability({...f.base,host:'dsh',adapter:await loadAdapter('codex')}),/HOST_ADAPTER_MISMATCH/);
 const cli=await detectWithoutHostSdk({file:f.base.file,host:'claude-code',env:f.env});assert.equal(cli.iab.result,'agent_only');assert.equal((await hostCapability({file:f.base.file,host:'claude-code'})).status,'detected');
}));
test('detection runs once per host: a second call returns the record without probing again until the user resets',()=>fixture(async f=>{
 let lists=0;const agent={browsers:{list:async()=>{lists++;return [{id:'i',type:'iab'}];},get:async()=>hostBrowser()}};
 const first=await detectBrowserCapability({...f.base,agent});assert.equal(lists,1);assert.equal(first.iab.result,'usable');
 const second=await detectBrowserCapability({...f.base,agent});assert.equal(lists,1);assert.equal(second.alreadyDetected,true);assert.equal(second.detectedAt,first.detectedAt);assert.deepEqual(second.channels,['chrome','iab']);
 await resetHost({file:f.base.file,host:'dsh',quote:'重新检测'});await detectBrowserCapability({...f.base,agent});assert.equal(lists,2);
}));
test('unreadable process evidence never passes the identity step; Chromium-family processes are seen',()=>fixture(async f=>{
 const r=await detectBrowserCapability({...f.base,processInventory:async()=>({available:false,processes:[],reason:'EPERM'}),agent:agentWith({i:{type:'iab',browser:hostBrowser()}})});
 assert.equal(r.iab.result,'identity_not_verified');assert.equal(r.iab.identity.processEvidence,false);assert.equal(r.iab.identity.processInventoryReason,'EPERM');assert.deepEqual(r.channels,['chrome']);
 const {readChromeProcessInventory}=await import('../shared/browser-environment.mjs');
 const lines=['999 /Applications/Chromium.app/Contents/MacOS/Chromium --user-data-dir=/tmp/synthetic-profile','1000 /Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --remote-debugging-port=9222','1001 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/w/.runtime/chrome-profile --remote-debugging-port=9333','1002 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer'];
 const inv=await readChromeProcessInventory({run:async()=>({stdout:lines.join('\n')})});
 assert.deepEqual(inv.processes.map(p=>p.pid),[999,1000,1001]);assert.equal(inv.processes[0].profileDir,'/tmp/synthetic-profile');assert.equal(inv.processes[2].debugPort,9333);
}));

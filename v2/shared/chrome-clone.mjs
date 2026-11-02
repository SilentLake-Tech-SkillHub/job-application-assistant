// The Chrome channel is ONE dedicated Chrome instance (the "clone"): the installed Google Chrome,
// started by this component with a fixed private profile and a local DevTools port, visible, with
// extensions allowed. Every executor host attaches to that same running instance over CDP; no host
// launches its own Chrome, and the user's everyday Chrome is never touched (Chrome 136+ ignores the
// debugging port on the default profile anyway).
//   - logins persist in the fixed profile directory across hosts and restarts
//   - the window is a normal Chrome window, so the user (or computer use) can operate edge cases in it
//   - Playwright attaches with connectOverCDP; it never launches this Chrome (a Playwright launch
//     would add --disable-extensions / --enable-automation and tie Chrome's life to one broker)
import {spawn as nodeSpawn} from 'node:child_process';
import {readFile,mkdir,chmod,realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {readChromeProcessInventory} from './browser-environment.mjs';
export const DEFAULT_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const DEFAULT_CDP_PORT=9333;
export const CLONE_LAUNCHER='scripts/chrome-clone.mjs start';
const DAILY_ROOTS=()=>[path.join(homedir(),'Library/Application Support/Google/Chrome'),path.join(homedir(),'.config/google-chrome'),path.join(process.env.LOCALAPPDATA||path.join(homedir(),'AppData/Local'),'Google/Chrome/User Data')];
export function isDailyProfile(dir){const d=path.resolve(dir);return DAILY_ROOTS().some(root=>d===path.resolve(root)||d.startsWith(path.resolve(root)+path.sep));}
// The configuration every host must share. install-host writes the same three values into each host.
export function cloneConfig(env=process.env){
 const profileDir=env.RECRUITING_BROWSER_PROFILE_DIR;
 if(!profileDir||!path.isAbsolute(profileDir)||isDailyProfile(profileDir))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
 const port=Number(env.RECRUITING_BROWSER_CDP_PORT||DEFAULT_CDP_PORT);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_CDP_PORT');
 const executable=env.RECRUITING_CHROME_EXECUTABLE||DEFAULT_CHROME_EXECUTABLE;
 if(!path.isAbsolute(executable))throw Error('CHROME_EXECUTABLE_PATH_REQUIRED');
 return {executable,profileDir:path.resolve(profileDir),port,endpoint:`http://127.0.0.1:${port}`};
}
export function cloneArgs({profileDir,port},{restoreLastSession=false}={}){
 return [`--user-data-dir=${profileDir}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',...(restoreLastSession?['--restore-last-session']:[])];
}
// macOS: .../Google Chrome.app/Contents/MacOS/Google Chrome -> .../Google Chrome.app/Contents/Info.plist
export async function readChromeVersion(executable,{read=readFile}={}){
 if(typeof executable!=='string'||!executable.includes('.app/Contents/MacOS/'))return null;
 const plist=path.join(executable.slice(0,executable.indexOf('.app/Contents/MacOS/')+4),'Contents','Info.plist');
 try{return (await read(plist,'utf8')).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]||null;}catch{return null;}
}
export const fetchVersion=async endpoint=>{try{const r=await fetch(new URL('/json/version',endpoint),{signal:AbortSignal.timeout(1500)});return r.ok?await r.json():null;}catch{return null;}};
export const fetchTabs=async endpoint=>{try{const r=await fetch(new URL('/json/list',endpoint),{signal:AbortSignal.timeout(1500)});return r.ok?(await r.json()).filter(t=>t.type==='page').map(t=>({id:t.id,url:t.url})):[];}catch{return [];}};
const resolved=async dir=>{try{return await realpath(dir);}catch{return path.resolve(dir);}};
// running             our profile's Chrome is up and owns the DevTools port
// stopped             nothing on the port, no Chrome on our profile
// running_without_cdp our profile is open in a Chrome started without the port (by hand); it must be quit first
// port_taken          something else answers on the port
export async function inspectClone({config,processInventory=readChromeProcessInventory,versionProbe=fetchVersion}){
 const [inventory,version]=await Promise.all([processInventory(),versionProbe(config.endpoint)]);
 const want=await resolved(config.profileDir);
 const ours=[];for(const p of inventory.processes||[])if(p.profileDir&&await resolved(p.profileDir)===want)ours.push(p);
 const owner=ours.find(p=>p.debugPort===config.port)||null;
 const state=owner&&version?'running':ours.length&&!owner?'running_without_cdp':version?'port_taken':'stopped';
 return {state,pid:owner?.pid||ours[0]?.pid||null,browserVersion:version?.Browser||null,inventoryAvailable:inventory.available!==false};
}
export async function launchClone({config,spawn=nodeSpawn,processInventory=readChromeProcessInventory,versionProbe=fetchVersion,restoreLastSession=false,waitMs=20000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const before=await inspectClone({config,processInventory,versionProbe});
 if(before.state==='running')return {...before,launched:false};
 if(before.state==='running_without_cdp')throw Error('CLONE_OPEN_WITHOUT_DEBUG_PORT_QUIT_IT_FIRST');
 if(before.state==='port_taken')throw Error('CDP_PORT_TAKEN_BY_ANOTHER_PROCESS');
 if(!(await stat(config.executable).catch(()=>null)))throw Error('CHROME_NOT_INSTALLED');
 await mkdir(config.profileDir,{recursive:true,mode:0o700});await chmod(config.profileDir,0o700);
 // Detached and unref'd: the clone outlives the broker and the host that asked for it.
 const child=spawn(config.executable,cloneArgs(config,{restoreLastSession}),{detached:true,stdio:'ignore'});child.unref?.();
 for(let waited=0;waited<waitMs;waited+=250){
  const now=await inspectClone({config,processInventory,versionProbe});
  if(now.state==='running')return {...now,launched:true};
  if(now.state==='port_taken')throw Error('CDP_PORT_TAKEN_BY_ANOTHER_PROCESS');
  await sleep(250);
 }
 throw Error('CLONE_DEVTOOLS_ENDPOINT_TIMEOUT');
}
// The capability record of the Chrome channel. Machine-wide: one record for all hosts.
export async function cloneRecord({config,now=()=>new Date().toISOString(),versionReader,exists=f=>stat(f).then(()=>true,()=>false)}){
 const installed=await exists(config.executable);
 const version=installed?await readChromeVersion(config.executable,versionReader?{read:versionReader}:{}):null;
 return {kind:'dedicated_clone',declaredBy:'component',executable:config.executable,installed,version,versionCheckedAt:now(),profileDir:config.profileDir,cdpPort:config.port,endpoint:config.endpoint,extensions:'allowed',window:'visible',
  identity:'checked on every attach: the browser pid (SystemInfo.getProcessInfo) must be the process running with --user-data-dir=profileDir',
  result:installed?'usable':'not_installed',...(installed?{}:{reason:'CHROME_NOT_INSTALLED'}),
  call:{mode:'cdp',url:config.endpoint,launcher:CLONE_LAUNCHER}};
}

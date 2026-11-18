import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureNativePageStructure} from './page-structure.mjs';

const domains=['Page.enable','Runtime.enable','Debugger.enable','Network.enable'];
const snapshotMethod='DOMSnapshot.captureSnapshot';
const unknownVersion={product:'Chrome (host extension)',protocol_version:'unavailable',revision:'unavailable',user_agent:'unavailable',js_version:'unavailable'};

// Collection stays on the authorized tab. REA normalization runs in the
// component core, so the host SDK never needs to load REA's Node transports.
export async function collectHostReaPage({tab,pageUrl}){
 const cdp=await tab.capabilities?.get('cdp');
 if(typeof cdp?.send!=='function')throw Error('REA_HOST_CAPABILITY_REQUIRED');
 const before=await tab.url();
 if(!tab.id||before!==pageUrl||new URL(before).protocol!=='https:')throw Error('REA_PAGE_BINDING_CHANGED');
 const targetId='host-tab:'+tab.id;
 const observed=Object.fromEntries(await Promise.all(domains.map(async method=>[method,await cdp.send(method)])));
 observed['Page.getFrameTree']=await cdp.send('Page.getFrameTree');
 const start=observed['Page.getFrameTree'].frameTree?.frame;
 if(!start?.loaderId||!start.url||new URL(start.url).origin!==new URL(before).origin)throw Error('REA_PAGE_BINDING_CHANGED');
 for(const [method,params] of [[snapshotMethod,{computedStyles:['display','visibility'],includeDOMRects:true,includePaintOrder:true}],['Page.getResourceTree',{}]]){
  observed[method]=await cdp.send(method,params);
 }
 const frames=[];
 const visit=node=>{
  if(!node?.frame)return;
  if(node.frame.id&&node.frame.securityOrigin===new URL(before).origin)frames.push(node.frame.id);
  for(const child of node.childFrames||[])visit(child);
 };
 visit(observed['Page.getFrameTree'].frameTree);
 if(!frames.includes(start.id))frames.unshift(start.id);
 const accessibility={};
 for(const frameId of frames)accessibility[frameId]=await cdp.send('Accessibility.getFullAXTree',{frameId});
 const after=(await cdp.send('Page.getFrameTree')).frameTree?.frame;
 if(await tab.url()!==before||after?.id!==start.id||after?.loaderId!==start.loaderId||after?.url!==start.url)throw Error('REA_PAGE_BINDING_CHANGED');
 const nativeStructure=await captureNativePageStructure({send:async method=>method==='Accessibility.getFullAXTree'?accessibility[start.id]:observed[method]},{pageUrl,targetId});
 return {observed,accessibility,observationStartedAt:new Date().toISOString(),title:await tab.title()||'',nativeStructure,binding:{pageId:tab.id,targetId,beforeUrl:before,afterUrl:before}};
}

export async function normalizeHostReaPage({hostObservation,reaPackageRoot}){
 if(!path.isAbsolute(reaPackageRoot||''))throw Error('REA_HOST_PACKAGE_REQUIRED');
 const manifest=JSON.parse(await readFile(path.join(reaPackageRoot,'package.json'),'utf8'));
 if(manifest.name!=='rea-agents'||manifest.version!=='6.7.0')throw Error('REA_HOST_PACKAGE_VERSION_MISMATCH');
 const load=name=>import(pathToFileURL(path.join(reaPackageRoot,'dist',name+'.js')).href);
 const [{capturePage},{createBrowserEvidence},{webPageInspectionSchema},{CdpCommandRejection}]=await Promise.all([
  load('browser/CdpPageCapture'),load('application/BrowserEvidence'),
  load('domain/browserObservationSchemas'),load('browser/CdpCommandRejection')
 ]);
 const {observed,accessibility,title,nativeStructure,binding}=hostObservation;
 const {targetId}=binding;
 const connection={
  onEvent(){return ()=>{};},
  async send(method,params={}){
   if(method==='Accessibility.getFullAXTree'&&Object.hasOwn(accessibility,params.frameId))return accessibility[params.frameId];
   if(Object.hasOwn(observed,method))return observed[method];
   throw new CdpCommandRejection('inspect_web_page',method,-32601,'Unavailable in the bound host snapshot');
  }
 };
 const input={target_id:targetId,cdp_endpoint:{recorded:'bound_host_extension_tab'},allowed_origins:nativeStructure.scriptOrigins,observation_ms:0,
  include_accessibility_text:true,include_console_text:false,include_json_body_shapes:false,include_websocket_shapes:false,include_script_sources:false,
  include_storage_keys:false,include_storage_fingerprints:false};
 const captured=await capturePage({connection,input,operation:'inspect_web_page',sessionId:undefined,
  target:{id:targetId,type:'page',title,attached:null},discovery:{version:unknownVersion}});
 const bridgeLimitations=['The target identifier is the host extension tab ID. Browser-wide debugger discovery is outside this capture.',
  'This is a host snapshot of DOM, accessibility and resources. Live event streams and script source bodies were not collected.'];
 const inspection={...captured.inspection,capture_window:{...captured.inspection.capture_window,started_at:hostObservation.observationStartedAt},limitations:bridgeLimitations};
 const normalized=webPageInspectionSchema.parse(inspection);
 const evidence=createBrowserEvidence('inspect_web_page',input,normalized,{id:'rea-host-extension',name:'REA observation through the bound browser extension',version:'6.7.0'});
 return {evidence,nativeStructure,bridgeLimitations,binding};
}

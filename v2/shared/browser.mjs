import {samePage} from './page-scope.mjs';
import {pageFailureState,missingPageFailureState} from './page-failure-state.mjs';
import {inspectEntryPage} from './entry-inspection.mjs';
import {executeTransition} from './entry-transition.mjs';
import {inspectRea} from './rea-structure.mjs';
import {captureNativePageStructure} from './page-structure.mjs';
import {readRoleIdentity} from './role-identity.mjs';
import {screenshotMaskDOM} from './screenshot-mask.mjs';
import { chromium } from 'playwright-core';
import { stat, readFile, mkdir, chmod, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import {hostRole} from './host-role.mjs';
import {readChromeProcessInventory} from './browser-environment.mjs';

import {PageAdapter} from './ui-page.mjs';
import {READY_TIMEOUT_MS,matchEntryPath} from './entry-recipe.mjs';
export {PageAdapter,inventoryDOM} from './ui-page.mjs';

export class BrowserAdapter {
  constructor(endpoint,{connector=(url,options)=>chromium.connectOverCDP(url,options),chromePortFile=path.join(homedir(),'Library/Application Support/Google/Chrome/DevToolsActivePort'),profileDir,screenshotDir,launcher=(dir,options)=>chromium.launchPersistentContext(dir,options),existingEndpoint=process.env.RECRUITING_BROWSER_ATTACH_ENDPOINT,endpointProbe=async url=>fetch(new URL('/json/version',url),{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false),versionProbe=async url=>{const u=new URL(url);if(u.protocol==='ws:')return {webSocketDebuggerUrl:u.href};return fetch(new URL('/json/version',url),{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():null);},identityProbe=null,hostEnvironment=process.env,cloneLauncher=null,processInventory=readChromeProcessInventory}={}) {
    // cloneLauncher starts the dedicated Chrome clone (shared/chrome-clone.mjs#launchClone) for a CDP
    // endpoint; it is only reached from the explicit initialize/restore stages, never from connect().
    Object.assign(this,{endpoint,connector,chromePortFile,profileDir,screenshotDir,launcher,existingEndpoint,endpointProbe,versionProbe,identityProbe,hostEnvironment,cloneLauncher,processInventory});this.executor={verified:false,provider:null,sessionId:null,reason:'BROWSER_NOT_CONNECTED'};this.connection=null;this.connecting=null;this.state='new';this.connectionAttempts=0;this.pageIds=new Map();
  }
  async assertPrivateProfile(){
    if(!this.profileDir||!path.isAbsolute(this.profileDir))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
    let current=path.resolve(this.profileDir),suffix=[];while(true){try{current=await realpath(current);break;}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;suffix.unshift(path.basename(current));current=parent;}}const actual=path.join(current,...suffix);
    const daily=[path.join(homedir(),'Library/Application Support/Google/Chrome'),path.join(homedir(),'.config/google-chrome'),path.join(process.env.LOCALAPPDATA||path.join(homedir(),'AppData/Local'),'Google/Chrome/User Data')];
    if(daily.some(root=>actual===path.resolve(root)||actual.startsWith(path.resolve(root)+path.sep)))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
    return actual;
  }
  async identifyConnection({owned=false,endpoint=this.endpoint}={}){
    const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
    try{
      const profile=await this.assertPrivateProfile();
      if(this.identityProbe){this.executor=await this.identityProbe({connection:this.connection,profileDir:profile,endpoint,owned});return;}
      let nativeId=null,command=null;
      if(!owned){
        // Browser.getBrowserCommandLine answers only when Chrome runs with --enable-automation, which the
        // dedicated clone deliberately does not use. Without it the profile is proven by the browser's own
        // process id (SystemInfo.getProcessInfo, no flag needed) matched to that process's --user-data-dir
        // in the local process list. Last resort: <user-data-dir>/DevToolsActivePort (written by Chrome for
        // --remote-debugging-port=0) naming this endpoint's port and current browser id.
        let args=null,browserPid=null;
        const session=await this.connection.newBrowserCDPSession();
        try{
          try{command=await session.send('Browser.getBrowserCommandLine');args=command?.arguments||null;}catch{args=null;}
          if(!args)try{browserPid=(await session.send('SystemInfo.getProcessInfo')).processInfo?.find(p=>p.type==='browser')?.id||null;}catch{browserPid=null;}
        }finally{await session.detach();}
        const version=await this.versionProbe(endpoint);nativeId=version?.webSocketDebuggerUrl?.match(/\/devtools\/browser\/([^/?#]+)/)?.[1];
        if(!nativeId)throw Error('BROWSER_SESSION_IDENTITY_UNAVAILABLE');
        let profileProof;
        if(args){
          const value=key=>{const inline=args.find(v=>v.startsWith(key+'='));return inline?inline.slice(key.length+1):args[args.indexOf(key)+1];};
          let actual=value('--user-data-dir');if(actual)try{actual=await realpath(actual);}catch{}if(!actual||path.resolve(actual)!==profile)throw Error('BROWSER_PROFILE_IDENTITY_MISMATCH');
          profileProof='browser_command_line';
        }
        let owner=null;
        if(!args&&browserPid){
          const inventory=await this.processInventory();owner=(inventory.processes||[]).find(p=>p.pid===browserPid)||null;
          if(owner){let own=owner.profileDir;try{own=await realpath(own);}catch{}if(!own||path.resolve(own)!==profile)throw Error('BROWSER_PROFILE_IDENTITY_MISMATCH');profileProof='browser_pid_process_inventory';}
        }
        if(!profileProof){
          const text=await readFile(path.join(profile,'DevToolsActivePort'),'utf8').catch(()=>null),[port,wsPath]=(text||'').split(/\r?\n/).map(v=>v.trim());
          if(!text||port!==new URL(endpoint).port||wsPath!==`/devtools/browser/${nativeId}`)throw Error('BROWSER_PROFILE_IDENTITY_MISMATCH');
          profileProof='devtools_active_port';
        }
        const proxy=args?args.filter(v=>/^--(?:proxy-|no-proxy)/.test(v)):owner?[owner.explicitProxy?'explicit:'+(owner.proxyEndpoint||'unparsed'):'none',owner.proxyPacConfigured?'pac':'no_pac']:['not_observable_without_automation_flag'];
        this.executor={provider:'local_cdp_chrome',verified:true,sessionId:digest({nativeId,profile,proxy}),browserInstanceId:nativeId,profileIdentity:digest(profile),profileProof,proxyIdentity:digest(proxy),reason:null};
      }else{
        let nativeId=null;const port=process.env.RECRUITING_BROWSER_CDP_PORT;try{if(port)nativeId=(await this.versionProbe('http://127.0.0.1:'+port))?.webSocketDebuggerUrl?.match(/\/devtools\/browser\/([^/?#]+)/)?.[1];}catch{}
        this.executor={provider:'managed_chrome',verified:true,sessionId:nativeId?digest({nativeId,profile}):randomUUID(),...(nativeId?{browserInstanceId:nativeId}:{}),continuity:nativeId?'native_browser_identity':'broker_lifetime_only',profileIdentity:digest(profile),proxyIdentity:digest({mode:'inherited_or_configured'}),reason:null};
      }
    }catch(error){this.executor={provider:owned?'managed_chrome':'local_cdp_chrome',verified:false,sessionId:null,reason:/^[A-Z_]+$/.test(error.message)?error.message:'BROWSER_IDENTITY_INSPECTION_FAILED'};}
  }
  async trackPage(page){
    const known=[...this.pageIds].find(([,p])=>p===page)?.[0];if(known)return known;
    let id;try{const session=await page.context().newCDPSession(page);try{id=(await session.send('Target.getTargetInfo')).targetInfo?.targetId;}finally{await session.detach();}}catch{}
    id=id||randomUUID();this.pageIds.set(id,page);return id;
  }
  async connect(){
    if(!this.endpoint)throw Error('BROWSER_CONNECTION_NOT_CONFIGURED');
    if(this.endpoint==='managed-iab')throw Error('IAB_HOST_BRIDGE_REQUIRED');
    if(this.endpoint==='chrome-default')throw Error('EXPLICIT_BROWSER_SESSION_REQUIRED');
    if(this.state==='failed'||this.state==='disconnected')throw Error('BROWSER_CONNECTION_STOPPED_NO_AUTOMATIC_RECONNECT');
    if(this.connecting)return this.connecting;
    if(this.connection)return this.connection;
    // Share the in-flight connection too: concurrent company jobs must never create parallel prompts.
    this.connecting=(async()=>{
      let endpoint=this.endpoint;
      if(endpoint==='managed-chrome'||endpoint==='managed-iab'){
        await this.assertPrivateProfile();
        const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
        if(!this.profileDir||!path.isAbsolute(this.profileDir)||path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
        await mkdir(this.profileDir,{recursive:true,mode:0o700});await chmod(this.profileDir,0o700);
        this.state='connecting';this.connectionAttempts++;
        if(this.existingEndpoint){
          const existing=new URL(this.existingEndpoint);
          if(!['http:','ws:'].includes(existing.protocol)||!['127.0.0.1','localhost','[::1]'].includes(existing.hostname)||existing.username||existing.password)throw Error('LOCAL_BROWSER_ENDPOINT_REQUIRED');
          this.connection=await this.connector(existing.href,{timeout:120000});this.state='connected';
          this.connection.on?.('disconnected',()=>{this.state='disconnected';this.connection=null;});
          await this.identifyConnection({endpoint:existing.href});return this.connection;
        }
        const cdpPort=process.env.RECRUITING_BROWSER_CDP_PORT;
        const context=await this.launcher(this.profileDir,{...(endpoint==='managed-chrome'?{channel:'chrome'}:{}),headless:false,viewport:null,...(cdpPort?{args:[`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1']}:{})});
        this.connection={contexts:()=>[context],on:(event,fn)=>{if(event==='disconnected')context.on('close',fn);}};
        this.state='connected';context.on('close',()=>{this.state='disconnected';this.connection=null;});
        await this.identifyConnection({owned:true});return this.connection;
      }
      const u=new URL(endpoint);
      if(!['http:','ws:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('LOCAL_BROWSER_ENDPOINT_REQUIRED');
      this.state='connecting';this.connectionAttempts++;
      this.connection=await this.connector(endpoint,{timeout:120000});this.state='connected';
      this.connection.on?.('disconnected',()=>{this.state='disconnected';this.connection=null;});
      await this.identifyConnection({endpoint});return this.connection;
    })();
    try{return await this.connecting;}catch(error){this.state='failed';throw error;}finally{this.connecting=null;}
  }
  status(){return {state:this.state,mode:this.endpoint==='managed-chrome'?'managed':this.endpoint==='managed-iab'?'iab':'cdp',connectionAttempts:this.connectionAttempts,automaticRetries:0,provider:this.executor.provider,executor:{...this.executor},pageCount:(this.connection?.contexts?.()||[]).reduce((n,c)=>n+(c.pages?.()||[]).filter(p=>!p.isClosed?.()).length,0),driverRevision:'2026-11-01.1',reloadableReaders:['ant','native_dom','control_operations']};}
  async initializeConfiguredChrome({authorization}={}){
    // Initialization is an explicit stage; status/startup never calls it.
    if(hostRole(this.hostEnvironment)!=='executor')throw Error('HOST_ROLE_MAINTAINER_READ_ONLY');
    if(authorization?.initialize!==true||!authorization.evidence?.trim())throw Error('BROWSER_INITIALIZE_USER_AUTHORIZATION_REQUIRED');
    if(this.initializing)return this.initializing;
    this.initializing=(async()=>{
      await this.assertPrivateProfile();
      if(this.endpoint==='managed-iab')throw Error('IAB_HOST_BRIDGE_REQUIRED');
      if(this.endpoint==='chrome-default'||!this.endpoint)throw Error('EXPLICIT_BROWSER_SESSION_REQUIRED');
      if(this.state==='connected'){
        if(!this.executor.verified)throw Error('BROWSER_EXECUTOR_IDENTITY_REQUIRED');
        return {...this.status(),initialized:false,reason:'already_connected',browserLaunched:false};
      }
      if(this.state==='failed'||this.state==='disconnected')throw Error('BROWSER_RESTORE_USER_AUTHORIZATION_REQUIRED');
      let cloneLaunched=false;
      if(this.endpoint!=='managed-chrome'&&this.cloneLauncher&&!(await this.endpointProbe(this.endpoint))){await this.cloneLauncher({restoreLastSession:false});cloneLaunched=true;}
      await this.connect();if(!this.executor.verified)throw Error('BROWSER_EXECUTOR_IDENTITY_REQUIRED');
      return {...this.status(),initialized:true,browserLaunched:cloneLaunched||this.endpoint==='managed-chrome'&&!this.existingEndpoint,requiresRoleReadback:true};
    })();
    try{return await this.initializing;}finally{this.initializing=null;}
  }
  async restoreConfiguredChrome({authorization}={}){
    if(authorization?.restore!==true||!authorization.evidence?.trim())throw Error('BROWSER_RESTORE_USER_AUTHORIZATION_REQUIRED');
    if(this.state==='connected')return {...this.status(),restored:false,reason:'already_connected'};
    if(this.connecting)throw Error('BROWSER_RESTORE_CONNECTION_IN_PROGRESS');
    await this.assertPrivateProfile();
    const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
    if(!this.profileDir||!path.isAbsolute(this.profileDir)||path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
    if(!(await stat(path.join(this.profileDir,'Local State')).catch(()=>null))?.isFile())throw Error('EXISTING_AUTOMATION_PROFILE_REQUIRED');
    if(this.endpoint==='managed-chrome'){
      this.state='new';this.connection=null;this.connecting=null;const context=await this.launcher(this.profileDir,{channel:'chrome',headless:false,viewport:null,args:['--restore-last-session']});
      this.connection={contexts:()=>[context],on:(event,fn)=>{if(event==='disconnected')context.on('close',fn);}};context.on('close',()=>{this.state='disconnected';this.connection=null;});this.state='connected';this.connectionAttempts++;await this.identifyConnection({owned:true});return {...this.status(),restored:true,profileReused:true,requiresRoleReadback:true};
    }
    const endpoint=new URL(this.endpoint);
    if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname)||!endpoint.port||endpoint.username||endpoint.password)throw Error('EXISTING_LOCAL_CDP_ENDPOINT_REQUIRED');
    this.state='connecting';this.connectionAttempts++;
    try{
      // Manual, explicitly authorized recovery of the configured private
      // profile. Ordinary connect() still never retries or launches on loss.
      // The clone is started as a normal Chrome (extensions allowed, outlives this broker), then attached.
      if(!(await this.endpointProbe(endpoint.href))){
        if(!this.cloneLauncher)throw Error('CHROME_CLONE_LAUNCHER_REQUIRED');
        await this.cloneLauncher({restoreLastSession:true});
      }
      this.connection=await this.connector(endpoint.href,{timeout:15000});this.connection.on?.('disconnected',()=>{this.state='disconnected';this.connection=null;});
      this.state='connected';await this.identifyConnection({endpoint:endpoint.href});
      return {...this.status(),restored:true,profileReused:true,requiresRoleReadback:true};
    }catch(error){this.state='failed';throw error;}
  }
  async trackedPage(id){let page=this.pageIds.get(id);if(!page&&this.connection)for(const candidate of (this.connection.contexts?.()||[]).flatMap(c=>c.pages?.()||[]).filter(p=>!p.isClosed())){if(await this.trackPage(candidate)===id){page=candidate;break;}}if(!page||page.isClosed())throw Error('ROLE_BROWSER_PAGE_LOST');return page;}
  async entryInspection(args){return inspectEntryPage(await this.trackedPage(args.pageId),args);}
  async failureSnapshot({pageId,knownUrls=[]}){
    let page=this.pageIds.get(pageId);
    if(page&&!page.isClosed())return pageFailureState(page,pageId);
    if(!this.connection){
      if(!/^https?:\/\/(?:127\.0\.0\.1|localhost):/.test(this.endpoint)||!this.profileDir||!await this.endpointProbe(this.endpoint))throw Error('EXISTING_BROWSER_SESSION_REQUIRED');
      const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
      if(path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
      if(this.state==='new')await this.connect();else await this.recoverTransient(Error('BROWSER_CONNECTION_LOST'));
    }
    // Broker reload may discover the same native target, never a same-URL replacement.
    try{return await pageFailureState(await this.trackedPage(pageId),pageId);}catch(error){if(error.message!=='ROLE_BROWSER_PAGE_LOST')throw error;return missingPageFailureState(pageId);}
  }

  async recoverTransient(error,args={}){
    const code=String(error?.message||'');
    if(this.state==='disconnected'||this.state==='failed'||/ECONN|disconnect/i.test(code)){
      if(!/^https?:\/\/(?:127\.0\.0\.1|localhost):/.test(this.endpoint)||!await this.endpointProbe(this.endpoint))throw Error('BROWSER_CONNECTION_LOST');
      const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
      if(!this.profileDir||path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
      this.connection=null;this.connecting=null;this.state='new';const connection=await this.connect();
      // Only native targets surviving in the same actual browser can be rebound.
      // A same-URL tab is a different document/task and must never inherit an ID.
      const prior=[...this.pageIds.keys()];this.pageIds.clear();
      for(const page of connection.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed()))await this.trackPage(page);
      for(const id of prior)if(!this.pageIds.has(id)&&args.pageId===id)throw Error('ROLE_BROWSER_PAGE_LOST');
    }
    if(args.pageId){const page=await this.trackedPage(args.pageId);if(page.isClosed())throw Error('ROLE_BROWSER_PAGE_LOST');}
  }

  async documentGeneration(page){
    try{const session=await page.context().newCDPSession(page);try{const tree=await session.send('Page.getFrameTree');if(tree.frameTree?.frame?.loaderId)return tree.frameTree.frame.loaderId;}finally{await session.detach();}}catch{}
    try{const origin=await page.evaluate(()=>performance.timeOrigin);if(Number.isFinite(origin)&&origin>0)return String(origin);}catch{}
    throw Error('BROWSER_DOCUMENT_IDENTITY_REQUIRED');
  }
  async pageIdentity(id){const page=await this.trackedPage(id);return {pageId:id,pageUrl:page.url(),generation:await this.documentGeneration(page),sessionId:this.executor.sessionId};}
  async reaInspect({pageId,pageUrl,authorization}){
    if(!authorization?.acquire||!authorization.evidence?.trim())throw Error('REA_CONSTRUCTION_AUTHORIZATION_REQUIRED');
    const page=await this.trackedPage(pageId),beforeUrl=page.url();
    if(this.state!=='connected'||beforeUrl!==pageUrl)throw Error('REA_PAGE_BINDING_CHANGED');
    const endpoint=process.env.RECRUITING_REA_ENDPOINT||(process.env.RECRUITING_BROWSER_CDP_PORT?`http://127.0.0.1:${process.env.RECRUITING_BROWSER_CDP_PORT}`:this.endpoint);
    const cdp=await page.context().newCDPSession(page);
    try{const {targetInfo}=await cdp.send('Target.getTargetInfo');
      if(targetInfo.url!==pageUrl)throw Error('REA_PAGE_BINDING_CHANGED');
      const nativeStructure=await captureNativePageStructure(cdp,{pageUrl,targetId:targetInfo.targetId});
      const evidence=await inspectRea({endpoint,targetId:targetInfo.targetId,pageUrl,allowedOrigins:nativeStructure.scriptOrigins});
      return {evidence,nativeStructure,binding:{pageId,targetId:targetInfo.targetId,beforeUrl,afterUrl:page.url()}};
    }finally{await cdp.detach();}
  }
  async roleSnapshot({pageId,roleSelector,accountSelector,loginRoot,roleIdentity}){
    const page=await this.trackedPage(pageId);
    const read=async s=>{if(!s)return null;const l=page.locator(s);if(await l.count()!==1)return null;return ((await l.innerText())||'').trim()||null;};
    return {pageUrl:page.url(),roleTitle:await read(roleSelector),...(roleIdentity?{roleIdentity:readRoleIdentity(roleIdentity,page.url())}:{}),account:await read(accountSelector),loginFormPresent:loginRoot?await page.locator(loginRoot).count()>0:false,readAt:new Date().toISOString()};
  }
  async screenshot(pageId,{selector}={}){const page=await this.trackedPage(pageId);const dir=this.screenshotDir||(this.profileDir?path.join(path.dirname(this.profileDir),'screenshots'):null);if(!dir)throw Error('SCREENSHOT_DIRECTORY_REQUIRED');await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,randomUUID()+'.png');const masks=await page.evaluate(screenshotMaskDOM),options={path:file,mask:masks.map(selector=>page.locator(selector))};if(selector){const actual=await new PageAdapter(page).resolveSelector(selector),target=page.locator(actual);if(await target.count()!==1)throw Error('SCREENSHOT_TARGET_NOT_UNIQUE');await target.screenshot(options);}else await page.screenshot({...options,fullPage:true});await chmod(file,0o600);return {path:file,scope:selector?'captured_field':'full_page',sensitiveFieldsMasked:masks.length};}
  async closePage(pageId){const page=await this.trackedPage(pageId);if(page.context().pages().filter(p=>!p.isClosed()).length<=1)throw Error('LAST_PAGE_NOT_CLOSABLE');await page.close();this.pageIds.delete(pageId);return {pageId,closed:true};}
  async openPage(url,{pageId,readySelectors=[],reuseOnly=false,reload=false,newPage=false}={}){
    if(new URL(url).protocol!=='https:')throw Error('HTTPS_BROWSER_PAGE_REQUIRED');
    const b=await this.connect(),context=b.contexts()[0];
    const matches=pageId?[await this.trackedPage(pageId)]:newPage?[]:context.pages().filter(p=>p.url()===url);
    if(matches.length>1)throw Error('AMBIGUOUS_PAGE');
    if(reuseOnly&&(!matches.length||matches[0].url()!==url))throw Error('EXISTING_PAGE_REQUIRED_FOR_REBIND');
    const blank=context.pages().find(p=>p.url()==='about:blank');
    const page=matches[0]||blank||await context.newPage(),reused=page.url()===url;
    if(!reused)await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});else if(reload&&pageId)await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await page.bringToFront();
    if(readySelectors.length){try{await page.waitForFunction(ss=>ss.some(s=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length)),readySelectors,{timeout:READY_TIMEOUT_MS});}catch{throw Error('PAGE_NOT_READY');}}
    const id=await this.trackPage(page);
    return {pageId:id,pageUrl:page.url(),reused};
  }
  async enterApplication({pageId,expectedTitle,accountSelector,expectedAccount,roleSelector,entry,expectedRoleId,sessionAccountPageUrl}){
    const page=await this.trackedPage(pageId),before=new URL(page.url());
    if(entry?.kind==='declarative_transition'){
      const identify=p=>this.trackPage(p);
      return executeTransition({entry,pageId,expectedTitle,expectedRoleId,expectedAccount,accountSelector,sessionAccountPageUrl},{
        getPage:id=>this.trackedPage(id),listPages:async()=>{const b=await this.connect();return Promise.all(b.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed()).map(async p=>({id:await identify(p),url:p.url()})));},pause:ms=>new Promise(r=>setTimeout(r,ms))
      });
    }
    if(entry?.kind==='resume_modal'){
      if(!expectedRoleId||entry.entryLabel!=='立即投递'||entry.editLabel!=='编辑'||!sessionAccountPageUrl||new URL(sessionAccountPageUrl).origin!==before.origin)throw Error('RESUME_ENTRY_CONTRACT_REQUIRED');
      const accountPage=await this.existingPage(sessionAccountPageUrl);
      const readAccount=async()=>(await accountPage.page.locator(accountSelector).innerText()).trim();
      if(await readAccount()!==expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
      let target=page,clicked=false;
      if(before.pathname===entry.detailPath){
        if(before.searchParams.get(entry.detailIdParameter)!==expectedRoleId||!(await page.getByText(expectedTitle,{exact:true}).count()))throw Error('APPLICATION_ENTRY_ROLE_CHANGED');
        if(await page.getByText(entry.editLabel,{exact:true}).count()!==1||!await page.getByText(entry.editLabel,{exact:true}).isVisible()){
          const buttons=page.getByText(entry.entryLabel,{exact:true});
          if(await buttons.count()!==entry.entryCount)throw Error('APPLICATION_ENTRY_BUTTON_CHANGED');
          await buttons.nth(entry.entryIndex).click({timeout:10000});clicked=true;
        }
        const edit=page.getByText(entry.editLabel,{exact:true});await edit.waitFor({state:'visible',timeout:15000});if(await edit.count()!==1)throw Error('RESUME_EDIT_ENTRY_NOT_UNIQUE');
        await edit.click({timeout:10000});const deadline=Date.now()+30000;
        do{const context=(await this.connect()).contexts()[0];const matches=context.pages().filter(p=>{const u=new URL(p.url());return u.origin===before.origin&&u.pathname===entry.formPath&&u.searchParams.get(entry.formIdParameter)===expectedRoleId;});if(matches.length>1)throw Error('AMBIGUOUS_ROLE_FORM');if(matches.length===1){target=matches[0];break;}await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);
      }
      const after=new URL(target.url());
      if(after.origin!==before.origin||after.pathname!==entry.formPath||after.searchParams.get(entry.formIdParameter)!==expectedRoleId)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
      await target.locator(entry.formReadySelector).waitFor({state:'visible',timeout:15000});if(await readAccount()!==expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
      const id=await this.trackPage(target);
      return {pageId:id,pageUrl:after.href,roleIdentity:{parameter:entry.formIdParameter,value:after.searchParams.get(entry.formIdParameter)},roleTitle:null,entryClicked:clicked,accountMatched:true,submission:'not_performed'};
    }
    // 通用分支只执行 JSON 配方；没有已核实配方的站点直接阻断，绝不按按钮文字猜测点击。
    const {detail,form,expectedApplyPath}=matchEntryPath(entry,before.pathname);
    if(!detail&&!form)throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
    if(!expectedTitle||!expectedAccount||!accountSelector||!roleSelector)throw Error('APPLICATION_ENTRY_IDENTITY_REQUIRED');
    if(sessionAccountPageUrl&&new URL(sessionAccountPageUrl).origin!==before.origin)throw Error('APPLICATION_ENTRY_ACCOUNT_SCOPE_CHANGED');
    // Some user-operated sites expose the verified identity on a separate résumé page.
    // Resolve it again before and after entry so a closed, replaced or duplicate page fails.
    const readAccount=async()=>{const identityPage=sessionAccountPageUrl?(await this.existingPage(sessionAccountPageUrl)).page:page;const l=identityPage.locator(accountSelector);if(await l.count()!==1)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');return (await l.innerText()).trim();};
    if(await readAccount()!==expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    if(detail){
      const title=await page.title();if(!title.startsWith(expectedTitle+entry.detailTitleSeparator))throw Error('APPLICATION_ENTRY_ROLE_CHANGED');
      const button=page.getByRole(entry.entryButton.role,{name:entry.entryButton.name,exact:true});await button.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});if(await button.count()!==1)throw Error('APPLICATION_ENTRY_BUTTON_CHANGED');
      // 该按钮只在已核实的岗位详情页存在并被点击；申请表页（form）永远不点击任何按钮。
      await button.click({timeout:10000});
      await page.waitForURL(url=>url.origin===before.origin&&url.pathname===expectedApplyPath,{timeout:READY_TIMEOUT_MS});
    }else if(before.pathname!==expectedApplyPath)throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
    try{await page.locator(roleSelector).waitFor({state:'visible',timeout:READY_TIMEOUT_MS});}catch{throw Error('PAGE_NOT_READY');}
    if((await page.locator(roleSelector).innerText()).trim()!==expectedTitle)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
    if(await readAccount()!==expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    return {pageId,pageUrl:page.url(),roleTitle:expectedTitle,entryClicked:detail,accountMatched:true,submission:'not_performed'};
  }
  async existingPage(url,{pageId,readOnly=false,roleBinding}={}){
    if(pageId&&!readOnly&&(!roleBinding||!['navigation','verified_role'].includes(roleBinding.kind)||roleBinding.pageId!==pageId||!this.executor.verified))throw Error('VERIFIED_ROLE_PAGE_BINDING_REQUIRED');
    if(!this.connection&&this.state==='new')throw Error('EXISTING_BROWSER_SESSION_REQUIRED');
    if(pageId){const page=await this.trackedPage(pageId);if(!samePage(page.url(),url))throw Error('EXPLICIT_PAGE_URL_MISMATCH');return new PageAdapter(page);}
    const browser=await this.connect();
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);
    if(pages.length!==1)throw Error(pages.length?'AMBIGUOUS_PAGE':'EXISTING_PAGE_NOT_FOUND');
    return new PageAdapter(pages[0]);
  }
  async tabs(){if(!this.connection&&this.state==='new'&&!this.existingEndpoint)return [];const b=await this.connect();return Promise.all(b.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed()).map(async p=>{const id=await this.trackPage(p);return {id,url:p.url(),title:await p.title()};}));}
}

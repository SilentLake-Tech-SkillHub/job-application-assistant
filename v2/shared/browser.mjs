import {executeTransition} from './entry-transition.mjs';
import {inspectRea} from './rea-structure.mjs';
import {captureNativePageStructure} from './page-structure.mjs';
import {readRoleIdentity} from './role-identity.mjs';
import {screenshotMaskDOM} from './screenshot-mask.mjs';
import { chromium } from 'playwright-core';
import { stat, readFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';

import {PageAdapter} from './ui-page.mjs';
import {READY_TIMEOUT_MS,matchEntryPath} from './entry-recipe.mjs';
export {PageAdapter,inventoryDOM} from './ui-page.mjs';

export class BrowserAdapter {
  constructor(endpoint,{connector=(url,options)=>chromium.connectOverCDP(url,options),chromePortFile=path.join(homedir(),'Library/Application Support/Google/Chrome/DevToolsActivePort'),profileDir,screenshotDir,launcher=(dir,options)=>chromium.launchPersistentContext(dir,options),existingEndpoint=process.env.RECRUITING_BROWSER_ATTACH_ENDPOINT,endpointProbe=async url=>fetch(new URL('/json/version',url),{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false)}={}) {
    Object.assign(this,{endpoint,connector,chromePortFile,profileDir,screenshotDir,launcher,existingEndpoint,endpointProbe});this.connection=null;this.connecting=null;this.state='new';this.connectionAttempts=0;this.pageIds=new Map();
  }
  async connect(){
    if(!this.endpoint)throw Error('BROWSER_CONNECTION_NOT_CONFIGURED');
    if(this.state==='failed'||this.state==='disconnected')throw Error('BROWSER_CONNECTION_STOPPED_NO_AUTOMATIC_RECONNECT');
    if(this.connecting)return this.connecting;
    if(this.connection)return this.connection;
    // Share the in-flight connection too: concurrent company jobs must never create parallel prompts.
    this.connecting=(async()=>{
      let endpoint=this.endpoint;
      if(endpoint==='managed-chrome'||endpoint==='managed-iab'){
        const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
        if(!this.profileDir||!path.isAbsolute(this.profileDir)||path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
        await mkdir(this.profileDir,{recursive:true,mode:0o700});await chmod(this.profileDir,0o700);
        this.state='connecting';this.connectionAttempts++;
        if(this.existingEndpoint){
          const existing=new URL(this.existingEndpoint);
          if(!['http:','ws:'].includes(existing.protocol)||!['127.0.0.1','localhost','[::1]'].includes(existing.hostname)||existing.username||existing.password)throw Error('LOCAL_BROWSER_ENDPOINT_REQUIRED');
          this.connection=await this.connector(existing.href,{timeout:120000});this.state='connected';
          this.connection.on?.('disconnected',()=>{this.state='disconnected';this.connection=null;});
          return this.connection;
        }
        const cdpPort=process.env.RECRUITING_BROWSER_CDP_PORT;
        const context=await this.launcher(this.profileDir,{...(endpoint==='managed-chrome'?{channel:'chrome'}:{}),headless:false,viewport:null,...(cdpPort?{args:[`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1']}:{})});
        this.connection={contexts:()=>[context],on:(event,fn)=>{if(event==='disconnected')context.on('close',fn);}};
        this.state='connected';context.on('close',()=>{this.state='disconnected';this.connection=null;});
        return this.connection;
      }
      if(endpoint==='chrome-default'){
        let parts;try{parts=(await readFile(this.chromePortFile,'utf8')).trim().split(/\r?\n/);}catch{throw Error('CHROME_DEBUGGING_NOT_AVAILABLE');}
        if(!/^\d{1,5}$/.test(parts[0])||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(parts[1]||''))throw Error('INVALID_CHROME_DEBUGGING_ENDPOINT');
        endpoint=`ws://127.0.0.1:${parts[0]}${parts[1]}`;
      }
      const u=new URL(endpoint);
      if(!['http:','ws:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('LOCAL_BROWSER_ENDPOINT_REQUIRED');
      this.state='connecting';this.connectionAttempts++;
      this.connection=await this.connector(endpoint,{timeout:120000});this.state='connected';
      this.connection.on?.('disconnected',()=>{this.state='disconnected';this.connection=null;});
      return this.connection;
    })();
    try{return await this.connecting;}catch(error){this.state='failed';throw error;}finally{this.connecting=null;}
  }
  status(){return {state:this.state,mode:this.endpoint==='managed-chrome'?'managed':this.endpoint==='managed-iab'?'iab':'cdp',connectionAttempts:this.connectionAttempts,automaticRetries:0,driverRevision:'2026-10-23.4',reloadableReaders:['ant','native_dom','control_operations']};}
  async restoreConfiguredChrome({authorization}={}){
    if(authorization?.restore!==true||!authorization.evidence?.trim())throw Error('BROWSER_RESTORE_USER_AUTHORIZATION_REQUIRED');
    if(this.state==='connected')return {...this.status(),restored:false,reason:'already_connected'};
    if(this.connecting)throw Error('BROWSER_RESTORE_CONNECTION_IN_PROGRESS');
    if(this.recoveryAttempted)throw Error('BROWSER_RESTORE_ALREADY_ATTEMPTED');
    const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
    if(!this.profileDir||!path.isAbsolute(this.profileDir)||path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
    if(!(await stat(path.join(this.profileDir,'Local State')).catch(()=>null))?.isFile())throw Error('EXISTING_AUTOMATION_PROFILE_REQUIRED');
    const endpoint=new URL(this.endpoint);
    if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname)||!endpoint.port||endpoint.username||endpoint.password)throw Error('EXISTING_LOCAL_CDP_ENDPOINT_REQUIRED');
    if(this.recoveryAttempted)throw Error('BROWSER_RESTORE_ALREADY_ATTEMPTED');
    this.recoveryAttempted=true;this.state='connecting';this.connectionAttempts++;
    try{
      // Manual, explicitly authorized recovery of the configured private
      // profile. Ordinary connect() still never retries or launches on loss.
      if(await this.endpointProbe(endpoint.href)){
        this.connection=await this.connector(endpoint.href,{timeout:15000});this.connection.on?.('disconnected',()=>{this.state='disconnected';this.connection=null;});
      }else{
        const context=await this.launcher(this.profileDir,{channel:'chrome',headless:false,viewport:null,args:[`--remote-debugging-port=${endpoint.port}`,'--remote-debugging-address=127.0.0.1','--restore-last-session']});
        this.connection={contexts:()=>[context],on:(event,fn)=>{if(event==='disconnected')context.on('close',fn);}};
        context.on('close',()=>{this.state='disconnected';this.connection=null;});
      }
      this.state='connected';
      return {...this.status(),restored:true,profileReused:true,requiresRoleReadback:true};
    }catch(error){this.state='failed';throw error;}
  }
  async trackedPage(id){const page=this.pageIds.get(id);if(!page||page.isClosed())throw Error('ROLE_BROWSER_PAGE_LOST');return page;}
  async pageIdentity(id){const page=await this.trackedPage(id);return {pageId:id,pageUrl:page.url()};}
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
  async openPage(url,{pageId,readySelectors=[],reuseOnly=false}={}){
    if(new URL(url).protocol!=='https:')throw Error('HTTPS_BROWSER_PAGE_REQUIRED');
    const b=await this.connect(),context=b.contexts()[0];
    const matches=pageId?[await this.trackedPage(pageId)]:context.pages().filter(p=>p.url()===url);
    if(matches.length>1)throw Error('AMBIGUOUS_PAGE');
    if(reuseOnly&&(!matches.length||matches[0].url()!==url))throw Error('EXISTING_PAGE_REQUIRED_FOR_REBIND');
    const blank=context.pages().find(p=>p.url()==='about:blank');
    const page=matches[0]||blank||await context.newPage(),reused=page.url()===url;
    if(!reused)await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.bringToFront();
    if(readySelectors.length){try{await page.waitForFunction(ss=>ss.some(s=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length)),readySelectors,{timeout:READY_TIMEOUT_MS});}catch{throw Error('PAGE_NOT_READY');}}
    let id=[...this.pageIds].find(([,p])=>p===page)?.[0];if(!id){id=randomUUID();this.pageIds.set(id,page);}
    return {pageId:id,pageUrl:page.url(),reused};
  }
  async enterApplication({pageId,expectedTitle,accountSelector,expectedAccount,roleSelector,entry,expectedRoleId,sessionAccountPageUrl}){
    const page=await this.trackedPage(pageId),before=new URL(page.url());
    if(entry?.kind==='declarative_transition'){
      const identify=p=>{let id=[...this.pageIds].find(([,v])=>v===p)?.[0];if(!id){id=randomUUID();this.pageIds.set(id,p);}return id;};
      return executeTransition({entry,pageId,expectedTitle,expectedRoleId,expectedAccount,accountSelector,sessionAccountPageUrl},{
        getPage:id=>this.trackedPage(id),listPages:async()=>{const b=await this.connect();return b.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed()).map(p=>({id:identify(p),url:p.url()}));},pause:ms=>new Promise(r=>setTimeout(r,ms))
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
      let id=[...this.pageIds].find(([,p])=>p===target)?.[0];if(!id){id=randomUUID();this.pageIds.set(id,target);}
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
  async existingPage(url,{pageId,readOnly=false}={}){
    if(pageId&&!readOnly)throw Error('EXPLICIT_PAGE_REQUIRES_READ_ONLY');
    if(!this.connection&&this.state==='new')throw Error('EXISTING_BROWSER_SESSION_REQUIRED');
    if(pageId){const page=await this.trackedPage(pageId);if(page.url()!==url)throw Error('EXPLICIT_PAGE_URL_MISMATCH');return new PageAdapter(page);}
    const browser=await this.connect();
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);
    if(pages.length!==1)throw Error(pages.length?'AMBIGUOUS_PAGE':'EXISTING_PAGE_NOT_FOUND');
    return new PageAdapter(pages[0]);
  }
  async tabs(){if(!this.connection&&this.state==='new'&&!this.existingEndpoint)return [];const b=await this.connect();return Promise.all(b.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed()).map(async p=>{let id=[...this.pageIds].find(([,tracked])=>tracked===p)?.[0];if(!id){id=randomUUID();this.pageIds.set(id,p);}return {id,url:p.url(),title:await p.title()};}));}
}

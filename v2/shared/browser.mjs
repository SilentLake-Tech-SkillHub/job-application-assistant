import { chromium } from 'playwright-core';
import { stat, readFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';

import {PageAdapter} from './ui-page.mjs';
export {PageAdapter,inventoryDOM} from './ui-page.mjs';

export class BrowserAdapter {
  constructor(endpoint,{connector=(url,options)=>chromium.connectOverCDP(url,options),chromePortFile=path.join(homedir(),'Library/Application Support/Google/Chrome/DevToolsActivePort'),profileDir,launcher=(dir,options)=>chromium.launchPersistentContext(dir,options)}={}) {
    Object.assign(this,{endpoint,connector,chromePortFile,profileDir,launcher});this.connection=null;this.connecting=null;this.state='new';this.connectionAttempts=0;this.pageIds=new Map();
  }
  async connect(){
    if(!this.endpoint)throw Error('BROWSER_CONNECTION_NOT_CONFIGURED');
    if(this.state==='failed'||this.state==='disconnected')throw Error('BROWSER_CONNECTION_STOPPED_NO_AUTOMATIC_RECONNECT');
    if(this.connecting)return this.connecting;
    if(this.connection)return this.connection;
    // Share the in-flight connection too: concurrent company jobs must never create parallel prompts.
    this.connecting=(async()=>{
      let endpoint=this.endpoint;
      if(endpoint==='managed-chrome'){
        const forbidden=path.join(homedir(),'Library/Application Support/Google/Chrome');
        if(!this.profileDir||!path.isAbsolute(this.profileDir)||path.resolve(this.profileDir)===forbidden||path.resolve(this.profileDir).startsWith(forbidden+path.sep))throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
        await mkdir(this.profileDir,{recursive:true,mode:0o700});await chmod(this.profileDir,0o700);
        this.state='connecting';this.connectionAttempts++;
        const context=await this.launcher(this.profileDir,{channel:'chrome',headless:false,viewport:null});
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
  status(){return {state:this.state,mode:this.endpoint==='managed-chrome'?'managed':'cdp',connectionAttempts:this.connectionAttempts,automaticRetries:0};}
  async trackedPage(id){const page=this.pageIds.get(id);if(!page||page.isClosed())throw Error('ROLE_BROWSER_PAGE_LOST');return page;}
  async pageIdentity(id){const page=await this.trackedPage(id);return {pageId:id,pageUrl:page.url()};}
  async roleSnapshot({pageId,roleSelector,accountSelector,loginRoot}){
    const page=await this.trackedPage(pageId);
    return page.evaluate(({roleSelector,accountSelector,loginRoot})=>{const read=s=>{if(!s)return null;const ns=document.querySelectorAll(s);return ns.length===1?ns[0].innerText?.trim()||null:null;};return {pageUrl:location.href,roleTitle:read(roleSelector),account:read(accountSelector),loginFormPresent:!!document.querySelector(loginRoot),readAt:new Date().toISOString()};},{roleSelector,accountSelector,loginRoot});
  }
  async screenshot(pageId){const page=await this.trackedPage(pageId);const dir=path.join(path.dirname(this.profileDir),'screenshots');await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,randomUUID()+'.png');await page.screenshot({path:file,fullPage:true,mask:[page.locator('input[data-test="validCodeInput"],input[type="password"]')]});await chmod(file,0o600);return {path:file};}
  async openPage(url,{pageId,readySelectors=[]}={}){
    if(new URL(url).protocol!=='https:')throw Error('HTTPS_BROWSER_PAGE_REQUIRED');
    const b=await this.connect(),context=b.contexts()[0];
    const matches=pageId?[await this.trackedPage(pageId)]:context.pages().filter(p=>p.url()===url);
    if(matches.length>1)throw Error('AMBIGUOUS_PAGE');
    const blank=context.pages().find(p=>p.url()==='about:blank');
    const page=matches[0]||blank||await context.newPage(),reused=page.url()===url;
    if(!reused)await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.bringToFront();
    if(readySelectors.length)await page.waitForFunction(ss=>ss.some(s=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length)),readySelectors,{timeout:30000});
    let id=[...this.pageIds].find(([,p])=>p===page)?.[0];if(!id){id=randomUUID();this.pageIds.set(id,page);}
    return {pageId:id,pageUrl:page.url(),reused};
  }
  async enterApplication({pageId,expectedTitle,accountSelector,expectedAccount,roleSelector}){
    const page=await this.trackedPage(pageId),before=new URL(page.url());
    const detailMatch=before.pathname.match(/^\/(campus|campushirecn)\/(?:m\/)?position\/(\d+)\/detail$/);
    const formMatch=before.pathname.match(/^\/(campus|campushirecn)\/resume\/(\d+)\/apply$/);
    const detail=!!detailMatch,form=!!formMatch,identity=detailMatch||formMatch;
    const expectedApplyPath=identity?'/'+identity[1]+'/resume/'+identity[2]+'/apply':null;
    if(!detail&&!form)throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
    const account=await page.locator(accountSelector).innerText();
    if(!expectedAccount||account.trim()!==expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    if(detail){
      const title=await page.title();if(!title.startsWith(expectedTitle+' - '))throw Error('APPLICATION_ENTRY_ROLE_CHANGED');
      const button=page.getByRole('button',{name:'投递',exact:true});await button.waitFor({state:'visible',timeout:15000});if(await button.count()!==1)throw Error('APPLICATION_ENTRY_BUTTON_CHANGED');
      // This named action exists only on a verified job-detail URL, never a résumé form.
      await button.click({timeout:10000});
      await page.waitForURL(url=>url.origin===before.origin&&url.pathname===expectedApplyPath,{timeout:30000});
    }
    await page.locator(roleSelector).waitFor({state:'visible',timeout:30000});
    if((await page.locator(roleSelector).innerText()).trim()!==expectedTitle)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
    if((await page.locator(accountSelector).innerText()).trim()!==expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    return {pageId,pageUrl:page.url(),roleTitle:expectedTitle,entryClicked:detail,accountMatched:true,submission:'not_performed'};
  }
  async existingPage(url){
    const browser=await this.connect();
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);
    if(pages.length!==1)throw Error(pages.length?'AMBIGUOUS_PAGE':'EXISTING_PAGE_NOT_FOUND');
    return new PageAdapter(pages[0]);
  }
  async tabs(){const b=await this.connect();return Promise.all(b.contexts().flatMap(c=>c.pages()).map(async p=>({url:p.url(),title:await p.title()})));}
}

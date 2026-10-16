import { chromium } from 'playwright-core';
import { stat, readFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import { observeDOM } from './observation.mjs';
import { inventoryFeishuDOM } from './feishu-inventory.mjs';
import { remapFeishuSpecDOM, canonicalizeInventory } from './feishu-selectors.mjs';

// This function only reads rendered DOM; no framework state, cookies, request interception or value injection.
export function inventoryDOM() {
  const visible = n => !!n?.getClientRects().length && getComputedStyle(n).visibility!=='hidden';
  const selector = n => {
    if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1)return '#'+CSS.escape(n.id);
    const parts=[];
    for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
    return 'body > '+parts.join(' > ');
  };
  const controls=[...document.querySelectorAll('input,textarea,select,[role="combobox"],[role="checkbox"],[role="radio"]')]
    // Styled checkbox/radio inputs can have zero layout rectangles while their labels remain visible.
    .filter(n=> (visible(n)||n.type==='file'||(['checkbox','radio'].includes(n.type)&&visible(n.closest('label')))) && n.type!=='hidden');
  // Some custom selectors and read-only answers contain no native/ARIA input.
  // Register their labeled question container so they cannot disappear from coverage.
  const containers=[...document.querySelectorAll('.atsx-form-item,[data-form-question]')]
    .filter(n=>visible(n)&&n.querySelector('label')&&!controls.some(c=>n.contains(c)));
  return [...controls,...containers]
    .map(n=>({selector:selector(n),tag:n.tagName.toLowerCase(),type:n.type||n.getAttribute('role')||'custom_question',label:[...(n.labels||[])].map(l=>l.textContent.trim()).join(' ')||n.closest('.atsx-form-item,[data-form-question]')?.querySelector('label')?.textContent.trim()||n.getAttribute('aria-label')||'',placeholder:n.getAttribute('placeholder'),required:!!n.required||n.getAttribute('aria-required')==='true'||!!n.closest('.atsx-form-item')?.querySelector('.atsx-form-item-required'),readonly:!!n.readOnly,disabled:!!n.disabled,accept:n.getAttribute('accept')}))
    .map(f=>({...f,userOnly:f.type==='password'||/otp|验证码|password|密码|token|captcha|身份证|护照号|银行卡/i.test(f.label+' '+f.selector)}));
}

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
    return page.evaluate(({roleSelector,accountSelector,loginRoot})=>{const read=s=>{const ns=document.querySelectorAll(s);return ns.length===1?ns[0].innerText?.trim()||null:null;};return {pageUrl:location.href,roleTitle:read(roleSelector),account:read(accountSelector),loginFormPresent:!!document.querySelector(loginRoot),readAt:new Date().toISOString()};},{roleSelector,accountSelector,loginRoot});
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
  async existingPage(url){
    const browser=await this.connect();
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);
    if(pages.length!==1)throw Error(pages.length?'AMBIGUOUS_PAGE':'EXISTING_PAGE_NOT_FOUND');
    return new PageAdapter(pages[0]);
  }
  async tabs(){const b=await this.connect();return Promise.all(b.contexts().flatMap(c=>c.pages()).map(async p=>({url:p.url(),title:await p.title()})));}
}

export class PageAdapter {
  constructor(page){this.page=page;}
  async assertLocation(origin,prefix){const u=new URL(this.page.url());if(u.origin!==origin||!u.pathname.startsWith(prefix))throw Error('PAGE_IDENTITY_CHANGED');}
  async wait(selector){await this.page.locator(selector).waitFor({state:'visible',timeout:10000});}
  async inventory(plan){const raw=await this.page.evaluate(plan?.provider==='feishu'?inventoryFeishuDOM:inventoryDOM);return plan?.provider==='feishu'&&!plan.rawKeys?canonicalizeInventory(raw).fields:raw;}
  async observe(plan){return this.page.evaluate(observeDOM,plan.provider==='feishu'&&!plan.selectorsResolved?await this.page.evaluate(remapFeishuSpecDOM,plan):plan);}
  async ensureGroups(groups){
    for(const group of groups||[]){
      let count=await this.page.locator(group.selector).count();
      if(count>group.count)throw Error('EXCESS_REPEAT_ENTRIES_REQUIRE_REVIEW');
      while(count<group.count){
        const add=this.page.locator(group.addSelector);
        if(await add.count()!==1||(await add.innerText()).trim()!=='添加')throw Error('REPEAT_ADD_CONTROL_CHANGED');
        await add.click({timeout:10000});
        const next=await this.page.locator(group.selector).count();
        if(next!==count+1)throw Error('REPEAT_ADD_DID_NOT_CREATE_ONE_ENTRY');
        count=next;
      }
    }
  }
  async act(action,value,files){
    if(action.provider==='feishu'&&!action.selectorsResolved)action=await this.page.evaluate(remapFeishuSpecDOM,action);
    const l=this.page.locator(action.selector);
    if(await l.count()!==1)throw Error('AMBIGUOUS_ACTION_TARGET');
    const meta=await l.evaluate(n=>({tag:n.tagName,type:n.getAttribute('type'),role:n.getAttribute('role'),label:n.getAttribute('aria-label')||n.textContent?.trim(),readonly:n.readOnly}));
    if(action.method==='wait'){await this.wait(action.selector);return;}
    if(action.method==='click'){
      if(!action.label||meta.label!==action.label)throw Error('CLICK_LABEL_CHANGED');
      if(/提交|投递|撤回|删除|同意|签名|submit|apply|withdraw|delete|agree|consent/i.test(meta.label)||meta.type==='submit'||(meta.tag==='BUTTON'&&!meta.type))throw Error('POTENTIAL_SUBMISSION_BLOCKED');
      await l.click({timeout:10000});return;
    }
    if(action.method==='fill'){
      if(meta.readonly||['date','month','password','file','radio','checkbox'].includes(meta.type))throw Error('CONTROL_REQUIRES_SPECIFIC_ACTION');
      await l.fill(String(value),{timeout:10000});await l.press('Tab');return;
    }
    if(action.method==='select'){if(meta.tag!=='SELECT')throw Error('NATIVE_SELECT_REQUIRED');await l.selectOption({label:String(value)});return;}
    if(action.method==='dropdown'){
      if(meta.role!=='combobox'||!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      await l.click({timeout:10000});
      const option=this.page.getByRole('option',{name:String(value),exact:true});
      if(await option.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
      await option.click({timeout:10000});await l.press('Tab');return;
    }
    if(action.method==='radio'){
      if(!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      await l.getByRole('radio',{name:String(value),exact:true}).check();return;
    }
    if(action.method==='feishu_month'){
      if(value!=='至今'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)))throw Error('INVALID_MONTH_VALUE');
      await l.click({timeout:10000});
      const base='.atsx-date-picker-period-month-panel-list-item';
      if(value==='至今')await this.page.locator(`${base}[data-cy="-"]:visible`).click({timeout:10000});
      else{
        const [year,month]=String(value).split('-');
        await this.page.locator(`${base}[data-cy="${year}"]:visible`).click({timeout:10000});
        await this.page.locator(`${base}[data-cy="${month}"]:visible`).click({timeout:10000});
      }
      return;
    }
    if(action.method==='feishu_year'){
      if(!/^\d{4}$/.test(String(value)))throw Error('INVALID_YEAR_VALUE');
      await l.click({timeout:10000});
      await this.page.locator('.atsx-date-picker-panel-body-cell-content:visible').filter({hasText:new RegExp(`^${value}$`)}).click({timeout:10000});
      await l.press('Tab');return;
    }
    if(action.method==='check'){if(typeof value!=='boolean')throw Error('BOOLEAN_REQUIRED');await l.setChecked(value);return;}
    if(action.method==='upload'){
      const asset=files[value];
      if(!asset?.paths?.length||!asset.displayNames?.length||asset.paths.length!==asset.displayNames.length)throw Error('FILE_REFERENCE_MISSING');
      for(const [index,file]of asset.paths.entries()){
        if(!path.isAbsolute(file)||!(await stat(file)).isFile())throw Error('INVALID_FILE_REFERENCE');
        if(!asset.sha256?.[index]||createHash('sha256').update(await readFile(file)).digest('hex')!==asset.sha256[index])throw Error('UPLOAD_FILE_HASH_MISMATCH');
      }
      await l.setInputFiles(asset.paths);
      if(action.successSelector)await this.page.locator(action.successSelector).waitFor({state:'visible',timeout:30000});
      return;
    }
    throw Error('UNKNOWN_ACTION');
  }
  async readBatch(fields){
    return this.page.evaluate(specs=>{
      const out={};
      for(const f of specs){
        const nodes=document.querySelectorAll(f.read.selector);
        if(nodes.length!==1){out[f.id]=null;continue;}
        const n=nodes[0];
        if(f.read.kind==='value')out[f.id]=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent?.trim():n.value??null;
        else if(f.read.kind==='checked')out[f.id]=typeof n.checked==='boolean'?n.checked:n.getAttribute('aria-checked')==='true';
        else if(f.read.kind==='text')out[f.id]=n.innerText?.trim()??null;
        else if(f.read.kind==='attribute')out[f.id]=n.getAttribute(f.read.attribute);
        // Only site-rendered attachment rows prove uploaded state; FileList merely proves local selection.
        else if(f.read.kind==='files')out[f.id]=f.read.filenameSelector?[...n.querySelectorAll(f.read.filenameSelector)].map(e=>e.innerText.trim()):null;
      }
      return out;
    },fields);
  }
  async validationErrors(selectors){return this.page.evaluate(ss=>ss.flatMap(s=>[...document.querySelectorAll(s)].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(()=>({selector:s,visible:true}))),selectors);}
}

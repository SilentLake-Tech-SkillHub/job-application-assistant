// Reuse the already connected browser host. No browser launch, CDP reconnect,
// cookie access, arbitrary evaluate endpoint or direct authentication HTTP API.
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
export class LoginBrowser{
  constructor(socket,{broker}={}){if(!socket)throw Error('SHARED_BROWSER_SOCKET_REQUIRED');this.broker=broker||new BrokerBrowserAdapter(socket,{requestTimeoutMs:45000});}
  status(){return this.broker.status();}
  open(url){return this.broker.request('openPage',{pageUrl:url});}
  async ready(c,url){const page=await this.broker.existingPage(url);await page.wait([c.fields?.root,c.account.selector,c.entry?.formReadySelector].filter(Boolean).join(','));}
  async locate(c,preferred){
    const tabs=(await this.broker.request('tabs',{pageUrl:preferred||c.origin})).filter(t=>{try{const u=new URL(t.url);return u.origin===c.origin&&c.allowedPaths.some(p=>u.pathname.startsWith(p));}catch{return false;}});
    const exact=tabs.filter(t=>t.url===preferred);
    if(exact.length===1)return exact[0].url;
    if(tabs.length!==1)throw Error(tabs.length?'LOGIN_PAGE_AMBIGUOUS':'LOGIN_PAGE_NOT_OPEN');return tabs[0].url;
  }
  async observe(c,url){
    if(c.loginMethod==='user_operated'){
      const read=async pageUrl=>{if(new URL(pageUrl).origin!==c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');const page=await this.broker.existingPage(pageUrl);const raw=await page.observe({fields:[{id:'account',read:{selector:c.account.selector,kind:'text'}}]});if(new URL(raw.pageUrl).origin!==c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');return raw;};
      let raw;try{raw=await read(url);}catch(cause){if(cause.message!=='EXISTING_PAGE_NOT_FOUND')throw cause;}
      if(!raw?.fields.account.present&&url!==c.account.pageUrl){
       try{raw=await read(c.account.pageUrl);}catch(cause){if(cause.message!=='EXISTING_PAGE_NOT_FOUND')throw cause;const error=Error('ACCOUNT_PROOF_PAGE_NOT_OPEN');error.details={identityPagePath:new URL(c.account.pageUrl).pathname,rolePagePath:new URL(url).pathname,recovery:'verify_real_account_locator_on_an_existing_same_origin_page'};throw error;}
      }
      if(!raw)throw Error('ACCOUNT_PROOF_PAGE_NOT_OPEN');
      return {url,identityPageUrl:raw.pageUrl,readAt:raw.readAt,account:raw.fields.account.present?raw.fields.account.value:null,form:!raw.fields.account.present,userOperated:true,dialogs:0,challenges:0,errors:0};
    }
    const f=c.fields,p=c.popups[0];
    const fields=[['account',c.account.selector,'text'],['form',f.root,'text',true],['country',f.countrySelected,'text'],['phone',f.phone,'value'],['otp',f.otp,'value',true],['send',f.send,'text'],['sendDisabled',f.send,'attribute'],['submit',f.submit,'text'],['consent',f.consent,'checked'],['popupTitle',p.titleSelector,'text'],['popupBody',p.bodySelector,'text'],['registrationNotice',f.automaticRegistrationNotice,'text']].map(([id,selector,kind,userOnly])=>({id,userOnly,read:{selector,kind,...(id==='sendDisabled'?{attribute:'disabled'}:{}),...(id==='consent'?{presenceSelector:f.consentPresence}:{})}}));
    const page=await this.broker.existingPage(url),raw=await page.observe({fields,groups:[{id:'dialogs',selector:'[role="dialog"]'},{id:'challenges',selector:c.challenge.selectors.join(',')},{id:'errors',selector:f.errors}]});
    return {url:raw.pageUrl,readAt:raw.readAt,account:raw.fields.account.present?raw.fields.account.value:null,form:raw.fields.form.present,country:raw.fields.country.value,phone:raw.fields.phone.value,otpPresent:raw.fields.otp.present,sendLabel:raw.fields.send.value,sendDisabled:raw.fields.sendDisabled.value!==null,submitLabel:raw.fields.submit.value,consent:raw.fields.consent.value===true,dialogs:raw.groups.dialogs,challenges:raw.groups.challenges,errors:raw.groups.errors,popupTitle:raw.fields.popupTitle.value,popupBody:raw.fields.popupBody.value,registrationNotice:raw.fields.registrationNotice.value};
  }
  async act(c,url,action,value){const page=await this.broker.existingPage(url);return page.act(action,value,{});}
  async inventory(c,url){return (await this.broker.existingPage(url)).inventory();}
}

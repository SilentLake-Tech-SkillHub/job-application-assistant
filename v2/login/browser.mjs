// Reuse the already connected browser host. No browser launch, CDP reconnect,
// cookie access, arbitrary evaluate endpoint or direct authentication HTTP API.
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {sessionFromSnapshot} from '../shared/login-state.mjs';
export async function observeUserOperatedSession(broker,c,url,{currentSnapshot,pageId}={}){
 if(new URL(url).origin!==c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');
 let raw=currentSnapshot;
 if(!raw){
  if(!pageId){const tabs=await broker.request('tabs',{pageUrl:url});const matches=tabs.filter(p=>p.url===url);if(matches.length!==1)throw Error(matches.length?'LOGIN_PAGE_AMBIGUOUS':'LOGIN_PAGE_NOT_OPEN');const p=matches[0];pageId=p.browserChannel&&!String(p.id).startsWith(p.browserChannel+':')?p.browserChannel+':'+p.id:p.id;}
  raw=await broker.request('roleSnapshot',{pageId,accountSelector:c.account?.selector,loginRoot:c.fields?.root,sessionSelectors:c.session});
 }
 if(new URL(raw.pageUrl).origin!==c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');
 const session=sessionFromSnapshot(raw);
 return {url:raw.pageUrl,readAt:raw.readAt,...session,form:session.loginFormPresent,userOperated:true,dialogs:0,challenges:0,errors:0};
}
export class LoginBrowser{
  constructor(socket,{broker}={}){if(!socket)throw Error('SHARED_BROWSER_SOCKET_REQUIRED');this.broker=broker||new BrokerBrowserAdapter(socket,{requestTimeoutMs:45000});}
  status(){return this.broker.status();}
  open(url){return this.broker.request('openPage',{pageUrl:url});}
  async ready(c,url){const page=await this.broker.existingPage(url);await page.wait([c.fields?.root,c.account?.selector,c.entry?.formReadySelector].filter(Boolean).join(','));}
  async locate(c,preferred){
    const tabs=(await this.broker.request('tabs',{pageUrl:preferred||c.origin})).filter(t=>{try{const u=new URL(t.url);return u.origin===c.origin&&c.allowedPaths.some(p=>u.pathname.startsWith(p));}catch{return false;}});
    const exact=tabs.filter(t=>t.url===preferred);
    if(exact.length===1)return exact[0].url;
    if(tabs.length!==1)throw Error(tabs.length?'LOGIN_PAGE_AMBIGUOUS':'LOGIN_PAGE_NOT_OPEN');return tabs[0].url;
  }
  async observe(c,url){
    if(c.loginMethod==='user_operated'){
      return observeUserOperatedSession(this.broker,c,url);
    }
    const f=c.fields,p=c.popups[0];
    const fields=[['account',c.account?.selector,'text'],['form',f.root,'text',true],['country',f.countrySelected,'text'],['phone',f.phone,'value'],['otp',f.otp,'value',true],['send',f.send,'text'],['sendDisabled',f.send,'attribute'],['submit',f.submit,'text'],['consent',f.consent,'checked'],['popupTitle',p.titleSelector,'text'],['popupBody',p.bodySelector,'text'],['registrationNotice',f.automaticRegistrationNotice,'text']].map(([id,selector,kind,userOnly])=>({id,userOnly,read:{selector,kind,...(id==='sendDisabled'?{attribute:'disabled'}:{}),...(id==='consent'?{presenceSelector:f.consentPresence}:{})}}));
    const page=await this.broker.existingPage(url),raw=await page.observe({fields,groups:[{id:'dialogs',selector:'[role="dialog"]'},{id:'challenges',selector:c.challenge.selectors.join(',')},{id:'errors',selector:f.errors}]});
    return {url:raw.pageUrl,readAt:raw.readAt,account:raw.fields.account.present?raw.fields.account.value:null,form:raw.fields.form.present,country:raw.fields.country.value,phone:raw.fields.phone.value,otpPresent:raw.fields.otp.present,sendLabel:raw.fields.send.value,sendDisabled:raw.fields.sendDisabled.value!==null,submitLabel:raw.fields.submit.value,consent:raw.fields.consent.value===true,dialogs:raw.groups.dialogs,challenges:raw.groups.challenges,errors:raw.groups.errors,popupTitle:raw.fields.popupTitle.value,popupBody:raw.fields.popupBody.value,registrationNotice:raw.fields.registrationNotice.value};
  }
  async act(c,url,action,value){const page=await this.broker.existingPage(url);return page.act(action,value,{});}
  async inventory(c,url){return (await this.broker.existingPage(url)).inventory();}
}

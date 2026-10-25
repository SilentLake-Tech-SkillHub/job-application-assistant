import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateCompany,assertScope,resolveAccount,accountMatches,matchesAccount,hash,PrivateStore,safeCode} from './contracts.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from '../shared/leases.mjs';
import {beforeLoginStep,canHandoff} from '../hooks/login-gate.mjs';
import {updateProfile} from '../shared/profile.mjs';
const now=()=>new Date().toISOString();
const smsCountdown=o=>o.sendDisabled&&/(?:\d{1,3}\s*(?:秒|s)|(?:重试|重发).*\d{1,3})/i.test(o.sendLabel||'');
const handoff={operator:'user',automaticSolve:false,automaticResend:false,nextTool:'login_resume_verification'};
export class LoginEngine{
  constructor({companyRoot,loginFile,privateRoot,profileFile,browser,leaseRoot=defaultLeaseRoot()}){Object.assign(this,{companyRoot,loginFile,profileFile,browser,leaseRoot});this.store=new PrivateStore(privateRoot);}
  async company(id){if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id))throw Error('INVALID_COMPANY_ID');const file=this.loginFile?this.loginFile(id):path.join(this.companyRoot,id+'.login.json');return validateCompany(JSON.parse(await readFile(file,'utf8')));}
  async profile(){return JSON.parse(await readFile(this.profileFile,'utf8'));}
  async planState(c,p){const url=p.taskContext?(await this.browser.broker.request('pageIdentity',{pageId:p.taskContext.pageId})).pageUrl:p.pageUrl;return this.state(c,url);}
  async open({companyId}){const c=await this.company(companyId);return this.locked(c,async()=>{const result=await this.browser.open(c.origin+c.loginPath);await this.browser.ready(c,result.pageUrl);return {...result,companyId,ready:true,applicationSubmission:'not_performed'};});}
  async locked(c,fn,{waitMs=0}={}){const release=await acquireLease(leasePath(this.leaseRoot,'recruiting-origin:'+c.origin),{waitMs,busyCode:'COMPANY_ALREADY_RUNNING'});try{return await fn();}finally{await release();}}
  async state(c,preferred){const url=await this.browser.locate(c,preferred);assertScope(c,url);const o=await this.browser.observe(c,url),account=resolveAccount(await this.profile(),c);return {...o,accountMatched:matchesAccount(o.account,account),accountMismatch:!!o.account&&!matchesAccount(o.account,account),unknownPopup:o.dialogs>0&&o.popupTitle!==c.popups?.[0]?.title};}
  publicState(o){return {pageUrl:o.url,readAt:o.readAt,status:o.accountMismatch?'account_mismatch':o.accountMatched&&!o.form?'authenticated':o.challenges?'needs_user_verification':o.unknownPopup?'unknown_popup':o.form?'logged_out':'unknown',accountMatched:o.accountMatched,loginFormAbsent:!o.form,popup:o.dialogs?{title:o.popupTitle,known:!o.unknownPopup}:null,applicationSubmission:'not_performed'};}
  async inspect({companyId,pageUrl}){const c=await this.company(companyId);assertScope(c,pageUrl);return this.locked(c,async()=>{const o=await this.state(c,pageUrl);return this.publicState(o);});}
  async capture({companyId,pageUrl,evidence}){
    const c=await this.company(companyId);assertScope(c,pageUrl);if(!evidence)throw Error('CAPTURE_EVIDENCE_REQUIRED');
    return this.locked(c,async()=>{
      const o=await this.state(c,pageUrl),controls=await this.browser.inventory(c,o.url),id=randomUUID();
      await updateProfile(this.profileFile,p=>{p.loginForms??={};p.loginForms[companyId]={companyId,version:c.version,assetHash:hash(c),observedAt:now(),fields:Object.entries(c.fields).filter(([k])=>!k.endsWith('Label')).map(([key,selector])=>({key,selector,source:key==='phone'?c.account.source:null,storage:key==='otp'?'never_store_authentication_secret':'company_definition'})),observedControls:controls.map(({selector,type,placeholder,required,disabled})=>({selector,type,placeholder,required,disabled})),evidence};});
      const result={id,companyId,assetHash:hash(c),capturedAt:now(),controls,coverage:'current_login_document; declared_country_and_privacy_popup; captcha_not_yet_observed',submission:'not_performed'};await this.store.put('captures',id,result);return {id,companyId,controlCount:controls.length,assetHash:hash(c),profileRegistered:true,coverage:result.coverage};
    });
  }
  async compile({companyId,pageUrl,taskContext}){
    const c=await this.company(companyId);assertScope(c,pageUrl);const a=resolveAccount(await this.profile(),c);
    const plan={id:randomUUID(),companyId,pageUrl,assetHash:hash(c),accountFingerprint:a.fingerprint,createdAt:now(),steps:c.loginMethod==='user_operated'?['check_current_session','user_login_handoff_if_required','verify_exact_account_at_session_page']:['check_current_session','inspect_and_dismiss_known_popups','select_actual_country_option','fill_phone_from_private_profile','require_privacy_acceptance','request_sms_once','handoff_verification_if_present','consume_ephemeral_user_otp','click_login_only','verify_account_and_absent_login_form'],applicationSubmission:'forbidden'};
    if(taskContext)plan.taskContext=taskContext;
    plan.planHash=hash(plan);await this.store.put('plans',plan.id,plan);return {planId:plan.id,planHash:plan.planHash,companyId,assetHash:plan.assetHash,stepCount:plan.steps.length,browserAccess:false};
  }
  async plan(args){const p=await this.store.get('plans',args.planId),h=p.planHash;delete p.planHash;if(hash(p)!==h||args.planHash!==h)throw Error('LOGIN_PLAN_HASH_MISMATCH');p.planHash=h;if(p.taskContext){if(!this.roleQueues)throw Error('ROLE_QUEUE_REQUIRED');await this.roleQueues.task(p.taskContext);}const c=await this.company(p.companyId),a=resolveAccount(await this.profile(),c);if(hash(c)!==p.assetHash)throw Error('LOGIN_ASSET_CHANGED');if(a.fingerprint!==p.accountFingerprint)throw Error('LOGIN_ACCOUNT_CHANGED');return {p,c,a};}
  async record(c,operation,result){const run={id:randomUUID(),companyId:c.companyId,operation,finishedAt:now(),...result,applicationSubmission:'not_performed'};await this.store.put('runs',run.id,run);return run;}
  async dismiss(c,o){
    if(!o.dialogs)return o;if(o.unknownPopup||o.dialogs!==1)throw Error('UNKNOWN_LOGIN_POPUP');
    const p=c.popups[0];await this.browser.act(c,o.url,{method:'click',selector:p.closeSelector,label:p.closeLabel});
    for(let i=0;i<8;i++){const next=await this.state(c,o.url);if(!next.dialogs)return next;await new Promise(r=>setTimeout(r,100));}throw Error('LOGIN_POPUP_DID_NOT_CLOSE');
  }
  async prepare(args){const {p,c}=await this.plan(args);return this.locked(c,async()=>{
    let o=await this.planState(c,p);beforeLoginStep({step:'prepare',state:o,authorization:args.authorization});
    if(o.accountMatched&&!o.form)return this.record(c,'prepare',{...this.publicState(o),reusedSession:true,smsSent:false});
    if(c.loginMethod==='user_operated')return this.record(c,'prepare',{status:'needs_user_login',method:'user_operated',pageUrl:o.url,automaticLogin:false,smsSent:false,handoff:{operator:'user',nextTool:'role_resume'}});
    if(!o.form)throw Error('LOGIN_FORM_NOT_PRESENT');
    o=await this.dismiss(c,o);const a=resolveAccount(await this.profile(),c),f=c.fields;
    if(o.country!==c.account.countryCode)await this.browser.act(c,o.url,{method:'dropdown',selector:f.country,options:[f.countryOptionLabel]},f.countryOptionLabel);
    await this.browser.act(c,o.url,{method:'fill',selector:f.phone},a.phone);
    o=await this.state(c,o.url);if(o.phone!==a.phone||o.country!==c.account.countryCode)throw Error('LOGIN_PREPARATION_READBACK_FAILED');
    // Read the current declaration through its real opening control, then close it.
    await this.browser.act(c,o.url,{method:'click',selector:c.consent.openSelector,label:c.consent.openLabel});
    for(let i=0;i<10;i++){o=await this.state(c,o.url);if(o.popupBody?.includes('生效日期'))break;await new Promise(r=>setTimeout(r,100));}
    if(o.popupTitle!==c.consent.title||!o.popupBody?.includes('生效日期'))throw Error('PRIVACY_DISCLOSURE_NOT_READ');
    const disclosure={id:randomUUID(),companyId:c.companyId,planId:p.id,assetHash:p.assetHash,title:c.consent.title,sourceUrl:o.url,text:o.popupBody,readAt:now()};disclosure.textHash=hash(disclosure.text);await this.store.put('disclosures',disclosure.id,disclosure);
    o=await this.dismiss(c,o);
    const policy=(await this.profile()).policy||{};
    const privacyScope=policy.privacyAcceptanceScope==='global'&&policy.globalAgreementAccepted===true?'global':'per_company';
    const known=policy.loginPrivacyAcceptances?.[c.companyId];
    let reused=null;
    if(privacyScope==='global'||(known?.origin===c.origin&&known.disclosureHash===disclosure.textHash&&known.scope==='recruiting_login'&&!known.revoked)){
      await this.browser.act(c,o.url,{method:'check',selector:f.consent},true);o=await this.state(c,o.url);if(!o.consent)throw Error('PRIVACY_CHECK_READBACK_FAILED');
      const evidenceHash=privacyScope==='global'?hash({mode:'global',origin:c.origin,disclosureHash:disclosure.textHash}):known.evidenceHash;
      reused={id:randomUUID(),companyId:c.companyId,planId:p.id,assetHash:p.assetHash,disclosureId:disclosure.id,disclosureHash:disclosure.textHash,evidenceHash,acceptedAt:privacyScope==='global'?now():known.acceptedAt,reusedAt:now(),scope:privacyScope};await this.store.put('acceptances',reused.id,reused);
      if(privacyScope==='global')await updateProfile(this.profileFile,profile=>{profile.policy??={};profile.policy.loginPrivacyAcceptances??={};profile.policy.loginPrivacyAcceptances[c.companyId]={origin:c.origin,disclosureHash:disclosure.textHash,evidenceHash,acceptedAt:reused.acceptedAt,scope:'global',defaultSelect:true};});
    }
    return this.record(c,'prepare',{status:reused?'ready_to_request_sms':'needs_privacy_acceptance',privacyScope,acceptanceId:reused?.id||null,privacyReused:!!reused,accountMatched:false,phoneReadback:'match',countryReadback:'match',popupHandling:'privacy_read_and_closed',disclosureId:disclosure.id,disclosureHash:disclosure.textHash,privacyTitle:disclosure.title,privacySourceUrl:disclosure.sourceUrl,smsSent:false});
  });}
  async accept(args){const {p,c}=await this.plan(args);return this.locked(c,async()=>{
    const d=await this.store.get('disclosures',args.disclosureId);
    if(d.planId!==p.id||d.companyId!==c.companyId||d.assetHash!==p.assetHash||d.textHash!==args.disclosureHash||hash(d.text)!==d.textHash)throw Error('PRIVACY_DISCLOSURE_CHANGED');
    const evidence=await readFile(args.evidenceFile,'utf8');if(!evidence.trim()||args.accepted!==true)throw Error('EXPLICIT_PRIVACY_ACCEPTANCE_REQUIRED');
    let o=await this.planState(c,p);beforeLoginStep({step:'accept',state:o,authorization:args.authorization});o=await this.dismiss(c,o);
    await this.browser.act(c,o.url,{method:'click',selector:c.consent.openSelector,label:c.consent.openLabel});
    for(let i=0;i<10;i++){o=await this.state(c,o.url);if(o.popupBody?.includes('生效日期'))break;await new Promise(r=>setTimeout(r,100));}
    if(o.popupTitle!==c.consent.title||hash(o.popupBody)!==d.textHash)throw Error('PRIVACY_DISCLOSURE_CHANGED');
    o=await this.dismiss(c,o);
    await this.browser.act(c,o.url,{method:'check',selector:c.fields.consent},true);o=await this.state(c,o.url);if(!o.consent)throw Error('PRIVACY_CHECK_READBACK_FAILED');
    const acceptance={id:randomUUID(),companyId:c.companyId,planId:p.id,assetHash:p.assetHash,disclosureId:d.id,disclosureHash:d.textHash,evidenceHash:hash(evidence),acceptedAt:now()};await this.store.put('acceptances',acceptance.id,acceptance);
    await updateProfile(this.profileFile,profile=>{profile.policy??={};profile.policy.loginPrivacyAcceptances??={};profile.policy.loginPrivacyAcceptances[c.companyId]={origin:c.origin,disclosureHash:d.textHash,evidenceHash:acceptance.evidenceHash,acceptedAt:acceptance.acceptedAt,scope:'recruiting_login',defaultSelect:true};});
    return this.record(c,'accept',{status:'privacy_accepted',acceptanceId:acceptance.id,disclosureHash:d.textHash,checkboxReadback:'match'});
  });}
  async acceptance(id,p){if(!id)return null;const a=await this.store.get('acceptances',id);if(a.planId!==p.id||a.assetHash!==p.assetHash)throw Error('PRIVACY_ACCEPTANCE_SCOPE_MISMATCH');return a;}
  async send(args){const {p,c,a}=await this.plan(args);return this.locked(c,async()=>{
    const o=await this.planState(c,p);beforeLoginStep({step:'prepare',state:o,authorization:args.authorization});
    if(o.accountMatched&&!o.form)return this.record(c,'request_sms',{...this.publicState(o),reusedSession:true,smsSent:false});
    const acceptance=await this.acceptance(args.acceptanceId,p);beforeLoginStep({step:'send',state:o,authorization:args.authorization,acceptance});
    if(!o.consent||o.phone!==a.phone||o.country!==c.account.countryCode||o.sendLabel!==c.fields.sendLabel)throw Error('SMS_PRECONDITION_CHANGED');
    let previous;try{previous=await this.store.get('challenges',c.companyId);}catch(e){if(e.code!=='ENOENT')throw e;}
    const attempts=previous?.planId===p.id?previous.attempts:0;
    if(previous&&Date.now()-Date.parse(previous.sentAt)<c.challenge.cooldownSeconds*1000)throw Error('SMS_COOLDOWN_ACTIVE');
    if(attempts>=c.challenge.maxSendAttempts)throw Error('SMS_ATTEMPT_LIMIT');
    // Persist the attempt BEFORE the click: an interrupted/uncertain send never auto-repeats.
    const challenge={id:randomUUID(),planId:p.id,acceptanceId:acceptance.id,companyId:c.companyId,sentAt:now(),attempts:attempts+1,otpAttempts:0,status:'send_attempted'};await this.store.put('challenges',c.companyId,challenge);
    await this.browser.act(c,o.url,{method:'click',selector:c.fields.send,label:c.fields.sendLabel});
    let next;const deadline=Date.now()+(c.challenge.observationWindowMs||10000);do{next=await this.state(c,o.url);if(next.challenges||next.errors||next.sendLabel!==c.fields.sendLabel)break;await new Promise(r=>setTimeout(r,200));}while(Date.now()<deadline);
    challenge.status=next.challenges?'needs_user_verification':next.errors?'sms_error':smsCountdown(next)?'waiting_user_otp':'send_unverified';
    if(challenge.status==='waiting_user_otp')challenge.smsConfirmedAt=now();
    await this.store.put('challenges',c.companyId,challenge);
    return this.record(c,'request_sms',{status:challenge.status,challengeId:challenge.id,otpStored:false,smsSent:challenge.status==='waiting_user_otp',sendAttempted:true,...(next.challenges?{handoff}:{})});
  });}
  async resumeVerification(args){const {p,c}=await this.plan(args);return this.locked(c,async()=>{
    const ch=await this.store.get('challenges',c.companyId);
    if(ch.id!==args.challengeId||ch.planId!==p.id)throw Error('VERIFICATION_CHALLENGE_CHANGED');
    const o=await this.planState(c,p);
    if(o.accountMismatch)throw Error('LOGIN_ACCOUNT_MISMATCH');
    if(o.accountMatched&&!o.form)return this.record(c,'resume_verification',{...this.publicState(o),readyForApplication:true});
    if(o.challenges)return this.record(c,'resume_verification',{status:'needs_user_verification',challengeId:ch.id,handoff,smsSent:false});
    if(o.unknownPopup)throw Error('UNKNOWN_LOGIN_POPUP');
    if(smsCountdown(o)){
      // Start OTP validity at the observed SMS countdown, never the earlier CAPTCHA request.
      const seconds=Number((o.sendLabel.match(/\d{1,3}/)||[])[0]);
      if(!ch.smsConfirmedAt)ch.smsConfirmedAt=new Date(Date.now()-Math.max(0,c.challenge.cooldownSeconds-seconds)*1000).toISOString();
      ch.status='waiting_user_otp';
    }else ch.status=o.errors?'sms_error':'verification_completed_sms_unverified';
    await this.store.put('challenges',c.companyId,ch);
    return this.record(c,'resume_verification',{status:ch.status,challengeId:ch.id,smsSent:ch.status==='waiting_user_otp',otpStored:false,automaticResend:false});
  });}
  async verify(args){const {p,c}=await this.plan(args);return this.locked(c,async()=>{
    let o=await this.planState(c,p);beforeLoginStep({step:'prepare',state:o,authorization:args.authorization});
    if(o.accountMatched&&!o.form)return this.record(c,'verify',{...this.publicState(o),reusedSession:true});
    const ch=await this.store.get('challenges',c.companyId),acceptance=await this.acceptance(ch.acceptanceId,p);
    if(ch.id!==args.challengeId||ch.planId!==p.id||!ch.smsConfirmedAt||Date.now()-Date.parse(ch.smsConfirmedAt)>c.challenge.expirySeconds*1000)throw Error('OTP_CHALLENGE_EXPIRED_OR_CHANGED');
    if(ch.otpAttempts>=c.challenge.maxOtpAttempts)throw Error('OTP_ATTEMPT_LIMIT');
    beforeLoginStep({step:'verify',state:o,authorization:args.authorization,acceptance});
    if(!/^\d{4,8}$/.test(args.code||''))throw Error('INVALID_EPHEMERAL_OTP_FORMAT');
    ch.otpAttempts++;ch.status='login_attempted';await this.store.put('challenges',c.companyId,ch);
    await this.browser.act(c,o.url,{method:'fill',selector:c.fields.otp},args.code);args.code=undefined;
    await this.browser.act(c,o.url,{method:'click',selector:c.fields.submit,label:c.fields.submitLabel});
    for(let i=0;i<30;i++){o=await this.planState(c,p);if(o.accountMatched&&!o.form||o.accountMismatch||o.challenges||o.errors)break;await new Promise(r=>setTimeout(r,200));}
    const result=this.publicState(o);if(result.status==='logged_out')result.status=o.errors?'otp_rejected':'login_unverified';ch.status=result.status;await this.store.put('challenges',c.companyId,ch);
    return this.record(c,'verify',{...result,readyForApplication:canHandoff(result),otpStored:false});
  });}
  async batch({tasks,concurrency=3,authorization}){
    if(!tasks?.length||tasks.length>20)throw Error('INVALID_LOGIN_BATCH');
    const results=new Array(tasks.length),groups=new Map();
    for(const [index,t]of tasks.entries()){
      let key=`idx:${index}`;
      try{const p=await this.store.get('plans',t.planId),c=await this.company(p.companyId);key=c.origin;}catch{}
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push({t,index});
    }
    const queues=[...groups.values()];let cursor=0;
    await Promise.all(Array.from({length:Math.min(concurrency,queues.length)},async()=>{
      while(cursor<queues.length){
        for(const {t,index}of queues[cursor++]){
          try{results[index]=await this.prepare({...t,authorization});}catch(e){results[index]={planId:t.planId,status:'needs_attention',errorCode:safeCode(e)};}
        }
      }
    }));
    return {results,applicationSubmission:'not_performed'};
  }
}

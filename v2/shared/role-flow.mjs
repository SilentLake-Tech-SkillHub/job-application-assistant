import {transitionLocationMatches} from './entry-transition.mjs';
import {matchesRole,readRoleIdentity,bindRoleTitleProof} from './role-identity.mjs';
import {resolveEntry,matchEntryPath} from './entry-recipe.mjs';
import {accountMatches,matchesAccount,resolveAccount,assertScope} from '../login/contracts.mjs';
export class RoleFlow{
 // onApplicationEntered：进入申请页并核对后回调，用于把申请页链接写回公司文件夹（见 form-assets.mjs）。
 constructor({queues,login,templates,browser,onApplicationEntered=null}){Object.assign(this,{queues,login,templates,browser,onApplicationEntered});}
 async context(args){
  const {q,t}=await this.queues.task(args),c=await this.login.company(t.companyId),entry=resolveEntry(c);let template;
  try{template=await this.templates(t.companyId,t.roleId);}catch(e){if(e.code!=='ENOENT')throw e;}
  let prior;try{prior=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  const stored=prior?.queueId===q.id&&prior?.expectedTitle===t.title&&prior?.originalRoleUrl===t.url?prior.applicationUrl:null;
  let target=stored||t.applyUrl||t.url;assertScope(c,t.url);assertScope(c,target);
  const plans=template?.pages.filter(p=>new URL(target).pathname.startsWith(p.pathPrefix))||[];
  if(plans.length>1)throw Error('ROLE_ENTRY_RECIPE_REQUIRED');
  let plan=plans[0];
  // 已存申请页链接但还没有覆盖该页的表单模板：仍从岗位页进入，进入后先建库。
  if(!plan&&t.applyUrl&&!stored)target=t.url;
  if(!plan&&target===t.url||!plan&&!t.applyUrl)plan={entryOnly:true,readySelector:entry?.detailReadySelector||c.account.selector,roleSelector:entry?.roleSelector||template?.pages[0]?.roleSelector};
  if(!plan)throw Error('ROLE_ENTRY_RECIPE_REQUIRED');
  if(!plan.entryOnly&&plan.roleTitle!==t.title)throw Error('CONFIRMED_ROLE_TITLE_TEMPLATE_MISMATCH');
  return {q,t,c,entry,template,plan,target};
 }
 async snapshot(x,pageId){const raw=await this.browser.request('roleSnapshot',{pageId,roleSelector:x.plan.roleSelector,roleIdentity:x.plan.roleIdentity,accountSelector:x.c.account.selector,loginRoot:x.c.fields?.root});
  await bindRoleTitleProof(this.browser,x.plan,pageId,raw);
  if(x.c.loginMethod==='user_operated'){const session=await this.login.state(x.c,raw.pageUrl);raw.account=session.account;raw.loginFormPresent=session.form;}return raw;}

 async open(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{
  let prior;try{prior=await this.queues.read(x.t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior?.status==='ready_for_user_review')throw Error('ROLE_ALREADY_PREPARED_FOR_REVIEW');
  if(prior){
   if(prior.queueId!==x.q.id||prior.taskId!==x.t.taskId||prior.originalRoleUrl!==x.t.url||prior.expectedTitle!==x.t.title||!prior.returnUrl||prior.applicationUrl&&prior.applicationUrl!==prior.returnUrl)throw Error('ROLE_TASK_STATE_CHANGED');
   // Reopening an already bound task is a read/rebind operation. Never send a
   // retained application editor back to its frozen detail URL or reset state.
   return this.resumeBoundPage(x,prior,{allowNavigation:false});
  }
  const readySelectors=[x.c.fields?.root,x.c.account.selector,x.plan.readySelector].filter(Boolean);
  const opened=await this.browser.request('openPage',{pageUrl:x.t.url,readySelectors});
  const state={queueId:x.q.id,taskId:x.t.taskId,pageId:opened.pageId,originalRoleUrl:x.t.url,returnUrl:x.target,expectedTitle:x.t.title,status:'opened',openedAt:new Date().toISOString()};await this.queues.put(x.t.taskId,state);
  return this.assess(x,state);
 },{waitMs:x.q.parallelRoles||x.q.executionMode==='parallel_roles'?30000:0});}
 async assess(x,state,{allowNavigation=true}={}){const s=await this.snapshot(x,state.pageId),account=resolveAccount(await this.login.profile(),x.c);
  if(s.account&&!matchesAccount(s.account,account))throw Error('LOGIN_ACCOUNT_MISMATCH');
  if(matchesAccount(s.account,account)&&!s.loginFormPresent){
   if(s.pageUrl!==state.returnUrl){if(!allowNavigation)throw Error('ROLE_BOUND_PAGE_LOCATION_CHANGED');await this.browser.request('openPage',{pageId:state.pageId,pageUrl:state.returnUrl,readySelectors:[x.plan.readySelector,x.c.fields?.root].filter(Boolean)});}
   if(x.plan.entryOnly){
    state.status='authenticated_at_role';state.accountMatched=true;await this.queues.put(x.t.taskId,state);
    return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,pageUrl:state.returnUrl,accountMatched:true,nextTools:['role_enter_application'],formAssetRequiredBeforeFill:true,submission:'not_performed'};
   }
   await this.browser.request('wait',{pageUrl:state.returnUrl,selector:x.plan.readySelector});
   const restored=await this.snapshot(x,state.pageId);
   if(restored.pageUrl!==state.returnUrl||!matchesRole(x.plan,restored)||restored.loginFormPresent||!matchesAccount(restored.account,account))throw Error('LOGIN_RETURN_ROLE_VERIFICATION_FAILED');
   state.status='ready_to_fill';state.restoredAt=restored.readAt;state.accountMatched=true;await this.queues.put(x.t.taskId,state);
   return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,roleTitle:restored.roleTitle,pageUrl:restored.pageUrl,accountMatched:true,originalRoleRestored:true,submission:'not_performed'};
  }
  if(!s.loginFormPresent)throw Error('ROLE_LOGIN_ENTRY_RECIPE_REQUIRED');
  if(new URL(s.pageUrl).origin!==x.c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');
  const plan=await this.login.compile({companyId:x.t.companyId,pageUrl:s.pageUrl,taskContext:{queueId:x.q.id,queueHash:x.q.queueHash,taskId:x.t.taskId,pageId:state.pageId,returnUrl:state.returnUrl,roleTitle:state.expectedTitle}});
  state.status='needs_login';state.loginPlan=plan;await this.queues.put(x.t.taskId,state);
  return {status:'needs_login',taskId:state.taskId,pageId:state.pageId,originalRoleUrl:state.originalRoleUrl,returnUrl:state.returnUrl,loginPlan:plan,submission:'not_performed'};
 }
 async resume(args){const x=await this.context(args);return this.login.locked(x.c,async()=>this.resumeBoundPage(x,await this.queues.read(x.t.taskId),{restoreLostPage:args.authorization?.restoreLostPage===true,recoveryEvidence:args.authorization?.evidence}),{waitMs:x.q.parallelRoles||x.q.executionMode==='parallel_roles'?30000:0});}
 async resumeBoundPage(x,state,{allowNavigation=true,restoreLostPage=false,recoveryEvidence}={}){if(state.queueId!==x.q.id||state.returnUrl!==x.target||state.expectedTitle!==x.t.title)throw Error('ROLE_TASK_STATE_CHANGED');
  // Rebind only a lost tab to the unique already-open original URL. No new tab,
  // navigation, expected-value injection or account/role bypass is permitted.
  const tabs=await this.browser.request('tabs',{pageUrl:state.returnUrl});
  const pageIdOf=p=>typeof p.id==='string'&&p.id?(p.browserChannel&&!p.id.startsWith(p.browserChannel+':')?p.browserChannel+':'+p.id:p.id):null;
  if(!tabs.some(p=>pageIdOf(p)===state.pageId)){
   let candidates=tabs.filter(p=>p.url===state.returnUrl);
   if(!candidates.length&&allowNavigation&&x.plan?.roleIdentity){
    const expected=new URL(state.returnUrl);
    candidates=tabs.filter(p=>{try{const u=new URL(p.url),identity=readRoleIdentity(x.plan.roleIdentity,p.url);return u.origin===expected.origin&&u.pathname===expected.pathname&&u.hash===expected.hash&&identity?.value===x.t.roleId;}catch{return false;}});
   }
   if(!candidates.length){
    if(!restoreLostPage)throw Error('ROLE_EXISTING_PAGE_NOT_FOUND');
    if(!recoveryEvidence?.trim())throw Error('ROLE_PAGE_RESTORE_AUTHORIZATION_REQUIRED');
    if(state.submissionAttempt)throw Error('SUBMISSION_ALREADY_ATTEMPTED');
    const opened=await this.browser.request('openPage',{pageUrl:state.returnUrl,readySelectors:[x.plan.readySelector,x.c.account.selector,x.c.fields?.root].filter(Boolean)});
    if(!opened.pageId||new URL(opened.pageUrl).origin!==x.c.origin)throw Error('ROLE_RESTORED_PAGE_SCOPE_CHANGED');
    state.pageId=opened.pageId;state.status='restored_page_requires_verification';state.accountMatched=false;
    for(const key of ['fillRunId','verifyRunId','verifiedAt','selectedFieldRunId','previewAttempt'])delete state[key];
    state.pageRecovery={reopenedAt:new Date().toISOString(),evidence:recoveryEvidence};await this.queues.put(x.t.taskId,state);
    return this.assess(x,state);
   }
   if(candidates.length!==1)throw Error('ROLE_EXISTING_PAGE_NOT_UNIQUE');
   const candidate=candidates[0];let pageId=pageIdOf(candidate);
   // Compatibility with an already-running older broker whose tabs omit IDs.
   // The unique full URL was just observed; claim that existing page and require
   // the broker's reused receipt before permitting account/role assessment.
   if(!pageId){const rebound=await this.browser.request('openPage',{pageUrl:candidate.url,readySelectors:[],reuseOnly:true});if(rebound.reused!==true||rebound.pageUrl!==candidate.url||!rebound.pageId)throw Error('ROLE_EXISTING_PAGE_REBIND_FAILED');pageId=rebound.pageId;}
   state.pageId=pageId;
   state.returnUrl=candidate.url;if(state.applicationUrl)state.applicationUrl=candidate.url;
  }
  return this.assess(x,state,{allowNavigation});}
 async enter(args){const {q,t}=await this.queues.task(args),c=await this.login.company(t.companyId),entry=resolveEntry(c);return this.login.locked(c,async()=>{
  let prior;try{prior=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior?.queueId&&prior.queueId!==q.id)throw Error('ROLE_TASK_STATE_CHANGED');
  let observedForm,observedPage;
  if(entry?.kind==='declarative_transition'){
   const tabs=await this.browser.request('tabs',{pageUrl:t.url}),sameOrigin=tabs.filter(p=>{try{return new URL(p.url).origin===c.origin;}catch{return false;}});
   const forms=sameOrigin.filter(p=>transitionLocationMatches(entry.form.location,p.url,t.roleId));
   if(forms.length>1)throw Error('AMBIGUOUS_ROLE_FORM');
   if(forms.length)observedPage=forms[0];
   else{
    const details=sameOrigin.filter(p=>transitionLocationMatches(entry.detail.location,p.url,t.roleId));
    if(details.length>1)throw Error('AMBIGUOUS_ROLE_DETAIL');
    if(!details.length)throw Error('EXISTING_PAGE_NOT_FOUND');
    observedPage=details[0];
   }
  }else if(!prior?.applicationUrl){
   if(entry?.kind==='resume_modal'){const tabs=await this.browser.request('tabs',{pageUrl:t.url}),matches=tabs.filter(p=>{const u=new URL(p.url);return u.origin===c.origin&&u.pathname===entry.formPath&&u.searchParams.get(entry.formIdParameter)===t.roleId;});if(matches.length>1)throw Error('AMBIGUOUS_ROLE_FORM');observedForm=matches[0]?.url;}
   if(entry?.kind==='detail_to_form'){const role=matchEntryPath(entry,new URL(t.url).pathname);if(role.detail){const tabs=await this.browser.request('tabs',{pageUrl:t.url});const matches=(tabs||[]).filter(p=>{const u=new URL(p.url);return u.origin===c.origin&&u.pathname===role.expectedApplyPath;});if(matches.length>1)throw Error('AMBIGUOUS_ROLE_FORM');observedForm=matches[0]?.url;}}
  }
  const observedId=observedPage?.id?observedPage.browserChannel&&!observedPage.id.startsWith(observedPage.browserChannel+':')?observedPage.browserChannel+':'+observedPage.id:observedPage.id:null;
  const opened=await this.browser.request('openPage',{pageUrl:observedPage?.url||prior?.applicationUrl||observedForm||t.url,...(observedPage?{reuseOnly:true,...(observedId?{pageId:observedId}:{})}:!observedForm&&prior?.pageId?{pageId:prior.pageId}:{}),readySelectors:[c.account.selector,c.fields?.root,entry?.detailReadySelector,entry?.formReadySelector].filter(Boolean)});
  if(observedPage&&(opened.reused!==true||opened.pageUrl!==observedPage.url||!opened.pageId||observedId&&opened.pageId!==observedId))throw Error('ROLE_EXISTING_PAGE_REBIND_FAILED');
  const snapshot=await this.browser.request('roleSnapshot',{pageId:opened.pageId,accountSelector:c.account.selector,loginRoot:c.fields?.root});if(c.loginMethod==='user_operated'){const session=await this.login.state(c,snapshot.pageUrl);snapshot.account=session.account;snapshot.loginFormPresent=session.form;}
  if(snapshot.loginFormPresent||!matchesAccount(snapshot.account,resolveAccount(await this.login.profile(),c)))throw Error('SHARED_LOGIN_SESSION_REQUIRED');
  const result=await this.browser.request('roleEnterApplication',{pageId:opened.pageId,expectedTitle:t.title,accountSelector:c.account.selector,expectedAccount:snapshot.account,roleSelector:entry?.roleSelector,entry,expectedRoleId:t.roleId,sessionAccountPageUrl:c.account.pageUrl});
  const roleChanged=entry?.kind==='resume_modal'?result.roleIdentity?.value!==t.roleId:entry?.kind==='declarative_transition'?
   (entry.form.roleIdentity&&(result.roleIdentity?.value!==t.roleId||result.roleIdentity?.parameter!==entry.form.roleIdentity.parameter)||entry.form.roleSelector&&result.roleTitle!==t.title):result.roleTitle!==t.title;
  if(new URL(result.pageUrl).origin!==c.origin||roleChanged||result.accountMatched!==true)throw Error('APPLICATION_ENTRY_RESULT_CHANGED');
  await this.queues.put(t.taskId,{...prior,queueId:q.id,taskId:t.taskId,pageId:result.pageId||opened.pageId,originalRoleUrl:t.url,applicationUrl:result.pageUrl,returnUrl:result.pageUrl,expectedTitle:t.title,status:'ready_to_fill',accountMatched:true,entryVerifiedAt:new Date().toISOString()});
  let applicationUrlRecord=null;if(this.onApplicationEntered){try{applicationUrlRecord=await this.onApplicationEntered({companyId:t.companyId,roleId:t.roleId,roleUrl:t.url,applicationUrl:result.pageUrl});}catch(e){applicationUrlRecord={status:'write_failed:'+(/^[A-Z_]+$/.test(e.message)?e.message:'UNKNOWN')};}}
  return {...result,status:'ready_to_fill',taskId:t.taskId,applicationUrl:result.pageUrl,...(applicationUrlRecord?{applicationUrlRecord:applicationUrlRecord.status}:{}),submission:'not_performed'};
 },{waitMs:q.parallelRoles||q.executionMode==='parallel_roles'?30000:0});}
 async screenshot(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{const state=await this.queues.read(x.t.taskId),s=await this.snapshot(x,state.pageId);if(new URL(s.pageUrl).origin!==x.c.origin)throw Error('ROLE_SCREENSHOT_SCOPE_CHANGED');return this.browser.request('screenshot',{pageId:state.pageId});},{waitMs:x.q.parallelRoles||x.q.executionMode==='parallel_roles'?30000:0});}
}

import {accountMatches,resolveAccount} from '../login/contracts.mjs';
export class RoleFlow{
 constructor({queues,login,templates,browser}){Object.assign(this,{queues,login,templates,browser});}
 async context(args){const {q,t}=await this.queues.task(args),c=await this.login.company(t.companyId),template=await this.templates(t.companyId);if(!template)throw Error('ROLE_COMPANY_TEMPLATE_REQUIRED');const target=t.applyUrl||t.url,u=new URL(target),plans=template.pages.filter(p=>u.pathname.startsWith(p.pathPrefix));if(plans.length!==1)throw Error('ROLE_ENTRY_RECIPE_REQUIRED');const plan=plans[0];if(plan.roleTitle!==t.title)throw Error('CONFIRMED_ROLE_TITLE_TEMPLATE_MISMATCH');return {q,t,c,template,plan,target};}
 async snapshot(x,pageId){return this.browser.request('roleSnapshot',{pageId,roleSelector:x.plan.roleSelector,accountSelector:x.c.account.selector,loginRoot:x.c.fields.root});}
 async open(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{
  let prior;try{prior=await this.queues.read(x.t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior?.status==='ready_for_user_review')throw Error('ROLE_ALREADY_PREPARED_FOR_REVIEW');
  const opened=await this.browser.request('openPage',{pageUrl:x.t.url,...(prior?.pageId?{pageId:prior.pageId}:{}),readySelectors:[x.c.fields.root,x.c.account.selector,x.plan.readySelector]});
  const state={queueId:x.q.id,taskId:x.t.taskId,pageId:opened.pageId,originalRoleUrl:x.t.url,returnUrl:x.target,expectedTitle:x.t.title,status:'opened',openedAt:new Date().toISOString()};await this.queues.put(x.t.taskId,state);
  return this.assess(x,state);
 });}
 async assess(x,state){const s=await this.snapshot(x,state.pageId),account=resolveAccount(await this.login.profile(),x.c);
  if(s.account&&!accountMatches(s.account,account.phone))throw Error('LOGIN_ACCOUNT_MISMATCH');
  if(accountMatches(s.account,account.phone)&&!s.loginFormPresent){
   if(s.pageUrl!==state.returnUrl){await this.browser.request('openPage',{pageId:state.pageId,pageUrl:state.returnUrl,readySelectors:[x.plan.readySelector,x.c.fields.root]});}
   const restored=await this.snapshot(x,state.pageId);
   if(restored.pageUrl!==state.returnUrl||restored.roleTitle!==state.expectedTitle||restored.loginFormPresent||!accountMatches(restored.account,account.phone))throw Error('LOGIN_RETURN_ROLE_VERIFICATION_FAILED');
   state.status='ready_to_fill';state.restoredAt=restored.readAt;state.accountMatched=true;await this.queues.put(x.t.taskId,state);
   return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,roleTitle:restored.roleTitle,pageUrl:restored.pageUrl,accountMatched:true,originalRoleRestored:true,submission:'not_performed'};
  }
  if(!s.loginFormPresent)throw Error('ROLE_LOGIN_ENTRY_RECIPE_REQUIRED');
  if(new URL(s.pageUrl).origin!==x.c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');
  const plan=await this.login.compile({companyId:x.t.companyId,pageUrl:s.pageUrl,taskContext:{queueId:x.q.id,queueHash:x.q.queueHash,taskId:x.t.taskId,pageId:state.pageId,returnUrl:state.returnUrl,roleTitle:state.expectedTitle}});
  state.status='needs_login';state.loginPlan=plan;await this.queues.put(x.t.taskId,state);
  return {status:'needs_login',taskId:state.taskId,pageId:state.pageId,originalRoleUrl:state.originalRoleUrl,returnUrl:state.returnUrl,loginPlan:plan,submission:'not_performed'};
 }
 async resume(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{const state=await this.queues.read(x.t.taskId);if(state.queueId!==x.q.id||state.returnUrl!==x.target||state.expectedTitle!==x.t.title)throw Error('ROLE_TASK_STATE_CHANGED');return this.assess(x,state);});}
 async screenshot(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{const state=await this.queues.read(x.t.taskId),s=await this.snapshot(x,state.pageId);if(new URL(s.pageUrl).origin!==x.c.origin)throw Error('ROLE_SCREENSHOT_SCOPE_CHANGED');return this.browser.request('screenshot',{pageId:state.pageId});});}
}

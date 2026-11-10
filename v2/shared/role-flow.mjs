import {sessionFromSnapshot} from './login-state.mjs';
import {samePage} from './page-scope.mjs';
import {transitionLocationMatches,transitionRoleIdFromLocation,canonicalLocationUrl} from './entry-transition.mjs';
import {matchesRole,readRoleIdentity,bindRoleTitleProof,rolePageContract} from './role-identity.mjs';
import {resolveEntry,matchEntryPath} from './entry-recipe.mjs';
import {assertScope} from '../login/contracts.mjs';
// 一个岗位任务 = 一张绑定的标签（任务记录里的 pageId）。所有步骤只操作这张标签；网址只用来判断它现在走到了哪一步，
// 不拿网址去整个浏览器里另找页面。
// 有入口配方的站点（岗位页 → 点“投递”进入申请页）只走一条线：
//   打开岗位链接 → 需要时登录/验证（同一张标签）→ 登录后落到别处就在同一张标签回岗位链接 → role_enter_application 点进入。
// 没有入口配方的站点（官网没有独立岗位页或入口未采集）才直接用投递链接。
const RECIPES=new Set(['declarative_transition','resume_modal','detail_to_form']);
const pageIdOf=p=>typeof p?.id==='string'&&p.id?(p.browserChannel&&!p.id.startsWith(p.browserChannel+':')?p.browserChannel+':'+p.id:p.id):null;
const originOf=u=>{try{return new URL(u).origin;}catch{return null;}};
const bindingError=(code,{nextTool,pageIds}={})=>{const e=Error(code);e.details={phase:'page_binding',nextTool:nextTool||null,pageIds:pageIds||[]};return e;};
export function invalidateRolePageProofs(state){for(const key of ['browserBinding','planId','planHash','fillRunId','verifyRunId','verifiedAt','selectedFieldRunId','previewAttempt'])delete state[key];}
// 这张标签当前处在本岗位的哪一步：form（申请页）/ detail（岗位页）/ role_link（岗位链接原址）；认不出返回 null。
export function rolePageKind(entry,url,{roleUrl,roleId}){
 let u;try{u=new URL(url);}catch{return null;}
 if(entry?.kind==='declarative_transition'){if(transitionLocationMatches(entry.form.location,url,roleId))return 'form';if(transitionLocationMatches(entry.detail.location,url,roleId))return 'detail';}
 else if(entry?.kind==='resume_modal'){if(u.pathname===entry.formPath&&u.searchParams.get(entry.formIdParameter)===roleId)return 'form';if(u.pathname===entry.detailPath&&u.searchParams.get(entry.detailIdParameter)===roleId)return 'detail';}
 else if(entry?.kind==='detail_to_form'){const m=matchEntryPath(entry,u.pathname);if(m.form)return 'form';if(m.detail&&url===roleUrl)return 'detail';}
 return url===roleUrl?'role_link':null;
}
// 申请页样式的地址（任何岗位）：关闭多余标签时这类页面可能有用户未保存的填写，需先给用户看。
export function formLikePage(entry,url,template){
 let u;try{u=new URL(url);}catch{return false;}
 if(entry?.kind==='declarative_transition')return transitionRoleIdFromLocation(entry.form.location,url)!==null||transitionLocationMatches(entry.form.location,url,null);
 if(entry?.kind==='resume_modal')return u.pathname===entry.formPath;
 if(entry?.kind==='detail_to_form')return matchEntryPath(entry,u.pathname).form;
 return !!template?.pages?.some(p=>u.pathname.startsWith(p.pathPrefix));
}
export class RoleFlow{
 // onObservation：链接观察只记到 投递回传.json（见 application-outcome.mjs recordObservation），
 // 由搜索端预览、用户确认后写主表；这里不改交接区的任何链接。触发：链接打不开（role_report_link_failure，附证据）、
 // 投递链接为空时第一次进入申请页、岗位链接跳转后岗位编号变了（岗位名核对一致）。只是跳转、编号不变不算变化。
 constructor({queues,login,templates,browser,onObservation=null,resolveTemplate=async t=>t}){Object.assign(this,{queues,login,templates,browser,onObservation,resolveTemplate});}
 roleId(t,state){return state?.siteRoleId||t.officialId;}
 // 浏览器主控进程不随 MCP 重载：旧进程不认识刷新、关闭标签，会报错或悄悄忽略。调用前先确认它支持。
 async assertPageTool(pageId,tool){let s;try{s=await this.browser.request('status');}catch{s=null;}const ch=String(pageId).split(':')[0],info=s?.channels?.[ch]||s;
  if(!info?.pageTools?.includes(tool))throw bindingError('BROWSER_HOST_RESTART_REQUIRED',{nextTool:null,pageIds:[pageId]});}
 // 记“岗位链接跳转后编号变了”的观察；上次写失败的，下次核对时补记。
 async recordLanding(x,state){if(!this.onObservation||!state.landedDetailUrl||state.linkObservation&&!String(state.linkObservation).startsWith('write_failed'))return;
  try{state.linkObservation=(await this.onObservation({kind:'role',code:x.t.roleId,field:'岗位链接',value:state.landedDetailUrl,evidence:'岗位链接跳转后岗位编号由 '+x.t.officialId+' 变为 '+state.siteRoleId+'；页面岗位名与确认岗位名一致'})).status;}catch(err){state.linkObservation='write_failed:'+(/^[A-Z_]+$/.test(err.message)?err.message:'UNKNOWN');}}
 entryOnlyPlan(c,entry,template){return {entryOnly:true,readySelector:entry?.detailReadySelector||c.account?.selector,roleSelector:entry?.roleSelector||template?.pages[0]?.roleSelector};}
 async base(args){
  let {q,t}=await this.queues.task(args);const c=await this.login.company(t.companyId,t),entry=resolveEntry(c),recipe=entry&&RECIPES.has(entry.kind)?entry:null;let template;
  try{template=await this.templates?.(t.companyId,t.roleId);}catch(e){if(e.code!=='ENOENT')throw e;}
  let prior;try{prior=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  // 已报“投递链接打不开”的任务改从岗位链接进入，到达申请页后再报新地址。
  if(t.applyUrl&&prior?.failedApplyUrl===t.applyUrl)t={...t,applyUrl:null};
  return {q,t,c,entry,recipe,template,prior};
 }
 async context(args){
  const {q,t,c,entry,recipe,template,prior}=await this.base(args);
  const stored=prior?.queueId===q.id&&prior?.expectedTitle===t.title&&prior?.originalRoleUrl===t.url?prior.applicationUrl:null;
  let target=stored||(recipe?t.url:t.applyUrl||t.url);assertScope(c,t.url);assertScope(c,target);
  let plan;
  if(recipe&&!stored)plan=this.entryOnlyPlan(c,entry,template);
  else{
   const resolved=template?await this.resolveTemplate(template,{...t,pageUrl:target},c):null;
   const plans=resolved?.pages.filter(p=>new URL(target).pathname.startsWith(p.pathPrefix))||[];
   if(plans.length>1)throw Error('ROLE_ENTRY_RECIPE_REQUIRED');
   plan=plans[0];
   // 已存申请页链接但还没有覆盖该页的表单模板：仍从岗位页进入，进入后先建库。
   if(!plan&&t.applyUrl&&!stored)target=t.url;
   if(!plan&&target===t.url||!plan&&!t.applyUrl)plan=this.entryOnlyPlan(c,entry,template);
   // 有入口配方、已进入过申请页但表单模板还没建好（建库中）：仍按入口配方判断标签位置，不因缺模板而无法恢复。
   if(!plan&&recipe)plan=this.entryOnlyPlan(c,entry,template);
  }
  if(!plan)throw Error('ROLE_ENTRY_RECIPE_REQUIRED');
  if(!plan.entryOnly)plan=rolePageContract(plan,{title:t.title,officialId:this.roleId(t,prior)});
  return {q,t,c,entry,recipe,template,plan,target,prior};
 }
 async snapshot(x,pageId){const raw=await this.browser.request('roleSnapshot',{pageId,roleSelector:x.plan.roleSelector,roleIdentity:x.plan.roleIdentity,accountSelector:x.c.account?.selector,loginRoot:x.c.fields?.root,sessionSelectors:x.c.session});
  Object.assign(raw,sessionFromSnapshot(raw));if(raw.authenticated)await bindRoleTitleProof(this.browser,x.plan,pageId,raw);return raw;}
 // 别的任务已绑定的标签（pageId → taskId）；本任务自己的不算。
 async boundElsewhere(taskId){const m=typeof this.queues.boundPages==='function'?await this.queues.boundPages():new Map();for(const [k,v] of [...m])if(v===taskId)m.delete(k);return m;}
 // 打开前先找本岗位已有的标签：重新导入延续下来的绑定、或唯一一张本岗位的页面（岗位链接原址 / 按入口规则认出的本岗位岗位页、申请页）。
 // 只接管没有被其他任务绑定的标签；同一岗位开着多张时不替用户挑，要求先关掉多余的。
 async findRolePage(x,prior){
  const others=await this.boundElsewhere(x.t.taskId),tabs=await this.browser.request('tabs',{pageUrl:x.t.url}).then(v=>Array.isArray(v)?v:[]);
  const mine=(tabs||[]).filter(p=>originOf(p.url)===x.c.origin).map(p=>({pageId:pageIdOf(p),url:p.url})).filter(p=>p.pageId&&!others.has(p.pageId));
  const id=this.roleId(x.t,prior),kind=url=>rolePageKind(x.recipe,url,{roleUrl:x.t.url,roleId:id});
  if(prior?.pageId){const hit=mine.find(p=>p.pageId===prior.pageId);if(hit)return {...hit,kind:kind(hit.url),reason:'carried_binding'};}
  const candidates=mine.map(p=>({...p,kind:kind(p.url)})).filter(p=>p.kind);
  if(candidates.length>1)throw bindingError('ROLE_PAGES_DUPLICATED',{nextTool:'role_close_extra_pages',pageIds:candidates.map(p=>p.pageId)});
  return candidates.length?{...candidates[0],reason:'existing_role_page'}:null;
 }
 async advance(args){
  if(!args.authorization?.login||!args.authorization.evidence?.trim())throw Error('LOGIN_AUTHORIZATION_REQUIRED');
  const {t}=await this.queues.task(args);let prior;try{prior=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior?.status==='ready_for_user_review')return {status:prior.status,taskId:t.taskId,pageId:prior.pageId,verifyRunId:prior.verifyRunId,submission:'not_performed'};
  const canResume=prior?.pageId&&prior.status!=='rebind_required';
  let result=canResume?await this.resume(args):await this.open(args);
  if(result.status==='needs_login'){
   if(prior?.loginWait)return {status:'needs_user_login',taskId:t.taskId,pageId:result.pageId,continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['role_advance']}};
   let prepared=await this.login.prepare({...result.loginPlan,authorization:args.authorization});
   if(prepared.status==='ready_to_request_sms')prepared=await this.login.send({...result.loginPlan,acceptanceId:prepared.acceptanceId,authorization:args.authorization});
   if(prepared.status!=='authenticated'){const state=await this.queues.read(t.taskId);await this.queues.put(t.taskId,{...state,loginWait:true});}
   if(prepared.status==='authenticated')result=await this.resume(args);
   else return {...prepared,taskId:t.taskId,pageId:result.pageId,continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['role_advance']}};
  }
  if(result.status==='authenticated_at_role')return this.enter(args);
  return result;
 }
 async open(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{
  const prior=x.prior;
  if(prior?.status==='ready_for_user_review')throw Error('ROLE_ALREADY_PREPARED_FOR_REVIEW');
  if(prior?.status&&prior.status!=='rebind_required'){
   if(prior.queueId!==x.q.id||prior.taskId!==x.t.taskId||prior.originalRoleUrl!==x.t.url||prior.expectedTitle!==x.t.title||!prior.returnUrl||prior.applicationUrl&&prior.applicationUrl!==prior.returnUrl)throw Error('ROLE_TASK_STATE_CHANGED');
   // Reopening an already bound task is a read/rebind operation. Never send a
   // retained application editor back to its frozen detail URL or reset state.
   return this.resumeBoundPage(x,prior,{allowNavigation:false});
  }
  if(prior?.status==='rebind_required'&&prior.queueId!==x.q.id)throw Error('ROLE_TASK_STATE_CHANGED');
  const readySelectors=[x.c.fields?.root,x.c.account?.selector,x.plan.readySelector].filter(Boolean);
  const found=await this.findRolePage(x,prior);
  // 延续下来的标签停在一张认不出的申请页上、且旧任务已经填过：不把它导航走（会丢掉填写），交给用户决定。
  if(found?.reason==='carried_binding'&&!found.kind&&prior?.carriedFrom?.hadFill&&formLikePage(x.entry,found.url,x.template))throw bindingError('ROLE_CARRIED_FORM_NOT_RECOGNIZED',{nextTool:null,pageIds:[found.pageId]});
  // 已有本岗位的标签：不新开。停在本岗位页面上就原地核对；停在别处（例如延续绑定的标签在首页）就在这张标签打开岗位链接。
  const opened=found?(found.kind?{pageId:found.pageId,pageUrl:found.url,reused:true}:await this.browser.request('openPage',{pageId:found.pageId,pageUrl:x.t.url,readySelectors})):await this.browser.request('openPage',{pageUrl:x.t.url,readySelectors,newPage:true});
  const state={queueId:x.q.id,taskId:x.t.taskId,pageId:opened.pageId,originalRoleUrl:x.t.url,returnUrl:x.target,expectedTitle:x.t.title,status:'opened',openedAt:new Date().toISOString(),...(prior?.failedApplyUrl?{failedApplyUrl:prior.failedApplyUrl}:{}),...(found?{reusedPage:found.reason}:{})};await this.queues.put(x.t.taskId,state);
  return this.assess(x,state);
 },{waitMs:x.q.parallelRoles||x.q.executionMode==='parallel_roles'?30000:0});}
 // 有入口配方时判断绑定标签停在本岗位的哪一步；岗位链接跳转后编号变了、且页面岗位名与确认岗位名一致时，按跳转后的编号继续并记观察。
 async locate(x,state,s){
  let kind=rolePageKind(x.recipe,s.pageUrl,{roleUrl:x.t.url,roleId:this.roleId(x.t,state)});
  if(kind)return kind;
  const e=x.recipe;if(e?.kind!=='declarative_transition'||state.siteRoleId||!e.detail.roleSelector)return null;
  const landed=transitionRoleIdFromLocation(e.detail.location,s.pageUrl);if(!landed||landed===x.t.officialId)return null;
  const raw=typeof s.roleTitle==='string'?s.roleTitle.trim():null,title=e.detail.rolePrefix?(raw?.startsWith(e.detail.rolePrefix)?raw.slice(e.detail.rolePrefix.length).trim():null):raw;
  if(title!==x.t.title)return null;
  state.siteRoleId=landed;state.landedDetailUrl=canonicalLocationUrl(e.detail.location,s.pageUrl);
  return 'detail';
 }
 async assess(x,state,{allowNavigation=true}={}){let s=await this.snapshot(x,state.pageId);
  if(s.authenticated===true&&!s.loginFormPresent){
   // 已进入过申请页的任务：上次没写成的岗位链接观察在这里补记。
   if(x.recipe&&!x.plan.entryOnly&&state.landedDetailUrl&&String(state.linkObservation||'').startsWith('write_failed')){await this.recordLanding(x,state);await this.queues.put(x.t.taskId,state);}
   if(x.plan.entryOnly&&x.recipe){
    let kind=await this.locate(x,state,s);
    // 登录后官网把标签送到了首页等别处：在同一张标签回到岗位链接，不另开。
    if(!kind){
     if(!allowNavigation)throw Error('ROLE_BOUND_PAGE_LOCATION_CHANGED');
     await this.browser.request('openPage',{pageId:state.pageId,pageUrl:x.t.url,readySelectors:[x.plan.readySelector,x.c.fields?.root].filter(Boolean)});
     s=await this.snapshot(x,state.pageId);
     kind=await this.locate(x,state,s);if(!kind)throw bindingError('ROLE_LINK_LANDING_NOT_RECOGNIZED',{nextTool:'role_report_link_failure',pageIds:[state.pageId]});
    }
    if(state.landedDetailUrl)await this.recordLanding(x,state);
    state.status='authenticated_at_role';state.authenticated=true;state.pageKind=kind;await this.queues.put(x.t.taskId,state);
    return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,pageUrl:s.pageUrl,pageKind:kind,authenticated:true,nextTools:['role_enter_application'],...(state.siteRoleId?{siteRoleId:state.siteRoleId,linkObservation:state.linkObservation||null}:{}),formAssetRequiredBeforeFill:true,submission:'not_performed'};
   }
   if(!samePage(s.pageUrl,state.returnUrl)&&x.recipe){
    // 有入口配方的站点：已进入过申请页、但标签现在不在申请页（例如登录过期后被送到别处）：不直接打开申请页地址，
    // 回到岗位链接重新点进入；原有的填写、核验证明作废，进入后重新核验。
    if(!allowNavigation)throw Error('ROLE_BOUND_PAGE_LOCATION_CHANGED');
    for(const key of ['fillRunId','verifyRunId','verifiedAt','selectedFieldRunId','previewAttempt','entryStarted','applicationUrl'])delete state[key];
    state.returnUrl=x.t.url;return this.assess({...x,target:x.t.url,plan:this.entryOnlyPlan(x.c,x.entry,x.template)},state,{allowNavigation});
   }
   if(!samePage(s.pageUrl,state.returnUrl)){if(!allowNavigation)throw Error('ROLE_BOUND_PAGE_LOCATION_CHANGED');await this.browser.request('openPage',{pageId:state.pageId,pageUrl:state.returnUrl,readySelectors:[x.plan.readySelector,x.c.fields?.root].filter(Boolean)});}
   if(x.plan.entryOnly){
    state.status='authenticated_at_role';state.authenticated=true;await this.queues.put(x.t.taskId,state);
    return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,pageUrl:state.returnUrl,authenticated:true,nextTools:['role_enter_application'],formAssetRequiredBeforeFill:true,submission:'not_performed'};
   }
   await this.browser.request('wait',{pageUrl:state.returnUrl,selector:x.plan.readySelector});
   const restored=await this.snapshot(x,state.pageId);
   if(!samePage(restored.pageUrl,state.returnUrl)||!matchesRole(x.plan,restored)||restored.loginFormPresent||restored.authenticated!==true)throw Error('LOGIN_RETURN_ROLE_VERIFICATION_FAILED');
   if(state.browserBinding&&(state.browserBinding.pageId!==state.pageId||state.browserBinding.pageUrl&&!samePage(state.browserBinding.pageUrl,state.returnUrl)))invalidateRolePageProofs(state);
   state.status='ready_to_fill';state.restoredAt=restored.readAt;state.authenticated=true;await this.queues.put(x.t.taskId,state);
   return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,roleTitle:restored.roleTitle,pageUrl:restored.pageUrl,authenticated:true,originalRoleRestored:true,submission:'not_performed'};
  }
  if(!s.loginFormPresent)return {status:'session_unknown',taskId:state.taskId,pageId:state.pageId,continuation:{state:'technical_block',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['role_advance'],reason:'LOGIN_STATE_NOT_OBSERVED'}};
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
  if(!tabs.some(p=>pageIdOf(p)===state.pageId)){
   // 别的任务已绑定的标签不能被接管。
   const others=await this.boundElsewhere(x.t.taskId),free=tabs.filter(p=>!others.has(pageIdOf(p)));
   let candidates=free.filter(p=>p.url===state.returnUrl);
   if(!candidates.length&&allowNavigation&&x.plan?.roleIdentity){
    const expected=new URL(state.returnUrl);
    candidates=free.filter(p=>{try{const u=new URL(p.url),identity=readRoleIdentity(x.plan.roleIdentity,p.url);return u.origin===expected.origin&&u.pathname===expected.pathname&&u.hash===expected.hash&&identity?.value===x.t.officialId;}catch{return false;}});
   }
   if(!candidates.length){
    if(!restoreLostPage)throw Error('ROLE_EXISTING_PAGE_NOT_FOUND');
    if(!recoveryEvidence?.trim())throw Error('ROLE_PAGE_RESTORE_AUTHORIZATION_REQUIRED');
    if(state.submissionAttempt)throw Error('SUBMISSION_ALREADY_ATTEMPTED');
    // 有入口配方的站点：恢复也走同一条线，从岗位链接重新进入；没有配方时才重开存储的申请页地址。
    const reopen=x.recipe?x.t.url:state.returnUrl;
    const opened=await this.browser.request('openPage',{pageUrl:reopen,readySelectors:[x.plan.readySelector,x.c.account?.selector,x.c.fields?.root].filter(Boolean)});
    if(!opened.pageId||new URL(opened.pageUrl).origin!==x.c.origin)throw Error('ROLE_RESTORED_PAGE_SCOPE_CHANGED');
    state.pageId=opened.pageId;state.status='restored_page_requires_verification';state.authenticated=false;
    invalidateRolePageProofs(state);
    for(const key of ['fillRunId','verifyRunId','verifiedAt','selectedFieldRunId','previewAttempt','entryStarted'])delete state[key];
    state.pageRecovery={reopenedAt:new Date().toISOString(),evidence:recoveryEvidence};
    if(x.recipe){delete state.applicationUrl;state.returnUrl=x.t.url;x={...x,target:x.t.url,plan:this.entryOnlyPlan(x.c,x.entry,x.template)};}
    await this.queues.put(x.t.taskId,state);
    return this.assess(x,state);
   }
   if(candidates.length!==1)throw bindingError('ROLE_EXISTING_PAGE_NOT_UNIQUE',{nextTool:'role_close_extra_pages',pageIds:candidates.map(pageIdOf).filter(Boolean)});
   const candidate=candidates[0];let pageId=pageIdOf(candidate);
   // Compatibility with an already-running older broker whose tabs omit IDs.
   // The unique full URL was just observed; claim that existing page and require
   // the broker's reused receipt before permitting account/role assessment.
   if(!pageId){const rebound=await this.browser.request('openPage',{pageUrl:candidate.url,readySelectors:[],reuseOnly:true});if(rebound.reused!==true||rebound.pageUrl!==candidate.url||!rebound.pageId)throw Error('ROLE_EXISTING_PAGE_REBIND_FAILED');pageId=rebound.pageId;}
   invalidateRolePageProofs(state);state.pageId=pageId;
   state.returnUrl=candidate.url;if(state.applicationUrl)state.applicationUrl=candidate.url;
  }
  return this.assess(x,state,{allowNavigation});}
 async enter(args){const x=await this.base(args);const {q,c,entry,recipe}=x;const t=x.t;return this.login.locked(c,async()=>{
  const prior=x.prior;
  if(prior?.queueId&&prior.queueId!==q.id)throw Error('ROLE_TASK_STATE_CHANGED');
  let opened,expectedRoleId=this.roleId(t,prior),excludePageIds=[];
  if(recipe){
   // 只在本任务绑定的标签上进入；不在浏览器里另找“现成的申请页”。
   if(!prior?.pageId)throw bindingError('ROLE_PAGE_NOT_BOUND',{nextTool:'role_open'});
   const tabs=await this.browser.request('tabs',{pageUrl:t.url}),bound=(tabs||[]).find(p=>pageIdOf(p)===prior.pageId);
   if(!bound)throw bindingError('ROLE_EXISTING_PAGE_NOT_FOUND',{nextTool:'role_resume',pageIds:[prior.pageId]});
   const kind=rolePageKind(recipe,bound.url,{roleUrl:t.url,roleId:expectedRoleId});
   if(kind!=='detail'&&kind!=='form')throw bindingError('ROLE_BOUND_PAGE_NOT_AT_ROLE',{nextTool:'role_open',pageIds:[prior.pageId]});
   // 点击后会开新标签的站点：第一次点击前登记已存在的同站标签，之后只认点击新开出来的申请页（中断后重试也一样）。
   if(kind==='detail'&&(recipe.kind==='resume_modal'||recipe.kind==='declarative_transition'&&recipe.target!=='same')){
    const entryStarted=prior.entryStarted||{at:new Date().toISOString(),preexisting:(tabs||[]).filter(p=>originOf(p.url)===c.origin).map(pageIdOf).filter(id=>id&&id!==prior.pageId)};
    excludePageIds=entryStarted.preexisting;if(!prior.entryStarted)await this.queues.put(t.taskId,{...prior,entryStarted});
   }
   opened={pageId:prior.pageId,pageUrl:bound.url};
  }else{
   opened=await this.browser.request('openPage',{pageUrl:prior?.applicationUrl||t.url,...(prior?.pageId?{pageId:prior.pageId}:{}),readySelectors:[c.account?.selector,c.fields?.root,entry?.detailReadySelector,entry?.formReadySelector].filter(Boolean)});
  }
  const snapshot=await this.browser.request('roleSnapshot',{pageId:opened.pageId,accountSelector:c.account?.selector,loginRoot:c.fields?.root});Object.assign(snapshot,sessionFromSnapshot(snapshot));
  if(snapshot.loginFormPresent||snapshot.authenticated!==true)throw Error('SHARED_LOGIN_SESSION_REQUIRED');
  const result=await this.browser.request('roleEnterApplication',{pageId:opened.pageId,originalRoleUrl:t.url,expectedTitle:t.title,accountSelector:c.account?.selector,roleSelector:entry?.roleSelector,entry,expectedRoleId,...(excludePageIds.length?{excludePageIds}:{})});
  const roleChanged=entry?.kind==='resume_modal'?result.roleIdentity?.value!==expectedRoleId:entry?.kind==='declarative_transition'?
   (entry.form.roleIdentity&&(result.roleIdentity?.value!==expectedRoleId||result.roleIdentity?.parameter!==entry.form.roleIdentity.parameter)||entry.form.roleSelector&&result.roleTitle!==t.title):result.roleTitle!==t.title;
  if(new URL(result.pageUrl).origin!==c.origin||roleChanged)throw Error('APPLICATION_ENTRY_RESULT_CHANGED');
  if(prior?.landedDetailUrl)await this.recordLanding(x,prior);
  const entered=await this.browser.request('roleSnapshot',{pageId:result.pageId||opened.pageId,accountSelector:c.account?.selector,loginRoot:c.fields?.root,sessionSelectors:c.session});if(!sessionFromSnapshot(entered).authenticated)throw Error('LOGIN_SESSION_REQUIRED');
  const next={...prior,queueId:q.id,taskId:t.taskId,pageId:result.pageId||opened.pageId,originalRoleUrl:t.url,applicationUrl:result.pageUrl,returnUrl:result.pageUrl,expectedTitle:t.title,status:'ready_to_fill',authenticated:true,entryVerifiedAt:new Date().toISOString()};delete next.entryStarted;invalidateRolePageProofs(next);
  await this.queues.put(t.taskId,next);
  // 投递链接为空（或已报打不开）时，第一次核对进入的申请页地址记为观察；已有投递链接时不记。
  let observation=null;if(!t.applyUrl&&this.onObservation){const u=new URL(result.pageUrl);
   if(u.href!==new URL(t.url).href){try{observation=await this.onObservation({kind:'role',code:t.roleId,field:'投递链接',value:u.href,evidence:'role_enter_application_verified'});}catch(e){observation={status:'write_failed:'+(/^[A-Z_]+$/.test(e.message)?e.message:'UNKNOWN')};}}}
  return {...result,status:'ready_to_fill',taskId:t.taskId,applicationUrl:result.pageUrl,...(observation?{observation:observation.status}:{}),submission:'not_performed'};
 },{waitMs:q.parallelRoles||q.executionMode==='parallel_roles'?30000:0});}
 // 页面卡住（一直转圈、没加载出来）：刷新这张绑定的标签，不另开。已经开始填写的页面刷新会丢掉未保存的填写，须用户同意。
 async reload(args){const x=await this.base(args);return this.login.locked(x.c,async()=>{
  const state=x.prior;if(!state?.pageId||state.queueId!==x.q.id)throw bindingError('ROLE_PAGE_NOT_BOUND',{nextTool:'role_open'});
  if(state.submissionAttempt||state.status==='ready_for_user_review')throw Error('ROLE_ALREADY_PREPARED_FOR_REVIEW');
  if((state.fillRunId||state.selectedFieldRunId)&&!args.authorization?.evidence?.trim())throw Error('RELOAD_DISCARDS_FILLED_FIELDS_AUTHORIZATION_REQUIRED');
  await this.assertPageTool(state.pageId,'reload');
  const identity=await this.browser.request('pageIdentity',{pageId:state.pageId});if(originOf(identity.pageUrl)!==x.c.origin)throw Error('ROLE_BOUND_PAGE_SCOPE_CHANGED');
  const r=await this.browser.request('openPage',{pageId:state.pageId,pageUrl:identity.pageUrl,reload:true,readySelectors:[]});
  if(state.fillRunId||state.selectedFieldRunId){for(const key of ['fillRunId','verifyRunId','verifiedAt','selectedFieldRunId','previewAttempt'])delete state[key];state.reloadAuthorization=args.authorization.evidence;await this.queues.put(x.t.taskId,state);}
  return {status:'reloaded',taskId:x.t.taskId,pageId:r.pageId,pageUrl:r.pageUrl,nextTools:[state.status==='ready_to_fill'?'role_open':state.status==='authenticated_at_role'?'role_enter_application':'role_open'],submission:'not_performed'};
 });}
 // 关闭本站点多余的标签：不属于任何任务、也不是登记的账号核对页。岗位页、首页、验证页、空白页直接关；
 // 申请页样式的标签可能有未保存的填写，先截图返回给用户，用户同意后带 closeFormPages 与用户原话再关。只关本站点的标签，不关浏览器。
 async inspectEntry(args){const x=await this.base(args);if(!x.prior?.pageId)throw bindingError('ROLE_PAGE_NOT_BOUND',{nextTool:'role_open'});
  let identity;
  try{identity=await this.browser.request('pageIdentity',{pageId:x.prior.pageId});}
  catch(error){if(error.message!=='ROLE_BROWSER_PAGE_LOST'||!args.stage)throw error;}
  if(identity&&originOf(identity.pageUrl)!==x.c.origin)throw Error('ROLE_BOUND_PAGE_SCOPE_CHANGED');
  const kind=url=>rolePageKind(x.entry,url,{roleUrl:x.t.url,roleId:this.roleId(x.t,x.prior)});
  let stage=identity?kind(identity.pageUrl):null,pageId=x.prior.pageId;
  // Diagnostics may read a unique already-open page of this same confirmed
  // role. Never navigate, open a page or replace the application task binding.
  if(args.stage&&args.stage!==stage){
   const others=await this.boundElsewhere(x.t.taskId),tabs=await this.browser.request('tabs',{pageUrl:x.t.url});
   const matches=tabs.filter(p=>pageIdOf(p)&&originOf(p.url)===x.c.origin&&!others.has(pageIdOf(p))&&kind(p.url)===args.stage);
   if(matches.length!==1)throw bindingError('ROLE_EXISTING_PAGE_NOT_UNIQUE',{nextTool:'role_close_extra_pages',pageIds:matches.map(pageIdOf).filter(Boolean)});
   stage=args.stage;pageId=pageIdOf(matches[0]);
  }
  if(!['detail','form'].includes(stage))throw Error('ROLE_BOUND_PAGE_NOT_AT_ROLE');
  // Flat catalog recipes predate the declarative form object. Normalize the
  // diagnostic payload at the caller so existing browser brokers can read it.
  const entry={...x.entry,form:x.entry?.form||{}};
  return this.browser.request('entryInspection',{pageId,entry,expectedTitle:x.t.title,stage});
 }
 async closeExtraPages(args){const x=await this.base(args);return this.login.locked(x.c,async()=>{
  const bound=typeof this.queues.boundPages==='function'?await this.queues.boundPages():new Map(),keep=new Set(bound.keys());

  const tabs=await this.browser.request('tabs',{pageUrl:x.t.url}).then(v=>Array.isArray(v)?v:[]);
  const extra=(tabs||[]).filter(p=>originOf(p.url)===x.c.origin).map(p=>({pageId:pageIdOf(p),url:p.url})).filter(p=>p.pageId&&!keep.has(p.pageId));
  const forms=extra.filter(p=>formLikePage(x.entry,p.url,x.template)||x.t.applyUrl&&p.url.split(/[?#]/)[0]===x.t.applyUrl.split(/[?#]/)[0]),plain=extra.filter(p=>!forms.includes(p));
  const allowed=new Set(args.authorization?.closeFormPages||[]);
  if(allowed.size&&!args.authorization.evidence?.trim())throw Error('FORM_PAGE_CLOSE_AUTHORIZATION_REQUIRED');
  for(const id of allowed)if(!forms.some(p=>p.pageId===id))throw Error('FORM_PAGE_NOT_EXTRA');
  const toClose=[...plain,...forms.filter(f=>allowed.has(f.pageId))];if(toClose.length)await this.assertPageTool(toClose[0].pageId,'closePage');
  const closed=[];for(const p of toClose){await this.browser.request('closePage',{pageId:p.pageId});closed.push({pageId:p.pageId,path:new URL(p.url).pathname});}
  const waiting=[];for(const p of forms.filter(f=>!allowed.has(f.pageId))){let shot=null,shotError=null;try{shot=await this.browser.request('screenshot',{pageId:p.pageId});}catch(e){shotError=/^[A-Z_]+$/.test(e.message)?e.message:'SCREENSHOT_FAILED';}waiting.push({pageId:p.pageId,path:new URL(p.url).pathname,screenshot:shot?.path||null,...(shotError?{screenshotError:shotError}:{})});}
  return {closed,formPagesAwaitingUser:waiting,keptPages:[...keep].filter(id=>(tabs||[]).some(p=>pageIdOf(p)===id)),...(waiting.length?{nextStep:'把这些申请页截图原样给用户看；用户同意关闭后，带 authorization.closeFormPages 与用户原话再调用一次'}:{}),browserClosed:false,submission:'not_performed'};
 });}
 // 岗位链接或投递链接打不开（报错、到首页/列表页、岗位名对不上）：记一条“失效”观察（值为空 + 证据）。
 // 投递链接打不开时，该任务改从岗位链接进入；岗位链接打不开时，该岗位等搜索端重新找到官网岗位页并经用户确认。
 async reportLinkFailure(args){const {q,t}=await this.queues.task(args),field=args.field,evidence=String(args.evidence||'').trim();
  if(!['岗位链接','投递链接'].includes(field))throw Error('INVALID_OBSERVATION');if(!evidence)throw Error('OBSERVATION_EVIDENCE_REQUIRED');
  const failed=field==='岗位链接'?t.url:t.applyUrl;if(!failed)throw Error('ROLE_LINK_NOT_SET');
  if(!this.onObservation)throw Error('OBSERVATION_RECORDER_REQUIRED');
  const c=await this.login.company(t.companyId,t);
  return this.login.locked(c,async()=>{
   let prior;try{prior=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(prior?.queueId&&prior.queueId!==q.id)throw Error('ROLE_TASK_STATE_CHANGED');
   if(prior?.submissionAttempt||prior?.status==='ready_for_user_review')throw Error('ROLE_ALREADY_PREPARED_FOR_REVIEW');
   const recorded=await this.onObservation({kind:'role',code:t.roleId,field,value:null,evidence});
   // 投递链接：清掉绑定在旧申请页上的任务状态，下次 role_open 从岗位链接进入（原标签继续用，不另开）。
   if(field==='投递链接')await this.queues.put(t.taskId,{queueId:q.id,taskId:t.taskId,failedApplyUrl:failed,...(prior?.pageId?{pageId:prior.pageId,status:'rebind_required'}:{})});
   return {status:recorded.status,taskId:t.taskId,roleId:t.roleId,field,nextStep:field==='投递链接'?'role_open':'等待搜索端 apply-observations 由用户确认新岗位链接',submission:'not_performed'};
  },{waitMs:q.parallelRoles||q.executionMode==='parallel_roles'?30000:0});}
 async screenshot(args){const x=await this.context(args);return this.login.locked(x.c,async()=>{const state=await this.queues.read(x.t.taskId),s=await this.snapshot(x,state.pageId);if(new URL(s.pageUrl).origin!==x.c.origin)throw Error('ROLE_SCREENSHOT_SCOPE_CHANGED');return this.browser.request('screenshot',{pageId:state.pageId});},{waitMs:x.q.parallelRoles||x.q.executionMode==='parallel_roles'?30000:0});}
}

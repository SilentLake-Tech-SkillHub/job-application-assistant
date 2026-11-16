import {sessionFromSnapshot} from './login-state.mjs';
import {samePage} from './page-scope.mjs';
import {transitionLocationMatches,transitionRoleIdFromLocation,canonicalLocationUrl} from './entry-transition.mjs';
import {matchesRole,readRoleIdentity,bindRoleTitleProof,rolePageContract} from './role-identity.mjs';
import {resolveEntry,matchEntryPath} from './entry-recipe.mjs';
import {assertScope} from '../login/contracts.mjs';
import {FALLBACK_ENTRY_RULE,isRoleForm} from './entry-config-supplement.mjs';
import {fallbackOperator} from './gui-fallback.mjs';
// 入口兜底交给 Agent 的要求：两种方式都登记时先用 Agent 自己的浏览器，点不了再用组件代点（C41，2026-11-16 用户选择“A 作为第三种方式”）。
const OWN_ENTRY_STEPS='只在这张已绑定的岗位页上，用鼠标点击本岗位的投递／申请入口，进入本岗位的申请表；先核对页面上的岗位名与 roleTitle 一致。不填写、不提交、不改其他内容，不自己另开标签（站点自己打开新标签就停在那里）；落到登录页就停下。完成后调用 role_entry_fallback（mode=report），回报 report.label：点的按钮上的完整文字；report.position：同样文字的按钮在页面上从上往下数是第几个（从 1 开始）。';
const COMPONENT_ENTRY_STEPS='组件代点：先用 role_screenshot 看这张岗位页，核对页面上的岗位名与 roleTitle 一致，不要自己操作页面；从 candidates 里选本岗位的投递／申请按钮，调用 role_entry_fallback（mode=component），report.label 填按钮文字，report.position 填同样文字的按钮从上往下第几个（从 1 开始），由组件用自己连着分身的浏览器通道点一次并核对落地页。页面上没有本岗位内容（只有横幅、列表或报错）时不选按钮，改用 role_report_link_failure（岗位链接）。';
const entryFallbackInstruction=surface=>!surface.surface?COMPONENT_ENTRY_STEPS:surface.componentClick?OWN_ENTRY_STEPS+' 你用自己的浏览器点不了这张页面时（例如插件没连上、宿主不给点击），改用'+COMPONENT_ENTRY_STEPS:OWN_ENTRY_STEPS;
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
 // entryConfigs：首版入口配置（C39，entry-config-supplement.mjs）；没有传入时不建首版、按原样报错。
 // fallbackSurface(pageId)：按组件外登记表判断本执行端与页面所在浏览器能否交 Agent 浏览器兜底（gui-fallback.mjs）。
 constructor({queues,login,templates,browser,onObservation=null,resolveTemplate=async t=>t,entryConfigs=null,fallbackSurface=null}){Object.assign(this,{queues,login,templates,browser,onObservation,resolveTemplate,entryConfigs,fallbackSurface});}
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
 async snapshot(x,pageId){const raw=await this.browser.request('roleSnapshot',{pageId,roleSelector:x.plan.roleSelector,roleIdentity:x.plan.roleIdentity,loginRoot:x.c.fields?.root});
  Object.assign(raw,sessionFromSnapshot(raw));if(!raw.loginFormPresent)await bindRoleTitleProof(this.browser,x.plan,pageId,raw);return raw;}
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
  const {t}=await this.queues.task(args);
  if(args.roleId&&args.roleId!==t.roleId)throw Error('ROLE_TASK_SELECTION_MISMATCH');
  let prior;try{prior=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior?.status==='ready_for_user_review')return {status:prior.status,taskId:t.taskId,pageId:prior.pageId,verifyRunId:prior.verifyRunId,submission:'not_performed'};
  const canResume=prior?.pageId&&prior.status!=='rebind_required';
  let result=canResume?await this.resume(args):await this.open(args);
  // 登录态由站点证明（C32）：在岗位页点一次真实入口，落到申请表即已登录；落到登录页则交本人登录，登录后回岗位再点一次。
  for(let attempt=0;attempt<2;attempt++){
   if(result.status==='needs_login'){
    if(prior?.loginWait)return {status:'needs_user_login',taskId:t.taskId,pageId:result.pageId,continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['role_advance']}};
    let prepared=await this.login.prepare({...result.loginPlan,authorization:args.authorization});
    if(prepared.status==='ready_to_request_sms')prepared=await this.login.send({...result.loginPlan,acceptanceId:prepared.acceptanceId,authorization:args.authorization});
    if(prepared.status!=='authenticated'){const state=await this.queues.read(t.taskId);await this.queues.put(t.taskId,{...state,loginWait:true});}
    if(prepared.status==='authenticated')result=await this.resume(args);
    else return {...prepared,taskId:t.taskId,pageId:result.pageId,continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['role_advance']}};
   }
   if(result.status!=='authenticated_at_role')return result;
   result=await this.enter(args);
   if(result.status!=='needs_login')return result;
  }
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
 // 绑定标签不是登录页：按岗位页推进到入口点击，是否已登录由点击后的落地页证明（C32）；是登录页：交登录流程。
 async assess(x,state,{allowNavigation=true}={}){let s=await this.snapshot(x,state.pageId);
  if(!s.loginFormPresent){
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
    state.status='authenticated_at_role';delete state.authenticated;state.pageKind=kind;await this.queues.put(x.t.taskId,state);
    return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,pageUrl:s.pageUrl,pageKind:kind,loginProof:'entry_click',nextTools:['role_enter_application'],...(state.siteRoleId?{siteRoleId:state.siteRoleId,linkObservation:state.linkObservation||null}:{}),formAssetRequiredBeforeFill:true,submission:'not_performed'};
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
    state.status='authenticated_at_role';delete state.authenticated;await this.queues.put(x.t.taskId,state);
    return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,pageUrl:state.returnUrl,loginProof:'entry_click',nextTools:['role_enter_application'],formAssetRequiredBeforeFill:true,submission:'not_performed'};
   }
   await this.browser.request('wait',{pageUrl:state.returnUrl,selector:x.plan.readySelector});
   const restored=await this.snapshot(x,state.pageId);
   if(!samePage(restored.pageUrl,state.returnUrl)||!matchesRole(x.plan,restored)||restored.loginFormPresent)throw Error('LOGIN_RETURN_ROLE_VERIFICATION_FAILED');
   if(state.browserBinding&&(state.browserBinding.pageId!==state.pageId||state.browserBinding.pageUrl&&!samePage(state.browserBinding.pageUrl,state.returnUrl)))invalidateRolePageProofs(state);
   state.status='ready_to_fill';state.restoredAt=restored.readAt;state.authenticated=true;await this.queues.put(x.t.taskId,state);
   return {status:state.status,taskId:state.taskId,pageId:state.pageId,companyId:x.t.companyId,roleId:x.t.roleId,roleTitle:restored.roleTitle,pageUrl:restored.pageUrl,authenticated:true,originalRoleRestored:true,submission:'not_performed'};
  }
  return this.loginLanding(x,state,s);
 }
 // 落到登录页：编译绑定本任务原岗位、原标签的登录计划，交登录流程；登录后回到岗位链接再点入口。
 async loginLanding(x,state,s){
  if(new URL(s.pageUrl).origin!==x.c.origin)throw Error('LOGIN_PAGE_SCOPE_MISMATCH');
  const plan=await this.login.compile({companyId:x.t.companyId,pageUrl:s.pageUrl,taskContext:{queueId:x.q.id,queueHash:x.q.queueHash,taskId:x.t.taskId,pageId:state.pageId,returnUrl:state.returnUrl,roleTitle:state.expectedTitle}});
  state.status='needs_login';state.loginPlan=plan;delete state.authenticated;await this.queues.put(x.t.taskId,state);
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
 async enter(args){let x=await this.base(args);const q=x.q;return this.login.locked(x.c,async()=>{
  // 站点还没有入口配置（C39）：先在绑定的岗位页读标题、点一次唯一的投递按钮，按落地的申请页写入首版入口配置并读回，
  // 再按新配置进入（新配置认得出已经打开的申请页，不再点第二次）。落到登录页照常交本人登录。
  if(!x.entry&&this.entryConfigs&&!x.prior?.applicationUrl){const handed=await this.firstEntry(x);if(handed)return handed;x=await this.base(args);}
  return this.enterBound(x);
 },{waitMs:q.parallelRoles||q.executionMode==='parallel_roles'?30000:0});}
 // 点入口后落到登录页（含点击被登录框挡住）：交登录流程，登录后回岗位再点一次（C32）。
 entryLogin(x,s,pageId){const {q,t,prior}=x;const state={...(prior||{}),queueId:q.id,taskId:t.taskId,pageId,originalRoleUrl:prior?.originalRoleUrl||t.url,returnUrl:prior?.returnUrl||t.url,expectedTitle:t.title};delete state.entryStarted;
  return this.loginLanding(x,state,s);}
 async entryLanding(c,pageId){const s=await this.browser.request('roleSnapshot',{pageId,loginRoot:c.fields?.root});return {...s,...sessionFromSnapshot(s)};}
 // 首版入口配置：在本任务绑定的岗位页点一次，看落到哪里。登录页 → 返回登录交接；申请表 → 写入首版配置后返回 null 由调用方接着进入；
 // 两者都不是 → 按原错误处理。
 async firstEntry(x){
  const {q,t,c,prior}=x;
  if(prior?.queueId&&prior.queueId!==q.id)throw Error('ROLE_TASK_STATE_CHANGED');
  if(!prior?.pageId)throw bindingError('ROLE_PAGE_NOT_BOUND',{nextTool:'role_open'});
  await this.assertPageTool(prior.pageId,'firstEntry');
  let tabs=await this.browser.request('tabs',{pageUrl:t.url});const bound=(tabs||[]).find(p=>pageIdOf(p)===prior.pageId);
  if(!bound)throw bindingError('ROLE_EXISTING_PAGE_NOT_FOUND',{nextTool:'role_resume',pageIds:[prior.pageId]});
  // 只从确认的岗位链接进入：绑定标签停在别处，就在这张标签回到岗位链接（还没有入口配置的站点此前不会有填写）。
  if(bound.url!==t.url){await this.browser.request('openPage',{pageId:prior.pageId,pageUrl:t.url,readySelectors:[]});tabs=await this.browser.request('tabs',{pageUrl:t.url});}
  // 先认登录再点（C42）：岗位页上已经有登录入口或登录框，就交登录流程，不点入口。
  const pre=await this.entryLanding(c,prior.pageId);if(pre.loginFormPresent)return this.entryLogin(x,pre,prior.pageId);
  // 点击前登记已有的同站标签：写入首版配置后按新配置进入时，只认这次点击新开出来的申请页。
  const preexisting=(tabs||[]).filter(p=>originOf(p.url)===c.origin).map(pageIdOf).filter(id=>id&&id!==prior.pageId);
  await this.queues.put(t.taskId,{...prior,entryStarted:{at:new Date().toISOString(),preexisting,firstEntry:true}});
  const expectedRoleId=this.roleId(t,prior);let observed;
  try{observed=await this.browser.request('roleFirstEntry',{pageId:prior.pageId,expectedTitle:t.title,expectedRoleId});}
  catch(error){let s;try{s=await this.entryLanding(c,prior.pageId);}catch{throw error;}if(s.loginFormPresent)return this.entryLogin(x,s,prior.pageId);throw error;}
  const s=await this.entryLanding(c,observed.pageId);if(s.loginFormPresent)return this.entryLogin(x,s,observed.pageId);
  if(!isRoleForm(observed,expectedRoleId)){const e=Error('APPLICATION_ENTRY_FIRST_LANDING_NOT_FORM');e.details={phase:'first_entry',check:'landing',target:observed.target,inputs:observed.inputs,frames:observed.frames};throw e;}
  await this.entryConfigs.create({companyId:t.companyId,siteId:t.siteId,roleId:expectedRoleId,observed});
  return null;
 }
 // Agent 浏览器兜底：首版入口同一失败第二次（C39 追加，2026-11-16 用户“按B。推进”）。
 // start：在本任务绑定的岗位页（不在就回岗位链接）只读盘点岗位标题和候选入口按钮，登记点击前已有的同站标签，交 Agent 用鼠标点进本岗位申请表。
 // report：Agent 回报点的按钮文字和同文字按钮从上往下第几个；组件读落地页，是本岗位申请表就按 Agent 的操作写入首版入口配置并读回，由 role_advance 接续。
 // 登记表外的执行端或浏览器、Agent 点了没反应、落地不是申请表、记录对不上：问用户。落到登录页：交用户登录。
 async entryFallback(args){const x=await this.base(args);return this.login.locked(x.c,async()=>{
  const {q,t,c,prior}=x;
  if(prior?.queueId&&prior.queueId!==q.id)throw Error('ROLE_TASK_STATE_CHANGED');
  if(!prior?.pageId)throw bindingError('ROLE_PAGE_NOT_BOUND',{nextTool:'role_open'});
  if(x.entry)return {status:'entry_config_exists',taskId:t.taskId,continuation:{state:'login',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['role_advance']},submission:'not_performed'};
  const ask=(reason,extra={})=>({status:'needs_user',reason,taskId:t.taskId,companyId:t.companyId,roleId:t.roleId,pageId:prior.pageId,...extra,continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:[],reason},submission:'not_performed'});
  const surface=this.fallbackSurface?await this.fallbackSurface(prior.pageId):{allowed:false,reason:'AGENT_FALLBACK_REGISTRY_MISSING'};
  if(!surface.allowed)return ask(surface.reason,{fallback:surface});
  await this.assertPageTool(prior.pageId,'entryFallback');
  const now=new Date().toISOString(),expectedRoleId=this.roleId(t,prior);
  if(args.mode==='start'){
   let tabs=await this.browser.request('tabs',{pageUrl:t.url});const bound=(tabs||[]).find(p=>pageIdOf(p)===prior.pageId);
   if(!bound)throw bindingError('ROLE_EXISTING_PAGE_NOT_FOUND',{nextTool:'role_resume',pageIds:[prior.pageId]});
   // 上次点击可能把标签带到了别处：在这张标签回到岗位链接（还没有入口配置的站点此前不会有填写）。
   if(bound.url!==t.url){await this.browser.request('openPage',{pageId:prior.pageId,pageUrl:t.url,readySelectors:[]});tabs=await this.browser.request('tabs',{pageUrl:t.url});}
   // 先认登录（C42）：没登录时换谁来点都进不去，交登录流程，不开始兜底。
   const pre=await this.entryLanding(c,prior.pageId);if(pre.loginFormPresent)return this.entryLogin(x,pre,prior.pageId);
   const inventory=await this.browser.request('roleEntryInventory',{pageId:prior.pageId,expectedTitle:t.title});
   const preexisting=(tabs||[]).filter(p=>originOf(p.url)===c.origin).map(pageIdOf).filter(id=>id&&id!==prior.pageId);
   const session={at:now,pageId:prior.pageId,detailUrl:inventory.pageUrl,detailTitle:inventory.detailTitle,candidates:inventory.candidates,preexisting,surface:{agent:surface.agent,hostId:surface.hostId,surface:surface.surface,componentClick:!!surface.componentClick}};
   await this.queues.put(t.taskId,{...prior,entryStarted:{at:now,preexisting,agentFallback:true},entryFallback:session});
   return {status:'agent_fallback_ready',taskId:t.taskId,companyId:t.companyId,roleId:t.roleId,fallback:{agent:surface.agent,surface:surface.surface,surfaceLabel:surface.surfaceLabel,componentClick:surface.componentClick,...(surface.componentLabel?{componentLabel:surface.componentLabel}:{})},page:{pageId:prior.pageId},roleTitle:t.title,
    titleFound:!!(inventory.detailTitle?.heading||inventory.detailTitle?.path),candidates:inventory.candidates.map(({role,label,count})=>({...(role?{role}:{}),label,count})),
    instruction:entryFallbackInstruction(surface),
    continuation:{state:'agent_fallback',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['role_entry_fallback']},submission:'not_performed'};
  }
  const session=prior.entryFallback;
  if(!session||session.pageId!==prior.pageId)throw Error('ENTRY_FALLBACK_SESSION_REQUIRED');
  // report：Agent 已用自己的浏览器点过；component：组件代点（C41），按 Agent 选的按钮由组件点一次。对应方式没有登记就拒绝。
  const operator=fallbackOperator(surface,args.mode);
  if(session.surface.hostId!==surface.hostId||(args.mode==='component'?!session.surface.componentClick:session.surface.surface!==surface.surface))throw Error('GUI_FALLBACK_SURFACE_CHANGED');
  const label=String(args.report?.label||'').trim(),position=args.report?.position;
  if(!label||label.length>30||!Number.isInteger(position)||position<1||position>20)throw Error('ENTRY_FALLBACK_REPORT_INVALID');
  // 点的是哪个按钮：同文字按钮的个数和上下顺序取兜底前的盘点；回报的文字不在盘点里、岗位页还开着时，在岗位页按这段文字再盘点一次。
  const pick=async canRecount=>{let cand=session.candidates.find(k=>k.label===label);
   if(!cand&&canRecount)cand=(await this.browser.request('roleEntryInventory',{pageId:prior.pageId,expectedTitle:t.title,labels:[label]})).candidates.find(k=>k.label===label);
   return cand&&position<=cand.domOrder.length?{cand,index:cand.domOrder[position-1]}:null;};
  let landingId,target,chosen;
  if(args.mode==='component'){
   await this.assertPageTool(prior.pageId,'componentClick');
   const bound=(await this.browser.request('tabs',{pageUrl:t.url})||[]).find(p=>pageIdOf(p)===prior.pageId);
   if(!bound||bound.url!==session.detailUrl)return ask('ENTRY_FALLBACK_PAGE_MOVED');
   const pre=await this.entryLanding(c,prior.pageId);if(pre.loginFormPresent)return this.entryLogin(x,pre,prior.pageId);
   chosen=await pick(true);if(!chosen)return ask('ENTRY_FALLBACK_BUTTON_NOT_VERIFIED');
   let clicked;
   try{clicked=await this.browser.request('roleEntryClick',{pageId:prior.pageId,expectedTitle:t.title,label,role:chosen.cand.role||null,count:chosen.cand.count,index:chosen.index});}
   catch(error){let s;try{s=await this.entryLanding(c,prior.pageId);}catch{throw error;}if(s.loginFormPresent)return this.entryLogin(x,s,prior.pageId);if(/^ENTRY_FALLBACK_/.test(error.message))return ask(error.message,error.details?{details:error.details}:{});throw error;}
   landingId=clicked.pageId;target=clicked.target;
  }else{
   // 落地页：Agent 点击后新开出来的同站标签，或者本标签换了地址。
   const tabs=await this.browser.request('tabs',{pageUrl:t.url}),before=new Set(session.preexisting),bound=(tabs||[]).find(p=>pageIdOf(p)===prior.pageId);
   const fresh=(tabs||[]).filter(p=>originOf(p.url)===c.origin&&pageIdOf(p)&&pageIdOf(p)!==prior.pageId&&!before.has(pageIdOf(p)));
   if(fresh.length>1)return ask('ENTRY_FALLBACK_LANDING_NOT_UNIQUE');
   if(fresh.length===1){landingId=pageIdOf(fresh[0]);target='new';}
   else if(bound&&bound.url!==session.detailUrl){landingId=prior.pageId;target='same';}
   else return ask('ENTRY_FALLBACK_NO_NAVIGATION');
  }
  const s=await this.entryLanding(c,landingId);if(s.loginFormPresent)return this.entryLogin(x,s,landingId);
  const landed=await this.browser.request('roleEntryLanding',{pageId:landingId,expectedTitle:t.title});
  if(!isRoleForm(landed,expectedRoleId))return ask('ENTRY_FALLBACK_LANDING_NOT_FORM',{landing:{target,inputs:landed.inputs,frames:landed.frames,formFieldsVisible:landed.formFieldsVisible}});
  chosen=chosen||await pick(target==='new');if(!chosen)return ask('ENTRY_FALLBACK_BUTTON_NOT_VERIFIED');
  const {cand,index}=chosen;
  const entryLocator={...(cand.role?{role:cand.role,name:label}:{text:label}),label,...(cand.count>1?{count:cand.count,index}:{})};
  const observed={pageId:landingId,target,detailUrl:session.detailUrl,detailTitle:session.detailTitle,entryLocator,...landed};
  try{await this.entryConfigs.create({companyId:t.companyId,siteId:t.siteId,roleId:expectedRoleId,observed,rule:FALLBACK_ENTRY_RULE,method:args.mode==='component'?'agent_choice_component_click':'agent_gui_fallback_observed_click',recordedBy:{agent:session.surface.agent,hostId:session.surface.hostId,surface:operator,at:now}});}
  catch(error){if(/^APPLICATION_ENTRY_FIRST_/.test(error.message))return ask(error.message);throw error;}
  const state=await this.queues.read(t.taskId);delete state.entryFallback;await this.queues.put(t.taskId,state);
  return {status:'entry_config_ready',taskId:t.taskId,companyId:t.companyId,roleId:t.roleId,target,operator,continuation:{state:'login',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['role_advance']},submission:'not_performed'};
 },{waitMs:x.q.parallelRoles||x.q.executionMode==='parallel_roles'?30000:0});}
 async enterBound(x){const {q,c,entry,recipe}=x;const t=x.t;{
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
  // 不先猜登录态：点一次真实入口，落到申请表即已登录；落到登录页（含点击前就停在登录页、点击被登录框挡住）即未登录（C32）。
  const landing=pageId=>this.entryLanding(c,pageId),toLogin=(s,pageId)=>this.entryLogin(x,s,pageId);
  let result;
  try{result=await this.browser.request('roleEnterApplication',{pageId:opened.pageId,originalRoleUrl:t.url,expectedTitle:t.title,roleSelector:entry?.roleSelector,entry,expectedRoleId,...(excludePageIds.length?{excludePageIds}:{})});}
  catch(error){let s;try{s=await landing(opened.pageId);}catch{throw error;}if(s.loginFormPresent)return toLogin(s,opened.pageId);throw error;}
  const roleChanged=entry?.kind==='resume_modal'?result.roleIdentity?.value!==expectedRoleId:entry?.kind==='declarative_transition'?
   (entry.form.roleIdentity&&(result.roleIdentity?.value!==expectedRoleId||result.roleIdentity?.parameter!==entry.form.roleIdentity.parameter)||entry.form.roleSelector&&result.roleTitle!==t.title):result.roleTitle!==t.title;
  if(new URL(result.pageUrl).origin!==c.origin||roleChanged)throw Error('APPLICATION_ENTRY_RESULT_CHANGED');
  if(prior?.landedDetailUrl)await this.recordLanding(x,prior);
  const entered=await landing(result.pageId||opened.pageId);if(entered.loginFormPresent)return toLogin(entered,result.pageId||opened.pageId);
  const next={...prior,queueId:q.id,taskId:t.taskId,pageId:result.pageId||opened.pageId,originalRoleUrl:t.url,applicationUrl:result.pageUrl,returnUrl:result.pageUrl,expectedTitle:t.title,status:'ready_to_fill',authenticated:true,entryVerifiedAt:new Date().toISOString()};delete next.entryStarted;invalidateRolePageProofs(next);
  await this.queues.put(t.taskId,next);
  // 投递链接为空（或已报打不开）时，第一次核对进入的申请页地址记为观察；已有投递链接时不记。
  let observation=null;if(!t.applyUrl&&this.onObservation){const u=new URL(result.pageUrl);
   if(u.href!==new URL(t.url).href){try{observation=await this.onObservation({kind:'role',code:t.roleId,field:'投递链接',value:u.href,evidence:'role_enter_application_verified'});}catch(e){observation={status:'write_failed:'+(/^[A-Z_]+$/.test(e.message)?e.message:'UNKNOWN')};}}}
  return {...result,status:'ready_to_fill',taskId:t.taskId,applicationUrl:result.pageUrl,...(observation?{observation:observation.status}:{}),submission:'not_performed'};
 }}
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
  // 站点还没有入口配置时，确认的岗位链接打开的那张页面就是岗位页：只读检查按岗位页处理，不再因“认不出”而卡住。
  const kind=url=>{const k=rolePageKind(x.entry,url,{roleUrl:x.t.url,roleId:this.roleId(x.t,x.prior)});return k==='role_link'&&!x.entry?'detail':k;};
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
  const inspection=await this.browser.request('entryInspection',{pageId,entry,expectedTitle:x.t.title,stage});
  if(inspection.candidates?.length===0){
   const current=await this.browser.request('pageIdentity',{pageId});
   if(originOf(current.pageUrl)!==x.c.origin)throw Error('ROLE_BOUND_PAGE_SCOPE_CHANGED');
   const page=await this.browser.existingPage(current.pageUrl,{pageId,readOnly:true});
   inspection.pageHealth=await page.observe({entryHealth:true});
  }
  return inspection;
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

// 一个岗位任务 = 一张绑定的标签：打开、登录、进入申请、恢复、关闭多余标签、刷新，全部只操作这张标签。
// 场景按 Keep 实际情况建模：保存的岗位链接 /zpdetail/<数字> 打开后跳到 /job/detail?jobAdId=<另一编号>，
// 在同一张标签点“立即投递”进入 /form?fromPage=job&jobAdId=<编号>。
import test from 'node:test';import assert from 'node:assert/strict';
import {RoleFlow,rolePageKind} from '../shared/role-flow.mjs';
import {executeTransition,validateTransition} from '../shared/entry-transition.mjs';
const origin='https://jobs.example.test',linkId='511153522',siteId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',title='AI 业务产品经理(J12289)';
const roleLink=origin+'/zpdetail/'+linkId,detail=id=>origin+'/job/detail?jobAdId='+id,form=id=>origin+'/form?fromPage=job&jobAdId='+id,home=origin+'/';
const entry=(target='same')=>({kind:'declarative_transition',target,detail:{location:{pathnamePattern:'^/job/detail$',query:{jobAdId:'$roleId'}},roleSelector:'.title'},entryLocator:{text:'立即投递',label:'立即投递'},form:{location:{pathnamePattern:'^/form$',query:{fromPage:'job',jobAdId:'$roleId'}},readySelector:'.form-title',roleSelector:'.form-title',rolePrefix:'你正在投递职位:'},evidence:{detailUrl:detail('x1'),formUrl:form('x1'),capturedAt:'2026-10-28',method:'synthetic'}});
function fixture({target='same',tabs=[],prior=null,officialId=linkId,url=roleLink,redirect={[roleLink]:detail(siteId)},bound=new Map(),account='me',loggedIn=true,landing=null,identity=null,pageTools=['newPage','reload','closePage'],observe=null}={}){
 const pages=new Map(tabs.map(([id,u])=>[id,{id,url:u}]));let seq=0;const calls=[],observations=[];let state=prior?structuredClone(prior):null;
 const task={taskId:'task-1',companyId:'keep',roleId:'J000144',officialId,title,url};
 const c={companyId:'keep',origin,entry:entry(target),loginMethod:'user_operated',account:{selector:'.acct',source:'account',mask:'exact',pageUrl:home},allowedPaths:['/']};
 const titleOf=u=>{try{const p=new URL(u);return p.pathname==='/job/detail'?title:null;}catch{return null;}};
 const page=id=>{const p=pages.get(id);return {url:()=>p.url,locator:s=>({filter(){return this;},first(){return this;},waitFor:async()=>{},count:async()=>s==='.acct'?1:s==='.title'?(new URL(p.url).pathname==='/job/detail'?1:0):s==='.form-title'?(new URL(p.url).pathname==='/form'?1:0):1,innerText:async()=>s==='.acct'?account:s==='.title'?title:s==='.form-title'?'你正在投递职位: '+title:s==='立即投递'?'立即投递':'',click:async()=>{calls.push({method:'cta',pageId:id});const to=form(new URL(p.url).searchParams.get('jobAdId'));if(target==='same')p.url=to;else{const nid='chrome:new-'+(++seq);pages.set(nid,{id:nid,url:to});}}}),getByText:()=>page(id).locator('立即投递')};};
 const host={getPage:async id=>{if(!pages.has(id))throw Error('ROLE_BROWSER_PAGE_LOST');return page(id);},listPages:async()=>[...pages.values()].map(p=>({id:p.id,url:p.url})),pause:async()=>{}};
 const browser={request:async(method,a)=>{calls.push({method,...a});
  if(method==='tabs')return [...pages.values()].map(p=>({id:p.id,url:p.url}));
  if(method==='openPage'){let id=a.pageId;if(id&&!pages.has(id))throw Error('ROLE_BROWSER_PAGE_LOST');if(!id){const hit=[...pages.values()].filter(p=>p.url===a.pageUrl);if(a.reuseOnly&&hit.length!==1)throw Error('EXISTING_PAGE_REQUIRED_FOR_REBIND');id=a.newPage?null:hit[0]?.id;if(!id){id='chrome:opened-'+(++seq);pages.set(id,{id,url:'about:blank'});}}
   const p=pages.get(id),reused=p.url===a.pageUrl;if(!reused||a.reload)p.url=landing&&!loggedIn?landing:(redirect[a.pageUrl]||a.pageUrl);return {pageId:id,pageUrl:p.url,reused};}
  if(method==='roleSnapshot'){const p=pages.get(a.pageId);if(!p)throw Error('ROLE_BROWSER_PAGE_LOST');return {pageUrl:p.url,roleTitle:a.roleSelector==='.title'?titleOf(p.url):null,account:loggedIn?account:null,loginFormPresent:!loggedIn,readAt:'now'};}
  if(method==='pageIdentity')return {pageId:a.pageId,pageUrl:pages.get(a.pageId).url};
  if(method==='roleEnterApplication')return executeTransition(a,host);
  if(method==='closePage'){pages.delete(a.pageId);return {closed:true};}
  if(method==='screenshot')return {path:'/private/shot-'+a.pageId+'.png'};
  if(method==='status')return {state:'channel_routed',channels:{chrome:{protocolVersion:4,...(pageTools?{pageTools}:{})}}};
  throw Error('UNEXPECTED_METHOD:'+method);
 }};
 const queues={task:async()=>({q:{id:'queue-1',queueHash:'h'},t:task}),read:async()=>{if(!state)throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(state);},put:async(id,v)=>{state=structuredClone(v);},boundPages:async()=>{const m=new Map(bound);if(state?.pageId)m.set(state.pageId,task.taskId);return m;}};
 const login={company:async()=>c,locked:async(_,fn)=>fn(),profile:async()=>({facts:{account:{status:'known',value:'me',sourceIds:['s']}}}),stateForPage:async(_,{snapshot})=>({account:snapshot.account,form:snapshot.loginFormPresent}),identityPage:async()=>identity,compile:async()=>({planId:'p',planHash:'h'})};
 const flow=new RoleFlow({queues,login,browser,templates:async()=>null,onObservation:async o=>{if(observe)return observe(o);observations.push(o);return {status:'observed'};}});
 return {flow,calls,pages,observations,state:()=>state,setLoggedIn:v=>{loggedIn=v;},task};
}
const opens=f=>f.calls.filter(c=>c.method==='openPage');

test('Keep line: role link → same tab redirect → landed id adopted with title proof → click 立即投递 in the same tab; one tab in total',async()=>{
 const f=fixture(),r=await f.flow.open({});
 assert.equal(r.status,'authenticated_at_role');assert.equal(r.pageKind,'detail');assert.equal(r.siteRoleId,siteId);
 assert.deepEqual(f.observations.map(o=>[o.field,o.value]),[['岗位链接',detail(siteId)]]);
 const e=await f.flow.enter({});assert.equal(e.status,'ready_to_fill');assert.equal(e.pageUrl,form(siteId));
 assert.equal(f.pages.size,1);assert.equal(opens(f).length,1);assert.equal(f.calls.filter(c=>c.method==='cta').length,1);
 assert.equal(f.calls.find(c=>c.method==='roleEnterApplication').expectedRoleId,siteId);
 // 再次进入：已在申请页，不再点击、不另开
 await f.flow.enter({});assert.equal(f.calls.filter(c=>c.method==='cta').length,1);assert.equal(f.pages.size,1);
});
test('a redirect to a page whose title differs is not adopted and is not guessed into the role',async()=>{
 const f=fixture({redirect:{[roleLink]:origin+'/job/detail?jobAdId=bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'}});
 // 标题核对：把详情页标题换掉
 const t=f.task;t.title='另一个岗位';
 await assert.rejects(f.flow.open({}),/ROLE_LINK_LANDING_NOT_RECOGNIZED/);assert.equal(f.observations.length,0);assert.equal(f.pages.size,1);
});
test('an unbound tab already showing this role is reused instead of opening another',async()=>{
 const f=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:existing',detail(siteId)]]}),r=await f.flow.open({});
 assert.equal(r.pageId,'chrome:existing');assert.equal(opens(f).length,0);assert.equal(f.state().reusedPage,'existing_role_page');assert.equal(f.pages.size,1);
});
test('two unbound tabs of the same role: refuse to choose, point to role_close_extra_pages',async()=>{
 const f=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:a',detail(siteId)],['chrome:b',form(siteId)]]});
 await assert.rejects(f.flow.open({}),e=>{assert.equal(e.message,'ROLE_PAGES_DUPLICATED');assert.deepEqual(e.details,{phase:'page_binding',nextTool:'role_close_extra_pages',pageIds:['chrome:a','chrome:b']});return true;});
 assert.equal(opens(f).length,0);
});
test('a tab bound to another task is never taken over',async()=>{
 const f=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:other',detail(siteId)]],bound:new Map([['chrome:other','task-2']])});
 const r=await f.flow.open({});assert.notEqual(r.pageId,'chrome:other');assert.equal(opens(f).length,1);
});
test('a binding carried over from a re-import keeps using that tab (no new tab) and navigates it back to the role link when it sits elsewhere',async()=>{
 const f=fixture({tabs:[['chrome:kept',home]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:kept',status:'rebind_required'}}),r=await f.flow.open({});
 assert.equal(r.pageId,'chrome:kept');assert.equal(f.pages.size,1);const o=opens(f);assert.equal(o.length,1);assert.equal(o[0].pageId,'chrome:kept');assert.equal(o[0].pageUrl,roleLink);
});
test('after login the site lands on its home page: the same tab goes back to the role link',async()=>{
 const f=fixture({loggedIn:false});const first=await f.flow.open({});assert.equal(first.status,'needs_login');
 f.setLoggedIn(true);f.pages.get(first.pageId).url=home;
 const r=await f.flow.resume({});assert.equal(r.status,'authenticated_at_role');assert.equal(r.pageId,first.pageId);assert.equal(f.pages.size,1);
 assert.deepEqual(opens(f).slice(1).map(o=>[o.pageId,o.pageUrl]),[[first.pageId,roleLink]]);
});
test('enter only works on the bound tab: a stray form of the same role is ignored, unbound/lost/elsewhere tabs are refused before any click',async()=>{
 const f=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:bound',detail(siteId)],['chrome:stray',form(siteId)]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'authenticated_at_role'}});
 const r=await f.flow.enter({});assert.equal(r.pageId,'chrome:bound');assert.equal(f.calls.filter(c=>c.method==='cta').length,1);assert.equal(f.pages.get('chrome:stray').url,form(siteId));
 for(const [prior,code,next] of [[null,'ROLE_PAGE_NOT_BOUND','role_open'],[{queueId:'queue-1',pageId:'chrome:gone'},'ROLE_EXISTING_PAGE_NOT_FOUND','role_resume'],[{queueId:'queue-1',pageId:'chrome:home'},'ROLE_BOUND_PAGE_NOT_AT_ROLE','role_open']]){
  const g=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:home',home],['chrome:stray',form(siteId)]],prior});
  await assert.rejects(g.flow.enter({}),e=>{assert.equal(e.message,code);assert.equal(e.details.nextTool,next);return true;});assert.equal(g.calls.some(c=>c.method==='cta'||c.method==='roleEnterApplication'),false);
 }
});
test('new-tab sites: tabs that existed before the first click never count as the entered form, also on retry after interruption',async()=>{
 const f=fixture({target:'new',officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:bound',detail(siteId)],['chrome:stray',form(siteId)]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'authenticated_at_role'}});
 const r=await f.flow.enter({});assert.match(r.pageId,/^chrome:new-/);assert.equal(f.calls.find(c=>c.method==='roleEnterApplication').excludePageIds.includes('chrome:stray'),true);
 // 中断重试：已登记的点击前标签不变，点击开出的新申请页被认作本次进入，不再点第二次
 const g=fixture({target:'new',officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:bound',detail(siteId)],['chrome:stray',form(siteId)],['chrome:clicked',form(siteId)]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'authenticated_at_role',entryStarted:{at:'t',preexisting:['chrome:stray']}}});
 const again=await g.flow.enter({});assert.equal(again.pageId,'chrome:clicked');assert.equal(g.calls.some(c=>c.method==='cta'),false);assert.equal(g.state().entryStarted,undefined);
});
test('close extra pages: plain extra tabs close at once; form-like extras need the user first; bound and identity pages and other sites stay',async()=>{
 const tabs=[['chrome:bound',detail(siteId)],['chrome:dup',detail(siteId)],['chrome:home',home],['chrome:verify',origin+'/personal/vertifyUser?state=4'],['chrome:oldform',form(siteId)],['chrome:identity',home],['chrome:else','https://other.example.test/x']];
 const f=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs,prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'authenticated_at_role'},identity:{pageId:'chrome:identity'}});
 const r=await f.flow.closeExtraPages({});
 assert.deepEqual(r.closed.map(c=>c.pageId).sort(),['chrome:dup','chrome:home','chrome:verify']);assert.deepEqual(r.formPagesAwaitingUser.map(p=>[p.pageId,p.screenshot]),[['chrome:oldform','/private/shot-chrome:oldform.png']]);
 assert.deepEqual([...f.pages.keys()].sort(),['chrome:bound','chrome:else','chrome:identity','chrome:oldform']);
 await assert.rejects(f.flow.closeExtraPages({authorization:{closeFormPages:['chrome:bound'],evidence:'可以关'}}),/FORM_PAGE_NOT_EXTRA/);
 await assert.rejects(f.flow.closeExtraPages({authorization:{closeFormPages:['chrome:oldform'],evidence:' '}}),/FORM_PAGE_CLOSE_AUTHORIZATION_REQUIRED/);
 const done=await f.flow.closeExtraPages({authorization:{closeFormPages:['chrome:oldform'],evidence:'用户：旧申请表可以关'}});assert.deepEqual(done.closed.map(c=>c.pageId),['chrome:oldform']);assert.equal(done.browserClosed,false);
});
test('reload refreshes the bound tab in place; after filling it needs the user’s words and drops the fill proofs',async()=>{
 const f=fixture({tabs:[['chrome:bound',form(siteId)]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'ready_to_fill',fillRunId:'fill-1',verifyRunId:'v'}});
 await assert.rejects(f.flow.reload({}),/RELOAD_DISCARDS_FILLED_FIELDS_AUTHORIZATION_REQUIRED/);
 const r=await f.flow.reload({authorization:{evidence:'用户：页面卡住了，刷新吧'}});assert.equal(r.pageId,'chrome:bound');assert.equal(opens(f).at(-1).reload,true);assert.equal(f.state().fillRunId,undefined);assert.equal(f.pages.size,1);
 const g=fixture({tabs:[['chrome:bound',detail(siteId)]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'authenticated_at_role'}});assert.equal((await g.flow.reload({})).status,'reloaded');
});
test('authorized recovery of a lost tab on an entry-recipe site restarts from the role link, never the stored form address',async()=>{
 const f=fixture({prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:lost',originalRoleUrl:roleLink,expectedTitle:title,returnUrl:form(siteId),applicationUrl:form(siteId),status:'ready_to_fill',fillRunId:'f',siteRoleId:siteId}});
 await assert.rejects(f.flow.resume({}),/ROLE_EXISTING_PAGE_NOT_FOUND/);
 const r=await f.flow.resume({authorization:{restoreLostPage:true,evidence:'用户确认原标签丢了，重开'}});
 assert.equal(r.status,'authenticated_at_role');assert.equal(opens(f)[0].pageUrl,roleLink);assert.equal(f.state().applicationUrl,undefined);assert.equal(f.state().fillRunId,undefined);assert.equal(f.state().returnUrl,roleLink);
});
test('an entered form whose tab was sent elsewhere (e.g. session expired) goes back through the role link, not straight to the form address',async()=>{
 const f=fixture({officialId:siteId,url:detail(siteId),redirect:{},tabs:[['chrome:bound',home]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',originalRoleUrl:detail(siteId),expectedTitle:title,returnUrl:form(siteId),applicationUrl:form(siteId),status:'ready_to_fill',fillRunId:'f'}});
 f.flow.templates=async()=>({pages:[{pathPrefix:'/form',roleTitle:title,roleSelector:'.form-title',readySelector:'.form-title'}]});
 const r=await f.flow.resume({});assert.equal(r.status,'authenticated_at_role');assert.deepEqual(opens(f).map(o=>[o.pageId,o.pageUrl]),[['chrome:bound',detail(siteId)]]);assert.equal(f.state().applicationUrl,undefined);assert.equal(f.state().fillRunId,undefined);
});
test('site entry configs are role-agnostic: literal role IDs are refused, $roleId and short tenant path codes pass',()=>{
 assert.equal(validateTransition(entry()).kind,'declarative_transition');
 for(const mutate of [e=>e.detail.location.query.jobAdId=siteId,e=>e.form.location.query.jobAdId='739bc546-7ae3-4f6a-9d4f-681f02bf3a91',e=>e.detail.location.query.jobAdId='511153522',e=>e.detail.location.pathnamePattern='^/zpdetail/511153522$']){const e=entry();mutate(e);assert.throws(()=>validateTransition(e),/ENTRY_ROLE_ID_LITERAL/);}
 const tenant=entry();tenant.detail.location.pathnamePattern='^/051736/position/[0-9]+/detail$';assert.equal(validateTransition(tenant).kind,'declarative_transition');
 assert.equal(rolePageKind(entry(),detail(siteId),{roleUrl:roleLink,roleId:siteId}),'detail');assert.equal(rolePageKind(entry(),form(siteId)+'&userId=1',{roleUrl:roleLink,roleId:siteId}),'form');assert.equal(rolePageKind(entry(),home,{roleUrl:roleLink,roleId:siteId}),null);
});
test('a carried tab sitting on an unrecognized form that the old task had already filled is not navigated away',async()=>{
 const other=form('cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee');
 const f=fixture({tabs:[['chrome:kept',other]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:kept',status:'rebind_required',carriedFrom:{queueId:'old',status:'ready_to_fill',hadFill:true}}});
 await assert.rejects(f.flow.open({}),e=>{assert.equal(e.message,'ROLE_CARRIED_FORM_NOT_RECOGNIZED');assert.deepEqual(e.details.pageIds,['chrome:kept']);return true;});assert.equal(opens(f).length,0);assert.equal(f.pages.get('chrome:kept').url,other);
 const g=fixture({tabs:[['chrome:kept',other]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:kept',status:'rebind_required',carriedFrom:{queueId:'old',status:'ready_to_fill',hadFill:false}}});
 assert.equal((await g.flow.open({})).pageId,'chrome:kept');assert.equal(g.pages.size,1);
});
test('an old browser host without page tools is reported, never silently treated as reloaded or closed',async()=>{
 const f=fixture({pageTools:null,tabs:[['chrome:bound',form(siteId)],['chrome:dup',home]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',status:'authenticated_at_role'}});
 await assert.rejects(f.flow.reload({}),e=>{assert.equal(e.message,'BROWSER_HOST_RESTART_REQUIRED');return true;});assert.equal(opens(f).length,0);
 await assert.rejects(f.flow.closeExtraPages({}),/BROWSER_HOST_RESTART_REQUIRED/);assert.equal(f.pages.size,2);
});
test('a landing observation that failed to write is written on the next check of the same task',async()=>{
 let fail=true;const seen=[];const f=fixture({observe:async o=>{seen.push(o);if(fail)throw Error('OUTCOME_WRITE_LOCKED');return {status:'observed'};}});
 const r=await f.flow.open({});assert.equal(r.linkObservation,'write_failed:OUTCOME_WRITE_LOCKED');
 fail=false;await f.flow.enter({});assert.equal(f.state().linkObservation,'observed');assert.deepEqual(seen.filter(o=>o.field==='岗位链接').map(o=>o.value),[detail(siteId),detail(siteId)]);
});
test('a task already on its form retries the failed landing observation when role_open re-checks it',async()=>{
 const f=fixture({officialId:linkId,tabs:[['chrome:bound',form(siteId)]],prior:{queueId:'queue-1',taskId:'task-1',pageId:'chrome:bound',originalRoleUrl:roleLink,expectedTitle:title,returnUrl:form(siteId),applicationUrl:form(siteId),status:'ready_to_fill',siteRoleId:siteId,landedDetailUrl:detail(siteId),linkObservation:'write_failed:ROLE_LINK_OBSERVATION_IS_FAILURE_ONLY'}});
 f.flow.templates=async()=>({pages:[{pathPrefix:'/form',roleTitle:title,roleSelector:'.form-title',readySelector:'.form-title'}]});
 await f.flow.open({}).catch(()=>{});assert.deepEqual(f.observations.map(o=>[o.field,o.value]),[['岗位链接',detail(siteId)]]);assert.equal(f.state().linkObservation,'observed');assert.equal(opens(f).length,0);
});
test('a task that entered the form while its template is still being built can be resumed and restored (no recipe error)',async()=>{
 const prior={queueId:'queue-1',taskId:'task-1',pageId:'chrome:lost',originalRoleUrl:roleLink,expectedTitle:title,returnUrl:form(siteId)+'&userId=1',applicationUrl:form(siteId)+'&userId=1',status:'ready_to_fill',siteRoleId:siteId,landedDetailUrl:detail(siteId),linkObservation:'write_failed:ROLE_LINK_OBSERVATION_IS_FAILURE_ONLY'};
 const f=fixture({prior});f.task.applyUrl=form(siteId)+'&userId=1';
 await assert.rejects(f.flow.resume({}),/ROLE_EXISTING_PAGE_NOT_FOUND/);
 const r=await f.flow.resume({authorization:{restoreLostPage:true,evidence:'用户同意重启专用浏览器'}});
 assert.equal(r.status,'authenticated_at_role');assert.equal(opens(f)[0].pageUrl,roleLink);assert.equal(r.linkObservation,'observed');assert.deepEqual(f.observations.map(o=>o.field),['岗位链接']);
 const g=fixture({prior:{...prior,pageId:'chrome:bound',linkObservation:'observed'},tabs:[['chrome:bound',form(siteId)+'&userId=1']]});g.task.applyUrl=form(siteId)+'&userId=1';
 const again=await g.flow.open({});assert.equal(again.pageKind,'form');assert.equal(opens(g).length,0);
});

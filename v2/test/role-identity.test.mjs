import test from 'node:test';import assert from 'node:assert/strict';import {matchesRole} from '../shared/role-identity.mjs';import {matchesAccount,resolveAccount,validateCompany} from '../login/contracts.mjs';
test('a titleless editor uses independently observed job ID, never a fabricated title',()=>{const p={roleTitle:'Role A',roleIdentity:{parameter:'pid',value:'a'}};assert.ok(matchesRole(p,{roleTitle:null,roleIdentity:{parameter:'pid',value:'a'}}));for(const actual of [{roleTitle:'Role A',roleIdentity:{parameter:'pid',value:'b'}},{roleTitle:null},{roleTitle:'Other',roleIdentity:{parameter:'pid',value:'a'}}])assert.equal(matchesRole(p,actual),false);});
test('user-operated login requires an exact sourced display identity, not any logged-in account',()=>{const c={schemaVersion:1,version:1,companyId:'sample',origin:'https://example.com',loginPath:'/jobs',allowedPaths:['/'],loginMethod:'user_operated',account:{mask:'exact',selector:'.account',source:'account.display',pageUrl:'https://example.com/account'},success:{requiresAccountMatch:true,noApplicationSubmission:true},evidence:{sourceUrl:'https://example.com/account'}};validateCompany(c);const a=resolveAccount({facts:{'account.display':{status:'known',value:'User',sourceIds:['observed_session']}}},c);assert.equal(matchesAccount('User',a),true);assert.equal(matchesAccount('Other',a),false);});
import {RoleFlow} from '../shared/role-flow.mjs';
import {readRoleIdentity} from '../shared/role-identity.mjs';
test('role resume uses the same literal prefix proof without replacing account or job ID',async()=>{
 const url='https://a.test/form?pid=actual',plan={roleTitle:'Role',roleSelector:'#role',rolePrefix:'Applying for:',roleIdentity:{parameter:'pid',value:'actual'}};
 const browser={request:async()=>({pageUrl:url,roleTitle:'Applying for: Role',account:'Actual Account',roleIdentity:{parameter:'pid',value:'actual'},loginFormPresent:false}),existingPage:async(pageUrl,options)=>{assert.equal(pageUrl,url);assert.equal(options.pageId,'chrome:bound');assert.equal(options.readOnly,true);return {observe:async()=>({source:'live_dom',pageUrl:url,roleTitle:'Role',rawRoleTitle:'Applying for: Role',prefixApplied:true,account:'Forged Account',roleIdentity:{parameter:'pid',value:'forged'}})};}};
 const f=new RoleFlow({browser,login:{}}),o=await f.snapshot({plan,c:{account:{selector:'#account'}}},'chrome:bound');assert.equal(o.account,'Actual Account');assert.equal(o.roleIdentity.value,'actual');assert.ok(matchesRole(plan,o));
});
test('query and SPA fragment identities share actual URL extraction without expected-value substitution',()=>{
 assert.equal(readRoleIdentity({parameter:'id',value:'wrong'},'https://a.test/form?id=actual').value,'actual');
 assert.equal(readRoleIdentity({parameter:'id',source:'hashQuery'},'https://a.test/#/form?id=actual').value,'actual');
 assert.equal(readRoleIdentity({parameter:'id',source:'hashPath',pattern:'^/jobs/(?<id>[^/]+)/apply$'},'https://a.test/#/jobs/actual/apply').value,'actual');
 assert.equal(readRoleIdentity({parameter:'id'},'https://a.test/?id=a&id=b').value,null);
 assert.throws(()=>readRoleIdentity({parameter:'id',source:'hashPath',pattern:'.*'},'https://a.test/#/jobs/a'),/PATTERN_REQUIRED/);
});
test('resuming an entered role preserves its actual application URL rather than reverting to its detail URL',async()=>{const t={taskId:'t',companyId:'c',title:'Role',url:'https://a.test/detail',applyUrl:null},q={id:'q'},state={queueId:'q',expectedTitle:'Role',originalRoleUrl:t.url,applicationUrl:'https://a.test/form?pid=1'};const f=new RoleFlow({queues:{task:async()=>({q,t}),read:async()=>state},login:{company:async()=>({origin:'https://a.test',allowedPaths:['/']})},templates:async()=>({pages:[{pathPrefix:'/form',roleTitle:'Role',roleIdentity:{parameter:'pid',value:'1'}}]})});const x=await f.context({});assert.equal(x.target,state.applicationUrl);assert.equal(x.plan.pathPrefix,'/form');});

test('a lost tab resumes only the unique existing original URL and never opens a new page',async()=>{
 const target='https://a.test/form',state={queueId:'q',pageId:'iab:old',returnUrl:target,expectedTitle:'Role'};let bound;
 const f=new RoleFlow({queues:{read:async()=>structuredClone(state)},login:{locked:async(c,fn)=>fn()},browser:{request:async(method,args)=>{assert.equal(method,'tabs');assert.equal(args.pageUrl,target);return [{id:'iab:current',url:target}];}}});
 f.context=async()=>({q:{id:'q'},t:{taskId:'t',title:'Role'},c:{},target});f.assess=async(x,s)=>{bound=s.pageId;return {status:'ready_to_fill'};};
 assert.equal((await f.resume({})).status,'ready_to_fill');assert.equal(bound,'iab:current');
 f.browser.request=async()=>[{id:'current',url:target,browserChannel:'iab'}];await f.resume({});assert.equal(bound,'iab:current');
 f.browser.request=async()=>[{id:'1',url:target},{id:'2',url:target}];await assert.rejects(f.resume({}),/EXISTING_PAGE_NOT_UNIQUE/);
 f.browser.request=async()=>[{id:'1',url:'https://a.test/other'}];await assert.rejects(f.resume({}),/EXISTING_PAGE_NOT_UNIQUE/);
});

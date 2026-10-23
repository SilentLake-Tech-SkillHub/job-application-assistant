import test from 'node:test';
import assert from 'node:assert/strict';
import {RoleFlow} from '../shared/role-flow.mjs';
import {BrowserAdapter} from '../shared/browser.mjs';

test('browser tab inventory exposes stable tracked IDs without navigation or new pages',async()=>{
 const page={url:()=> 'https://forms.example/apply',title:async()=> 'Apply',isClosed:()=>false};
 const b=new BrowserAdapter('managed-chrome');b.state='connected';b.connection={contexts:()=>[{pages:()=>[page]}]};
 const first=await b.tabs(),second=await b.tabs();assert.equal(first[0].id,second[0].id);assert.ok(first[0].id);assert.equal(await b.trackedPage(first[0].id),page);
});

test('reuse-only page binding never creates or navigates a missing page',async()=>{
 const b=new BrowserAdapter('managed-chrome');b.state='connected';b.connection={contexts:()=>[{pages:()=>[],newPage:()=>{throw Error('MUST_NOT_CREATE_PAGE');}}]};
 await assert.rejects(b.openPage('https://forms.example/absent',{reuseOnly:true}),/EXISTING_PAGE_REQUIRED/);
});

for(const legacy of [false,true])test(`lost role page rebind preserves its unique full URL (legacy broker=${legacy})`,async()=>{
 const calls=[],url='https://forms.example/apply?id=one#form';
 const state={queueId:'queue',returnUrl:url,expectedTitle:'Role',pageId:'chrome:lost'};
 const flow=new RoleFlow({queues:{read:async()=>({...state})},login:{locked:async(_,run)=>run()},browser:{request:async(method,args)=>{
  calls.push({method,args});if(method==='tabs')return [{url,browserChannel:'chrome',...(legacy?{}:{id:'retained'})}];
  if(method==='openPage')return {pageId:'chrome:retained',pageUrl:url,reused:true};throw Error('UNEXPECTED_OPERATION');
 }}});
 flow.context=async()=>({q:{id:'queue'},t:{taskId:'task',title:'Role'},c:{},target:url});
 flow.assess=async(_,current)=>{assert.equal(current.pageId,'chrome:retained');return current;};
 assert.equal((await flow.resume({})).returnUrl,url);assert.equal(calls.filter(c=>c.method==='openPage').length,legacy?1:0);
});

test('ambiguous retained forms refuse rebind instead of closing or choosing a tab',async()=>{
 const url='https://forms.example/apply',state={queueId:'queue',returnUrl:url,expectedTitle:'Role',pageId:'lost'};
 const flow=new RoleFlow({queues:{read:async()=>state},login:{locked:async(_,run)=>run()},browser:{request:async method=>{assert.equal(method,'tabs');return [{id:'one',url},{id:'two',url}];}}});
 flow.context=async()=>({q:{id:'queue'},t:{taskId:'task',title:'Role'},c:{},target:url});
 await assert.rejects(flow.resume({}),/ROLE_EXISTING_PAGE_NOT_UNIQUE/);
});

for(const role of ['one','other'])test(`query variation rebind requires an observed matching role identity (${role})`,async()=>{
 const url='https://forms.example/apply#job/one',observed='https://forms.example/apply?id='+role+'#job/one';
 const state={queueId:'queue',returnUrl:url,applicationUrl:url,expectedTitle:'Role',pageId:'lost'};
 const flow=new RoleFlow({queues:{read:async()=>({...state})},login:{locked:async(_,run)=>run()},browser:{request:async method=>{assert.equal(method,'tabs');return [{id:'retained',url:observed,browserChannel:'chrome'}];}}});
 flow.context=async()=>({q:{id:'queue'},t:{taskId:'task',title:'Role',roleId:'one'},c:{},target:url,plan:{roleIdentity:{source:'query',parameter:'id',value:'one'}}});
 flow.assess=async(_,current)=>current;
 if(role==='one'){const current=await flow.resume({});assert.equal(current.returnUrl,observed);assert.equal(current.applicationUrl,observed);assert.equal(current.pageId,'chrome:retained');}
 else await assert.rejects(flow.resume({}),/ROLE_EXISTING_PAGE_NOT_UNIQUE/);
});

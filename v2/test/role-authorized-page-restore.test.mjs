import test from 'node:test';import assert from 'node:assert/strict';import {RoleFlow} from '../shared/role-flow.mjs';
const fixture=({attempt=false,tabs=[]}={})=>{
 const url='https://example.test/form?id=example',calls=[],state={queueId:'queue',taskId:'task',returnUrl:url,applicationUrl:url,expectedTitle:'Example Role',pageId:'lost',status:'ready_for_user_review',fillRunId:'old-fill',verifyRunId:'old-review',...(attempt?{submissionAttempt:{status:'uncertain'}}:{})};
 const flow=new RoleFlow({queues:{read:async()=>state,put:async()=>{}},login:{locked:async(_,fn)=>fn()},browser:{request:async(method,args)=>{calls.push({method,args});if(method==='tabs')return tabs;if(method==='openPage')return {pageId:'chrome:restored',pageUrl:url};throw Error('Unexpected method');}}});
 flow.context=async()=>({q:{id:'queue'},t:{taskId:'task',title:'Example Role'},c:{origin:'https://example.test',account:{selector:'#account'}},target:url,plan:{readySelector:'form'}});flow.assess=async(_,current)=>({...current,assessed:true});return {flow,state,calls,url};
};
test('authorized zero-tab recovery opens only the stored original form and invalidates old ready proofs',async()=>{
 const f=fixture();await assert.rejects(f.flow.resume({}),/PAGE_NOT_FOUND/);assert.equal(f.calls.filter(c=>c.method==='openPage').length,0);
 const r=await f.flow.resume({authorization:{restoreLostPage:true,evidence:'Human approved restoring the original dedicated browser and lost forms'}});assert.equal(r.assessed,true);assert.equal(r.pageId,'chrome:restored');assert.equal(r.fillRunId,undefined);assert.equal(r.verifyRunId,undefined);assert.equal(r.status,'restored_page_requires_verification');assert.equal(f.calls.find(c=>c.method==='openPage').args.pageUrl,f.url);
});
test('page restoration cannot release uncertain submissions or choose among duplicate existing pages',async()=>{
 const f=fixture({attempt:true});await assert.rejects(f.flow.resume({authorization:{restoreLostPage:true,evidence:'Human approved browser restore'}}),/SUBMISSION_ALREADY_ATTEMPTED/);assert.equal(f.calls.filter(c=>c.method==='openPage').length,0);
 const d=fixture({tabs:[{id:'a',url:f.url},{id:'b',url:f.url}]});await assert.rejects(d.flow.resume({authorization:{restoreLostPage:true,evidence:'Human approved browser restore'}}),/NOT_UNIQUE/);assert.equal(d.calls.filter(c=>c.method==='openPage').length,0);
});

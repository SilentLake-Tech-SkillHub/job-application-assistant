// C32：登录态不从页面痕迹推断。登录 MCP 只报告当前页面是不是登录页；是否已登录由岗位入口点击后的落地页证明。
import test from 'node:test';import assert from 'node:assert/strict';
import {observeUserOperatedSession} from '../login/browser.mjs';
const origin='https://example.test',url=origin+'/form',c={origin,account:{selector:'.session',pageUrl:origin+'/unused-proof'}};
const forbidden={request:async()=>{throw Error('UNEXPECTED_BROWSER_CALL');}};
for(const snapshot of [{authenticated:true},{authenticated:true,account:'different-account'},{account:'me'},{}])test('a non-login page is only reported as not a login page; account text and session markers are ignored: '+JSON.stringify(snapshot),async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url,loginFormPresent:false,...snapshot}});
 assert.equal(r.form,false);assert.equal(r.loginFormPresent,false);for(const key of ['authenticated','account','sessionStatus'])assert.equal(key in r,false);
});
test('a visible login form marks the login page regardless of stale session evidence',async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url,authenticated:true,account:'me',loginFormPresent:true}});assert.equal(r.form,true);assert.equal('authenticated' in r,false);
});
test('same tab redirected to login is observed by ID at its actual URL; no account or session selectors are read',async()=>{
 const calls=[],broker={request:async(m,a)=>{calls.push([m,a]);assert.equal(a.pageId,'chrome:original');return {pageUrl:origin+'/login',loginFormPresent:true};}};
 const r=await observeUserOperatedSession(broker,{...c,session:{authenticated:'.x'},fields:{root:'.login'}},url,{pageId:'chrome:original'});assert.equal(r.form,true);assert.equal(r.url,origin+'/login');
 assert.deepEqual(calls.map(([m])=>m),['roleSnapshot']);assert.deepEqual(calls[0][1],{pageId:'chrome:original',loginRoot:'.login'});
});
test('foreign requested and observed origins are rejected',async()=>{
 await assert.rejects(observeUserOperatedSession(forbidden,c,'https://foreign.test/form'),/LOGIN_PAGE_SCOPE_MISMATCH/);
 await assert.rejects(observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:'https://foreign.test/form'}}),/LOGIN_PAGE_SCOPE_MISMATCH/);
});
test('unbound read finds unique exact current page without opening an identity page',async()=>{
 const calls=[],broker={request:async(m,a)=>{calls.push(m);if(m==='tabs')return [{id:'t',browserChannel:'chrome',url},{id:'other',browserChannel:'chrome',url:origin+'/job'}];assert.equal(a.pageId,'chrome:t');return {pageUrl:url,loginFormPresent:false};}};
 const r=await observeUserOperatedSession(broker,c,url);assert.equal(r.form,false);assert.deepEqual(calls,['tabs','roleSnapshot']);
});
test('unbound ambiguous pages are not silently chosen',async()=>{
 const broker={request:async()=>[{id:'one',url},{id:'two',url}]};await assert.rejects(observeUserOperatedSession(broker,c,url),/LOGIN_PAGE_AMBIGUOUS/);
});
test('no account proof page is opened when the page shows no login evidence',async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url}});assert.equal(r.form,false);
});

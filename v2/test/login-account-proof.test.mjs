import test from 'node:test';import assert from 'node:assert/strict';
import {observeUserOperatedSession} from '../login/browser.mjs';
const origin='https://example.test',url=origin+'/form',c={origin,account:{selector:'.session',pageUrl:origin+'/unused-proof'}};
const forbidden={request:async()=>{throw Error('UNEXPECTED_BROWSER_CALL');}};
for(const account of [undefined,'different-account'])test('authenticated session works without matching identity: '+account,async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url,authenticated:true,account,loginFormPresent:false}});
 assert.equal(r.authenticated,true);assert.equal(r.form,false);assert.equal('account' in r,false);
});
test('visible login overrides stale authenticated evidence',async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url,authenticated:true,loginFormPresent:true}});assert.equal(r.authenticated,false);assert.equal(r.sessionStatus,'logged_out');
});
test('absence of both login form and positive session evidence remains unknown',async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url,loginFormPresent:false}});assert.equal(r.authenticated,false);assert.equal(r.sessionStatus,'unknown');
});
test('same tab redirected to login is observed by ID at its actual URL',async()=>{
 const calls=[],broker={request:async(m,a)=>{calls.push(m);assert.equal(a.pageId,'chrome:original');return {pageUrl:origin+'/login',loginFormPresent:true};}};
 const r=await observeUserOperatedSession(broker,c,url,{pageId:'chrome:original'});assert.equal(r.sessionStatus,'logged_out');assert.equal(r.url,origin+'/login');assert.deepEqual(calls,['roleSnapshot']);
});
test('foreign requested and observed origins are rejected',async()=>{
 await assert.rejects(observeUserOperatedSession(forbidden,c,'https://foreign.test/form'),/LOGIN_PAGE_SCOPE_MISMATCH/);
 await assert.rejects(observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:'https://foreign.test/form',authenticated:true}}),/LOGIN_PAGE_SCOPE_MISMATCH/);
});
test('unbound read finds unique exact current page without opening an identity page',async()=>{
 const calls=[],broker={request:async(m,a)=>{calls.push(m);if(m==='tabs')return [{id:'t',browserChannel:'chrome',url},{id:'other',browserChannel:'chrome',url:origin+'/job'}];assert.equal(a.pageId,'chrome:t');return {pageUrl:url,authenticated:true};}};
 const r=await observeUserOperatedSession(broker,c,url);assert.equal(r.authenticated,true);assert.deepEqual(calls,['tabs','roleSnapshot']);
});
test('unbound ambiguous pages are not silently chosen',async()=>{
 const broker={request:async()=>[{id:'one',url},{id:'two',url}]};await assert.rejects(observeUserOperatedSession(broker,c,url),/LOGIN_PAGE_AMBIGUOUS/);
});
test('no account proof page is opened when login evidence is missing',async()=>{
 const r=await observeUserOperatedSession(forbidden,c,url,{currentSnapshot:{pageUrl:url}});assert.equal(r.sessionStatus,'unknown');
});

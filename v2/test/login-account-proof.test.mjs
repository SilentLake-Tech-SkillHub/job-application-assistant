import test from 'node:test';import assert from 'node:assert/strict';
import {LoginBrowser} from '../login/browser.mjs';
import {matchesAccount,resolveAccount} from '../login/contracts.mjs';
const origin='https://example.test',roleUrl=origin+'/form?job=example',proofUrl=origin+'/account';
const company=()=>({origin,loginMethod:'user_operated',account:{selector:'.actual-account',source:'account',mask:'exact',pageUrl:proofUrl}});
const observed=(pageUrl,account,present=account!==null)=>({pageUrl,readAt:'observed-at',fields:{account:{present,value:account}}});
function fixture(entries){
 const reads=[],observations=[],broker={existingPage:async url=>{
  reads.push(url);const raw=entries[url];if(raw instanceof Error)throw raw;if(!raw)throw Error('EXISTING_PAGE_NOT_FOUND');
  return {observe:async spec=>{observations.push(spec);assert.deepEqual(spec,{fields:[{id:'account',read:{selector:'.actual-account',kind:'text'}}]});return structuredClone(raw);}};
 },request:async()=>{throw Error('ACCOUNT_PROOF_MUST_NOT_NAVIGATE_OR_MUTATE');}};
 return {browser:new LoginBrowser('synthetic-account-socket',{broker}),reads,observations};
}
test('current page account is preferred and declared account page is never opened or read',async()=>{
 const f=fixture({[roleUrl]:observed(roleUrl,'current-person'),[proofUrl]:observed(proofUrl,'fallback-person')}),r=await f.browser.observe(company(),roleUrl);
 assert.equal(r.account,'current-person');assert.equal(r.identityPageUrl,roleUrl);assert.equal(r.url,roleUrl);assert.equal(r.form,false);assert.equal(r.userOperated,true);assert.deepEqual(f.reads,[roleUrl]);
});
test('wrong current account survives for downstream rejection instead of being hidden by a good fallback',async()=>{
 const c=company(),f=fixture({[roleUrl]:observed(roleUrl,'wrong-person'),[proofUrl]:observed(proofUrl,'expected-person')}),r=await f.browser.observe(c,roleUrl);
 const expected=resolveAccount({facts:{account:{status:'known',value:'expected-person',sourceIds:['fixture']}}},c);
 assert.equal(r.account,'wrong-person');assert.equal(matchesAccount(r.account,expected),false);assert.deepEqual(f.reads,[roleUrl]);assert.equal(r.identityPageUrl,roleUrl);
});
test('absent current account may use only the declared existing same-origin proof page',async()=>{
 for(const current of [observed(roleUrl,null),Error('EXISTING_PAGE_NOT_FOUND')]){
  const f=fixture({[roleUrl]:current,[proofUrl]:observed(proofUrl,'expected-person')}),r=await f.browser.observe(company(),roleUrl);
  assert.deepEqual(f.reads,[roleUrl,proofUrl]);assert.equal(r.account,'expected-person');assert.equal(r.identityPageUrl,proofUrl);assert.equal(r.url,roleUrl);assert.equal(r.form,false);
 }
});
test('foreign requested role URL is rejected before reading any page',async()=>{
 const f=fixture({[proofUrl]:observed(proofUrl,'expected-person')});await assert.rejects(f.browser.observe(company(),'https://other.test/form'),/LOGIN_PAGE_SCOPE_MISMATCH/);assert.deepEqual(f.reads,[]);
});
test('foreign declared proof URL cannot supply a fallback identity',async()=>{
 const c=company();c.account.pageUrl='https://other.test/account';const f=fixture({[roleUrl]:observed(roleUrl,null),[c.account.pageUrl]:observed(c.account.pageUrl,'expected-person')});
 await assert.rejects(f.browser.observe(c,roleUrl),/LOGIN_PAGE_SCOPE_MISMATCH/);assert.deepEqual(f.reads,[roleUrl]);
});
test('missing declared proof page produces a typed actionable error without creating pages',async()=>{
 const f=fixture({[roleUrl]:observed(roleUrl,null)});
 await assert.rejects(f.browser.observe(company(),roleUrl),error=>{assert.equal(error.message,'ACCOUNT_PROOF_PAGE_NOT_OPEN');assert.deepEqual(error.details,{identityPagePath:'/account',rolePagePath:'/form',recovery:'verify_real_account_locator_on_an_existing_same_origin_page'});return true;});
 assert.deepEqual(f.reads,[roleUrl,proofUrl]);
});
test('missing current identity page itself is typed and not retried',async()=>{
 const f=fixture({});await assert.rejects(f.browser.observe(company(),proofUrl),/ACCOUNT_PROOF_PAGE_NOT_OPEN/);assert.deepEqual(f.reads,[proofUrl]);
});
test('an existing proof page without the account element remains unauthenticated',async()=>{
 const f=fixture({[roleUrl]:observed(roleUrl,null),[proofUrl]:observed(proofUrl,null)}),r=await f.browser.observe(company(),roleUrl);
 assert.equal(r.account,null);assert.equal(r.form,true);assert.equal(r.identityPageUrl,proofUrl);
});
test('ambiguous or broken current-page observation is not masked by a fallback',async()=>{
 for(const code of ['AMBIGUOUS_PAGE','READBACK_FAILED']){
  const f=fixture({[roleUrl]:Error(code),[proofUrl]:observed(proofUrl,'expected-person')});await assert.rejects(f.browser.observe(company(),roleUrl),error=>error.message===code);assert.deepEqual(f.reads,[roleUrl]);
 }
});
test('a same-origin request cannot accept an account observed after a cross-origin navigation',async()=>{
 for(const fallback of [false,true]){
  const f=fixture({[roleUrl]:fallback?observed(roleUrl,null):observed('https://other.test/form','expected-person'),[proofUrl]:observed('https://other.test/account','expected-person')});
  await assert.rejects(f.browser.observe(company(),roleUrl),/LOGIN_PAGE_SCOPE_MISMATCH/);
 }
});

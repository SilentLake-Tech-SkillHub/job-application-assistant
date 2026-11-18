import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';
import {assertRoleSnapshot} from '../shared/role-identity.mjs';
import {verifyForm} from '../shared/verifier.mjs';
import {stableControlCount} from '../shared/form-acquisition.mjs';
import {verifySearchableCommits} from '../shared/searchable-commit.mjs';
import {browserPreferences} from '../shared/browser-preferences.mjs';
import {hookReceiptStatus} from '../shared/hook-receipt.mjs';
import {PageAdapter} from '../shared/ui-page.mjs';
import {withHostCapabilities} from '../shared/sampling-bridge.mjs';
import {workflowEnvelope} from '../shared/workflow-contract.mjs';
test('the first missing-title failure keeps the batch moving and retries entry rather than auditing templates',()=>{
 const r=workflowEnvelope({error:'APPLICATION_ENTRY_FIRST_ROLE_TITLE_NOT_FOUND'});
 assert.equal(r.continuation.owner,'agent');assert.equal(r.continuation.continueWithOtherCompanies,true);assert.deepEqual(r.continuation.nextTools,['role_advance']);
});
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('missing or differing job titles do not block a bound shared application editor',()=>{
 for(const roleTitle of [null,'Another title'])assert.doesNotThrow(()=>assertRoleSnapshot({roleTitle:'Target'}, {pageUrl:'https://a.test/form',roleTitle,loginFormPresent:false},'https://a.test/form'));
 assert.throws(()=>assertRoleSnapshot({roleTitle:'Target'},{pageUrl:'https://a.test/login',loginFormPresent:true},'https://a.test/login'),/LOGIN_SESSION_REQUIRED/);
});
test('independent field verification continues when the shared editor has no job title',()=>{
 const result=verifyForm({roleTitle:'Target',pageUrl:'https://a.test/form',fields:[{id:'name',kind:'text',value:'Example'}]}, {source:'live_dom',readAt:new Date().toISOString(),pageUrl:'https://a.test/form',roleTitle:null,inventoryIds:['name'],fields:{name:{present:true,value:'Example'}}});
 assert.equal(result.status,'verified');assert.equal(result.roleObservation.matches,false);
});
test('acquisition waits for consecutive equal counts without accepting an earlier transient count',async()=>{
 const counts=[1,3,4,4];let reads=0;
 await stableControlCount(async()=>{reads++;return counts.shift();},{pause:async()=>{}});
 assert.equal(reads,4);
});
test('another job reuses an independently observed existing entity without typing it again',async()=>{
 const calls=[],field={id:'school',control:{type:'searchable_text'},source:'school',actions:[{method:'phoenix_autocomplete',selector:'#school'}]};
 const task={companyId:'C00001',roleId:'J000002',pageUrl:'https://a.test/form',templateHash:'hash',values:{school:'Example'}};
 const page={act:async action=>{calls.push(action.method);return {value:'Example',blurConfirmed:true,readbackStable:true,websiteId:{value:'entity'},currentSelection:{verified:true,label:'Example',kind:'entity_id',value:'entity',websiteId:{value:'entity'}}};}};
 const store={get:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}};
 const proofs=await verifySearchableCommits({store,page,plan:{fields:[field]},task});
 assert.equal(proofs.school.status,'verified');assert.equal(proofs.school.mode,'existing_selected_value');assert.deepEqual(calls,['phoenix_autocomplete_verify']);
});
test('existing repeat rows are read without adding them again; real additions retain the writer check',async()=>{
 let count=2,guards=0;const page=new PageAdapter({locator:()=>({count:async()=>count})});
 page.assertSingleEditor=async()=>{guards++;throw Error('SHARED_RESUME_HAS_OTHER_OPEN_EDITORS');};
 await page.ensureGroups([{selector:'.record',count:2,addSelector:'.add'}]);assert.equal(guards,0);
 count=1;await assert.rejects(page.ensureGroups([{selector:'.record',count:2,addSelector:'.add'}]),/SHARED_RESUME/);assert.equal(guards,1);
});
test('browser choice starts empty and main Chrome is limited to the registered host',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'browser-choice-')),env={RECRUITING_WORKSPACE_ROOT:root,RECRUITING_HOST_ID:'codex'};
 try{
  assert.equal((await browserPreferences({action:'initialize'},env)).status,'needs_browser_choice');
  await mkdir(path.join(root,'产品管理'),{recursive:true});await writeFile(path.join(root,'产品管理','Agent浏览器兜底登记.json'),JSON.stringify({schemaVersion:1,agents:[{agent:'Codex',hostId:'codex','浏览器':['chrome_main_extension']}]}));
  assert.equal((await browserPreferences({action:'set',choice:'main',quote:'用主用Chrome'},env)).allowed,true);
  assert.equal((await browserPreferences({}, {...env,RECRUITING_HOST_ID:'other'})).allowed,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('hook readiness uses a receipt from this conversation and only warns if it is absent',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'hook-receipt-')),env={CODEX_THREAD_ID:'this',RECRUITING_WORKFLOW_STATE:root};
 try{
  assert.equal((await hookReceiptStatus(env)).active,false);
  await writeFile(path.join(root,'hook-session-'+createHash('sha256').update('this').digest('hex').slice(0,24)+'.json'),JSON.stringify({receipt:'receipt.json'}));
  await writeFile(path.join(root,'receipt.json'),JSON.stringify({session_id:'other',sha256:'s',route_sha256:'r'}));assert.equal((await hookReceiptStatus(env)).active,false);
  await writeFile(path.join(root,'receipt.json'),JSON.stringify({session_id:'this',turn_id:'turn',event:'PreToolUse',sha256:'s',route_sha256:'r'}));
  const pre=await hookReceiptStatus(env);assert.equal(pre.active,true);assert.deepEqual(pre.verifiedEvents,['PreToolUse']);assert.equal(pre.stopGuardVerified,false);
  await writeFile(path.join(root,'continuation-'+createHash('sha256').update('this\0turn').digest('hex')+'.json'),JSON.stringify({observedEvents:['PostToolUse','Stop']}));
  assert.equal((await hookReceiptStatus(env)).stopGuardVerified,true);
  assert.equal((await withHostCapabilities({conversationId:'this'},()=>hookReceiptStatus({...env,CODEX_THREAD_ID:'old-core'}))).active,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

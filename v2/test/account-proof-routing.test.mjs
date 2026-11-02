import test from 'node:test';import assert from 'node:assert/strict';
import {workflowEnvelope,stageResult} from '../shared/workflow-contract.mjs';
test('missing identity pages route to an agent-owned configured-page opening, not a user login wait',()=>{
 const r=workflowEnvelope({error:'ACCOUNT_PROOF_PAGE_NOT_OPEN'});assert.equal(r.completion.complete,false);assert.equal(r.continuation.owner,'agent');assert.equal(r.continuation.requiresUser,false);assert.ok(r.continuation.nextTools.includes('login_open_identity'));
 const opened=stageResult('login_open_identity',{status:'identity_page_opened'});assert.equal(opened.continuation.owner,'agent');assert.ok(opened.continuation.nextTools.includes('login_inspect'));assert.equal(opened.completion.complete,false);
});

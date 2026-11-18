import test from 'node:test';import assert from 'node:assert/strict';
import {technicalRepairHandoff} from '../shared/workflow-contract.mjs';
test('a verified technical handoff remains unfinished coordination work until repair and original-task resume',()=>{
 const r=technicalRepairHandoff({id:'workflow-handoff-C00001',companyId:'C00001',evidenceId:'actual-error',reasons:['REA_HOST_CAPABILITY_REQUIRED'],conversationId:'actual-chat'});
 assert.equal(r.completion.complete,false);assert.equal(r.continuation.owner,'agent');assert.equal(r.continuation.shouldContinue,true);assert.equal(r.continuation.requiresUser,false);
 assert.equal(r.continuation.repairOwner,'supervisor');assert.equal(r.repair.status,'pending_dispatch');assert.equal(r.repair.resumeAfterRepair,true);assert.deepEqual(r.continuation.nextTools,['run_status']);
 assert.equal(r.repair.sourceConversationId,'actual-chat');assert.equal(r.submission,'not_performed');
});

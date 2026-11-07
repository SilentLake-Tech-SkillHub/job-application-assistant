import test from 'node:test';import assert from 'node:assert/strict';
import {workflowEnvelope} from '../shared/workflow-contract.mjs';
test('lost login requires user login and continues through unified entry',()=>{const r=workflowEnvelope({error:'LOGIN_SESSION_REQUIRED'});assert.equal(r.continuation.owner,'user');assert.equal(r.continuation.requiresUser,true);assert.deepEqual(r.continuation.nextTools,['role_advance']);});
test('unavailable browser routes to configuration rather than template acquisition',()=>{const r=workflowEnvelope({error:'BROWSER_EXECUTOR_IDENTITY_REQUIRED'});assert.equal(r.continuation.state,'environment');assert.deepEqual(r.continuation.nextTools,['browser_status']);});

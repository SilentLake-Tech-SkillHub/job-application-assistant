import test from 'node:test';import assert from 'node:assert/strict';
import {callerContextSchema,splitCallerContext} from '../shared/caller-context.mjs';
test('optional Hook chat context preserves each operation contract',()=>{
 const original={name:'example',inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}};
 const exposed=callerContextSchema(original);assert.deepEqual(exposed.inputSchema.required,['value']);assert.equal(exposed.inputSchema.additionalProperties,false);assert.equal(exposed.inputSchema.properties.conversationId.maxLength,200);assert.equal(original.inputSchema.properties.conversationId,undefined);
});
test('Hook chat context is stripped from business arguments and never carried to another call',()=>{
 assert.deepEqual(splitCallerContext({value:1,conversationId:'actual-chat'}),{args:{value:1},capabilities:{conversationId:'actual-chat'}});
 assert.deepEqual(splitCallerContext({value:2}),{args:{value:2},capabilities:{}});
 assert.deepEqual(splitCallerContext({conversationId:{forged:true}}),{args:{},capabilities:{}});
});

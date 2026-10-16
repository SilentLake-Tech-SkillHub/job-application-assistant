import test from 'node:test';import assert from 'node:assert/strict';
import{sharedRecordKey,assertIndependentDrafts}from'../shared/shared-record.mjs';
test('different role tabs sharing one observed resume cannot become parallel writers',()=>{
 const a='https://example.test/resumeOperation.html?resumeId=record&pid=a',b='https://example.test/resumeOperation.html?pid=b&resumeId=record';
 assert.equal(sharedRecordKey(a),sharedRecordKey(b));assert.throws(()=>assertIndependentDrafts([{pageUrl:a},{pageUrl:b}]),/SHARED_RESUME_REQUIRES_SINGLE_WRITER/);
 assert.doesNotThrow(()=>assertIndependentDrafts([{pageUrl:a},{pageUrl:b.replace('record','other')}]));
 assert.doesNotThrow(()=>assertIndependentDrafts([{pageUrl:'https://example.test/resume/1/apply'},{pageUrl:'https://example.test/resume/2/apply'}]));
 assert.doesNotMatch(sharedRecordKey(a),/record/);
});

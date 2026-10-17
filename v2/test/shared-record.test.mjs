import test from 'node:test';import assert from 'node:assert/strict';
import{sharedRecordKey,assertIndependentDrafts}from'../shared/shared-record.mjs';
import{PageAdapter}from'../shared/ui-page.mjs';
test('different role tabs sharing one observed resume cannot become parallel writers',()=>{
 const a='https://example.test/resumeOperation.html?resumeId=record&pid=a',b='https://example.test/resumeOperation.html?pid=b&resumeId=record';
 assert.equal(sharedRecordKey(a),sharedRecordKey(b));assert.throws(()=>assertIndependentDrafts([{pageUrl:a},{pageUrl:b}]),/SHARED_RESUME_REQUIRES_SINGLE_WRITER/);
 assert.doesNotThrow(()=>assertIndependentDrafts([{pageUrl:a},{pageUrl:b.replace('record','other')}]));
 assert.doesNotThrow(()=>assertIndependentDrafts([{pageUrl:'https://example.test/resume/1/apply'},{pageUrl:'https://example.test/resume/2/apply'}]));
 assert.doesNotMatch(sharedRecordKey(a),/record/);
});
test('even one scheduled writer cannot write while a stale autosaving editor of that record is open',async()=>{
 const own={url:()=> 'https://example.test/editor?resumeId=one&pid=a'},stale={url:()=> 'https://example.test/editor?resumeId=one&pid=b',isClosed:()=>false};own.context=()=>({pages:()=>[own,stale]});const p=new PageAdapter(own);
 await assert.rejects(p.act({method:'fill',selector:'#name'},'example',{}),/SHARED_RESUME_HAS_OTHER_OPEN_EDITORS/);
 await assert.rejects(p.ensureGroups([{count:2}]),/SHARED_RESUME_HAS_OTHER_OPEN_EDITORS/);
 stale.url=()=> 'https://example.test/editor?resumeId=other';await assert.doesNotReject(p.assertSingleEditor());
});

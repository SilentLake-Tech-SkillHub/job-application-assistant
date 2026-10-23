import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {safeControlErrorDetails} from '../shared/control-error-details.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const valid=()=>({phase:'after_blur',expectedValueHash:hash('expected synthetic'),observedValueHash:hash('observed synthetic'),valueMatches:false,readbackAvailable:true});
test('only complete typed control diagnostics survive and the output is a detached allowlist object',()=>{
 for(const phase of ['after_option_click','after_blur','independent_verify']){const input={...valid(),phase},r=safeControlErrorDetails(input);assert.deepEqual(r,input);assert.notEqual(r,input);assert.deepEqual(Object.keys(r),['phase','expectedValueHash','observedValueHash','valueMatches','readbackAvailable']);}
 assert.deepEqual(safeControlErrorDetails({...valid(),readbackAvailable:false,observedValueHash:null}),{...valid(),readbackAvailable:false,observedValueHash:null});
});
test('raw values, URLs, unexpected keys and unsafe schema are rejected as a whole',()=>{
 const secret='private-control-value',url='https://private.invalid/form?secret=value';
 const bad=[null,[],new Error(secret),{...valid(),value:secret},{...valid(),url},{...valid(),context:{secret}},
  {...valid(),phase:'unexpected'},{...valid(),expectedValueHash:secret},{...valid(),observedValueHash:url},
  {...valid(),valueMatches:'false'},{...valid(),readbackAvailable:1},{...valid(),observedValueHash:null},
  {...valid(),readbackAvailable:false},{...valid(),expectedValueHash:'a'.repeat(63)},Object.create(valid())];
 const incomplete=valid();delete incomplete.phase;bad.push(incomplete);
 for(const input of bad)assert.equal(safeControlErrorDetails(input),null);
});
test('accessors and symbol keys cannot execute or slip through the diagnostic schema',()=>{
 let read=false;const getter={...valid()};Object.defineProperty(getter,'phase',{enumerable:true,get(){read=true;return 'after_blur';}});assert.equal(safeControlErrorDetails(getter),null);assert.equal(read,false);
 assert.equal(safeControlErrorDetails({...valid(),[Symbol('raw')]: 'secret'}),null);
 assert.equal(safeControlErrorDetails(new Proxy({}, {getPrototypeOf(){throw Error('private metadata');}})),null);
 assert.deepEqual(safeControlErrorDetails(Object.assign(Object.create(null),valid())),valid());
});
test('candidate resolution accepts exactly its eight fields including bounded integer counts',()=>{
 const payload={...valid(),phase:'candidate_resolution',candidateCount:3,exactCandidateCount:1,visibleTargetCount:0};assert.deepEqual(safeControlErrorDetails(payload),payload);
 for(const count of [0,1000]){const edge={...payload,candidateCount:count,exactCandidateCount:count,visibleTargetCount:count};assert.deepEqual(safeControlErrorDetails(edge),edge);}
 for(const key of ['candidateCount','exactCandidateCount','visibleTargetCount']){
  for(const bad of [-1,1001,1.5,'1',NaN,Infinity,undefined,null,true])assert.equal(safeControlErrorDetails({...payload,[key]:bad}),null);
  const missing={...payload};delete missing[key];assert.equal(safeControlErrorDetails(missing),null);
 }
});
test('candidate counts are phase-specific and do not permit raw values, URLs or accessors',()=>{
 const counts={candidateCount:3,exactCandidateCount:1,visibleTargetCount:0},payload={...valid(),phase:'candidate_resolution',...counts};
 assert.equal(safeControlErrorDetails({...valid(),phase:'candidate_resolution'}),null);
 for(const phase of ['after_option_click','after_blur','independent_verify'])assert.equal(safeControlErrorDetails({...valid(),phase,...counts}),null);
 assert.equal(safeControlErrorDetails({...payload,rawValue:'private-original'}),null);assert.equal(safeControlErrorDetails({...payload,url:'https://private.invalid/'}),null);
 let read=false;const getter={...payload};Object.defineProperty(getter,'candidateCount',{enumerable:true,get(){read=true;return 3;}});assert.equal(safeControlErrorDetails(getter),null);assert.equal(read,false);
});

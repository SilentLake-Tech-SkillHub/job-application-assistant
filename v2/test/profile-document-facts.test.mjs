import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {recordProfileDocumentFacts} from '../shared/profile-document-facts.mjs';
const bytes=Buffer.from('synthetic reviewed certificate'),sha256=createHash('sha256').update(bytes).digest('hex');
const io={realpath:async p=>p,stat:async()=>({isFile:()=>true,size:bytes.length}),readFile:async()=>bytes};
const profile=()=>({schemaVersion:1,entities:{},sources:{},facts:{'award.date':{status:'missing',value:null,sourceIds:[],precision:'day',reason:'missing'}},fieldRegistry:{'award.date':{canonicalType:'string',precision:'day'}}});
const args={filePath:'/synthetic/certificate.jpg',sha256,excerpt:'Certificate date: 2020-11-01',evidence:'Reviewed original supplied certificate; filename is not award evidence',facts:[{factKey:'award.date',status:'known',value:'2020-11-01'}]};
test('restored facts retain checksum and exact primary-document provenance without a fabricated user reply',async()=>{
 const p=profile(),r=await recordProfileDocumentFacts(p,args,io),source=p.sources[r.sourceId];
 assert.equal(p.facts['award.date'].value,'2020-11-01');assert.equal(p.facts['award.date'].reason,undefined);assert.equal(source.kind,'primary_document');assert.equal(source.sha256,sha256);assert.equal(source.excerpt,args.excerpt);assert.equal(Object.keys(p.sources).length,1);assert.deepEqual(p.facts['award.date'].sourceIds,[r.sourceId]);
 const again=await recordProfileDocumentFacts(p,args,io);assert.equal(again.sourceId,r.sourceId);assert.equal(Object.keys(p.sources).length,1);assert.equal(p.facts['award.date'].history,undefined);
});
test('changed files, unregistered facts, missing precision and secret fields cannot mutate the profile',async()=>{
 for(const input of [{...args,sha256:'0'.repeat(64)},{...args,facts:[{factKey:'other',status:'known',value:'x'}]},{...args,facts:[{factKey:'award.date',status:'known',value:'2020'}]},{...args,facts:[{factKey:'contact.password',status:'known',value:'x'}]}]){
  const p=profile(),before=structuredClone(p);await assert.rejects(recordProfileDocumentFacts(p,input,io));assert.deepEqual(p,before);
 }
});
test('a document cannot invent a user omission or use a relative unsupported or empty document',async()=>{
 for(const input of [{...args,filePath:'relative.jpg'},{...args,filePath:'/synthetic/secret.json'},{...args,excerpt:''},{...args,facts:[{factKey:'award.date',status:'not_applicable',omissionKind:'user_declined'}]}]){
  const p=profile();await assert.rejects(recordProfileDocumentFacts(p,input,io));assert.equal(p.facts['award.date'].status,'missing');
 }
 await assert.rejects(recordProfileDocumentFacts(profile(),args,{...io,stat:async()=>({isFile:()=>true,size:0})}),/SIZE_INVALID/);
});

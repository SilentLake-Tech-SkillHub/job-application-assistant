import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {uploadWithOrigin,uploadArtifactBindings,uploadOriginMatches} from '../shared/upload-origin.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('an upload receipt requires approved source bytes, success and an actual file identity',async()=>{
 const source=Buffer.from('approved source'),page=new EventEmitter(),req={method:()=> 'POST',url:()=> 'https://files.example.test/upload',postDataBuffer:()=>Buffer.concat([Buffer.from('boundary'),source])};
 const input={setInputFiles:async paths=>{assert.deepEqual(paths,['/source.jpg']);page.emit('request',req);page.emit('response',{request:()=>req,ok:()=>true,status:()=>200,json:async()=>({fileName:'photo.jpeg',id:'artifact_12345678',url:'https://files.example.test/artifact_12345678/photo.jpeg?signature=private'})});}};
 const receipt=await uploadWithOrigin(page,input,{paths:['/source.jpg'],sha256:[sha(source)]},[source],{timeoutMs:20});
 assert.equal(receipt.status,'verified');assert.equal(receipt.sourceSha256,sha(source));assert.equal(page.listenerCount('request'),0);assert.equal(page.listenerCount('response'),0);
 assert.equal(JSON.stringify(receipt).includes('signature'),false);
 assert.equal(uploadOriginMatches(receipt,'https://files.example.test/artifact_12345678/photo.jpeg'),true);
 assert.equal(uploadOriginMatches(receipt,'https://files.example.test/download?fileId=artifact_12345678'),true);
 assert.equal(uploadOriginMatches(receipt,'https://files.example.test/other/photo.jpeg'),false);
});
test('a request without approved bytes cannot attest a server-side transform',async()=>{
 const source=Buffer.from('approved'),page=new EventEmitter(),req={method:()=> 'POST',url:()=> 'https://files.example.test/upload',postDataBuffer:()=>Buffer.from('other source')};
 const result=await uploadWithOrigin(page,{setInputFiles:async()=>{page.emit('request',req);page.emit('response',{request:()=>req,ok:()=>true,status:()=>200,json:async()=>({fileName:'x.jpg',id:'artifact_12345678'})});}},{paths:['/source.jpg'],sha256:[sha(source)]},[source],{timeoutMs:10});
 assert.equal(result.status,'unverified');assert.equal(uploadOriginMatches(result,'https://files.example.test/download?fileId=artifact_12345678'),false);
});
test('artifact binding extraction omits secrets and unrelated generic IDs',()=>{
 const result=uploadArtifactBindings({id:'applicant_12345678',token:'secret_12345678',profile:{userId:'user_12345678'},file:{fileName:'x.jpg',id:'file_12345678'},fileUrl:'https://files.example.test/actual/x.jpg?token=secret'});
 assert.deepEqual(result.fileIds,['file_12345678']);assert.deepEqual(result.resourcePaths,['https://files.example.test/actual/x.jpg']);assert.equal(JSON.stringify(result).includes('secret'),false);
});

import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {Store} from '../shared/engine.mjs';import {saveSearchableCommit,verifySearchableCommits,attachSearchableCommits} from '../shared/searchable-commit.mjs';
import {verifyForm} from '../shared/verifier.mjs';
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'searchable-commit-'));try{await fn(new Store(root));}finally{await rm(root,{recursive:true,force:true});}}
const task={companyId:'sample',roleId:'role',pageUrl:'https://example.test/form',templateHash:'template',values:{school:'Example University'}},field={id:'school',source:'school',value:'Example University',control:{type:'searchable_text'},actions:[{method:'phoenix_autocomplete',selector:'#school'}]},plan={fields:[field]};
const selectedRead=(id='school-id')=>({value:field.value,blurConfirmed:true,readbackStable:true,warning:null,websiteId:{value:id,attribute:'data-entity-id'},currentSelection:{verified:true,kind:'entity_id',label:field.value,value:id,websiteId:{value:id,attribute:'data-entity-id'}}});
const proof=()=>({searchableCommit:{mode:'actual_option_click',optionClicked:true,optionLabel:field.value,optionValue:'school-id',...selectedRead()}});
const customRead=()=>({value:field.value,blurConfirmed:true,readbackStable:true,websiteId:null,warning:'Portal explicitly accepts this typed value',customAcceptance:{verified:true,label:field.value,websiteEvidence:'Portal explicitly accepts this typed value'}});
const customProof=()=>({searchableCommit:{mode:'explicit_custom_value',optionClicked:false,optionLabel:field.value,optionValue:null,customValueEvidence:'Portal explicitly accepts this typed value',...customRead()}});
test('matching input and an old click receipt cannot substitute for current selection proof',()=>fixture(async store=>{
 await assert.rejects(saveSearchableCommit(store,task,field,{searchableCommit:{...proof().searchableCommit,currentSelection:undefined,websiteId:null}}),/CURRENT_SELECTION_PROOF_REQUIRED/);
 await saveSearchableCommit(store,task,field,proof());
 const r=await verifySearchableCommits({store,task,plan,page:{act:async()=>({value:field.value,blurConfirmed:true,readbackStable:true})}});assert.equal(r.school.reason,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');
 await assert.rejects(saveSearchableCommit(store,task,field,{searchableCommit:{...proof().searchableCommit,optionClicked:false}}),/ACTION_PROOF_REQUIRED/);
}));
test('independent verification checks current entity, frozen mode and source binding',()=>fixture(async store=>{
 await saveSearchableCommit(store,task,field,proof());let called;
 const page={act:async action=>{called=action;return selectedRead();}};
 assert.equal((await verifySearchableCommits({store,task,plan,page})).school.status,'verified');assert.equal(called.expectedCommitMode,'actual_option_click');assert.equal(called.expectedOptionValue,'school-id');
 page.act=async()=>selectedRead('other-id');assert.equal((await verifySearchableCommits({store,task,plan,page})).school.reason,'AUTOCOMPLETE_SELECTED_ID_MISMATCH');
 assert.equal((await verifySearchableCommits({store,task:{...task,templateHash:'changed'},plan,page})).school.reason,'SEARCHABLE_COMMIT_SOURCE_CHANGED');
}));
test('current selected marker can prove selection when no entity ID is exposed',()=>fixture(async store=>{
 const read={value:field.value,blurConfirmed:true,readbackStable:true,warning:null,websiteId:null,currentSelection:{verified:true,kind:'selected_option',selected:true,label:field.value,value:null}},saved={searchableCommit:{mode:'actual_option_click',optionClicked:true,optionLabel:field.value,optionValue:null,...read}};
 await saveSearchableCommit(store,task,field,saved);const page={act:async()=>read};assert.equal((await verifySearchableCommits({store,task,plan,page})).school.status,'verified');
 page.act=async()=>({...read,currentSelection:{...read.currentSelection,selected:false}});assert.equal((await verifySearchableCommits({store,task,plan,page})).school.status,'failed');
}));
test('custom text needs current explicit acceptance again, not an old warning or empty search',()=>fixture(async store=>{
 await saveSearchableCommit(store,task,field,customProof());const page={act:async()=>customRead()};assert.equal((await verifySearchableCommits({store,task,plan,page})).school.status,'verified');
 for(const read of [{...customRead(),customAcceptance:undefined},{...customRead(),warning:null},{...customRead(),websiteId:{value:'stale'}}]){page.act=async()=>read;assert.equal((await verifySearchableCommits({store,task,plan,page})).school.reason,'AUTOCOMPLETE_CURRENT_CUSTOM_ACCEPTANCE_REQUIRED');}
}));
test('a lost entity during independent verification retains safe phase diagnostics while staying failed',()=>fixture(async store=>{
 await saveSearchableCommit(store,task,field,proof());
 const digest=value=>createHash('sha256').update(value).digest('hex'),safe={phase:'independent_verify',expectedValueHash:digest(field.value),observedValueHash:digest(field.value),valueMatches:true,readbackAvailable:true};
 const page={act:async action=>{assert.equal(action.method,'phoenix_autocomplete_verify');throw Object.assign(Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED'),{details:safe});}};
 const result=await verifySearchableCommits({store,task,plan,page});assert.equal(result.school.status,'failed');assert.equal(result.school.reason,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');assert.deepEqual(result.school.errorDetails,safe);assert.notEqual(result.school.errorDetails,safe);
 // Equal text/hashes explain the failure; they never release the entity gate.
 assert.equal(result.school.errorDetails.valueMatches,true);assert.equal(result.school.currentSelection,undefined);
 const observation=attachSearchableCommits({source:'live_dom',readAt:new Date().toISOString(),pageUrl:task.pageUrl,roleTitle:'Example Role',inventoryIds:['school'],fields:{school:{present:true,value:field.value}}},result);assert.deepEqual(observation.fields.school.searchableCommitProof.errorDetails,safe);
 const verified=verifyForm({pageUrl:task.pageUrl,roleTitle:'Example Role',fields:[{id:'school',kind:'text',label:'School',value:field.value,required:true,searchableCommitRequired:true}]},observation),check=verified.checks.find(c=>c.id==='school');
 assert.equal(verified.status,'needs_attention');assert.equal(check.status,'mismatch');assert.equal(check.reason,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');assert.deepEqual(check.errorDetails,safe);assert.equal(check.errorDetails.phase,'independent_verify');
 assert.equal(JSON.stringify(result).includes(field.value),false);
}));
test('final verification rejects malicious proof diagnostics without changing entity failure verdict',()=>{
 const digest=value=>createHash('sha256').update(value).digest('hex'),malicious={phase:'independent_verify',expectedValueHash:digest('expected'),observedValueHash:null,valueMatches:false,readbackAvailable:false,rawValue:'synthetic-private-original',url:'https://private.invalid/'};
 const observed={source:'live_dom',readAt:new Date().toISOString(),pageUrl:task.pageUrl,roleTitle:'Example Role',inventoryIds:['school'],fields:{school:{present:true,value:field.value,searchableCommitProof:{status:'failed',reason:'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED',errorDetails:malicious}}}};
 const result=verifyForm({pageUrl:task.pageUrl,roleTitle:'Example Role',fields:[{id:'school',kind:'text',label:'School',value:field.value,required:true,searchableCommitRequired:true}]},observed),check=result.checks.find(c=>c.id==='school');
 assert.equal(result.status,'needs_attention');assert.equal(check.status,'mismatch');assert.equal(check.reason,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');assert.equal(check.errorDetails,undefined);assert.equal(JSON.stringify(result).includes('synthetic-private-original'),false);assert.equal(JSON.stringify(result).includes('https://private.invalid/'),false);
});
test('independent verification drops unsafe exception details without changing the failure reason',()=>fixture(async store=>{
 await saveSearchableCommit(store,task,field,proof());const digest=value=>createHash('sha256').update(value).digest('hex'),safe={phase:'independent_verify',expectedValueHash:digest('expected'),observedValueHash:null,valueMatches:false,readbackAvailable:false};
 const page={act:async()=>{throw Object.assign(Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED'),{details:{...safe,rawValue:'synthetic-private-original',url:'https://private.invalid/'}});}};
 const result=await verifySearchableCommits({store,task,plan,page});assert.equal(result.school.status,'failed');assert.equal(result.school.reason,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');assert.equal(result.school.errorDetails,undefined);assert.equal(JSON.stringify(result).includes('synthetic-private-original'),false);
}));

import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../shared/engine.mjs';import {saveSearchableCommit,verifySearchableCommits} from '../shared/searchable-commit.mjs';
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

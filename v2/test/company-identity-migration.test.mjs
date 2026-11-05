import test from 'node:test';import assert from 'node:assert/strict';
import {identityTransform,mergeCompanyForms} from '../scripts/migrate-company-assets.mjs';
const identities=new Map([['S0001','C00001'],['F000001','C00001'],['F000002','C00001']]);
const assets=new Map([['capture-F000001','capture-C00001']]);
test('migration changes ownership metadata without rewriting personal facts or actual control values',()=>{
 const input={companyId:'S0001',formId:'F000001',captureId:'capture-F000001',facts:{literal:{value:'S0001'}},sources:{original:{evidence:'F000001'}},controls:[{id:'F000001',value:'S0001'}],actions:[{method:'select',value:'S0001'}],rawEvidence:{companyId:'S0001'}};
 const result=identityTransform(input,{identities,assets});
 assert.equal(result.companyId,'C00001');assert.equal(result.formId,'C00001');assert.equal(result.captureId,'capture-C00001');
 for(const key of ['facts','sources','controls','actions','rawEvidence'])assert.deepEqual(result[key],input[key]);
 assert.equal(input.companyId,'S0001');
});
test('one bound form keeps its contract and inherits inactive observations without losing confirmed material exceptions',()=>{
 const profile={schemaVersion:1,facts:{name:{status:'known',value:'Original'}},sources:{s:{kind:'user_reply',evidence:'original'}},entities:{},formCodeSequence:2,companyForms:{
  F000001:{formId:'F000001',companyId:'S0001',companyCode:'C00001',pageUrl:'https://company.test/form',mappings:{current:{factKey:'name',active:true}},executionContract:{templateHash:'known'}},
  F000002:{formId:'F000002',companyId:'S0001',companyCode:'C00001',pageUrl:'https://company.test/login',mappings:{aux:{factKey:'phone',active:true,coverageRequired:true}}}
 },applicationDispositions:{S0001:{roleMaterials:{original:{companyId:'S0001',key:'referralCode',sourceId:'s',kind:'user_confirmed_no_destination'}}}}};
 const result=mergeCompanyForms(profile,new Map([['C00001','F000001']]),identities,assets).profile;
 assert.deepEqual(Object.keys(result.companyForms),['C00001']);assert.equal(result.formCodeSequence,undefined);
 assert.deepEqual(result.companyForms.C00001.executionContract,{templateHash:'known'});
 assert.equal(result.companyForms.C00001.mappings.aux.active,false);assert.equal(result.companyForms.C00001.mappings.aux.coverageRequired,false);
 assert.equal(result.applicationDispositions.C00001.roleMaterials.original.companyId,'C00001');
 assert.deepEqual(result.facts,profile.facts);assert.deepEqual(result.sources,profile.sources);assert.deepEqual(result.entities,profile.entities);
});
test('two independently built company forms cannot be silently selected during migration',()=>{
 const form=id=>({formId:id,companyId:'S0001',companyCode:'C00001',mappings:{},executionContract:{templateId:id}});
 assert.throws(()=>mergeCompanyForms({facts:{},sources:{},entities:{},companyForms:{F000001:form('F000001'),F000002:form('F000002')}},new Map(),identities,assets),/MIGRATION_FORM_OWNER_AMBIGUOUS/);
});

import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,access} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {applyCompanyMigration,rollbackCompanyMigration} from '../scripts/migrate-company-assets.mjs';
const sourceRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function migrationWorkspace(fn){
 const base=await mkdtemp(path.join(os.tmpdir(),'company-migration-')),workspace=path.join(base,'workspace'),journal=path.join(base,'journal');
 await Promise.all(['产品管理','岗位交接/公司','.runtime/application/templates','.runtime/role-queue'].map(p=>mkdir(path.join(workspace,p),{recursive:true})));
 const profile={schemaVersion:1,facts:{literal:{value:'S0001',status:'known',sourceIds:['s']}},sources:{s:{kind:'fixture',evidence:'F000001'}},entities:{},companyForms:{F000001:{formId:'F000001',companyId:'S0001',companyCode:'C00001',pageUrl:'https://example.test/form',mappings:{}}}};
 const profileFile=path.join(workspace,'产品管理/网申个人信息主档.json');await writeFile(profileFile,JSON.stringify(profile));
 await writeFile(path.join(workspace,'岗位交接/公司/C00001.json'),JSON.stringify({'公司编码':'C00001','公司名称':'Fixture','站点':[{'站点编码':'S0001','站点':'https://example.test'}],'岗位':[],'批次':{'选中岗位':[]}}));
 await writeFile(path.join(workspace,'.runtime/application/templates/company-bindings.json'),JSON.stringify({S0001:'F000001'}));
 await writeFile(path.join(workspace,'.runtime/application/templates/F000001.json'),JSON.stringify({id:'F000001',version:1,evidence:{formId:'F000001',sourceUrl:'https://example.test/form'},pages:[],coverage:{}}));
 try{await fn({workspace,journal,profile,profileFile});}finally{await chmod(path.join(workspace,'产品管理'),0o700);await rm(base,{recursive:true,force:true});}
}
test('one-time writer reads back canonical files and preserves original facts, sources and old evidence',()=>migrationWorkspace(async({workspace,journal,profile,profileFile})=>{
 const result=await applyCompanyMigration(workspace,{journalDir:journal,baselineSource:sourceRoot});
 assert.equal(result.applied,true);assert.equal(result.oldAssetsDeleted,false);
 const saved=JSON.parse(await readFile(profileFile,'utf8'));assert.deepEqual(saved.facts,profile.facts);assert.deepEqual(saved.sources,profile.sources);
 assert.deepEqual(Object.keys(saved.companyForms),['C00001']);
 const directory=path.join(workspace,'.runtime/application/templates');await access(path.join(directory,'F000001.json'));
 assert.equal(JSON.parse(await readFile(path.join(directory,'C00001.json'),'utf8')).id,'C00001');
 assert.equal(JSON.parse(await readFile(path.join(journal,'transaction.json'),'utf8')).status,'applied_pending_final_acceptance');
}));
test('real profile write failure rolls back already-created canonical assets',{skip:process.platform==='win32'||process.getuid?.()===0},()=>migrationWorkspace(async({workspace,journal,profileFile})=>{
 const before=await readFile(profileFile,'utf8');await chmod(path.dirname(profileFile),0o500);
 await assert.rejects(applyCompanyMigration(workspace,{journalDir:journal,baselineSource:sourceRoot}),e=>['EACCES','EPERM'].includes(e.code));
 assert.equal(await readFile(profileFile,'utf8'),before);
 await assert.rejects(access(path.join(workspace,'.runtime/application/templates/C00001.json')),{code:'ENOENT'});
 assert.equal(JSON.parse(await readFile(path.join(journal,'transaction.json'),'utf8')).status,'rolled_back');
}));

test('a live execution registration expressed in seconds stops migration before writes',()=>migrationWorkspace(async({workspace,journal,profileFile})=>{
 const before=await readFile(profileFile,'utf8');const hooks=path.join(workspace,'.codex/hooks');await mkdir(hooks,{recursive:true});
 await writeFile(path.join(hooks,'scope.json'),JSON.stringify({sessions:{another:{expiresAt:Date.now()/1000+3600}},session_ids:[]}));
 await assert.rejects(applyCompanyMigration(workspace,{journalDir:journal,baselineSource:sourceRoot}),/MIGRATION_REQUIRES_PAUSED_EXECUTION/);
 assert.equal(await readFile(profileFile,'utf8'),before);await assert.rejects(access(journal),{code:'ENOENT'});
}));

test('explicit rollback restores original identity data and removes only migration-created files',()=>migrationWorkspace(async({workspace,journal,profile,profileFile})=>{
 await applyCompanyMigration(workspace,{journalDir:journal,baselineSource:sourceRoot});
 const result=await rollbackCompanyMigration(workspace,{journalDir:journal});assert.equal(result.rolledBack,true);
 assert.deepEqual(JSON.parse(await readFile(profileFile,'utf8')),profile);
 await assert.rejects(access(path.join(workspace,'.runtime/application/templates/C00001.json')),{code:'ENOENT'});
 await access(path.join(workspace,'.runtime/application/templates/F000001.json'));
}));

test('a prepared journal can recover a stop after asset creation but before profile replacement',()=>migrationWorkspace(async({workspace,journal,profile,profileFile})=>{
 await applyCompanyMigration(workspace,{journalDir:journal,baselineSource:sourceRoot});
 await writeFile(profileFile,JSON.stringify(profile));
 const file=path.join(journal,'transaction.json'),record=JSON.parse(await readFile(file,'utf8'));record.status='prepared';await writeFile(file,JSON.stringify(record));
 assert.equal((await rollbackCompanyMigration(workspace,{journalDir:journal})).rolledBack,true);
 assert.deepEqual(JSON.parse(await readFile(profileFile,'utf8')),profile);
 await assert.rejects(access(path.join(workspace,'.runtime/application/templates/C00001.json')),{code:'ENOENT'});
}));

import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {registerObservedQuestions,mapProfileQuestions} from '../shared/profile.mjs';
import {Store,hash} from '../shared/engine.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('actual application MCP reports new runtime and missing company form routes offline to acquisition', {timeout:10000},async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'application-protocol-'));const profile=path.join(d,'profile.json');await writeFile(profile,JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}}));
 const companyId='protocol-fixture',origin='https://application.example',pageUrl=origin+'/campus/resume/123/apply';
 const handoff=path.join(d,'handoff'),firm=path.join(handoff,'公司','测试地区','测试公司');await mkdir(firm,{recursive:true});
 await writeFile(path.join(firm,'公司.json'),JSON.stringify({schemaVersion:2,companyId,'公司':'测试公司','地区':'测试地区',origins:[origin],roles:[]}));
 const c=new Client({name:'application-repair-regression',version:'1'});
 try{await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'application/server.mjs')],cwd:d,env:{PATH:process.env.PATH,RECRUITING_HANDOFF_DIR:handoff,RECRUITING_PROFILE_JSON:profile,RECRUITING_PRIVATE_DIR:path.join(d,'application'),RECRUITING_ROLE_QUEUE_DIR:path.join(d,'queue'),RECRUITING_BROWSER_SOCKET:path.join(d,'absent.sock')},stderr:'pipe'}));
 const names=(await c.listTools()).tools.map(t=>t.name);for(const name of ['runtime_info','workflow_next','template_rebind_role','application_closeout','capture_form_definition','inspect_choice'])assert.ok(names.includes(name));
 const call=async(name,args={})=>{const r=await c.callTool({name,arguments:args},undefined,{timeout:3000}),data=JSON.parse(r.content[0].text);assert.notEqual(r.isError,true,`${name}: ${data.error||'MCP error'}`);return data;};
 const info=await call('runtime_info');assert.equal(info.version,'2.0.0-alpha.7');assert.equal(info.compilerVersion,3);assert.equal(info.pipelineRevision,'rea-contract-5');assert.ok(info.capabilities.includes('choice_resolution_pending_diagnostics'));
 const unknown=await c.callTool({name:'workflow_next',arguments:{companyId:'absent-company',pageUrl}},undefined,{timeout:3000});assert.equal(unknown.isError,true);const failure=JSON.parse(unknown.content[0].text);assert.equal(failure.error,'COMPANY_ORIGIN_MISMATCH');assert.equal(failure.continuation.owner,'agent');assert.ok(failure.failureEvidenceId);
 const route=await call('workflow_next',{companyId,pageUrl});assert.equal(route.workflowContract.tracked,true);assert.equal(route.continuation.shouldContinue,true);assert.equal(route.completion.complete,false);assert.equal(route.route,'acquire');assert.equal(route.browserAccess,false);assert.ok(route.nextTools.includes('capture_controls'));
 const template={id:'synthetic-import',version:1,evidence:{sourceUrl:pageUrl,observedAt:'synthetic'},coverage:{allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:true,proof:{runId:'model-authored'}},pages:[{pathPrefix:new URL(pageUrl).pathname,readySelector:'#form',roleSelector:'h1',roleTitle:'Synthetic',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[{id:'name',label:'Name',source:'name',kind:'text',required:false,control:{type:'text',valueType:'string',readbackType:'string'},read:{kind:'value',selector:'#name'},actions:[{method:'fill',selector:'#name'}]}]}]};
 await call('template_register',{companyId,template});
 const gated=await call('workflow_next',{companyId,pageUrl});assert.equal(gated.route,'acquire');assert.equal(gated.reason,'COMPANY_FORM_ASSET_INCOMPLETE');assert.equal(gated.blockers.length,3);
 const privateStore=new Store(path.join(d,'application'));
 await privateStore.put('runs','test-draft',{companyId,template,readyToRegister:true,blockers:[]});
 const draftResult=await call('template_register',{companyId,draftId:'test-draft',draftHash:hash(template)});
 assert.equal(draftResult.templateId,template.id);assert.equal(draftResult.status,'captured_not_live_verified');
 for(const args of [{companyId,draftId:'test-draft',draftHash:'0'.repeat(64)},{companyId,template,draftId:'test-draft',draftHash:hash(template)},{companyId}]){
  const rejected=await c.callTool({name:'template_register',arguments:args},undefined,{timeout:3000});assert.equal(rejected.isError,true);
 }
 const personal=JSON.parse(await readFile(profile,'utf8'));personal.sources.synthetic={kind:'test'};personal.facts.school={status:'known',value:'Alpha University',sourceIds:['synthetic']};
 const registered=registerObservedQuestions(personal,{companyId,pageUrl,observedAt:'synthetic',fields:[{selector:'#school',label:'学校',type:'combobox'}]});
 const questionId=Object.keys(personal.companyForms[registered.pageKey].mappings).find(k=>personal.companyForms[registered.pageKey].mappings[k].selector==='#school');mapProfileQuestions(personal,{companyId,pageUrl,evidence:'synthetic observed school mapping',mappings:[{questionId,factKey:'school'}]});await writeFile(profile,JSON.stringify(personal));
 await privateStore.put('runs','test-choices',{companyId,pageUrl,captureId:'synthetic',choices:[{selector:'#school',status:'captured',restored:true,options:['Alpha University']}]});
 const pending=await call('form_resolve_choices',{companyId,choicesId:'test-choices',resolutions:[{selector:'#missing',factKey:'school'},{selector:'#school',factKey:'wrong'}]});assert.deepEqual(pending.pending.map(p=>p.status),['needs_option_capture','needs_question_mapping']);assert.equal(pending.pending[1].questionId,questionId);assert.equal(pending.continuation.owner,'agent');
 const resolved=await call('form_resolve_choices',{companyId,choicesId:'test-choices',resolutions:[{selector:'#school',factKey:'school'}]});assert.equal(resolved.pending.length,0);assert.equal((await privateStore.get('runs','test-choices')).choices[0].resolutions.school.selectedOption,'Alpha University');
 }finally{await c.close();await rm(d,{recursive:true,force:true});}
});

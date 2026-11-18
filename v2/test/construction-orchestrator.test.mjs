// C33／C34：建库两段编排、Agent 浏览器兜底（组件外登记表）、回放定义与两次失败先兜底。
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {runConstructionBuild,splitMappings,pageFromTemplate,D1_EVIDENCE,D2_EVIDENCE} from '../shared/construction-orchestrator.mjs';
import {loadFallbackRegistry,fallbackSurface,recordedDefinition,fallbackRegistryFile,fallbackEligible} from '../shared/gui-fallback.mjs';
import {validateRecordedSteps,performRecordedSequence} from '../shared/control-operations.mjs';
import {validateControlContract} from '../shared/value-contract.mjs';
import {recordOutcome} from '../shared/stop-loss.mjs';

const registry={schemaVersion:1,'浏览器':{builtin_browser:'Agent 内置浏览器（右侧栏）',chrome_clone_extension:'投递专用 Chrome 分身里安装的 Agent 插件'},agents:[{agent:'Claude Code',hostId:'claude-code','浏览器':['builtin_browser','chrome_clone_extension']},{agent:'Codex',hostId:'codex','浏览器':['builtin_browser','chrome_clone_extension']},{agent:'Kimi',hostId:'kimi','浏览器':['builtin_browser','chrome_clone_extension']}]};

test('D2: only a single candidate with a known fact (or confirmed handoff material) maps automatically',()=>{
 const profile={facts:{'person.name':{status:'known',value:'x'},'edu.major':{status:'missing'}}};
 const {auto,agent}=splitMappings([
  {selector:'#a',label:'姓名',questionId:'q1',candidates:[{factKey:'person.name'}]},
  {selector:'#b',label:'专业',questionId:'q2',candidates:[{factKey:'edu.major'}]},
  {selector:'#c',label:'学校',questionId:'q3',candidates:[{factKey:'edu.school'},{factKey:'edu.school_en'}]},
  {selector:'#d',label:'简历',questionId:'q4',candidates:[{factKey:'material.resume',status:'confirmed_handoff_material'}]},
  {selector:'#e',label:'新题',questionId:null,candidates:[{factKey:'person.name'}]},
  {selector:'#f',label:'已映射',questionId:'q6',currentFactKey:'person.name',candidates:[]},
  {selector:'#g',label:'占位',questionId:'q7',currentFactKey:'unmapped.sample.field',candidates:[{factKey:'person.name'}]}
 ],profile);
 assert.deepEqual(auto,[{questionId:'q1',factKey:'person.name'},{questionId:'q4',factKey:'material.resume'},{questionId:'q7',factKey:'person.name'}]);
 assert.deepEqual(agent.map(a=>[a.selector,a.reason]),[['#b','MULTIPLE_CANDIDATES_OR_FACT_MISSING'],['#c','MULTIPLE_CANDIDATES_OR_FACT_MISSING'],['#e','QUESTION_NOT_REGISTERED']]);
});

test('existing companies reuse the page definition of the formal company template',()=>{
 assert.deepEqual(pageFromTemplate({pages:[{readySelector:'.r',roleSelector:'.t',sections:[{title:'教育'}],sectionDiscovery:{selector:'.s',titleSelector:'.h'},fields:[{id:'x'}],groups:[1]}]}),{roleSelector:'.t',readySelector:'.r',sections:[{title:'教育'}],sectionDiscovery:{selector:'.s',titleSelector:'.h'}});
 assert.equal(pageFromTemplate(null),null);assert.equal(pageFromTemplate({pages:[{readySelector:'.r'}]}),null);
});

// A tiny stand-in for the company construction state machine; every tool call changes it like the real tool would.
function machine({expansions=['e1'],interaction=['verified'],template={pages:[{readySelector:'.r',sections:[{title:'教育'}]}]},candidates=[],fallback={allowed:true,agent:'Codex',surface:'chrome_clone_extension'},buildReady=true,expandStatus='section_expanded'}={}){
 const s={stage:'primary_review',pending:[...expansions],calls:[],interactions:[...interaction],stored:null};
 const deps={
  cycle:async()=>({stage:s.stage,templateHash:'th'}),pendingExpansions:async()=>s.pending,captureSelectors:async()=>['#a','#b'],
  profile:async()=>({facts:{'person.name':{status:'known'}}}),template:async()=>template,update:async()=>s.stored,fallbackSurface:async()=>fallback,
  call:async(tool,args)=>{s.calls.push([tool,args]);
   if(tool==='form_review_completeness'){if(args.primary){s.stage=s.pending.length?'section_expansion':'agent_completeness';return {status:s.pending.length?'needs_section_expansion':'passed'};}s.stage='build';return {status:'passed'};}
   if(tool==='form_expand_sections'){if(expandStatus!=='section_expanded')return {status:'needs_backfill',reason:'SECTION_EXPANSION_FIELDS_NOT_OBSERVED'};s.pending=s.pending.filter(id=>id!==args.entranceId);if(!s.pending.length)s.stage='agent_completeness';return {status:'section_expanded'};}
   if(tool==='form_mapping_candidates')return {candidates};
   if(tool==='profile_map_questions')return {mapped:args.mappings.length};
   if(tool==='form_build_template')return buildReady?{readyToRegister:true,templateId:'C00001',templateHash:'th'}:{readyToRegister:false,pending:[{id:'f1',kind:'answer',label:'期望薪资'}],blockers:[{id:'f1'}]};
   if(tool==='template_register'){s.stage='interaction_test';return {status:'captured_not_live_verified'};}
   if(tool==='form_test_interactions'){const r=s.interactions.shift()||'verified';if(r==='verified'){s.stage='confirm';s.stored={construction:{conditionProbeId:'probe-1',interaction:{status:'verified'}}};return {status:'verified',probeRunId:'probe-1'};}
    const failures=[{id:'school',reason:r}];s.stage='backfill';s.stored={construction:{interaction:{status:'failed',failures}}};return {status:'failed',failures};}
   if(tool==='template_finalize'){s.stage='ready';return {status:'company_template_ready',templateHash:'sealed'};}
   throw Error('UNEXPECTED_TOOL:'+tool);
  }};
 return {s,deps};
}
const task={companyId:'C00001',captureId:'capture-C00001',pageUrl:'https://example.test/apply',queue:{queueId:'q',queueHash:'h',taskId:'t'}},authorization={prepare:true,evidence:'用户授权建库'};
const primary={matches:[{visualId:'v1',reaId:'r1'}],secondary:[]};

test('stage 2 runs pairing, expansion, D1 review, D2 mapping, build, test and confirmation inside the component and returns once',async()=>{
 const {s,deps}=machine({candidates:[{selector:'#a',label:'姓名',questionId:'q1',candidates:[{factKey:'person.name'}]}]});
 const r=await runConstructionBuild({deps,task,authorization,primary,evidence:'Agent 对照截图与 REA 清单'});
 assert.equal(r.status,'company_template_ready');assert.deepEqual(r.nextTools,['role_prepare']);assert.equal(r.submission,'not_performed');
 assert.deepEqual(s.calls.map(([tool])=>tool),['form_review_completeness','form_expand_sections','form_review_completeness','form_mapping_candidates','profile_map_questions','form_build_template','template_register','form_test_interactions','template_finalize']);
 assert.deepEqual(s.calls[0][1].reviewedSelectors,['#a','#b']);assert.equal(s.calls[0][1].evidence,'Agent 对照截图与 REA 清单');
 assert.equal(s.calls[2][1].evidence,D1_EVIDENCE);assert.equal(s.calls[4][1].evidence,D2_EVIDENCE);assert.deepEqual(s.calls[4][1].mappings,[{questionId:'q1',factKey:'person.name'}]);
 assert.equal(s.calls[5][1].page.readySelector,'.r');assert.equal(s.calls[8][1].probeRunId,'probe-1');
 assert.equal(r.records.structure,'form-structure-C00001');assert.equal(r.agentItems.length+r.userItems.length+r.fallbackItems.length,0);
});

test('without the Agent pairing stage 2 does not guess the primary comparison',async()=>{
 const {s,deps}=machine();const r=await runConstructionBuild({deps,task,authorization});
 assert.equal(r.status,'needs_primary_pairs');assert.deepEqual(r.nextTools,['form_construct_acquire']);assert.equal(s.calls.length,0);
});

test('a failed section expansion goes back to acquisition instead of being reviewed by code',async()=>{
 const {deps}=machine({expandStatus:'needs_backfill'});const r=await runConstructionBuild({deps,task,authorization,primary,evidence:'e'});
 assert.equal(r.status,'needs_acquisition');assert.equal(r.reason,'SECTION_EXPANSION_FIELDS_NOT_OBSERVED');
});

test('D3: the same control failing twice for the same reason goes to the registered Agent browser fallback, otherwise to the user',async()=>{
 const allowed=machine({expansions:[],interaction:['CHOICE_TRIGGER_NOT_EXPANDED','CHOICE_TRIGGER_NOT_EXPANDED']});
 const r=await runConstructionBuild({deps:allowed.deps,task,authorization,primary,evidence:'e'});
 assert.equal(r.status,'needs_fallback');assert.deepEqual(r.nextTools,['form_gui_fallback']);assert.deepEqual(r.fallbackItems,[{kind:'control_operation',fieldId:'school',reason:'CHOICE_TRIGGER_NOT_EXPANDED'}]);
 assert.equal(allowed.s.calls.filter(([tool])=>tool==='form_test_interactions').length,2);
 const refused=machine({expansions:[],interaction:['X_FAILED','X_FAILED'],fallback:{allowed:false,reason:'HOST_NOT_IN_FALLBACK_REGISTRY'}});
 const u=await runConstructionBuild({deps:refused.deps,task,authorization,primary,evidence:'e'});
 assert.equal(u.status,'needs_user');assert.equal(u.userItems[0].fieldId,'school');
 const flaky=machine({expansions:[],interaction:['X_FAILED','verified']});
 assert.equal((await runConstructionBuild({deps:flaky.deps,task,authorization,primary,evidence:'e'})).status,'company_template_ready');
});

test('new companies: page definition and unmapped questions come back together; answers go to the user',async()=>{
 const n=machine({expansions:[],template:null,candidates:[{selector:'#c',label:'学校',questionId:'q3',candidates:[{factKey:'a'},{factKey:'b'}]}]});
 const r=await runConstructionBuild({deps:n.deps,task,authorization,primary,evidence:'e'});
 assert.equal(r.status,'needs_agent');assert.deepEqual(r.agentItems.map(i=>i.kind),['question_mapping','page_definition']);
 const a=machine({expansions:[],buildReady:false});
 const u=await runConstructionBuild({deps:a.deps,task,authorization,primary,evidence:'e',page:{readySelector:'.r',sections:['x']}});
 assert.equal(u.status,'needs_user');assert.equal(u.userItems[0].label,'期望薪资');
});

test('fallback registry lives outside the component and is matched by host and page browser',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'fallback-registry-')),file=path.join(d,'登记.json');
 try{
  assert.equal(await loadFallbackRegistry(file),null);
  await writeFile(file,JSON.stringify(registry));const loaded=await loadFallbackRegistry(file);
  assert.equal(fallbackSurface({registry:loaded,hostId:'codex',pageId:'chrome:7'}).allowed,true);
  assert.equal(fallbackSurface({registry:loaded,hostId:'claude-code',pageId:'iab:3'}).surface,'builtin_browser');
  assert.equal(fallbackSurface({registry:loaded,hostId:'dsh',pageId:'chrome:7'}).reason,'HOST_NOT_IN_FALLBACK_REGISTRY');
  assert.equal(fallbackSurface({registry:{...loaded,agents:[{agent:'Codex',hostId:'codex','浏览器':['builtin_browser']}]},hostId:'codex',pageId:'chrome:7'}).reason,'PAGE_BROWSER_NOT_IN_FALLBACK_REGISTRY');
  assert.equal(fallbackSurface({registry:null,hostId:'codex',pageId:'chrome:7'}).reason,'AGENT_FALLBACK_REGISTRY_MISSING');
  await writeFile(file,'{');await assert.rejects(loadFallbackRegistry(file),/AGENT_FALLBACK_REGISTRY_INVALID/);
  assert.equal(fallbackRegistryFile({RECRUITING_WORKSPACE_ROOT:'/ws'}),path.join('/ws','产品管理','Agent浏览器兜底登记.json'));
  assert.equal(fallbackRegistryFile({RECRUITING_AGENT_FALLBACK_REGISTRY:'/x.json',RECRUITING_WORKSPACE_ROOT:'/ws'}),'/x.json');
 }finally{await rm(d,{recursive:true,force:true});}
});

test('a reported Agent operation becomes the field operation definition and passes the control contract',()=>{
 const field={id:'school',label:'学校',kind:'choice',source:'edu.school',control:{type:'dropdown',valueType:'string',readbackType:'string',options:['南洋理工大学','北京大学']},actions:[{method:'scroll',selector:'#school'},{method:'ant_dropdown',selector:'#school',options:['南洋理工大学','北京大学']}],read:{selector:'#school .v',kind:'text'}};
 const steps=[{kind:'click_field'},{kind:'type_value'},{kind:'click_text',text:'南洋理工大学'},{kind:'press',key:'Escape'}];
 const actions=recordedDefinition(field,steps,{agent:'Codex',hostId:'codex',surface:'chrome_clone_extension',at:'t'});
 assert.deepEqual(actions.map(a=>a.method),['scroll','recorded_sequence']);assert.equal(actions[1].selector,'#school');assert.equal(actions[1].recordedBy.agent,'Codex');
 validateControlContract({...field,actions});
 assert.throws(()=>validateRecordedSteps([{kind:'click_text',text:'提交申请'}]),/POTENTIAL_SUBMISSION_BLOCKED/);
 assert.throws(()=>validateRecordedSteps([{kind:'press',key:'Delete'}]),/RECORDED_SEQUENCE_STEP_INVALID/);
 assert.throws(()=>validateRecordedSteps([{kind:'click_field',selector:'#other'}]),/RECORDED_SEQUENCE_STEP_INVALID/);
 assert.throws(()=>validateRecordedSteps([]),/RECORDED_SEQUENCE_STEPS_REQUIRED/);
 assert.equal(fallbackEligible({userOnly:true}),false);assert.equal(fallbackEligible(field),true);
});

test('the recorded sequence replays from the field: field click, value typing, unique option text and keys',async()=>{
 const log=[];let matches=1;
 const page={getByText:(text,{exact})=>({filter:()=>({count:async()=>matches,click:async()=>log.push(['text',text,exact])})}),keyboard:{type:async v=>log.push(['type',v]),press:async k=>log.push(['press',k])}};
 const field={click:async()=>log.push(['field'])};
 const action={method:'recorded_sequence',steps:[{kind:'click_field'},{kind:'type_value'},{kind:'click_text',text:'北京'},{kind:'type_text',text:'朝阳'},{kind:'press',key:'Enter'}]};
 assert.deepEqual(await performRecordedSequence(page,field,action,'北京'),{performed:true,verification:'requires_independent_readback'});
 assert.deepEqual(log,[['field'],['type','北京'],['text','北京',true],['type','朝阳'],['press','Enter']]);
 matches=0;await assert.rejects(performRecordedSequence(page,field,{steps:[{kind:'click_text',text:'上海'}]},null),/ACTION_TARGET_NOT_FOUND/);
 matches=2;await assert.rejects(performRecordedSequence(page,field,{steps:[{kind:'click_text',text:'上海'}]},null),/ACTION_TARGET_NOT_UNIQUE/);
});

test('P14 as changed on 2026-11-14: a repeated failure first offers the registered Agent fallback, then asks the user',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'fallback-stoploss-')),file=path.join(d,'登记.json');
 try{
  await writeFile(file,JSON.stringify(registry));
  const env={RECRUITING_STOP_LOSS_DIR:path.join(d,'stop'),RECRUITING_HOST_ID:'codex',RECRUITING_AGENT_FALLBACK_REGISTRY:file};
  const failed=()=>({status:'needs_attention',continuation:{owner:'agent'},checks:[{id:'school',status:'mismatch',reason:'CHOICE_TRIGGER_NOT_EXPANDED'}]});
  const args={queueId:'q',queueHash:'h',taskId:'task-1'};
  assert.equal((await recordOutcome({tool:'role_prepare',phase:'prepare',args,result:failed(),env})).continuation.owner,'agent');
  const second=await recordOutcome({tool:'role_prepare',phase:'prepare',args,result:failed(),env});
  assert.equal(second.continuation.state,'agent_fallback');assert.deepEqual(second.continuation.nextTools,['form_gui_fallback']);assert.deepEqual(second.continuation.fallback,{context:'fill',fieldIds:['school'],agent:'Codex'});
  const third=await recordOutcome({tool:'role_prepare',phase:'prepare',args,result:failed(),env});
  assert.equal(third.continuation.state,'ask_user');assert.equal(third.continuation.requiresUser,true);
  const other={...env,RECRUITING_STOP_LOSS_DIR:path.join(d,'stop2'),RECRUITING_HOST_ID:'dsh'};
  await recordOutcome({tool:'role_prepare',phase:'prepare',args,result:failed(),env:other});
  assert.equal((await recordOutcome({tool:'role_prepare',phase:'prepare',args,result:failed(),env:other})).continuation.state,'ask_user');
 }finally{await rm(d,{recursive:true,force:true});}
});

test('production evidence: one overwritten record per role, by stage, without personal values; stored as a durable run, not inside task records',async()=>{
 const {recordProductionEvidence,productionEvidenceId}=await import('../shared/production-evidence.mjs');
 const data=new Map(),store={get:async(g,id)=>{if(!data.has(id))throw Object.assign(Error('x'),{code:'ENOENT'});return structuredClone(data.get(id));},put:async(g,id,v)=>{data.set(id,structuredClone(v));}};
 await recordProductionEvidence(store,{roleId:'J000202',companyId:'C00083',stage:'fill',data:{by:'component',verifyRunId:'v1',verification:'verified'},at:'t1'});
 const r=await recordProductionEvidence(store,{roleId:'J000202',companyId:'C00083',stage:'submission',data:{by:'component',event:'submission_confirmed',officialReceipt:true},at:'t2'});
 assert.equal(data.size,1);assert.equal(r.id,'production-J000202');assert.equal(r.fill.verifyRunId,'v1');assert.equal(r.submission.officialReceipt,true);assert.equal(r.updatedAt,'t2');
 assert.throws(()=>productionEvidenceId('x'),/ROLE_CODE_REQUIRED/);await assert.rejects(recordProductionEvidence(store,{roleId:'J000202',companyId:'C00083',stage:'other',data:{}}),/PRODUCTION_STAGE_INVALID/);
 const {TaskRecords,withTaskRecords}=await import('../shared/task-records.mjs');
 const records=new TaskRecords('/nonexistent-root');
 assert.equal(await withTaskRecords({taskId:'00000000-0000-4000-8000-000000000001'},()=>records.put('runs','production-J000202',{companyId:'C00083'})),false);
});

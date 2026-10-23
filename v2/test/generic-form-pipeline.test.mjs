import test from 'node:test';import assert from 'node:assert/strict';
import {buildFormTemplate,mappingCandidates} from '../shared/form-construction.mjs';
import {templateConstructionIssues,verificationSummary} from '../shared/field-policy.mjs';
import {validateTemplate,hash,Store,Engine} from '../shared/engine.mjs';
import {compileExecutionPlan} from '../shared/execution-plan.mjs';
import {verifyForm} from '../shared/verifier.mjs';
import {normalizeReaStructure,bindStructureControls,inspectRea} from '../shared/rea-structure.mjs';
import {continuationFor,advanceCompanies} from '../shared/workflow-continuation.mjs';
import {FormRouter} from '../shared/form-route.mjs';
import {performAntDay} from '../shared/ant-date.mjs';
import {capturedChoiceOptions} from '../shared/form-acquisition.mjs';
const profile={facts:{name:{status:'known',value:'Applicant'},gender:{status:'known',value:'女'},start:{status:'known',value:'2027-06-01'}},fieldRegistry:{name:{label:'姓名'},gender:{label:'性别'},start:{label:'入学时间'}}};
const capture=(companyId,framework)=>({companyId,captureId:'captured',pageUrl:`https://${companyId}.example/form`,observedAt:new Date().toISOString(),controls:[{selector:'#name',label:'姓名',tag:'input',type:'text',required:true,contextProvider:framework},{selector:'#gender',questionSelector:'#gender-wrapper',selectedSelector:'#gender-selected',labelSelector:'#gender-label',label:'性别',tag:'input',type:'combobox',required:true,contextProvider:framework}]});
const page={roleTitle:'Product',roleSelector:'h1',readySelector:'form',sections:[{title:'基本信息'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}};
const mappings=[{selector:'#name',factKey:'name'},{selector:'#gender',factKey:'gender'}];
test('an uncaptured date panel returns the exact acquisition call instead of claiming a missing driver',()=>{
 const c=capture('dates','phoenix');c.provider='phoenix';c.controls=[{selector:'#start',label:'开始时间',renderer:'phoenix_date_picker',type:'combobox',tag:'div',labelSelector:'#label'}];
 const b=buildFormTemplate({capture:c,profile,mappings:[{selector:'#start',factKey:'start'}],page,templateId:'dates'});
 assert.equal(b.readyToRegister,false);assert.ok(b.blockers.some(x=>x.reason==='DATE_OPTIONS_NOT_CAPTURED'));
 assert.equal(b.blockers.some(x=>x.reason==='CONTROL_DRIVER_REQUIRED'),false);assert.deepEqual(b.nextGoals[0].arguments,{companyId:c.companyId,pageUrl:c.pageUrl,captureId:c.captureId,selectors:['#start']});
});
test('a captured autocomplete uses its selection contract and never falls back to plain fill',()=>{
 const c=capture('autocomplete',null);c.controls=[{selector:'#school',label:'学校',type:'combobox',tag:'input',renderer:'phoenix_autocomplete',labelSelector:'#school-label'}];
 const p={facts:{school:{status:'known',value:'Example University'}}},choices=[{selector:'#school',captureId:c.captureId,choicesId:'choices-school',status:'captured',restored:true,options:['Example University']}];
 const b=buildFormTemplate({capture:c,profile:p,mappings:[{selector:'#school',factKey:'school'}],choices,page,templateId:'autocomplete'});
 assert.equal(b.readyToRegister,true);validateTemplate(b.template);assert.equal(b.template.pages[0].fields[0].actions[0].method,'phoenix_autocomplete');
 b.template.pages[0].fields[0].actions=[{method:'fill',selector:'#school'}];assert.throws(()=>validateTemplate(b.template),/CONSTRUCTION_GAPS/);
});
const observedChoices=(c,rows=[{selector:'#gender',status:'captured',restored:true,options:['男','女']}])=>rows.map(row=>({...row,choicesId:'choices-'+c.companyId,captureId:c.captureId}));
const nativeChoices=c=>observedChoices(c,c.controls.filter(control=>capturedChoiceOptions(control)).map(control=>({selector:control.selector,...capturedChoiceOptions(control)})));
for(const [company,framework,method]of [['alpha','.ant-form-item','ant_dropdown'],['beta','.ud-formily-item','ud_dropdown']])test(`same construction pipeline creates executable ${framework} mappings for ${company}`,async()=>{
 const c=capture(company,framework),b=buildFormTemplate({capture:c,profile,mappings,choices:observedChoices(c),page,templateId:company});
 assert.equal(b.readyToRegister,true);validateTemplate(b.template);assert.equal(b.template.pages[0].fields[1].actions[0].method,method);
 assert.equal(b.template.pages[0].fields[1].userOnly,undefined);
 const plan=await compileExecutionPlan(b.template,{companyId:company,pageUrl:c.pageUrl,templateHash:hash(b.template),values:{name:'Applicant',gender:'女'}});
 assert.equal(plan.readyForExecution,false);assert.ok(plan.constructionBlockers.includes('CONTROLS_NOT_FULLY_MAPPED')); // generation does not forge probe evidence
 const expected=plan.pages[0].expected,fields=Object.fromEntries(expected.fields.map(f=>[f.id,{present:true,value:f.value,selected:true,selectionProof:{status:'verified',label:f.value,blurConfirmed:true,reopenedOptionSelected:true}}]));
 const v=verifyForm(expected,{source:'live_dom',readAt:new Date().toISOString(),pageUrl:c.pageUrl,roleTitle:'Product',sections:[{title:'基本信息'}],inventoryIds:expected.fields.map(f=>f.id),fields});
 assert.equal(v.status,'verified');assert.deepEqual(v.summary.fields,{match:2});assert.deepEqual(v.summary.structure,{match:1});
});
test('unsupported controls and uncaptured options become construction work, never userOnly',()=>{
 const c=capture('gamma','.unrecognized');const b=buildFormTemplate({capture:c,profile,mappings,choices:[],page,templateId:'gamma'});
 assert.equal(b.readyToRegister,false);assert.ok(b.blockers.some(x=>x.reason==='CONTROL_DRIVER_REQUIRED'));assert.ok(b.blockers.some(x=>x.reason==='OPTIONS_NOT_CAPTURED'));
 assert.ok(b.template.pages[0].fields.every(f=>!f.userOnly));assert.throws(()=>validateTemplate(b.template),/CONSTRUCTION_GAPS/);
});
test('ordinary userOnly cannot bypass routing or preflight even with known answers and forged coverage',async()=>{
 const c=capture('alpha','.ant-form-item'),b=buildFormTemplate({capture:c,profile,mappings,choices:observedChoices(c),page,templateId:'alpha'});const t=b.template;
 t.pages[0].fields[1].userOnly=true;t.pages[0].fields[1].actions=[];t.coverage={allControlsMapped:true,allDriversSupported:true,allConditionalBranchesVerified:true};
 assert.throws(()=>validateTemplate(t),/CONSTRUCTION_GAPS/);
 const route=await new FormRouter({store:{get:async()=>t},companies:[{id:'alpha',origin:'https://alpha.example',templateId:'alpha'}],validateTemplate}).resolve({companyId:'alpha',pageUrl:'https://alpha.example/form'});
 assert.equal(route.route,'acquire');assert.equal(route.requiresUser,false);assert.ok(route.blockers.includes('ORDINARY_FIELD_MARKED_USER_ONLY'));
 assert.ok((await compileExecutionPlan(t,{values:{name:'Applicant',gender:'女'}})).constructionBlockers.includes('ORDINARY_FIELD_MARKED_USER_ONLY'));
});
test('mapping suggestions preserve multiple school records for semantic resolution',()=>{
 const candidates=mappingCandidates([{selector:'#school',label:'学校',repeatIndex:0}],{facts:{'education.one.school':{status:'known',value:'Example School A'},'education.two.school':{status:'known',value:'Example School B'}},fieldRegistry:{'education.one.school':{label:'学校'},'education.two.school':{label:'学校'}}});
 assert.equal(candidates[0].candidates.length,2);assert.equal(candidates[0].automaticMapping,false);assert.equal(candidates[0].owner,'agent');
});
function evidence(){return {operation:'inspect_web_page',predicate_type:'rea.web-page-inspection',evidence_id:'test-evidence',parameters:{target_id:'target'},normalized_result:{target:{target_id:'target',url:'https://alpha.example/form',origin:'https://alpha.example'},capture_window:{ended_at:new Date().toISOString()},dom:{total_nodes:2,nodes:[{}]},accessibility:{text_capture:{status:'included'},nodes:[{node_id:'n1',role:'textbox',name:'姓名',value:'must not be retained',states:[]}]},completeness:{truncated_sections:[]}}};}
const binding=()=>({pageId:'iab:1',targetId:'target',beforeUrl:'https://alpha.example/form#job=1',afterUrl:'https://alpha.example/form#job=1'});
test('REA evidence preserves exact bound page identity, never turns AX IDs into selectors',()=>{
 const s=normalizeReaStructure(evidence(),binding());assert.equal(s.executableSelectors,false);assert.equal(s.accessibility[0].value,undefined);assert.equal(s.pageUrl,binding().beforeUrl);
 const c={...capture('alpha','.ant-form-item'),pageUrl:s.pageUrl,pageId:'iab:1'};const j=bindStructureControls(s,c);assert.deepEqual(j.controls[0].reaCandidates,[]);assert.deepEqual(j.uncorrelatedControls.map(n=>n.nodeId),['n1']);assert.equal(j.controls[0].selector,'#name');
 assert.throws(()=>bindStructureControls(s,{...c,pageId:'iab:2'}),/SCOPE_MISMATCH/);
});
test('REA rejects stale, cross-target, partial and changed-page evidence',()=>{
 for(const change of [x=>x.e.parameters.target_id='other',x=>x.b.afterUrl='https://alpha.example/other',x=>x.e.normalized_result.capture_window.ended_at='2020-01-01T00:00:00Z',x=>x.e.normalized_result.completeness.truncated_sections=['dom']]){const x={e:evidence(),b:binding()};change(x);assert.throws(()=>normalizeReaStructure(x.e,x.b));}
});
test('REA invocation is a bounded argument array, captures no storage/scripts, and rejects remote endpoints',async()=>{
 let call;await inspectRea({endpoint:'http://127.0.0.1:9222',targetId:'target',pageUrl:'https://alpha.example/form',command:['node','/installed/rea.mjs'],execute:async(...args)=>{call=args;return {stdout:JSON.stringify(evidence())};}});
 assert.equal(call[0],'node');assert.ok(call[1].includes('--include-accessibility-text'));assert.ok(call[1].includes('--include-script-sources'));assert.equal(call[1].includes('--include-storage-keys'),false);assert.equal(call[2].shell,undefined);
 await assert.rejects(inspectRea({endpoint:'https://remote.example',targetId:'target',pageUrl:'https://alpha.example/form'}),/LOCAL_ENDPOINT/);
});
test('continuation keeps technical work with the agent and distinguishes real user decisions',async()=>{
 assert.equal(continuationFor({route:{route:'acquire'}}).requiresUser,false);
 assert.equal(continuationFor({verification:{status:'needs_attention',checks:[{id:'x',status:'unmapped',reason:'NEW_SECTION'}]}}).state,'repair');
 const r=await advanceCompanies([{id:1},{id:2}],async t=>t.id===1?{continuation:{requiresUser:true,owner:'user'}}:{continuation:{owner:'agent'},done:true});
 assert.equal(r.results[1].done,true);assert.equal(r.agentWorkRemaining,true);
 const failed=await advanceCompanies([{id:1},{id:2}],async t=>{if(t.id===1)throw Error('MAPPING_REQUIRED');return {done:true};});assert.equal(failed.results[1].done,true);assert.equal(failed.results[0].continuation.retry,'only_after_evidence_or_inputs_change');
});
test('68 passed checks with 14 sections report 54 actual matched fields',()=>{const ids=Array.from({length:54},(_,i)=>'f'+i);const s=verificationSummary([...ids.map(id=>({id,status:'match'})),...Array.from({length:14},(_,i)=>({id:'section:'+i,status:'match'}))],ids);assert.equal(s.fields.match,54);assert.equal(s.structure.match,14);});

test('native HTML date and select use the same generator without a company adapter',()=>{
 const c=capture('native',null);c.controls=[{selector:'#start',label:'入学时间',tag:'input',type:'date',required:true},{selector:'#gender',label:'性别',tag:'select',type:'select-one',options:['男','女'],optionRecords:[{label:'男',value:'gender-m',valueAttribute:'value',disabled:false,selected:false},{label:'女',value:'gender-f',valueAttribute:'value',disabled:false,selected:false}],required:true}];
 const b=buildFormTemplate({capture:c,profile,mappings:[{selector:'#start',factKey:'start'},...mappings],choices:nativeChoices(c),page,templateId:'native'});
 assert.equal(b.readyToRegister,true);validateTemplate(b.template);assert.deepEqual(b.template.pages[0].fields.map(f=>f.actions[0].method),['native_date','select']);
});
test('native control.options without a bound choice asset cannot become registerable',()=>{
 const c=capture('native-missing',null);c.controls=[{selector:'#gender',label:'性别',tag:'select',type:'select-one',required:true,options:['男','女']}];
 const b=buildFormTemplate({capture:c,profile,mappings,choices:[],page,templateId:'native-missing'});
 assert.equal(b.readyToRegister,false);assert.ok(b.blockers.some(b=>b.reason==='CHOICE_GOAL_OPTION_CAPTURE_REQUIRED'));assert.throws(()=>validateTemplate(b.template),/CONSTRUCTION_GAPS/);
});
test('erased, blocked or detached choice goals cannot register or freeze despite forged coverage',async()=>{
 const c=capture('goal-gate','.ant-form-item'),b=buildFormTemplate({capture:c,profile,mappings,choices:observedChoices(c),page,templateId:'goal-gate'});
 assert.equal(b.readyToRegister,true);assert.equal(b.template.pages[0].fields[1].choiceGoalRequired,true);
 for(const [mutate,reason]of [
  [f=>delete f.choiceGoal,'CHOICE_GOAL_REQUIRED'],
  [f=>f.choiceGoal.status='blocked','CHOICE_GOAL_INCOMPLETE'],
  [f=>f.choiceGoal.captureId='unrelated-capture','CHOICE_GOAL_BINDING_INVALID'],
  [f=>f.choiceGoal.choicesId='','CHOICE_GOAL_BINDING_INVALID'],
  [f=>f.choiceGoal.selector='#unrelated','CHOICE_GOAL_BINDING_INVALID']
 ]){
  const t=structuredClone(b.template);t.coverage={allControlsMapped:true,allDriversSupported:true,allConditionalBranchesVerified:true};mutate(t.pages[0].fields[1]);
  assert.ok(templateConstructionIssues(t).some(b=>b.reason===reason));assert.throws(()=>validateTemplate(t),/CONSTRUCTION_GAPS/);
  const plan=await compileExecutionPlan(t,{companyId:c.companyId,pageUrl:c.pageUrl,templateHash:hash(t),values:{name:'Applicant',gender:'女'}});
  assert.equal(plan.readyForExecution,false);assert.ok(plan.constructionBlockers.includes(reason));
 }
});
test('REA-only controls cannot disappear from template coverage without explicit reconciliation',()=>{
 const c=capture('alpha','.ant-form-item');const rea={companyId:c.companyId,pageUrl:c.pageUrl,uncorrelatedControls:[{nodeId:'unseen',label:'Other question'}]};
 const args={capture:c,profile,mappings,choices:observedChoices(c),page,templateId:'alpha',reaStructure:rea};
 const blocked=buildFormTemplate(args);assert.equal(blocked.readyToRegister,false);assert.throws(()=>validateTemplate(blocked.template),/CONSTRUCTION_GAPS/);
 assert.throws(()=>buildFormTemplate({...args,reaReconciliation:[{nodeId:'unseen',selector:'#invented',evidence:'not actually captured'}]}),/RECONCILIATION_EVIDENCE/);
 const ok=buildFormTemplate({...args,reaReconciliation:[{nodeId:'unseen',exclusion:'outside_application_form',evidence:'Observed header search input outside the application form'}]});assert.equal(ok.readyToRegister,true);
});
test('two dates sharing one range label keep their independent captured control identity',()=>{
 const c=capture('dates','.ant-form-item');c.controls=[0,1].map(i=>({selector:'#range-'+i,label:'起止时间',contextProvider:'.ant-form-item',renderer:'ant_date',type:'text',tag:'input',readonly:true,controlIndex:i,required:true}));
 const b=buildFormTemplate({capture:c,profile,mappings:[{selector:'#range-0',factKey:'start'},{selector:'#range-1',factKey:'end'}],page,templateId:'dates'});
 assert.equal(b.readyToRegister,true);assert.deepEqual(b.template.pages[0].fields.map(f=>f.actions[0].openSelector),['#range-0','#range-1']);assert.ok(b.template.pages[0].fields.every(f=>!f.userOnly));
});
test('section contracts normalize titles and use captured section roots instead of a shared form root',()=>{
 const c=capture('sections','.ant-form-item');c.provider='ant';c.controls=[{selector:'#name',sectionSelector:'#basics',section:'Basics',label:'姓名',type:'text',tag:'input',contextProvider:'.ant-form-item'}];
 const b=buildFormTemplate({capture:c,profile,mappings:[{selector:'#name',factKey:'name'}],page:{...page,sections:['Basics']},templateId:'sections'});
 assert.deepEqual(b.template.pages[0].sections,[{title:'Basics'}]);assert.deepEqual(b.template.pages[0].sectionDiscovery.selectors,['#basics']);validateTemplate(b.template);
 const bad=structuredClone(b.template);bad.pages[0].sections=['Basics'];assert.throws(()=>validateTemplate(bad),/SECTION_TITLES_REQUIRED/);
});
test('captured editable Ant date uses real input and rejects failed commit',async()=>{
 let value='',keys=[];const input={count:async()=>1,evaluate:async fn=>fn({tagName:'INPUT',readOnly:false,closest:()=>({}),get value(){return value;}}),fill:async v=>{value=v;},press:async k=>keys.push(k)};
 const adapter={resolveSelector:async s=>s,page:{locator:()=>input}},action={selector:'#date',openSelector:'#date',openLabel:'起止时间',openKind:'captured_date_input'};
 assert.equal((await performAntDay(adapter,action,'2027-06-01')).committed,true);assert.deepEqual(keys,['Enter','Tab']);
 input.fill=async()=>{};await assert.rejects(performAntDay(adapter,action,'2028-06-01'),/COMMIT_NOT_VERIFIED/);
});
test('classic ATS form uses captured action/read selectors and month driver through the same builder',()=>{
 const c=capture('classic','.atsx-form-item');c.controls=[{selector:'#question-name',actionSelector:'#question-name input',readSelector:'#question-name input',label:'姓名',type:'text',contextProvider:'.atsx-form-item',required:true},{selector:'#period',label:'起止时间',type:'month',contextProvider:'.atsx-form-item',required:true}];
 const b=buildFormTemplate({capture:c,profile,mappings:[{selector:'#question-name',factKey:'name'},{selector:'#period',factKey:'start'}],page:{...page,provider:'feishu'},templateId:'classic'});
 assert.equal(b.readyToRegister,true);validateTemplate(b.template);assert.equal(b.template.pages[0].fields[0].actions[0].selector,'#question-name input');assert.equal(b.template.pages[0].fields[1].actions[0].method,'feishu_month');assert.equal(b.template.pages[0].fields[1].read.kind,'month');
});
test('shared browser origins advance serially while independent origins keep progressing',async()=>{
 const active=new Set(),done=[];let overlap=false;
 const tasks=[{id:1,origin:'same'},{id:2,origin:'same'},{id:3,origin:'other'}];
 const r=await advanceCompanies(tasks,async t=>{if(active.has(t.origin))overlap=true;active.add(t.origin);await new Promise(r=>setTimeout(r,5));active.delete(t.origin);done.push(t.id);return {done:true};},{concurrency:3,affinity:t=>t.origin});
 assert.equal(overlap,false);assert.equal(r.results.length,3);assert.ok(done.indexOf(1)<done.indexOf(2));assert.ok(done.includes(3));
});

test('native and Ant multi selections keep array values and full selection readback contracts',async()=>{
 const p={facts:{locations:{status:'known',value:['Beijing']}},fieldRegistry:{locations:{label:'Locations'}}};
 for(const native of [true,false]){const c={...capture('multi',native?null:'.ant-form-item'),controls:[{selector:'#locations',questionSelector:'#question',selectedSelector:'#selected',labelSelector:'#label',label:'Locations',tag:native?'select':'input',type:native?'select-multiple':'search',renderer:native?null:'ant_select',contextProvider:native?null:'.ant-form-item',multiple:true,required:true,options:native?['Beijing','Shanghai']:undefined}]};
 const b=buildFormTemplate({capture:c,profile:p,mappings:[{selector:'#locations',factKey:'locations'}],choices:native?nativeChoices(c):observedChoices(c,[{selector:'#locations',status:'captured',restored:true,options:['Beijing','Shanghai']}]),page,templateId:native?'native-multi':'ant-multi'});assert.equal(b.readyToRegister,true);validateTemplate(b.template);assert.equal(b.template.pages[0].fields[0].control.type,'multiselect');
 const plan=await compileExecutionPlan(b.template,{values:{locations:['Beijing']}});assert.deepEqual(plan.pages[0].fields[0].value,['Beijing']);assert.equal(plan.pages[0].fields[0].read.kind,'selected_values');
 await assert.rejects(compileExecutionPlan(b.template,{values:{locations:['Not offered']}}),/VALUE_OUTSIDE_CAPTURED_OPTIONS/);
 }
});

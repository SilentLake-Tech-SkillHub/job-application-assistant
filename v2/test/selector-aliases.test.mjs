import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {selectorAliasDOM} from '../shared/selector-aliases.mjs';
import {retireLegacyQuestionMappings} from '../shared/profile-migration.mjs';
test('a shared fact retires only the unique observed replacement of the same semantic question',()=>{
 const companyId='fixture',pageUrl='https://example.test/form';
 const selector=(label,occurrence,section='项目经历')=>'phoenixq:'+JSON.stringify({section,label,occurrence,part:'native',controlIndex:0});
 const fields=['职务','项目中职责'].map(label=>({source:'projects.example.role',label,inventorySelectors:[selector(label,8)],read:{selector:selector(label,8)}}));
 const template={evidence:{sourceUrl:pageUrl},pages:[{fields}]},key=companyId;
 const profile={facts:{'projects.example.role':{value:'Owner'}},companyForms:{[key]:{companyId,pageUrl,mappings:Object.fromEntries(['职务','项目中职责'].map((label,i)=>['old'+i,{status:'mapped',active:false,coverageRequired:true,factKey:'projects.example.role',selector:selector(label,9)}]))}}};
 const probe={operation:'internal_condition_probe',companyId,templateHash:hash(template),status:'verified',restoration:'verified',branches:[{status:'verified',newQuestions:0,inventory:fields.map(f=>({selector:f.read.selector}))}]};
 const original=structuredClone(profile);
 assert.equal(retireLegacyQuestionMappings(profile,{companyId,template,probe}).retired,2);assert.equal(profile.facts['projects.example.role'].value,'Owner');
 for(const changes of [{restoration:'failed'},{branches:[{status:'verified',newQuestions:1,inventory:[]}]}])assert.throws(()=>retireLegacyQuestionMappings(structuredClone(original),{companyId,template,probe:{...probe,...changes}}),/PROOF_REQUIRED/);
 const ambiguous=structuredClone(template);ambiguous.pages[0].fields.push({...fields[0],inventorySelectors:[selector('职务',7)],read:{selector:selector('职务',7)}});
 const ambiguousProbe={...probe,templateHash:hash(ambiguous),branches:[{status:'verified',newQuestions:0,inventory:ambiguous.pages[0].fields.map(f=>({selector:f.read.selector}))}]};
 const kept=structuredClone(original);assert.equal(retireLegacyQuestionMappings(kept,{companyId,template:ambiguous,probe:ambiguousProbe}).retired,1);assert.ok(kept.companyForms[key].mappings.old0);
 const unknown=structuredClone(original);unknown.companyForms[key].mappings.old0.selector=selector('职务',9,'其他栏目');assert.equal(retireLegacyQuestionMappings(unknown,{companyId,template,probe}).retired,1);assert.ok(unknown.companyForms[key].mappings.old0);
});
import {formLocation} from '../shared/profile.mjs';import {hash} from '../shared/engine.mjs';
import {PageAdapter} from '../shared/ui-page.mjs';
import {controlDOM} from '../shared/control-dom.mjs';
const phoenix=label=>'phoenixq:'+JSON.stringify({section:'section',label,occurrence:0,part:'native',controlIndex:0});
test('alias comparison tolerates an absent old Phoenix question, while current references stay strict',async()=>{
 const old=phoenix('retired'),current=phoenix('current'),calls=[];
 const page={evaluate:async(_fn,args)=>{calls.push(args);if(args.operation==='resolvePhoenixAliases')return [null];if(args.operation==='resolvePhoenix')return ['#current'];throw Error('UNEXPECTED_READ');}};
 const spec=await new PageAdapter(page).resolveSpec({method:'wait',operation:'compare_control_aliases',selector:'#ready',alternatives:[old],references:[current]});
 assert.deepEqual(spec.alternatives,[':not(*)']);assert.deepEqual(spec.references,['#current']);
 assert.deepEqual(calls.filter(c=>c.operation==='resolvePhoenix').flatMap(c=>c.references),[current]);
 const broken=new PageAdapter({evaluate:async()=>{throw Error('PHOENIX_QUESTION_NOT_FOUND');}});
 await assert.rejects(broken.resolveSpec({operation:'compare_control_aliases',alternatives:[old],references:[current]}),/PHOENIX_QUESTION_NOT_FOUND/);
});
test('optional alias resolution skips only absent questions, and ordinary resolution remains strict',()=>{
 const context={document:{querySelectorAll:()=>[]},input:{operation:'resolvePhoenixAliases',references:[phoenix('retired')]}};
 const run=()=>vm.runInNewContext('('+controlDOM.toString()+')(input)',context);
 assert.deepEqual(JSON.parse(JSON.stringify(run())),[null]);
 context.input.operation='resolvePhoenix';assert.throws(run,/PHOENIX_QUESTION_NOT_FOUND/);
 context.input.operation='resolvePhoenixAliases';context.input.references=['phoenixq:invalid'];assert.throws(run,/PHOENIX_REFERENCE_INVALID/);
});
test('collector aliases need the same unique actual DOM node; labels, hidden nodes and ambiguous matches cannot substitute',()=>{
 const node=shown=>({getClientRects:()=>shown?[{}]:[],closest:()=>null,matches:()=>false}),a=node(true),b=node(true),hidden=node(false),map={'#old':[a],'#new':[a],'#same-label':[b],'#hidden':[hidden],'#ambiguous':[a,b]};
 const result=vm.runInNewContext('('+selectorAliasDOM.toString()+')(input)',{document:{querySelectorAll:s=>map[s]||[]},getComputedStyle:()=>({visibility:'visible'}),input:{alternatives:['#old','#same-label','#hidden','#ambiguous','#absent'],references:['#new']}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{pairs:[{alternativeIndex:0,referenceIndex:0}],valuesRead:false});
});
test('inactive unmapped locator records retire only with page/template-bound live equivalence, unresolved conditional records remain',()=>{
 const companyId='sample',url='https://sample.test/form',template={evidence:{sourceUrl:url},pages:[{fields:[{source:'name',inventorySelectors:['semantic-name'],read:{selector:'semantic-name'}}]}]},key=companyId;
 const profile={facts:{name:{value:'Keep real fact'}},companyForms:{[key]:{companyId,pageUrl:url,mappings:{duplicate:{factKey:'unmapped.duplicate',status:'needs_semantic_mapping',selector:'#old-name',active:false,coverageRequired:true},unseen:{factKey:'unmapped.unseen',status:'needs_semantic_mapping',selector:'#conditional-unseen',active:false,coverageRequired:true}}}}};
 const probe={operation:'internal_condition_probe',companyId,templateHash:hash(template),status:'verified',restoration:'verified',branches:[{status:'verified',newQuestions:0,inventory:[{selector:'semantic-name'}]}],selectorEquivalences:{companyId,pageUrl:url,templateHash:hash(template),pairs:[{selector:'#old-name',reference:'semantic-name'}]}};
 assert.equal(retireLegacyQuestionMappings(profile,{companyId,template,probe}).retired,1);assert.ok(profile.companyForms[key].mappings.unseen);assert.equal(profile.facts.name.value,'Keep real fact');
 probe.selectorEquivalences.pageUrl='https://other.test/form';assert.throws(()=>retireLegacyQuestionMappings(profile,{companyId,template,probe}),/SCOPE_MISMATCH/);
});

test('readback reports an absent Phoenix field while writes and changed controls remain strict',async()=>{
 const ref=phoenix('not-rendered'),calls=[];
 const page={evaluate:async(_reader,args)=>{calls.push(args);if(args.operation==='resolvePhoenix')throw Error('PHOENIX_QUESTION_NOT_FOUND');if(args.operation==='resolvePhoenixReadback')return [null];return {fields:{missing:{present:false,value:null,errors:[]}}};}};
 const adapter=new PageAdapter(page),result=await adapter.observe({fields:[{id:'missing',read:{selector:ref,kind:'value'}}]});assert.equal(result.fields.missing.present,false);assert.equal(calls.at(-1).fields[0].read.selector,':not(*)');
 await assert.rejects(adapter.resolveSelector(ref),/PHOENIX_QUESTION_NOT_FOUND/);
 const changed=new PageAdapter({evaluate:async()=>{throw Error('PHOENIX_CONTROL_CHANGED');}});await assert.rejects(changed.observe({fields:[{id:'changed',read:{selector:ref,kind:'value'}}]}),/PHOENIX_CONTROL_CHANGED/);
});
test('native optional readback returns only absent markers and never accepts a malformed reference',()=>{
 const context={document:{querySelectorAll:()=>[]},input:{operation:'resolvePhoenixReadback',references:[phoenix('not-rendered')]}};
 const run=()=>vm.runInNewContext('('+controlDOM.toString()+')(input)',context);assert.deepEqual(JSON.parse(JSON.stringify(run())),[null]);
 context.input.references=['phoenixq:invalid'];assert.throws(run,/PHOENIX_REFERENCE_INVALID/);
});

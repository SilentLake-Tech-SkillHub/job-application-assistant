import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {withProfileRecords,recordPlanOf,sectionsWithoutAdd,groupFromDiscovery,inheritFields} from '../shared/repeat-groups.mjs';
import {controlDOM} from '../shared/control-dom.mjs';
import {Engine} from '../shared/engine.mjs';
const ref=(section,label,occurrence)=>'phoenixq:'+JSON.stringify({section,label,occurrence,part:'native',controlIndex:0});
const field=(section,occurrence,record,member,label=member)=>({id:`id-${record}-${member}`,source:`${record}.${member}`,label,inventorySelectors:[ref(section,label,occurrence)],read:{selector:ref(section,label,occurrence),kind:'value'},actions:[{method:'fill',selector:ref(section,label,occurrence)}],control:{type:'text',valueType:'string',readbackType:'string'},kind:'text',required:true});
const scope=title=>({title,headingSelector:`[id="${title}"]`,containerSelector:`div:has(> [id="${title}"])`,recordSelector:':scope > div > div',addSelector:`[id="${title}_addButton"]`,addLabel:`Add ${title}`});
const group=(title,count)=>({id:title,selector:'phoenixq:'+JSON.stringify({...scope(title),part:'repeatRecords'}),addSelector:'phoenixq:'+JSON.stringify({...scope(title),part:'repeatAdd'}),addLabel:`Add ${title}`,...(count===undefined?{}:{count})});
const work=(...keys)=>keys.flatMap((key,i)=>[field('Work',i,`employment.${key}`,'company'),field('Work',i,`employment.${key}`,'title')]);
const form=(fields,groups,evidence={})=>({id:'F1',evidence,pages:[{pathPrefix:'/form',fields,...(groups?{groups}:{})}]});
const plan=(entities,projects=null)=>({entities,projects});
const selectors=page=>page.fields.map(f=>JSON.parse(f.inventorySelectors[0].slice(9)).occurrence);
test('T13: the count comes from the profile, not from the number stored on the group',()=>{
 const t=form(work('a','b'),[group('Work',9)]);
 assert.equal(withProfileRecords(t,plan({employment:['a','b']})).pages[0].groups[0].count,2);
 assert.equal(withProfileRecords(form(work('a','b'),[group('Work')]),plan({employment:['a','b']})).pages[0].groups[0].count,2);
});
test('T13: a record added to the profile gets its own segment, following its siblings',()=>{
 const page=withProfileRecords(form(work('a','b'),[group('Work',2)]),plan({employment:['a','b','c']})).pages[0];
 assert.equal(page.groups[0].count,3);
 const added=page.fields.filter(f=>f.source.startsWith('employment.c.'));
 assert.deepEqual(added.map(f=>f.source),['employment.c.company','employment.c.title']);
 assert.equal(JSON.parse(added[0].inventorySelectors[0].slice(9)).occurrence,2);
 assert.equal(JSON.parse(added[0].actions[0].selector.slice(9)).occurrence,2);
 assert.equal(new Set(page.fields.map(f=>f.id)).size,page.fields.length);
});
test('T13: a record removed from the profile is dropped and later segments move up',()=>{
 const page=withProfileRecords(form(work('a','b','c'),[group('Work',3)]),plan({employment:['a','c']})).pages[0];
 assert.equal(page.groups[0].count,2);
 assert.deepEqual(page.fields.map(f=>f.source),['employment.a.company','employment.a.title','employment.c.company','employment.c.title']);
 assert.deepEqual(selectors(page),[0,0,1,1]);
});
test('nothing changed returns the stored template itself, so its hash and plan stay the same',()=>{
 const t=form(work('a','b'),[group('Work',2)]);
 assert.equal(withProfileRecords(t,plan({employment:['a','b']})),t);
 assert.equal(withProfileRecords(t,undefined),t);
});
test('a section with no add control is never grown; the form keeps the subset it was built with',()=>{
 const t=form(work('a','b'));
 assert.equal(withProfileRecords(t,plan({employment:['a','b','c','d']})),t);
});
test('families the profile does not list stay as built',()=>{
 const fields=[field('Project',0,'workProjects.x','name'),field('Project',1,'projects.y','name')];
 const page=withProfileRecords(form(fields,[group('Project',2)]),plan({projects:['y']})).pages[0];
 assert.deepEqual(page.fields.map(f=>f.source),['workProjects.x.name','projects.y.name']);
 assert.equal(page.groups[0].count,2);
});
test('a project the user took out of the selection leaves the plan without a rebuild',()=>{
 const fields=[field('Project',0,'projects.x','name'),field('Project',1,'projects.y','name')];
 const page=withProfileRecords(form(fields,[group('Project',2)]),plan({projects:['x','y']},['y'])).pages[0];
 assert.deepEqual(page.fields.map(f=>f.source),['projects.y.name']);
 assert.equal(page.groups[0].count,1);
});
test('a new segment does not reuse what was resolved for its sibling',()=>{
 const base=work('a');base[0].choiceResolution={sourceValue:'A'};base[0].choiceGoal={status:'resolved'};base[0].actions[0].query='A';
 const added=withProfileRecords(form(base,[group('Work',1)]),plan({employment:['a','b']})).pages[0].fields.find(f=>f.source==='employment.b.company');
 assert.equal(added.choiceResolution,undefined);assert.equal(added.choiceGoal,undefined);assert.equal(added.actions[0].query,undefined);
});
test('a single-record section outside the repeat contract is left alone',()=>{
 const t=form([field('Personal',0,'education.old','school')]);
 assert.equal(withProfileRecords(t,plan({education:['new']})),t);
});
test('derived members of a record do not make their parent the owner',()=>{
 const fields=[field('Project',0,'workProjects.x','name'),field('Project',0,'employment.a','title'),field('Project',0,'employment.a','start')];
 const t=form(fields,[group('Project',1)],{recordParents:{'workProjects.x':'employment.a'}});
 assert.equal(withProfileRecords(t,plan({employment:[]})),t);
});
test('recordPlanOf reads the profile record list and the project selection',()=>{
 assert.deepEqual(recordPlanOf({entities:{projects:['x']},applicationSelections:{projects:{projectIds:['x']}}}),{entities:{projects:['x']},projects:['x']});
});
test('sections needing an add control are those with planned records missing from the page and no contract',()=>{
 const page=form(work('a','b')).pages[0],first=[{selector:ref('Work','company',0)}];
 assert.deepEqual(sectionsWithoutAdd(page,first),['Work']);
 assert.deepEqual(sectionsWithoutAdd({...page,groups:[group('Work',2)]},first),[]);
 assert.deepEqual(sectionsWithoutAdd(page,[...first,{selector:ref('Work','company',1)}]),[]);
});
test('a discovered section becomes a group the fill path accepts, without a count',()=>{
 const g=groupFromDiscovery(scope('Work'));
 assert.equal(g.count,undefined);
 assert.equal(JSON.parse(g.selector.slice(9)).part,'repeatRecords');assert.equal(JSON.parse(g.addSelector.slice(9)).part,'repeatAdd');assert.equal(g.addLabel,'Add Work');
});
function learningEngine(found){
 const stored=form(work('a','b')),writes=[],puts=[];
 const page={assertLocation:async()=>{},wait:async()=>{},repeatDiscovery:async titles=>{writes.push('read:'+titles.join());return found;},
  inventory:async()=>[{selector:ref('Work','company',0),label:'company',type:'text'},{selector:ref('Work','title',0),label:'title',type:'text'}],
  observe:async spec=>({source:'live_dom',readAt:'x',pageUrl:'https://fixture.test/form',fields:Object.fromEntries(spec.fields.map(f=>[f.id,{present:true,value:null}]))}),
  act:async()=>{writes.push('write');},ensureGroups:async()=>{writes.push('ensure');}};
 const engine=new Engine({store:{get:async()=>structuredClone(stored),put:async(kind,id,value)=>{puts.push({kind,id,value});}},companies:[],browser:{existingPage:async()=>page}});
 return {engine,stored,writes,puts};
}
test('T1 for a template without add locators: read the section once, keep it on the template, write nothing to the form',async()=>{
 const {engine,stored,writes,puts}=learningEngine([scope('Work')]);
 const result=await engine.learnRepeatContract(await engine.browser.existingPage(),stored,stored.pages[0],await (await engine.browser.existingPage()).inventory()).catch(e=>e);
 assert.equal(result.message,'REPEAT_CONTRACT_LEARNED');assert.deepEqual(result.details.nextTools,['prepare_plan','batch_prepare']);
 assert.deepEqual(writes,['read:Work']);
 assert.equal(puts[0].kind,'templates');assert.equal(puts[0].value.pages[0].groups[0].addLabel,'Add Work');assert.equal(puts[0].value.pages[0].groups[0].count,undefined);
});
test('when the page shows no add control nothing is stored and filling goes on',async()=>{
 const {engine,stored,puts}=learningEngine([]);
 const page=await engine.browser.existingPage();
 await engine.learnRepeatContract(page,stored,stored.pages[0],await page.inventory());
 assert.deepEqual(puts,[]);
});
test('T15: a rebuild keeps mappings, captured options and fields the fresh capture did not show',()=>{
 const old=[{id:'a',source:'employment.a.company',inventorySelectors:['#a'],constructionBlockers:[],control:{type:'dropdown',options:['x']},actions:[{method:'dropdown',options:['x']}],read:{selector:'#a'},enumMap:{m:'x'}},{id:'b',source:'employment.b.company',inventorySelectors:['#b'],when:{source:'x',equals:'y'},constructionBlockers:[],control:{type:'text'},actions:[],read:{selector:'#b'}}];
 const fresh=[{id:'a',source:'unmapped.pending',inventorySelectors:['#a'],constructionBlockers:['OPTIONS_NOT_CAPTURED'],control:{type:'dropdown'},actions:[],read:{selector:'#a'}}];
 const merged=inheritFields(fresh,[{pages:[{pathPrefix:'/form',fields:old}]}],'/form');
 assert.equal(merged.length,2);assert.equal(merged[0].source,'employment.a.company');assert.deepEqual(merged[0].enumMap,{m:'x'});assert.deepEqual(merged[0].control.options,['x']);assert.deepEqual(merged[0].constructionBlockers,[]);assert.equal(merged[1].id,'b');
});
test('T15: records the capture did not show survive; a control gone from a shown record does not',()=>{
 const f=(id,occurrence,label='Name')=>({id,source:id,inventorySelectors:[ref('Work',label,occurrence)],constructionBlockers:[],control:{type:'text'},actions:[],read:{selector:ref('Work',label,occurrence)}});
 const merged=inheritFields([f('a',0)],[{pages:[{pathPrefix:'/form',fields:[f('a',0),f('removed',0,'Old'),f('second',1)]}]}],'/form');
 assert.deepEqual(merged.map(x=>x.id),['a','second']);
});
test('a fresh mapping wins over the inherited one',()=>{
 const merged=inheritFields([{id:'a',source:'new.fact',inventorySelectors:['#a'],constructionBlockers:[],control:{type:'text'},actions:[],read:{}}],[{pages:[{pathPrefix:'/form',fields:[{id:'a',source:'old.fact',inventorySelectors:['#a'],constructionBlockers:[],control:{type:'text'},actions:[],read:{}}]}]}],'/form');
 assert.equal(merged[0].source,'new.fact');
});
test('the page read finds the add button tied to the section heading, and only for asked sections',()=>{
 const el=(tag,id,innerText,parent)=>{const n={tagName:tag,id,innerText,parentElement:parent,children:[],getClientRects:()=>[{}],getAttribute:()=>null,contains(o){for(let x=o;x;x=x.parentElement)if(x===n)return true;return false;}};if(parent)parent.children.push(n);return n;};
 const root=el('DIV','','',null),heading=el('DIV','uuid_Edu','教育经历',root),other=el('DIV','','',root),body=el('DIV','','',root),inner=el('DIV','','',body),add=el('DIV','uuid_Edu_addButton','添加教育经历',inner);
 const skipHeading=el('DIV','uuid_Skip','证书',root),skipBody=el('DIV','','',root),skip=el('DIV','uuid_Skip_addButton','添加证书',skipBody);
 const all=[add,skip],byId={uuid_Edu:heading,uuid_Skip:skipHeading};
 const document={querySelectorAll:s=>s==='[id$="_addButton"]'?all:[],getElementById:id=>byId[id]||null};
 const found=vm.runInNewContext('('+controlDOM.toString()+')({operation:"repeatDiscovery",titles:["教育经历"]})',{document,getComputedStyle:()=>({visibility:'visible'}),CSS:{escape:s=>s}});
 assert.equal(found.length,1);
 assert.equal(found[0].addLabel,'添加教育经历');assert.equal(found[0].addSelector,'[id="uuid_Edu_addButton"]');assert.equal(found[0].headingSelector,'[id="uuid_Edu"]');
 assert.equal(found[0].recordSelector,':scope > div:nth-of-type(3) > div > div:not([id$="_addButton"])');
});
test('A7: a recapture on another role address keeps the confirmed options of every unchanged control',async()=>{
 const {retainControlChoices,controlDefinitionHash}=await import('../shared/control-choice-store.mjs');
 const control={selector:'#degree',label:'Degree',type:'select',options:['A','B']};
 const asset={companyId:'c',formId:'F1',pageUrl:'https://x.test/jobs/1/form?token=a',choices:[{selector:'#degree',definitionHash:controlDefinitionHash(control)}]};
 assert.equal(retainControlChoices(asset,{companyId:'c',formId:'F1',pageUrl:'https://x.test/jobs/2/apply?token=b',controls:[control]}).length,1);
 assert.equal(retainControlChoices(asset,{companyId:'c',formId:'F1',pageUrl:'https://x.test/form',controls:[{...control,options:['A','B','C']}]}).length,0);
 assert.equal(retainControlChoices(asset,{companyId:'other',formId:'F1',pageUrl:'https://x.test/form',controls:[control]}).length,0);
});
test('R1-1: a change of major policy does not mark the company form for rebuild',async()=>{
 const {preferRealMajorMappings}=await import('../shared/major-policy.mjs');const {contractRebuildRequired}=await import('../shared/rebuild-mark.mjs');
 const profile={facts:{'education.a.major.canonical':{status:'known',value:'x'},'education.a.major.zh':{status:'known',value:'y'}},fieldRegistry:{},companyForms:{k:{executionContract:{templateHash:'h',status:'registered',fields:[{source:'education.a.major.canonical'}]}}}};
 preferRealMajorMappings(profile,{evidence:'user said'});
 assert.equal(profile.companyForms.k.executionContract.status,'registered');assert.equal(contractRebuildRequired(profile,'h'),false);
 profile.companyForms.k.executionContract={templateHash:'h',status:'requires_rebuild',rebuildReason:'major_policy_changed'};assert.equal(contractRebuildRequired(profile,'h'),false);
});
test('T13 through plan compile: the added record is planned with its own values and the removed one is gone',async()=>{
 const {compileExecutionPlan}=await import('../shared/execution-plan.mjs');
 const stored={...form(work('a','b'),[group('Work',2)],{sourceUrl:'https://x.test/form'}),coverage:{allControlsMapped:true,allDriversSupported:true,allConditionalBranchesVerified:true}};
 const recordPlan=plan({employment:['b','c']});
 const values=Object.fromEntries(['b','c'].flatMap(k=>[[`employment.${k}.company`,`company-${k}`],[`employment.${k}.title`,`title-${k}`]]));
 const compiled=await compileExecutionPlan(stored,{companyId:'x',pageUrl:'https://x.test/form',templateHash:'h',recordPlan,values,sources:{}});
 const fields=compiled.pages[0].fields;
 assert.deepEqual(fields.map(f=>[f.source,f.value,JSON.parse(f.inventorySelectors[0].slice(9)).occurrence]),[['employment.b.company','company-b',0],['employment.b.title','title-b',0],['employment.c.company','company-c',1],['employment.c.title','title-c',1]]);
 assert.equal(compiled.pages[0].executionOrder.find(s=>s.stage==='ensure_groups').groups[0].count,2);
});

test('Feishu rows use the master record count even when the saved count is smaller',()=>{
 const fields=['first','second'].map((key,index)=>{
  const selector=`input[data-cy="project[${index}].name"]`;
  return {...field('project',index,`projects.${key}`,'name'),inventorySelectors:[selector],read:{selector},actions:[{method:'fill',selector}]};
 });
 const group={id:'projects',selector:'.resumeEditForm-item.resumeEditForm-project',count:2};
 const plan=recordPlanOf({entities:{projects:['first','second','third']}});
 const compiled=withProfileRecords({pages:[{provider:'feishu',fields,groups:[group]}]},plan).pages[0];
 assert.equal(compiled.groups[0].count,3);
 assert.deepEqual(compiled.fields.map(f=>f.source),['projects.first.name','projects.second.name','projects.third.name']);
 assert.match(compiled.fields[2].actions[0].selector,/project\[2\]/);
 assert.deepEqual(sectionsWithoutAdd(compiled,fields.map(f=>({selector:f.read.selector}))),['project']);
});

test('legacy fact-only work project expansions rebind to each project’s own parent',()=>{
 const p={facts:{
  'workProjects.first.name':{derivation:{source:'employment.one.description'}},
  'workProjects.second.name':{derivation:{source:'employment.two.description'}},
  'portfolio.sample.url':{},
 }};
 const plan=recordPlanOf(p);
 assert.deepEqual(plan.entities.portfolio,['sample']);
 const groups=[{...groupFromDiscovery(scope('Work projects')),count:1}];
 const fields=[field('Work projects',0,'workProjects.first','name','Name'),field('Work projects',0,'employment.one','description','Description')];
 const compiled=withProfileRecords({pages:[{groups,fields}]},plan).pages[0];
 assert.deepEqual(compiled.fields.map(f=>f.source),['workProjects.first.name','employment.one.description','workProjects.second.name','employment.two.description']);
});

test('Feishu repeat discovery learns and rechecks the scoped add control',()=>{
 const visible=()=>[{}],selector='.resumeEditForm-item.resumeEditForm-project';
 const buttons=[{id:'observed-add',innerText:'添加项目',getClientRects:visible}];
 const parent={querySelectorAll:()=>buttons};
 const rows=[{parentElement:parent,getClientRects:visible,contains:()=>false}];
 const document={querySelectorAll:s=>s===selector?rows:s==='#observed-add'?buttons:[]};
 const run=spec=>vm.runInNewContext('('+controlDOM.toString()+')(spec)',{spec,document,getComputedStyle:()=>({visibility:'visible'}),CSS:{escape:s=>s}});
 const [group]=run({operation:'repeatDiscovery',titles:['project','award']});
 assert.equal(group.selector,selector);
 assert.equal(run({operation:'resolvePhoenix',references:[group.addSelector]})[0],'#observed-add');
 buttons.push({...buttons[0]});
 assert.throws(()=>run({operation:'resolvePhoenix',references:[group.addSelector]}),/REPEAT_ADD_CONTROL_CHANGED/);
});

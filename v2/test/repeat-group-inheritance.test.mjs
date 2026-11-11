import test from 'node:test';
import assert from 'node:assert/strict';
import {inheritPageContract,inheritFields} from '../shared/repeat-groups.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';

const ref=(section,occurrence)=>'phoenixq:'+JSON.stringify({section,label:'Name',occurrence,part:'native',controlIndex:0});
const field=(id,section,occurrence,extra={})=>({id,inventorySelectors:[ref(section,occurrence)],read:{selector:ref(section,occurrence)},...extra});
const scope=title=>({title,headingSelector:'#h',containerSelector:'.c',recordSelector:'.r',addSelector:'#a',addLabel:'Add'});
const group=(title,count)=>({id:title,selector:'phoenixq:'+JSON.stringify({...scope(title),part:'repeatRecords'}),addSelector:'phoenixq:'+JSON.stringify({...scope(title),part:'repeatAdd'}),addLabel:'Add',count});
const css={id:'edu',selector:'#edu .row',addSelector:'#edu button',addLabel:'Add',count:2};
test('unrendered named records inherit the newly observed column shape without borrowing another record source',()=>{
 const selector=(index,key)=>'.atsx-form-item[data-cy="project['+index+'].'+key+'"]';
 const column=(id,index,key,source)=>({id,source,inventoryLabel:'项目名称',inventoryType:'text',inventorySelectors:[selector(index,key)],control:{type:'text'},read:{selector:selector(index,key),kind:'value'},actions:[{method:'fill',selector:selector(index,key)}],constructionBlockers:[]});
 const observed=column('one',0,'name','projects.one.name');observed.ongoingSource='projects.one.ongoing';
 const old=column('two',1,'old_name','projects.two.name');
 const gone={...column('gone',0,'removed','projects.one.description'),inventoryLabel:'Removed'};
 const fields=inheritFields([observed],[{pages:[{pathPrefix:'/form',fields:[old,gone]}]}],'/form',{preserveObservedBlockers:true});
 assert.equal(fields.length,2);assert.equal(fields[1].id,'two');assert.equal(fields[1].source,'projects.two.name');
 assert.deepEqual(fields[1].inventorySelectors,[selector(1,'name')]);assert.equal(fields[1].ongoingSource,undefined);
 const remapped=inheritFields([observed],[{pages:[{pathPrefix:'/form',fields:[{...old,constructionBlockers:['SEMANTIC_MAPPING_REQUIRED'],inventorySelectors:[selector(1,'name')],read:{selector:selector(1,'name'),kind:'value'}}]}]}],'/form',{mappings:[{selector:selector(1,'name'),status:'mapped',factKey:'projects.approved.name'}]});
 assert.equal(remapped[1].source,'projects.approved.name');assert.equal(remapped[1].id,'two');assert.deepEqual(remapped[1].constructionBlockers,[]);
});

test('a rebuild keeps the record counts and add control of the existing asset',()=>{
 const previous={pages:[{pathPrefix:'/form',groups:[group('Work',4)],after:[{method:'click'}]}]};
 const page=inheritPageContract({pathPrefix:'/form',roleTitle:'PM'},[previous]);
 assert.deepEqual(page.groups,previous.pages[0].groups);assert.deepEqual(page.after,previous.pages[0].after);assert.equal(page.roleTitle,'PM');
});
test('groups observed in this build win over the inherited ones, an empty list does not erase them',()=>{
 const previous={pages:[{pathPrefix:'/form',groups:[group('Work',4)]}]};
 assert.equal(inheritPageContract({pathPrefix:'/form',groups:[group('Work',3)]},[previous]).groups[0].count,3);
 assert.equal(inheritPageContract({pathPrefix:'/form',groups:[]},[previous]).groups[0].count,4);
});
test('a draft without groups does not hide the groups of the official asset, whichever comes first',()=>{
 const official={pages:[{pathPrefix:'/form',groups:[group('Work',4)]}]},draft={pages:[{pathPrefix:'/form'}]};
 assert.equal(inheritPageContract({pathPrefix:'/form'},[draft,official]).groups[0].count,4);
 assert.equal(inheritPageContract({pathPrefix:'/form'},[null,official]).groups[0].count,4);
});
test('a first build has nothing to inherit and stays as observed',()=>{
 assert.deepEqual(inheritPageContract({pathPrefix:'/form'},[]),{pathPrefix:'/form'});
 assert.deepEqual(inheritPageContract({pathPrefix:'/other'},[{pages:[{pathPrefix:'/form',groups:[group('Work',4)]}]}]),{pathPrefix:'/other'});
});
test('rebuilding a template keeps its groups and conditional controls the page is not showing now',()=>{
 const profile={facts:{name:{status:'known',value:'A'}},fieldRegistry:{}};
 const control=selector=>({selector,label:'Name',type:'text',tag:'input',required:true,renderer:'native',constructionBlockers:[]});
 const capture={companyId:'sample',pageUrl:'https://sample.test/form',observedAt:'2026-11-04T00:00:00.000Z',controls:[control('#a'),control('#new')]};
 const page={roleTitle:'PM',readySelector:'form',pathPrefix:'/form',sections:['Basic'],sectionDiscovery:{selector:'.s',titleSelector:'.t'}};
 const mappings=[{selector:'#a',factKey:'name'},{selector:'#new',factKey:'name'}];
 const previous=[{pages:[{pathPrefix:'/form',groups:[css],fields:[{read:{selector:'#a'},when:{source:'x',equals:'y'}},{read:{selector:'#gone'},when:{source:'x',equals:'z'}}]}]}];
 const built=buildFormTemplate({capture,profile,mappings,page,templateId:'sample',previous}).template.pages[0];
 assert.deepEqual(built.groups,[css]);
 assert.deepEqual(built.fields.map(f=>[f.read.selector,f.when?.equals]),[['#a','y'],['#new',undefined],['#gone','z']]);
 assert.equal(buildFormTemplate({capture,profile,mappings,page,templateId:'sample'}).template.pages[0].groups,undefined);
});

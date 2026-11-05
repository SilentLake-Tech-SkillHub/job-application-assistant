import test from 'node:test';
import assert from 'node:assert/strict';
import {inheritPageContract} from '../shared/repeat-groups.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';

const ref=(section,occurrence)=>'phoenixq:'+JSON.stringify({section,label:'Name',occurrence,part:'native',controlIndex:0});
const field=(id,section,occurrence,extra={})=>({id,inventorySelectors:[ref(section,occurrence)],read:{selector:ref(section,occurrence)},...extra});
const scope=title=>({title,headingSelector:'#h',containerSelector:'.c',recordSelector:'.r',addSelector:'#a',addLabel:'Add'});
const group=(title,count)=>({id:title,selector:'phoenixq:'+JSON.stringify({...scope(title),part:'repeatRecords'}),addSelector:'phoenixq:'+JSON.stringify({...scope(title),part:'repeatAdd'}),addLabel:'Add',count});
const css={id:'edu',selector:'#edu .row',addSelector:'#edu button',addLabel:'Add',count:2};

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

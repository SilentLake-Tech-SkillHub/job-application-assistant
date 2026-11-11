import test from 'node:test';import assert from 'node:assert/strict';
import {inspectEntryPage} from '../shared/entry-inspection.mjs';
import {RoleFlow} from '../shared/role-flow.mjs';
import {controlDOM} from '../shared/control-dom.mjs';
import vm from 'node:vm';
test('a missing rendered title returns bound-page loading diagnostics without navigation',async()=>{
 const origin='https://example.test',pageUrl=origin+'/campus/resume/123/apply',flow=Object.create(RoleFlow.prototype);
 const prior={pageId:'chrome:form'},entry={kind:'detail_to_form',detailPathPattern:'^/campus/position/(?<id>\\d+)/detail$',formPathPattern:'^/campus/resume/(?<id>\\d+)/apply$',formPathTemplate:'/campus/resume/{id}/apply'};
 flow.base=async()=>({prior,t:{taskId:'task',officialId:'123',url:origin+'/campus/position/123/detail',title:'Role'},c:{origin},entry});
 flow.browser={request:async method=>{if(method==='pageIdentity')return {pageUrl};if(method==='entryInspection')return {candidates:[]};throw Error('Unexpected mutation');},existingPage:async(url,options)=>{assert.equal(url,pageUrl);assert.deepEqual(options,{pageId:prior.pageId,readOnly:true});return {observe:async spec=>{assert.equal(spec.entryHealth,true);return {readyState:'complete',visibleControls:0};}};}};
 assert.equal((await flow.inspectEntry({stage:'form'})).pageHealth.visibleControls,0);
});
test('loading diagnostics expose response status and omit resource queries and numeric identities',()=>{
 const result=vm.runInNewContext('('+controlDOM.toString()+')({entryHealth:true})',{URL,Date,location:{href:'https://example.test/form'},document:{readyState:'complete',querySelectorAll:()=>[]},performance:{now:()=>6000,getEntriesByType:()=>[{name:'https://api.example.test/resumes/123456789?token=private',initiatorType:'fetch',duration:4000,responseStatus:503}]}});
 assert.equal(result.visibleControls,0);assert.equal(result.failedResources[0].status,503);
 assert.equal(result.failedResources[0].resource,'https://api.example.test/resumes/[id]');
 assert.equal(JSON.stringify(result).includes('private'),false);
});
test('entry inspection accepts only unique rendered title matches and never clicks',async()=>{
 let reads=0;const page={url:()=> 'https://example.test/form',locator:selector=>({count:async()=>selector.startsWith('span:')?1:0,innerText:async()=>{reads++;return '你正在投递职位: Test Role(J12345)';}})};
 const result=await inspectEntryPage(page,{stage:'form',expectedTitle:'Test Role(J12345)',entry:{form:{rolePrefix:'你正在投递职位:'}}});
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].titleMatches,true);assert.equal(result.configurationWritten,false);assert.equal(reads,1);
 assert.equal(result.candidates[0].roleSelector.includes('J12345'),false);assert.equal(result.candidates[0].roleSelector.includes('sc-'),false);
 const mismatch=await inspectEntryPage(page,{stage:'form',expectedTitle:'Other',entry:{form:{rolePrefix:'你正在投递职位:'}}});assert.deepEqual(mismatch.candidates,[]);
});
test('entry inspection refuses ambiguous candidates',async()=>{
 const page={url:()=> 'https://example.test/detail',locator:()=>({count:async()=>2,innerText:async()=>{throw Error('MUST_NOT_READ_AMBIGUOUS');}})};
 const r=await inspectEntryPage(page,{stage:'detail',expectedTitle:'Role(J12345)',entry:{form:{}}});assert.deepEqual(r.candidates,[]);
});
test('native DOM locator is derived and independently rechecked so templates do not need Playwright-only text syntax',async()=>{
 const css='body > main:nth-of-type(1) > span:nth-of-type(1)',text='你正在投递职位: Role(J12345)';
 const page={url:()=> 'https://example.test/form',locator:s=>({count:async()=>s.startsWith('span:')||s===css?1:0,innerText:async()=>text,evaluate:async()=>css})};
 const result=await inspectEntryPage(page,{stage:'form',expectedTitle:'Role(J12345)',entry:{form:{rolePrefix:'你正在投递职位:'}}});
 assert.equal(result.candidates[0].domSelector,css);assert.equal(result.candidates[0].domSelector.includes('sc-'),false);
});
test('detail diagnostics read only the same role unique existing page and preserve the bound form',async()=>{
 const origin='https://example.test',flow=Object.create(RoleFlow.prototype),calls=[];
 const entry={kind:'declarative_transition',detail:{location:{pathnamePattern:'^/detail$',query:{job:'$roleId'}}},form:{location:{pathnamePattern:'^/form$',query:{job:'$roleId'}}}};
 const prior={pageId:'chrome:form'},t={taskId:'task',officialId:'job',url:origin+'/detail?job=job',title:'Role(J12345)'};
 flow.base=async()=>({prior,t,c:{origin},entry});flow.boundElsewhere=async()=>new Map();
 flow.browser={request:async(method,args)=>{calls.push({method,args});if(method==='pageIdentity')return {pageUrl:origin+'/form?job=job'};if(method==='tabs')return [{id:'detail',browserChannel:'chrome',url:t.url},{id:'wrong',browserChannel:'chrome',url:origin+'/detail?job=other'}];if(method==='entryInspection')return {stage:args.stage};throw Error('UNEXPECTED_MUTATION');}};
 assert.equal((await flow.inspectEntry({stage:'detail'})).stage,'detail');assert.equal(prior.pageId,'chrome:form');assert.equal(calls.at(-1).args.pageId,'chrome:detail');
 flow.boundElsewhere=async()=>new Map([['chrome:detail','other-task']]);await assert.rejects(flow.inspectEntry({stage:'detail'}),/ROLE_EXISTING_PAGE_NOT_UNIQUE/);
 assert.equal(calls.some(c=>['openPage','act','roleEnterApplication'].includes(c.method)),false);
});
test('entry diagnostics can inspect a unique existing confirmed form after its old binding is lost',async()=>{
 const origin='https://example.test',flow=Object.create(RoleFlow.prototype),prior={pageId:'chrome:closed'};
 const t={taskId:'task',officialId:'job',url:origin+'/detail?job=job',title:'Role'};
 const entry={kind:'declarative_transition',detail:{location:{pathnamePattern:'^/detail$',query:{job:'$roleId'}}},form:{location:{pathnamePattern:'^/form$',query:{job:'$roleId'}}}};
 flow.base=async()=>({prior,t,c:{origin},entry});flow.boundElsewhere=async()=>new Map();
 flow.browser={request:async(method,args)=>{
  if(method==='pageIdentity')throw Error('ROLE_BROWSER_PAGE_LOST');
  if(method==='tabs')return [{id:'live',browserChannel:'chrome',url:origin+'/form?job=job'},{id:'wrong',browserChannel:'chrome',url:origin+'/form?job=other'}];
  if(method==='entryInspection')return args;
  throw Error('UNEXPECTED_MUTATION');
 }};
 const evidence=await flow.inspectEntry({stage:'form'});
 assert.equal(evidence.pageId,'chrome:live');
 assert.equal(prior.pageId,'chrome:closed');
});
test('catalog entry recipes provide the form shape required by a resident browser broker',async()=>{
 const origin='https://example.test',flow=Object.create(RoleFlow.prototype);
 const prior={pageId:'chrome:form'},t={taskId:'task',officialId:'123',url:origin+'/campus/position/123/detail',title:'Role'};
 const entry={kind:'detail_to_form',detailPathPattern:'^/campus/position/(?<id>\\d+)/detail$',formPathPattern:'^/campus/resume/(?<id>\\d+)/apply$',formPathTemplate:'/campus/resume/{id}/apply'};
 flow.base=async()=>({prior,t,c:{origin},entry});
 flow.browser={request:async(method,args)=>{
  if(method==='pageIdentity')return {pageUrl:origin+'/campus/resume/123/apply'};
  if(method==='entryInspection')return {prefix:args.entry.form.rolePrefix||''};
  throw Error('UNEXPECTED_MUTATION');
 }};
 assert.deepEqual(await flow.inspectEntry({stage:'form'}),{prefix:''});
});

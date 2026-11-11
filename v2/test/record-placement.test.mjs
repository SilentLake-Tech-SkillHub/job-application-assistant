import test from 'node:test';import assert from 'node:assert/strict';
import {placementFindings,nonRecordMembers,sectionCategory,recordContentFindings} from '../shared/record-placement.mjs';
const rules=[{经历:'employment',栏目:['工作'],没有这些栏目时:['实习']},{经历:'entrepreneurship',栏目:['工作','创业'],没有这些栏目时:['项目']},{经历:'internship',栏目:['实习']},{经历:'projects',栏目:['项目']},{经历:'workProjects',栏目:['项目']}];
const f=(section,i,source,label='x')=>({id:section+i+source,label,inventoryLabel:label,source,read:{selector:'phoenixq:'+JSON.stringify({section,occurrence:i,label})}});
test('a job goes into the internship section only when the form has no work section',()=>{
 const noWork={pages:[{fields:[f('实习经历',0,'employment.a.title'),f('项目经历',0,'projects.p.name')]}]};
 assert.deepEqual(placementFindings(noWork,rules),[]);
 const withWork={pages:[{fields:[f('实习经历',0,'employment.a.title'),f('工作经历',0,'employment.b.title')]}]};
 assert.equal(placementFindings(withWork,rules)[0].reason,'PREFERRED_SECTION_EXISTS');
});
test('entrepreneurship stays out of the project section when a work section exists',()=>{
 const t={pages:[{fields:[f('项目经历',0,'entrepreneurship.s.name'),f('工作经历',0,'employment.b.title')]}]};
 assert.equal(placementFindings(t,rules).length,1);
 assert.deepEqual(placementFindings({pages:[{fields:[f('项目经历',0,'entrepreneurship.s.name')]}]},rules),[]);
});
test('a job project may carry its job\'s members; other cross-kind records and non-record members are reported',()=>{
 const t={evidence:{recordParents:{'workProjects.w':'employment.e'}},pages:[{fields:[f('项目经历',0,'workProjects.w.name'),f('项目经历',0,'employment.e.title'),f('项目经历',0,'companyAnswers.c.duty')]}]};
 assert.deepEqual(placementFindings(t,rules),[]);
 assert.equal(nonRecordMembers(t)[0].source,'companyAnswers.c.duty');
 assert.equal(sectionCategory('career'),'工作');assert.equal(sectionCategory('internship_list'),'实习');assert.equal(sectionCategory('语言能力'),'语言');assert.equal(sectionCategory('works'),'作品');
});
test('construction content coverage finds an entirely missing family and duplicate named records independently of control coverage',()=>{
 const profile={entities:{employment:['a','b'],internship:['i'],projects:['p','excluded'],portfolio:['site']},applicationSelections:{projects:{projectIds:['p']}}};
 const groups=['internship','project','works'].map(section=>({id:section,sectionKey:section,addSelector:'#add-'+section}));
 const page={sections:[{title:'实习经历'},{title:'项目经历'},{title:'作品'}],groups,fields:[f('internship',0,'internship.i.title'),f('project',0,'projects.p.name'),f('project',1,'projects.p.name'),f('works',0,'portfolio.site.link')]};
 const findings=recordContentFindings({pages:[page]},profile,rules);
 assert.deepEqual(findings.map(item=>[item.record,item.reason]),[['employment.a','RECORD_CONTENT_MAPPING_REQUIRED'],['employment.b','RECORD_CONTENT_MAPPING_REQUIRED'],['projects.p','RECORD_CONTENT_DUPLICATED']]);
 page.fields=[f('internship',0,'internship.i.title'),f('internship',1,'employment.a.title'),f('internship',2,'employment.b.title'),f('project',0,'projects.p.name'),f('works',0,'portfolio.site.link')];
 assert.deepEqual(recordContentFindings({pages:[page]},profile,rules),[]);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {recordSourceBindingIssues,assertRecordSourceBindings} from '../shared/record-source-binding.mjs';
import {templateConstructionIssues} from '../shared/field-policy.mjs';
const field=(section,index,label,source,kind='text')=>({id:source+'-'+section,label,inventoryLabel:label,source,kind,inventorySelectors:['phoenixq:'+JSON.stringify({section,label,occurrence:index,part:'native',controlIndex:0})],read:{kind:'value'}});
const fixture=()=>({pages:[{fields:[field('实习经历',0,'单位名称','internship.example.company'),field('实习经历',0,'开始时间','internship.example.start','date'),field('实习经历',0,'结束时间','internship.example.end','date'),field('项目经历',0,'项目名称','projects.example.name'),field('项目经历',0,'开始时间','projects.example.start','date'),field('项目经历',0,'结束时间','projects.example.end','date')]}]});
test('same numeric occurrence in different sections never pairs one records dates with another record',()=>{
 const t=fixture();assert.deepEqual(recordSourceBindingIssues(t),[]);
 [t.pages[0].fields[1].source,t.pages[0].fields[4].source]=[t.pages[0].fields[4].source,t.pages[0].fields[1].source];
 [t.pages[0].fields[2].source,t.pages[0].fields[5].source]=[t.pages[0].fields[5].source,t.pages[0].fields[2].source];
 assert.equal(recordSourceBindingIssues(t).length,4);assert.ok(templateConstructionIssues(t).some(i=>i.reason==='RECORD_SOURCE_FAMILY_MISMATCH'));assert.throws(()=>assertRecordSourceBindings(t),/FORM_RECORD_SOURCE_BINDING_MISMATCH/);
});
test('different records in one section use their own naming anchors for every mapped member',()=>{
 const t=fixture();t.pages[0].fields.push(field('项目经历',1,'项目名称','workProjects.other.name'),field('项目经历',1,'开始时间','workProjects.other.start','date'));
 assert.deepEqual(recordSourceBindingIssues(t),[]);t.pages[0].fields.at(-1).source='projects.example.start';assert.equal(recordSourceBindingIssues(t).length,1);
});
test('an ambiguous naming scope fails closed while unrelated scalar dates are not guessed into a record',()=>{
 const t=fixture();t.pages[0].fields.push(field('项目经历',0,'公司名称','employment.other.company'));assert.ok(recordSourceBindingIssues(t).some(i=>i.reason==='RECORD_NAMING_ANCHOR_AMBIGUOUS'));
 assert.deepEqual(recordSourceBindingIssues({pages:[{fields:[field('个人信息',0,'出生日期','identity.birthDate','date')]}]}),[]);
});

test('every framework record container is checked, not only one locator format',()=>{
 const feishu=(n,label,source)=>({id:source+n,label,inventoryLabel:label,source,kind:'text',read:{selector:`#formily-item-project_list [class^="apply-form-array-card__"]:nth-child(${n}) [id="formily-item-x"] input`,kind:'value'}});
 const t={pages:[{fields:[feishu(1,'项目名称','projects.a.name'),feishu(1,'起止时间','internship.b.start'),feishu(2,'项目名称','projects.c.name'),feishu(2,'起止时间','projects.c.start')]}]};
 assert.equal(recordSourceBindingIssues(t).length,1);
 const cy=(n,label,source)=>({id:source+n,label,inventoryLabel:label,source,kind:'text',read:{selector:`[data-cy="education[${n}].x"]`,kind:'value'}});
 assert.equal(recordSourceBindingIssues({pages:[{fields:[cy(0,'学校名称','education.a.school.name.zh'),cy(0,'起止时间','education.b.start')]}]}).length,1);
});
test('a record derived from another record may inherit only from that recorded parent',async()=>{
 const {recordParentsFromProfile}=await import('../shared/record-source-binding.mjs');
 const profile={facts:{'workProjects.sf.name':{status:'known',value:'X',derivation:{source:'employment.sf.responsibilities'}},'projects.p.name':{status:'known',value:'Y'}}};
 const parents=recordParentsFromProfile(profile);assert.deepEqual(parents,{'workProjects.sf':'employment.sf'});
 const feishu=(label,source)=>({id:source,label,inventoryLabel:label,source,kind:'text',read:{selector:'#formily-item-project_list [class^="apply-form-array-card__"]:nth-child(1) input',kind:'value'}});
 const t={evidence:{recordParents:parents},pages:[{fields:[feishu('项目名称','workProjects.sf.name'),feishu('项目角色','employment.sf.title'),feishu('起止时间','employment.sf.start')]}]};
 assert.deepEqual(recordSourceBindingIssues(t),[]);
 t.pages[0].fields[1].source='employment.other.title';assert.equal(recordSourceBindingIssues(t).length,1);
 delete t.evidence.recordParents;t.pages[0].fields[1].source='employment.sf.title';assert.equal(recordSourceBindingIssues(t).length,2);
});

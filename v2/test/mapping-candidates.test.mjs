import test from 'node:test';import assert from 'node:assert/strict';
import {mappingCandidates} from '../shared/form-construction.mjs';
const known=(value,extra={})=>({status:'known',value,...extra});
const profile=facts=>({facts,fieldRegistry:Object.fromEntries(Object.keys(facts).map(key=>[key,{label:key,canonicalType:'string'}]))});
const suggestions=(p,label,extra={})=>mappingCandidates([{selector:'#field',label,...extra}],p)[0];
test('internal registry labels still expose both existing school records and preserve record ambiguity',()=>{
 const p=profile({'education.alpha.school.name.zh':known('Example University A'),'education.beta.school.name.zh':known('Example University B'),'education.gamma.school.name.zh':{status:'missing',value:null}});
 p.fieldRegistry['education.nonexistent.school.name.zh']={label:'学校名称'};
 const one=suggestions(p,'学校名称',{section:'教育经历',repeatIndex:0}),two=suggestions(p,'学校名称',{section:'教育经历',repeatIndex:1});
 assert.deepEqual(one.candidates.map(c=>c.factKey),['education.alpha.school.name.zh','education.beta.school.name.zh','education.gamma.school.name.zh']);
 assert.deepEqual(one.candidates,two.candidates);assert.equal(one.automaticMapping,false);assert.equal(one.context.recordSelection,'requires_semantic_review');assert.deepEqual(one.context.families,['education']);
 assert.ok(one.candidates.every(c=>!Object.hasOwn(c,'value')));
});
test('role hints use actual section family across industries and never relabel employment as internship',()=>{
 const p=profile({'employment.alpha.title':known('Role A'),'employment.beta.title':known('Role B'),'internship.gamma.title':known('Role C'),'projects.delta.role':known('Role D'),'workProjects.epsilon.role':known('Role E')});
 assert.deepEqual(suggestions(p,'职务',{section:'实习经历'}).candidates.map(c=>c.factKey),['internship.gamma.title']);
 assert.deepEqual(suggestions(p,'职位名称',{section:'工作经历'}).candidates.map(c=>c.factKey),['employment.alpha.title','employment.beta.title']);
 assert.deepEqual(suggestions(p,'职务',{group:'项目经历'}).candidates.map(c=>c.factKey),['projects.delta.role','workProjects.epsilon.role']);
 assert.equal(suggestions(p,'职务',{section:'工作经历'}).automaticMapping,false);
});
test('explicit internship labels do not default to a formal employer when section metadata is absent',()=>{
 const p=profile({'employment.alpha.company':known('Employer A'),'internship.beta.company':known('Employer B'),'employment.alpha.responsibilities':known('Employment facts'),'internship.beta.responsibilities':known('Internship facts')});
 assert.deepEqual(suggestions(p,'实习单位').candidates.map(c=>c.factKey),['internship.beta.company']);
 assert.deepEqual(suggestions(p,'实习内容').candidates.map(c=>c.factKey),['internship.beta.responsibilities']);
 const generic=suggestions(p,'公司名称');assert.deepEqual(new Set(generic.candidates.map(c=>c.family)),new Set(['employment','internship']));assert.equal(generic.automaticMapping,false);
});
test('generic dates preserve all same-family records and disclose year/day precision instead of inventing values',()=>{
 const p=profile({'awards.alpha.year':known('2021',{precision:'year'}),'awards.alpha.date':known('2021-06-01',{precision:'day'}),'education.alpha.start':known('2020-09-01',{precision:'day'}),'education.beta.start':known('2024-08-01',{precision:'day'}),'projects.gamma.start':known('2023-01-01',{precision:'day'})});
 const award=suggestions(p,'获奖时间',{section:'获奖情况',type:'date'}),year=award.candidates.find(c=>c.factKey.endsWith('.year')),day=award.candidates.find(c=>c.factKey.endsWith('.date'));
 assert.equal(year.sourcePrecision,'year');assert.equal(year.controlPrecision,'day');assert.equal(year.precisionCompatibility,'insufficient_source_precision');assert.equal(day.precisionCompatibility,'exact');
 const dates=suggestions(p,'开始时间',{section:'教育经历',type:'month'});assert.deepEqual(dates.candidates.map(c=>c.factKey),['education.alpha.start','education.beta.start']);assert.ok(dates.candidates.every(c=>c.precisionCompatibility==='projection_requires_review'));
});
test('project and work-project facts remain discoverable even when absent from entities lists',()=>{
 const p=profile({'projects.alpha.name':known('Project A'),'workProjects.beta.name':known('Project B'),'projects.alpha.description':known('Description A'),'workProjects.beta.description':known('Description B'),'education.alpha.major.zh':known('Major'),'education.alpha.major.application':known('Approved fallback')});p.entities={projects:['alpha']};
 assert.deepEqual(suggestions(p,'项目名称',{section:'项目经历'}).candidates.map(c=>c.factKey),['projects.alpha.name','workProjects.beta.name']);
 assert.equal(suggestions(p,'项目描述',{section:'项目经历'}).candidates.length,2);assert.deepEqual(suggestions(p,'专业名称',{section:'教育经历'}).candidates.map(c=>c.factKey),['education.alpha.major.zh']);
});
test('language type and abilities use only existing language facts, with known facts ahead of missing',()=>{
 const p=profile({'languages.alpha.name':known('Language A'),'languages.beta.name':known('Language B'),'languages.alpha.proficiency':{status:'missing',value:null},'languages.beta.proficiency':known('Existing proficiency'),'languages.beta.readingWriting':known('Existing reading/writing')});
 assert.equal(suggestions(p,'语言类型',{section:'语言能力'}).candidates.length,2);
 const ability=suggestions(p,'掌握程度',{section:'语言能力'});assert.equal(ability.candidates[0].factKey,'languages.beta.proficiency');
 assert.deepEqual(new Set(suggestions(p,'读写',{section:'语言能力'}).candidates.map(c=>c.factKey)),new Set(['languages.alpha.proficiency','languages.beta.proficiency','languages.beta.readingWriting']));
});
test('existing exact registry labels and aliases survive while unsupported or absent facts do not appear',()=>{
 const p=profile({'custom.existing':known('Private fact'),'employment.alpha.title':known('Formal role'),'internship.beta.title':known('Intern role'),'custom.secret':known('Secret')});
 p.fieldRegistry['custom.existing']={label:'Label alias',aliases:['自定义字段']};p.fieldRegistry['custom.absent']={label:'自定义字段'};p.fieldRegistry['custom.secret']={label:'自定义字段',neverStoreValue:true};
 assert.deepEqual(suggestions(p,'自定义字段').candidates.map(c=>c.factKey),['custom.existing']);
 p.fieldRegistry['employment.alpha.title'].label='职位名称';
 const role=suggestions(p,'职位名称',{section:'实习经历'});assert.equal(role.candidates[0].factKey,'internship.beta.title');assert.equal(role.candidates[1].factKey,'employment.alpha.title');assert.equal(role.candidates[1].contextMatch,'conflict');assert.equal(role.automaticMapping,false);
});
test('suggestions do not mutate source facts, registries, entities or captured controls',()=>{
 const p=profile({'education.alpha.degree':known('Degree'),'education.alpha.end':known('2027-07-01',{precision:'day'})}),controls=[{selector:'#field',label:'学位',section:'教育经历',repeatIndex:1}],before=structuredClone({p,controls});
 const r=mappingCandidates(controls,p);assert.equal(r[0].candidates[0].factKey,'education.alpha.degree');assert.deepEqual({p,controls},before);assert.equal(r[0].automaticMapping,false);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {selectApplicationProjects,assertSelectedProjects} from '../shared/project-selection.mjs';
test('a current project selection preserves historical facts and flags every dependent form without touching other sections',()=>{
 const p={sources:{},facts:{'projects.old.name':{value:'Old'},'employment.name':{value:'Company'}},entities:{projects:['old','new']},companyForms:{a:{companyId:'a',executionContract:{fields:[{source:'projects.old.name'}]}},b:{companyId:'b',executionContract:{fields:[{source:'employment.name'}]}}}};
 const facts=JSON.stringify(p.facts),r=selectApplicationProjects(p,{projectIds:['new'],evidence:'user chooses project section only'});
 assert.equal(JSON.stringify(p.facts),facts);assert.equal(p.entities.projects.includes('old'),true);assert.equal(r.affectedForms.length,1);assert.equal(p.companyForms.b.projectRefresh,undefined);
 assert.throws(()=>assertSelectedProjects(p,{pages:[{fields:[{source:'projects.old.name'}]}]}),/TEMPLATE_REFRESH/);assert.doesNotThrow(()=>assertSelectedProjects(p,{pages:[{fields:[{source:'projects.new.name'},{source:'employment.name'}]}]}));
});
test('unknown, empty or duplicate project selection and missing user evidence fail before changing the profile',()=>{
 for(const args of [{projectIds:['unknown'],evidence:'yes'},{projectIds:[],evidence:'yes'},{projectIds:['new','new'],evidence:'yes'},{projectIds:['new'],evidence:''}]){const p={entities:{projects:['new']}};assert.throws(()=>selectApplicationProjects(p,args));assert.equal(p.applicationSelections,undefined);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPending} from '../shared/field-policy.mjs';
import {continuationFor} from '../shared/workflow-continuation.mjs';
const field=(key,label)=>({id:key,source:`workProjects.${key}.description`,label,kind:'text',inventorySelectors:['phoenixq:'+JSON.stringify({section:'Projects',occurrence:0,label,part:'native'})],read:{selector:'#description'},actions:[],control:{type:'text'}});
test('an unregistered source belongs to mapping, while a registered missing answer remains a user question',()=>{
 assert.equal(classifyPending(field('new','Description'),{facts:{}}).kind,'mapping');
 assert.equal(classifyPending(field('new','Description'),{facts:{'workProjects.new.description':{status:'missing'}}}).kind,'answer');
});
test('continuation inspects the added record and routes its unregistered source to construction helpers',()=>{
 const template={pages:[{fields:[field('old','Description')],groups:[{sectionKey:'Projects',selector:'#rows',addSelector:'#add'}]}]};
 const profile={entities:{workProjects:['old','new']},facts:{'workProjects.old.description':{status:'known',value:'old'},'workProjects.new.name':{status:'known',value:'new'}}};
 const result=continuationFor({template,profile});
 assert.equal(result.state,'map');assert.equal(result.owner,'agent');assert.equal(result.requiresUser,false);
 assert.ok(result.nextTools.includes('capture_controls'));assert.ok(result.nextTools.includes('profile_map_questions'));
});

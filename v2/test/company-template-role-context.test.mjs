import test from 'node:test';import assert from 'node:assert/strict';
import {rolePageContract,matchesRole} from '../shared/role-identity.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';
import {hash} from '../shared/engine.mjs';
const template={id:'C00001',version:1,evidence:{sourceUrl:'https://example.test/form?id=old',observedAt:'fixture'},coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true},pages:[{pathPrefix:'/form',readySelector:'form',roleTitle:'Old role',roleSelector:'h1',roleIdentity:{parameter:'id',value:'old'},fields:[]}]};
test('one stored company template freezes each confirmed role without changing stored controls',async()=>{
 const before=JSON.stringify(template);
 const tasks=['one','two'].map(id=>({companyId:'C00001',roleId:id,pageUrl:'https://example.test/form?id='+id,templateHash:hash(template),values:{},confirmedRole:{title:'Role '+id,officialId:id}}));
 const plans=await Promise.all(tasks.map(task=>compileExecutionPlan(template,task)));
 assert.deepEqual(plans.map(p=>[p.pages[0].expected.roleTitle,p.pages[0].expected.roleIdentity.value]),[['Role one','one'],['Role two','two']]);
 assert.equal(JSON.stringify(template),before);
 const page=rolePageContract(template.pages[0],tasks[1].confirmedRole);
 assert.equal(matchesRole(page,{roleTitle:'Role one',roleIdentity:{parameter:'id',value:'one'}}),false);
 assert.equal(matchesRole(page,{roleTitle:'Role two',roleIdentity:{parameter:'id',value:'two'}}),true);
 await assert.rejects(assertPreparedPlan(plans[0],template,{...tasks[0],confirmedRole:tasks[1].confirmedRole,planId:plans[0].id,planHash:plans[0].planHash},{prepare:true}),/PREPARED_PLAN_CONTENT_CHANGED/);
});

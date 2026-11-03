import test from 'node:test';import assert from 'node:assert/strict';
import {registerObservedQuestions,lookupCompanyForm} from '../shared/profile.mjs';
import {validateFormIdentities} from '../shared/form-identity.mjs';
test('forms receive opaque increasing codes, remain scoped to a site and never reuse a deleted code',()=>{
 const profile={facts:{},companyForms:{},fieldRegistry:{}};
 const capture=(site,url)=>registerObservedQuestions(profile,{companyId:site,companyCode:'C00001',pageUrl:url,fields:[],observedAt:'synthetic'}).pageKey;
 const first=capture('S0001','https://one.test/form?jobId=1&userId=temporary');assert.equal(first,'F000001');
 assert.equal(capture('S0001','https://one.test/form?jobId=1&userId=changed'),first);
 const second=capture('S0001','https://one.test/form?jobId=2');assert.equal(second,'F000002');
 delete profile.companyForms[second];assert.equal(capture('S0002','https://two.test/form'),'F000003');
 assert.equal(lookupCompanyForm(profile,'S0002','https://one.test/form?jobId=1').form,undefined);
 assert.equal(validateFormIdentities(profile),true);
});

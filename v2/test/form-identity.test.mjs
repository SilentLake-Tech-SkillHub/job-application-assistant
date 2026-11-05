import test from 'node:test';import assert from 'node:assert/strict';
import {registerObservedQuestions,lookupCompanyForm} from '../shared/profile.mjs';
import {validateFormIdentities,formAssetKeys} from '../shared/form-identity.mjs';
test('one company owns one form identity across jobs, paths and refreshed URLs',()=>{
 const profile={facts:{},companyForms:{},fieldRegistry:{}};
 const capture=(companyId,pageUrl)=>registerObservedQuestions(profile,{companyId,pageUrl,fields:[],observedAt:'synthetic'}).pageKey;
 assert.equal(capture('C00001','https://one.test/form?jobId=1'),'C00001');
 assert.equal(capture('C00001','https://one.test/another?jobId=2'),'C00001');
 assert.equal(capture('C00002','https://one.test/form?jobId=1'),'C00002');
 assert.equal(Object.keys(profile.companyForms).length,2);
 assert.equal(lookupCompanyForm(profile,'C00003','https://one.test/form').form,undefined);
 assert.equal(validateFormIdentities(profile),true);
 assert.equal(profile.formCodeSequence,undefined);
 assert.equal(formAssetKeys('C00001').capture,'capture-C00001');
});
test('unmigrated form codes are reported as storage migration, not a company rebuild',()=>{
 assert.throws(()=>validateFormIdentities({companyForms:{F000001:{formId:'F000001',companyId:'S0001',siteId:'S0001',companyCode:'C00001'}}}),/COMPANY_CODE_MIGRATION_REQUIRED/);
});

import test from 'node:test';import assert from 'node:assert/strict';import{validateControlContract}from'../shared/value-contract.mjs';
const field=()=>({kind:'choice',control:{type:'dropdown',valueType:'string',readbackType:'string',options:['Exact major']},read:{kind:'text'},actions:[{method:'ant_dropdown',options:['Exact major'],optionTextMap:{'Exact major':'Use Exact major as my major'},observedOptionTexts:['Use Exact major as my major']}]});
test('manual school/major choice retains the exact sourced value and requires the actual observed option text',()=>{
 assert.doesNotThrow(()=>validateControlContract(field()));const a=field();a.actions[0].observedOptionTexts=[];assert.throws(()=>validateControlContract(a),/CHOICE_ALIAS_REQUIRES_CAPTURED_OPTION_TEXT/);
 const b=field();b.actions[0].optionTextMap['Other major']='Use Exact major as my major';assert.throws(()=>validateControlContract(b),/CHOICE_ALIAS_REQUIRES_CAPTURED_OPTION_TEXT/);
});

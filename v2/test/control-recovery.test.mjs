import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {annotateRecoveredControl} from '../shared/control-recovery.mjs';
import {canContinueAfterRecoveredControl} from '../shared/engine.mjs';
import {safeControlErrorDetails} from '../shared/control-error-details.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
const field={kind:'date',value:'2026-10',actions:[{method:'phoenix_date'}]};
async function failure(overrides={}){return annotateRecoveredControl(Error('PHOENIX_DATE_CELL_NOT_AVAILABLE'),{before:'',expected:field.value,read:async()=>'',isClosed:async()=>true,samePage:async()=>true,sleep:async()=>{},...overrides});}
test('a closed stable unchanged date permits independent work and retains the failed proof',async()=>{
 const e=await failure();assert.equal(e.details.phase,'restored_control_failure');assert.equal(e.details.valueMatches,false);assert.equal(e.details.unchangedFromBefore,true);assert.equal(canContinueAfterRecoveredControl(e,field),true);assert.deepEqual(safeControlErrorDetails(e.details),e.details);
});
test('a stable target without selection proof never becomes a successful selection',async()=>{
 const e=await failure({read:async()=>field.value});assert.equal(e.details.valueMatches,true);assert.equal(canContinueAfterRecoveredControl(e,field),true);assert.equal(e.selectionProof,undefined);
});
test('open popups, page changes, changed auxiliary controls and unstable intermediate values fail closed',async()=>{
 let count=0;for(const override of [{isClosed:async()=>false},{samePage:async()=>false},{auxiliaryRestored:async()=>false},{read:async()=>String(count++)},{read:async()=> 'partial'}])assert.equal(canContinueAfterRecoveredControl(await failure(override),field),false);
});
test('hash mismatch, unsupported controls and protected fields cannot release work',async()=>{
 const e=await failure();for(const patch of [{expectedValueHash:digest('other')},{popupClosed:false},{stableReadback:false},{pageUnchanged:false},{observedValueHash:digest('different')}])assert.equal(canContinueAfterRecoveredControl({...e,message:e.message,details:{...e.details,...patch}},field),false);
 for(const patch of [{sensitive:true},{userOnly:true},{kind:'file'},{actions:[{method:'fill'}]}])assert.equal(canContinueAfterRecoveredControl(e,{...field,...patch}),false);
 assert.equal(canContinueAfterRecoveredControl({...e,message:'LOGIN_ACCOUNT_MISMATCH'},field),false);
});

test('search and calendar readiness failures are deferred only with the same positive UI recovery evidence',async()=>{for(const reason of ['AUTOCOMPLETE_RESULTS_NOT_READY','PHOENIX_DATE_YEAR_NOT_CAPTURED','PHOENIX_DATE_MONTH_NOT_CAPTURED']){const e=await annotateRecoveredControl(Error(reason),{before:'',expected:field.value,read:async()=>field.value,isClosed:async()=>true,samePage:async()=>true,sleep:async()=>{}});const target=reason.startsWith('AUTOCOMPLETE_')?{...field,kind:'text',actions:[{method:'phoenix_autocomplete'}]}:field;assert.equal(canContinueAfterRecoveredControl(e,target),true);}});

test('raw UI exceptions require verified recovery, while unknown named kernel errors remain fatal',async()=>{
 const recover=error=>annotateRecoveredControl(error,{before:'',expected:field.value,read:async()=>'',isClosed:async()=>true,samePage:async()=>true,sleep:async()=>{}});
 const raw=await recover(Error('locator.press: Element cannot receive keyboard input'));assert.equal(raw.message,'CONTROL_OPERATION_FAILED_AFTER_RECOVERY');assert.equal(canContinueAfterRecoveredControl(raw,field),true);
 for(const reason of ['LOGIN_ACCOUNT_MISMATCH','PAGE_IDENTITY_CHANGED','UNKNOWN_KERNEL_POLICY']){const error=await recover(Error(reason));assert.equal(error.message,reason);assert.equal(error.details,undefined);assert.equal(canContinueAfterRecoveredControl(error,field),false);}
 const unsafe=await annotateRecoveredControl(Error('locator.press: failed'),{before:'',expected:field.value,read:async()=>'',isClosed:async()=>false,samePage:async()=>true});assert.equal(unsafe.details,undefined);assert.equal(unsafe.message,'locator.press: failed');
});

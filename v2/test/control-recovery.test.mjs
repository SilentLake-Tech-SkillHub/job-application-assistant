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

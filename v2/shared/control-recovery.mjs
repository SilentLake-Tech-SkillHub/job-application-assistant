import {createHash} from 'node:crypto';
const reasons=new Set(['AREA_CURRENT_SELECTION_NOT_VERIFIED','LIST_POPUP_SELECTION_PANE_REQUIRED','LIST_POPUP_CURRENT_ENTITY_NOT_VERIFIED','LIST_POPUP_SEARCH_RESULTS_NOT_READY','CHOICE_SELECTED_LABEL_MISMATCH','CHOICE_NOT_UNIQUE_OR_NOT_PRESENT','PHOENIX_DATE_CELL_NOT_AVAILABLE','PHOENIX_DATE_SELECTION_NOT_VERIFIED','PHOENIX_DATE_PRECISION_NOT_SUPPORTED','AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED','AUTOCOMPLETE_RESULTS_NOT_READY','PHOENIX_DATE_YEAR_NOT_CAPTURED','PHOENIX_DATE_MONTH_NOT_CAPTURED','PHOENIX_DATE_NAVIGATION_NOT_UNIQUE','PHOENIX_DATE_NAVIGATION_NOT_CHANGED','PHOENIX_DATE_COMMIT_NOT_VERIFIED','CONTROL_OPERATION_FAILED_AFTER_RECOVERY']);
export const isRecoverableControlReason=reason=>reasons.has(reason);
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
// Failed ordinary controls may release independent work only after actual UI
// recovery. This is neither a successful selection nor a final verification.
export async function annotateRecoveredControl(error,{before,expected,read,isClosed,samePage,auxiliaryRestored=async()=>true,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!error||typeof before!=='string'||typeof expected!=='string')return error;
 const known=isRecoverableControlReason(error.message);
 // Unknown named kernel errors retain their original stop semantics. A raw UI
 // exception may release work only after the same full positive recovery proof.
 if(!known&&(typeof error.message!=='string'||/^[A-Z_]+$/.test(error.message)))return error;
 try{
  if(!await samePage()||!await isClosed()||!await auxiliaryRestored())return error;
  const first=await read();await sleep(100);const second=await read();
  if(typeof first!=='string'||first!==second||!await samePage()||!await isClosed()||!await auxiliaryRestored()||second!==before&&second!==expected)return error;
  if(!known)error.message='CONTROL_OPERATION_FAILED_AFTER_RECOVERY';
  error.details={phase:'restored_control_failure',expectedValueHash:digest(expected),observedValueHash:digest(second),valueMatches:second===expected,readbackAvailable:true,originalValueHash:digest(before),unchangedFromBefore:second===before,popupClosed:true,stableReadback:true,pageUnchanged:true};
 }catch{}return error;
}

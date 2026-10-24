import {createHash} from 'node:crypto';
const reasons=new Set(['AREA_CURRENT_SELECTION_NOT_VERIFIED','LIST_POPUP_SELECTION_PANE_REQUIRED','CHOICE_SELECTED_LABEL_MISMATCH','CHOICE_NOT_UNIQUE_OR_NOT_PRESENT','PHOENIX_DATE_CELL_NOT_AVAILABLE','PHOENIX_DATE_SELECTION_NOT_VERIFIED','PHOENIX_DATE_PRECISION_NOT_SUPPORTED','AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED']);
export const isRecoverableControlReason=reason=>reasons.has(reason);
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
// Failed ordinary controls may release independent work only after actual UI
// recovery. This is neither a successful selection nor a final verification.
export async function annotateRecoveredControl(error,{before,expected,read,isClosed,samePage,auxiliaryRestored=async()=>true,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!isRecoverableControlReason(error?.message)||typeof before!=='string'||typeof expected!=='string')return error;
 try{
  if(!await samePage()||!await isClosed()||!await auxiliaryRestored())return error;
  const first=await read();await sleep(100);const second=await read();
  if(typeof first!=='string'||first!==second||!await samePage()||!await isClosed()||!await auxiliaryRestored()||second!==before&&second!==expected)return error;
  error.details={phase:'restored_control_failure',expectedValueHash:digest(expected),observedValueHash:digest(second),valueMatches:second===expected,readbackAvailable:true,originalValueHash:digest(before),unchangedFromBefore:second===before,popupClosed:true,stableReadback:true,pageUnchanged:true};
 }catch{}return error;
}

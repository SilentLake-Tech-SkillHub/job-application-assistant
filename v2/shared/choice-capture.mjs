import {capturedChoiceOptions} from './form-acquisition.mjs';
import {captureLockedChoice} from './locked-control.mjs';
import {capturedChoiceAction,choiceActionWithReadback} from './choice-actions.mjs';
export async function inspectCapturedChoice(page,capture,field,query){
 const native=capturedChoiceOptions(field);if(native)return native;
 if(field.disabled)return captureLockedChoice(page,field);
 const method=field.renderer==='phoenix_autocomplete'?'phoenix_autocomplete_inspect':field.renderer==='phoenix_select'?'phoenix_dropdown_inspect':field.contextProvider==='.ant-form-item'?'ant_dropdown_inspect':field.contextProvider==='.ud-formily-item'?'ud_dropdown_inspect':field.contextProvider==='.atsx-form-item'?'dropdown_inspect':null;
 if(!method)throw Error('CONTROL_DRIVER_REQUIRED');
 const action=choiceActionWithReadback(capturedChoiceAction(field,method),field.selectedSelector);
 return page.act({...(capture.provider==='feishu'?{provider:'feishu'}:{}),...action,query},null,{});
}

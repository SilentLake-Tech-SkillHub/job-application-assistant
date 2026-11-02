import {capturedChoiceOptions} from './form-acquisition.mjs';
import {captureLockedChoice} from './locked-control.mjs';
export async function inspectCapturedChoice(page,capture,field,query){
 const native=capturedChoiceOptions(field);if(native)return native;
 if(field.disabled)return captureLockedChoice(page,field);
 const method=field.renderer==='phoenix_autocomplete'?'phoenix_autocomplete_inspect':field.renderer==='phoenix_select'?'phoenix_dropdown_inspect':field.contextProvider==='.ant-form-item'?'ant_dropdown_inspect':field.contextProvider==='.ud-formily-item'?'ud_dropdown_inspect':field.contextProvider==='.atsx-form-item'?'dropdown_inspect':null;
 if(!method)throw Error('CONTROL_DRIVER_REQUIRED');
 const root=field.questionSelector||`.ud-formily-item:has(:is(${field.selector})):not(:has(.ud-formily-item :is(${field.selector})))`;
 return page.act({...(capture.provider==='feishu'?{provider:'feishu'}:{}),method,selector:field.actionSelector||field.selector,labelSelector:field.labelSelector||(field.contextProvider==='.ud-formily-item'?root+' > .ud-formily-item-label':undefined),query},null,{});
}

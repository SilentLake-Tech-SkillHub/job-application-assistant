export function capturedChoiceAction(field,method){
 const root=field.questionSelector||`.ud-formily-item:has(:is(${field.selector})):not(:has(.ud-formily-item :is(${field.selector})))`;
 const labelSelector=field.labelSelector||(field.contextProvider==='.ud-formily-item'?root+' > .ud-formily-item-label':field.contextProvider==='.atsx-form-item'&&field.questionSelector?field.questionSelector+' label':undefined);
 return {method,selector:field.actionSelector||field.selector,labelSelector,...(field.menuSelector?{menuSelector:field.menuSelector}:{}),...(field.type==='school_text'&&field.contextProvider==='.atsx-form-item'?{searchTrigger:'input'}:{})};
}

// The option input identifies the control. Its displayed selection is read
// independently from the selected-content target already bound to the field.
export function choiceActionWithReadback(action,selectedSelector){
 return selectedSelector&&['dropdown','dropdown_verify','dropdown_inspect'].includes(action.method)?{...action,selectedSelector}:action;
}

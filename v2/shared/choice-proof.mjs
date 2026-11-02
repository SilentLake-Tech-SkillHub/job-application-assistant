// Serializable DOM evidence. Never read component internals or infer a commit
// from the text in the combobox search input.
export function choiceProofDOM(node,spec={}){
 const record=n=>{const item=n.closest?.('[role="option"],[role="treeitem"],.ant-select-item-option,.ant-select-dropdown-menu-item,.ud__select__list__item,.phoenix-selectList__listItem')||n,attrs=['data-value','data-id','value'],attribute=attrs.find(a=>item.hasAttribute?.(a))||null,classes=String(item.className||'').split(/\s+/);return {label:(item.getAttribute?.('title')||item.querySelector?.('.ant-select-item-option-content')?.textContent||item.innerText||item.textContent||'').trim(),value:attribute?item.getAttribute(attribute):null,valueAttribute:attribute,domId:item.id||null,disabled:!!item.disabled||item.getAttribute?.('aria-disabled')==='true'||classes.some(c=>/(?:-|__)disabled$/.test(c)),selected:item.selected===true||item.getAttribute?.('aria-selected')==='true'||item.getAttribute?.('aria-checked')==='true'||classes.some(c=>/(?:-|__)selected$/.test(c))};};
 if(spec.operation==='options')return [...node.querySelectorAll(spec.selector)].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(record);
 return record(node);
}
export function confirmChoiceEvidence(candidate,reopened,{expectedLabel,blurredLabel}){
 if(candidate.disabled||reopened.disabled)throw Error('CHOICE_OPTION_DISABLED');
 if(candidate.label!==expectedLabel||reopened.label!==expectedLabel||blurredLabel!==expectedLabel)throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
 if(reopened.selected!==true)throw Error('CHOICE_REOPENED_OPTION_NOT_SELECTED');
 if(candidate.value!==null&&reopened.value!==candidate.value)throw Error('CHOICE_SELECTED_VALUE_MISMATCH');
 return {label:expectedLabel,value:reopened.value,valueAttribute:reopened.valueAttribute,blurConfirmed:true,reopenedOptionSelected:true,valueCompared:candidate.value!==null};
}

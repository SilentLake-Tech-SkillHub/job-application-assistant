// Read-only provider inventory. One record per atomic question, including extra controls
// outside normal wrappers. No answers, application state, cookies or framework data.
export function inventoryFeishuDOM() {
  const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
  const fields=[];
  const add=(selector,label,type,required=false,extra={})=>fields.push({selector,label,type,required,contextProvider:'.atsx-form-item',...extra,
    userOnly:/验证码|密码|身份证|护照号|银行卡|captcha|password|otp/i.test(label)});
  for(const row of document.querySelectorAll('.atsx-form-item[data-cy]')){
    if(!visible(row))continue;
    const key=row.getAttribute('data-cy'),label=row.querySelector('label')?.textContent.trim()||'',required=!!row.querySelector('.atsx-form-item-required');
    const selector=`.atsx-form-item[data-cy=${JSON.stringify(key)}]`;
    if(row.querySelector('.atsx-date-picker-period-month')){
      for(const side of ['Begin','End'])add(`[data-cy=${JSON.stringify(key+'Input'+side)}]`,label, 'month',required,{part:side});
    }else if(row.querySelector('.atsx-date-picker'))add(selector,label,'year',required);
    else {
      const combo=row.querySelector('[role="combobox"]'),input=row.querySelector('input,textarea');
      const type=combo?(key.endsWith('.school')?'school_text':'choice'):input?'text':'readonly';
      const searchSelector=type==='school_text'?(combo.tagName==='INPUT'?selector+' [role="combobox"]':combo.querySelectorAll('input:not([type="hidden"])').length===1?selector+' [role="combobox"] input:not([type="hidden"])':null):null;
      add(selector,label,type,required,{questionSelector:selector,labelSelector:row.querySelectorAll('label').length===1?selector+' label':null,actionSelector:combo?selector+' [role="combobox"]':input?selector+' input, '+selector+' textarea':null,searchSelector,readSelector:combo&&row.querySelector('[data-cy="contentRender"]')?selector+' [data-cy="contentRender"]':input?selector+' input, '+selector+' textarea':selector,selectedSelector:combo?selector+' .atsx-select-selection-selected-value':null,role:combo?'combobox':null});
    }
  }
  if(document.querySelector('.referralCode-section .atsx-radio-group'))add('.referralCode-section .atsx-radio-group','推荐方式','radio_group',true,{options:[...document.querySelectorAll('.referralCode-section .atsx-radio-group label')].map(n=>n.textContent.trim())});
  for(const row of document.querySelectorAll('.referralCode-section .atsx-form-item:not([data-cy])')){
    const label=row.querySelector('label')?.textContent.trim();
    if(label==='意向城市')add('.referralCode-section .customResumeForm-fieldName-with-desc-item','意向城市','readonly',true);
    else if(label&&label!=='推荐方式'){
      const input=row.querySelector('input');
      add(input?.placeholder?`.referralCode-section input[placeholder=${JSON.stringify(input.placeholder)}]`:`.referralCode-section [data-unmapped-label=${JSON.stringify(label)}]`,label,'text',!!row.querySelector('.atsx-form-item-required'));
    }
  }
  const resumeRoot=document.querySelector('.uploadResume-section');
  if(resumeRoot?.querySelectorAll('input[type="file"]').length===1){
    const required=resumeRoot.classList.contains('createFormSection-require')||!!resumeRoot.querySelector('.atsx-form-item-required');
    add('.uploadResume-section input[type="file"]','附件简历','file',required,{uploadContainerSelector:'.uploadResume-section',filenameSelector:'.uploadFile-loadedFilename',uploadedSelector:'.uploadResume-section .uploadFile-loadedWrapper'});
  }
  const workGroups=[...document.querySelectorAll('.resumeEditForm-item.resumeEditForm-works')];
  for(const row of workGroups){
    const input=row.querySelector('input[id$=".link"]');
    if(input&&row.querySelectorAll('input[type="file"]').length===1){
      const root=`.resumeEditForm-item.resumeEditForm-works:has([id=${JSON.stringify(input.id)}])`;
      const custom=!!row.querySelector('.uploadFile');
      add(root+' input[type="file"]','作品附件','file',false,{uploadContainerSelector:root,filenameSelector:custom?'.uploadFile-loadedFilename':'.atsx-upload-list-item-name-text',uploadedSelector:root+(custom?' .uploadFile-loadedWrapper':' .atsx-upload-list-item-done')});
    }
  }
  if(document.querySelector('.resumeEditForm-career input[type="checkbox"]'))add('.resumeEditForm-career input[type="checkbox"]','没有工作经历','checkbox');
  // A newly introduced question without data-cy still enters the mandatory registry.
  for(const row of document.querySelectorAll('.atsx-form-item:not([data-cy])')){
    if(!visible(row)||row.closest('.referralCode-section'))continue;
    const label=row.querySelector('label')?.textContent.trim();if(!label)continue;
    if(row.closest('.resumeEditForm-item.resumeEditForm-works')&&label==='作品附件')continue;
    add(`unmapped-question:${label}`,label,'unknown',!!row.querySelector('.atsx-form-item-required'));
  }
  return fields.map(field=>{
    if(field.selector.startsWith('unmapped-question:'))return field;
    const nodes=[...document.querySelectorAll(field.selector)];
    if(nodes.length!==1)return field;
    const node=nodes[0];
    if(node.id&&document.querySelectorAll('#'+CSS.escape(node.id)).length===1)return {...field,diagnosticSelector:'#'+CSS.escape(node.id)};
    const parts=[];
    for(let current=node;current&&current!==document.body;current=current.parentElement){
      let position=1;
      for(let previous=current.previousElementSibling;previous;previous=previous.previousElementSibling)if(previous.tagName===current.tagName)position++;
      parts.unshift(current.tagName.toLowerCase()+':nth-of-type('+position+')');
    }
    return {...field,diagnosticSelector:'body > '+parts.join(' > ')};
  });
}

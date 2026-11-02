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
      add(selector,label,type,required,{questionSelector:selector,actionSelector:combo?selector+' [role="combobox"]':input?selector+' input, '+selector+' textarea':null,readSelector:combo&&row.querySelector('[data-cy="contentRender"]')?selector+' [data-cy="contentRender"]':input?selector+' input, '+selector+' textarea':selector,selectedSelector:row.querySelector('.atsx-select-selection-selected-value')?selector+' .atsx-select-selection-selected-value':null,role:combo?'combobox':null});
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
  if(document.querySelector('.uploadResume-section input[type="file"]'))add('.uploadResume-section input[type="file"]','附件简历','file');
  const workGroups=[...document.querySelectorAll('.resumeEditForm-item.resumeEditForm-works')];
  for(const row of workGroups){
    const input=row.querySelector('input[id$=".link"]');
    if(input&&row.querySelector('input[type="file"]'))add(`.resumeEditForm-item.resumeEditForm-works:has([id=${JSON.stringify(input.id)}]) input[type="file"]`,'作品附件','file');
  }
  if(document.querySelector('.resumeEditForm-career input[type="checkbox"]'))add('.resumeEditForm-career input[type="checkbox"]','没有工作经历','checkbox');
  // A newly introduced question without data-cy still enters the mandatory registry.
  for(const row of document.querySelectorAll('.atsx-form-item:not([data-cy])')){
    if(!visible(row)||row.closest('.referralCode-section'))continue;
    const label=row.querySelector('label')?.textContent.trim();if(!label)continue;
    if(row.closest('.resumeEditForm-item.resumeEditForm-works')&&label==='作品附件')continue;
    add(`unmapped-question:${label}`,label,'unknown',!!row.querySelector('.atsx-form-item-required'));
  }
  return fields;
}

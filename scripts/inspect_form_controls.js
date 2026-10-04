/* Read-only DOM inventory. It deliberately never reads input values or auth state. */
(function (root) {
  'use strict';
  function inspectApplicationForm(doc) {
    const win = doc.defaultView;
    const text = n => (n?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const shown = n => {for(let p=n;p&&p.nodeType===1;p=p.parentElement){const s=win.getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||p.hidden)return false;}return !!n.getClientRects().length;};
    const esc = s => win.CSS?.escape ? win.CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
    const path = n => {if(n.id && doc.querySelectorAll('#'+esc(n.id)).length===1)return '#'+esc(n.id);const parts=[];for(let p=n;p&&p!==doc.body;p=p.parentElement){let k=1;for(let q=p.previousElementSibling;q;q=q.previousElementSibling)if(q.tagName===p.tagName)k++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+k+')');}return 'body > '+parts.join(' > ');};
    const raw=[...doc.querySelectorAll('input,select,textarea,button,[role="combobox"],[role="radio"],[role="checkbox"],[role="textbox"],.el-select,.el-cascader,.el-date-editor,.ant-select,.ant-picker')];
    const accepted=new Set(), fields=[];
    for(const n of raw){
      if(n.tagName==='INPUT' && (n.type==='hidden'||n.type==='password'||/password|passwd|otp|captcha|verification.?code|access.?token|csrf/i.test([n.name,n.id,n.autocomplete].join(' '))))continue;
      const wrapper=n.closest('.el-select,.el-cascader,.el-date-editor,.ant-select,.ant-picker');
      const outer=wrapper||n;
      const inner=outer.matches('input,select,textarea,button')?outer:outer.querySelector('input,select,textarea');
      if(inner?.type==='password'||/password|passwd|otp|captcha|verification.?code|access.?token|csrf/i.test([inner?.name,inner?.id,inner?.autocomplete].join(' ')))continue;
      // File inputs are often visually hidden behind an upload button; retain their metadata.
      if((n.type!=='file'&&!shown(outer))||accepted.has(outer))continue;
      if(n.tagName==='BUTTON'&&n.closest('.el-select,.el-cascader,.el-date-editor,.ant-select,.ant-picker'))continue;
      accepted.add(outer);
      const control=outer.matches('input,select,textarea,button')?outer:outer.querySelector('input,select,textarea');
      const role=outer.getAttribute('role')||n.getAttribute('role')||'';
      const box=outer.closest('.info_box,.ant-form-item,.el-form-item,[data-field]');
      const labelNode=box?.querySelector('.subtitle,.ant-form-item-label,.el-form-item__label,[data-label]');
      const labels=control?.labels?.length?[...control.labels].map(text).join(' '):'';
      const labelled=(control?.getAttribute('aria-labelledby')||outer.getAttribute('aria-labelledby'))?.split(/\s+/).map(id=>text(doc.getElementById(id))).join(' ');
      const ariaLabel=control?.getAttribute('aria-label')||outer.getAttribute('aria-label');
      const boxControls=box?[...box.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="textbox"]')].filter(x=>shown(x)&&x.type!=='password'):[];
      const sharedContainer=boxControls.length>1;
      const label=labels||labelled||ariaLabel||(!sharedContainer?text(labelNode):'')||'';
      const labelSource=labels?'label':labelled?'aria-labelledby':ariaLabel?'aria-label':label?'single-control-container':'unresolved';
      const classHint=String(outer.className||'');
      let kind='unknown', action='inspect_in_ui', confidence='low';
      if(control?.type==='file'){kind='file';action='upload_file';}
      else if(outer.matches('.el-cascader')){kind='cascader';action='click_each_level';}
      else if(outer.matches('.el-date-editor,.ant-picker')||['date','datetime-local','month','week','time'].includes(control?.type)||/calendar/.test(outer.getAttribute('aria-haspopup')||'')){kind='date_picker';action='click_actual_date_cells';}
      else if(outer.tagName==='SELECT'){kind=outer.multiple?'multi_select':'select';action='select_actual_option';}
      else if(outer.matches('.el-select,.ant-select')||role==='combobox'||control?.getAttribute('role')==='combobox'||outer.getAttribute('aria-haspopup')==='listbox'){kind=/multiple|multiple-selection/.test(classHint)?'multi_select':'select';action='open_and_click_actual_option';}
      else if(control?.type==='radio'||role==='radio'){kind='radio';action='click_actual_choice';}
      else if(control?.type==='checkbox'||role==='checkbox'){kind='checkbox';action='click_actual_choice';}
      else if(outer.tagName==='BUTTON'){kind='button';action='inspect_button_purpose';}
      else if(control?.tagName==='TEXTAREA'||control?.tagName==='INPUT'||role==='textbox'){kind=control?.readOnly?'readonly_input':'text';action=control?.readOnly?'inspect_in_ui':'type_text_and_blur';}
      if(kind!=='unknown')confidence=kind==='readonly_input'?'low':'high';
      const disabled=!!(control?.disabled||outer.getAttribute('aria-disabled')==='true'||outer.closest('fieldset[disabled]'));
      if(disabled)action='skip_until_dependency_resolved';
      const listId=control?.getAttribute('aria-controls')||outer.getAttribute('aria-controls');
      const list=listId?doc.getElementById(listId):null;
      const options=outer.tagName==='SELECT'?outer.options:list?.querySelectorAll('[role="option"]');
      const evidence=[outer.tagName.toLowerCase(),role?`role=${role}`:'',wrapper?`wrapper=${classHint.split(/\s+/).filter(x=>/^el-|^ant-/.test(x)).join(' ')}`:'',control?.readOnly?'readonly':'',control?.type?`input_type=${control.type}`:''].filter(Boolean);
      const errorIds=(control?.getAttribute('aria-errormessage')||outer.getAttribute('aria-errormessage')||'').split(/\s+/).filter(Boolean);
      const descriptionIds=(control?.getAttribute('aria-describedby')||outer.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      const errorNodes=errorIds.map(id=>doc.getElementById(id)).filter(Boolean);
      for(const id of descriptionIds){const e=doc.getElementById(id);if(e?.matches('[role="alert"],.verify-tip-no-data,.ant-form-item-explain-error,.el-form-item__error'))errorNodes.push(e);}
      const ownError=!sharedContainer?box?.querySelector('.verify-tip-no-data,.ant-form-item-explain-error,.el-form-item__error'):null;
      const ariaInvalid=control?.getAttribute('aria-invalid')??outer.getAttribute('aria-invalid');
      const automationId=(control||outer).getAttribute('data-automation-id');
      const automationMatchCount=automationId?doc.querySelectorAll('[data-automation-id="'+esc(automationId)+'"]').length:null;
      fields.push({index:fields.length,label,locator:path(outer),controlLocator:control?path(control):null,kind,action,confidence,evidence,required:!!(control?.required||outer.getAttribute('aria-required')==='true'||control?.getAttribute('aria-required')==='true'||(!sharedContainer&&(box?.querySelector('.is-required,.ant-form-item-required')||/[＊*]/.test(text(labelNode))))),disabled,readonly:!!control?.readOnly,multiple:!!control?.multiple||kind==='multi_select',maxLength:control?.getAttribute('maxlength')||null,accept:control?.getAttribute('accept')||null,placeholder:control?.getAttribute('placeholder')||null,optionCount:options?.length??null,optionsNeedOpening:['select','multi_select','cascader'].includes(kind)&&options==null,validationErrorVisible:!!ownError&&shown(ownError),dependencyReview:['date_picker','select','multi_select','cascader','checkbox','radio'].includes(kind),displayedValueIsProof:false});
      Object.assign(fields[fields.length-1],{labelSource,sharedContainer,fieldIdentityNeedsReview:!label||labelSource==='single-control-container',ariaInvalid,automationMatchCount,validationErrorVisible:errorNodes.some(shown)||!!ownError&&shown(ownError)||ariaInvalid!=null&&!['false',''].includes(ariaInvalid),validationAssociationNeedsReview:sharedContainer&&!errorIds.length&&!descriptionIds.length});
    }
    return {schemaVersion:2,readOnly:true,valuesIncluded:false,scope:'rendered DOM including offscreen controls; excludes hidden sections and authentication inputs',coverageLimit:'Unrendered steps, collapsed sections, iframe contents, shadow roots and dynamic options require separate UI inspection and a new scan.',count:fields.length,fields};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={inspectApplicationForm};
  else root.inspectApplicationForm=inspectApplicationForm;
})(typeof globalThis!=='undefined'?globalThis:this);

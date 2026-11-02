// Locate sensitive inputs from labels/attributes without reading their values.
// Read-only résumé summaries can render government numbers as text nodes.
export function screenshotMaskDOM(){
 const selectors=[];for(const n of document.querySelectorAll('input,textarea')){
  const q=n.closest('.ant-form-item,.ud-formily-item,.atsx-form-item,.form-item--phoenix,[data-form-question]'),label=q?.querySelector('.ant-form-item-label,.ud-formily-item-label,.form-item__title .form-item__text,label')?.textContent||'',prefix=q?.querySelector('.form-item__control .phoenix-button__content')?.textContent||'';
  const identity=[n.type,n.id,n.name,n.getAttribute('placeholder'),n.getAttribute('aria-label'),label,prefix].join(' ');
  if(n.type!=='password'&&!/验证码|证件号|身份证|护照号|银行卡|otp|password|validCode|national.?id|identity.?number|document.?number|passport|bank.?account/i.test(identity))continue;
  if(n.id&&!/\d{8,}/.test(n.id)&&document.querySelectorAll('#'+CSS.escape(n.id)).length===1){selectors.push('#'+CSS.escape(n.id));continue;}
  const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}selectors.push('body > '+parts.join(' > '));
 }
 for(const n of document.querySelectorAll('body *')){
  if(['SCRIPT','STYLE','NOSCRIPT'].includes(n.tagName)||![...(n.childNodes||[])].some(t=>t.nodeType===3&&/\b\d{17}[\dXx]\b/.test(t.textContent||'')))continue;
  if(n.id&&!/\d{8,}/.test(n.id)&&document.querySelectorAll('#'+CSS.escape(n.id)).length===1){selectors.push('#'+CSS.escape(n.id));continue;}
  const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}if(parts.length)selectors.push('body > '+parts.join(' > '));
 }
 return [...new Set(selectors)];
}

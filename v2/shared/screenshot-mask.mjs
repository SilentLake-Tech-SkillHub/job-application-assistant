// Locate sensitive inputs from labels/attributes only; never read their values.
export function screenshotMaskDOM(){
 const selectors=[];for(const n of document.querySelectorAll('input,textarea')){
  const q=n.closest('.ant-form-item,.ud-formily-item,.atsx-form-item,[data-form-question]'),label=q?.querySelector('.ant-form-item-label,.ud-formily-item-label,label')?.textContent||'';
  const identity=[n.type,n.id,n.name,n.getAttribute('placeholder'),n.getAttribute('aria-label'),label].join(' ');
  if(n.type!=='password'&&!/验证码|证件号码|身份证|护照号|银行卡|otp|password|validCode/i.test(identity))continue;
  if(n.id&&document.querySelectorAll('#'+CSS.escape(n.id)).length===1){selectors.push('#'+CSS.escape(n.id));continue;}
  const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}selectors.push('body > '+parts.join(' > '));
 }
 return selectors;
}

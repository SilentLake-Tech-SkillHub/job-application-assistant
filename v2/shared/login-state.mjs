// 登录态不再从页面痕迹推断（C32，2026-11-12 用户决定）：是否已登录由站点自己证明——
// 点一次真实入口，落到申请表就是已登录，落到登录页就是未登录（见 role-flow.mjs enter）。
// 这里只保留“当前页面是不是登录页”的最小识别：登录 URL、登录表单/验证码/密码框、页面上的“登录”入口、登录对话框。
// 它是未登录分支的判据，用来区分“未登录”和“落地页还没加载好”，不读账号文本、不读凭证。
export function sessionFromSnapshot(s){
 return {loginFormPresent:s.loginFormPresent===true||s.form===true};
}
// Serializable DOM reader shared by the Chrome and native-host bridges.
// 2026-11-16 补全（任务单 C42，用户：“改”）：没登录时不跳登录页的站点也要认出来——
// 页头等处可点的“登录／请登录／登录注册”文字（不限按钮元素，只看元素自己的文字），以及带登录字样、有手机号／验证码／密码输入的对话框。
// 仍只识别“是不是登录页／登录入口”，不读账号文本、不读凭证。
export function loginStateDOM({loginRoot}={}){
 const visible=n=>!!n&&n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
 const any=s=>{if(!s)return false;try{return [...document.querySelectorAll(s)].some(visible);}catch{return false;}};
 const loginUrl=/(?:^|\/)(?:login|signin|sign-in)(?:\/|$)/i.test(location.pathname);
 const LOGIN=/^(?:(?:请|立即|去)?(?:登录|登陆)(?:\s*[\/／|｜、]?\s*注册)?|注册\s*[\/／|｜、]?\s*(?:登录|登陆)|sign\s*in|log\s*in|login)$/i;
 const control='a,button,[role="button"],[role="link"]';
 // 元素自己的文字（不含子元素），用于页头 span／div 这类不是按钮的登录入口。
 const own=n=>[...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent).join('').trim();
 const clickable=n=>n.hasAttribute('onclick')||getComputedStyle(n).cursor==='pointer';
 const loginControl=[...document.querySelectorAll(control)].some(n=>LOGIN.test(n.textContent.trim())&&visible(n))
  ||[...document.querySelectorAll('span,div,li,p,em,strong')].some(n=>LOGIN.test(own(n))&&clickable(n)&&visible(n));
 const credentialInput=i=>visible(i)&&(['tel','password'].includes(i.type)||i.autocomplete==='one-time-code'||/手机|验证码|密码|phone|password|code/i.test(i.placeholder||''));
 const loginDialog=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].some(d=>visible(d)&&/登录|登陆|log\s*in|sign\s*in/i.test(d.textContent)&&[...d.querySelectorAll('input')].some(credentialInput));
 const form=loginUrl||loginControl||loginDialog||any(loginRoot)||any('input[autocomplete="one-time-code"], input[type="password"]');
 return {loginFormPresent:form};
}

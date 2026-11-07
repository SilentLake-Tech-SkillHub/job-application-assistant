// Login evidence is independent of the user's stored account identity.
export function sessionFromSnapshot(s){
 const form=s.loginFormPresent===true||s.form===true;
 const authenticated=!form&&(s.authenticated===true||s.sessionStatus==='authenticated'||typeof s.account==='string'&&s.account.trim().length>0);
 return {authenticated,loginFormPresent:form,sessionStatus:form?'logged_out':authenticated?'authenticated':'unknown'};
}
// Serializable DOM reader shared by the Chrome and native-host bridges.
export function loginStateDOM({loginRoot,accountSelector,sessionSelectors={}}={}){
 const visible=n=>!!n&&n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
 const any=s=>{if(!s)return false;try{return [...document.querySelectorAll(s)].some(visible);}catch{return false;}};
 const loginUrl=/(?:^|\/)(?:login|signin|sign-in)(?:\/|$)/i.test(location.pathname);
 const loginControl=[...document.querySelectorAll('a,button,[role="button"]')].some(n=>visible(n)&&/^(登录|登陆|登录\s*[\/／]\s*注册|注册\s*[\/／]\s*登录|Sign in|Log in)$/i.test(n.textContent.trim()));
 const form=loginUrl||loginControl||any(sessionSelectors.loggedOut)||any(loginRoot)||any('input[autocomplete="one-time-code"], input[type="password"]');
 const logout=[...document.querySelectorAll('a,button,[role="button"]')].some(n=>visible(n)&&/^(退出登录|退出登陆|退出账号|登出|Sign out|Log out)$/i.test(n.textContent.trim()));
 const authenticated=!form&&(any(sessionSelectors.authenticated)||any(accountSelector)||logout);
 return {authenticated,loginFormPresent:form,sessionStatus:form?'logged_out':authenticated?'authenticated':'unknown'};
}

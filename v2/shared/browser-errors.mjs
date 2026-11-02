import {createHash} from 'node:crypto';
export const TRANSIENT_BROWSER_ERRORS=new Set(['BROWSER_OPERATION_TIMEOUT','BROWSER_PAGE_CLOSED','BROWSER_NAVIGATION_INTERRUPTED','BROWSER_CONNECTION_LOST','BROWSER_HOST_NOT_AVAILABLE','BROWSER_HOST_OPERATION_TIMEOUT','ROLE_BROWSER_PAGE_LOST']);
export function browserErrorCode(error){
 const text=String(error?.message||'');
 if(/^[A-Z_]+$/.test(text)&&!/^E(?:CONN|PIPE|TIMEDOUT)/.test(text))return text;
 if(/closed|has been disposed|target.*gone/i.test(text))return 'BROWSER_PAGE_CLOSED';
 if(/navigation.*interrupt|execution context was destroyed|navigation.*abort/i.test(text))return 'BROWSER_NAVIGATION_INTERRUPTED';
 if(/disconnect|ECONNRESET|ECONNREFUSED|socket hang up|connection.*closed|connect.*fail/i.test(text))return 'BROWSER_CONNECTION_LOST';
 if(error?.name==='TimeoutError'||/timed?\s*out|timeout/i.test(text))return 'BROWSER_OPERATION_TIMEOUT';
 if(/element.*not found|no.*element|selector.*not found/i.test(text))return 'BROWSER_ELEMENT_NOT_FOUND';
 return 'BROWSER_OPERATION_FAILED';
}
export function sanitizeBrowserMessage(value){
 if(/\b(?:otp|bearer|password|cookie|authorization|secret|token)\b/i.test(String(value||'')))return '[sensitive exception message redacted]';
 return String(value||'').replace(/https?:\/\/[^\s)'"<>]+/g,url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '[url]';}})
  .replace(/(["'`])[^\n]*?\1/g,'[quoted value redacted]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
  .replace(/\b\d{5,}[\dXx]*\b/g,'[number]').slice(0,500);
}
export function browserErrorDetails(error,{method,step,locator}={}){
 locator=error?.operationLocator||locator;
 return {phase:'browser_operation',operation:method||'unknown',step:step||error?.operationStep||'browser_operation',locator:typeof locator==='string'?sanitizeBrowserMessage(locator):null,locatorHash:typeof locator==='string'?createHash('sha256').update(locator).digest('hex'):null,nextAction:browserErrorCode(error)==='BROWSER_ELEMENT_NOT_FOUND'?'reacquire_entry_and_preview':/QUESTION_NOT_FOUND|CONTROL_CHANGED|REPEAT_SECTION_NOT_FOUND/.test(browserErrorCode(error))?'reacquire_control':'inspect_failure',requiresUserConfirmation:browserErrorCode(error)==='BROWSER_ELEMENT_NOT_FOUND'};
}
// Total attempts are bounded. Retry only operations whose owner has verified
// idempotence; never use this wrapper for submit, SMS, consent or arbitrary act.
export async function retryBrowserOperation(operation,{retrySafe=false,recover,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let attempt=0;;attempt++){
  try{return await operation();}catch(error){
   if(!retrySafe||!TRANSIENT_BROWSER_ERRORS.has(browserErrorCode(error))||attempt>=2)throw error;
   await sleep([250,750][attempt]);if(recover)await recover(error,attempt+1);
  }
 }
}

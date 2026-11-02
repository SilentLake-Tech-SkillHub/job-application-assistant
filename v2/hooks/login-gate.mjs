// Called inside every mutating MCP operation, regardless of host hook support.
export function beforeLoginStep({step,state,authorization,acceptance}){
  if(!authorization?.login||!authorization?.evidence)throw Error('LOGIN_AUTHORIZATION_REQUIRED');
  if(state.accountMismatch)throw Error('LOGIN_ACCOUNT_MISMATCH');
  if(state.challenges)throw Error('USER_VERIFICATION_REQUIRED');
  if(state.unknownPopup)throw Error('UNKNOWN_LOGIN_POPUP');
  if(['send','verify'].includes(step)&&!acceptance)throw Error('PRIVACY_ACCEPTANCE_REQUIRED');
  if(step==='send'&&state.sendDisabled)throw Error('SMS_CONTROL_NOT_READY');
  if(step==='verify'&&!state.otpPresent)throw Error('OTP_CONTROL_NOT_PRESENT');
  return {passed:true,step};
}
export function canHandoff(result){return result.status==='authenticated'&&result.accountMatched===true&&result.loginFormAbsent===true&&result.applicationSubmission==='not_performed';}

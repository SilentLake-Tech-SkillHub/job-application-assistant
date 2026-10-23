import {lookupCompanyForm} from './profile.mjs';
import {resolveDateRepresentation} from './date-representation.mjs';
// A real representation conflict can wait for a user decision. An arbitrary
// explanation, unfinished mapping, or absent capture cannot grant a wait.
export function ongoingDateUserWait({companyId,capture,choices,selectors,profile,question}){
 if(!question?.trim()||!selectors?.length||capture.companyId!==companyId||choices.companyId!==companyId||choices.captureId!==capture.captureId||choices.pageUrl!==capture.pageUrl)throw Error('USER_WAIT_CAPTURE_SCOPE_REQUIRED');
 const {form}=lookupCompanyForm(profile,companyId,capture.pageUrl),fields=[];
 for(const selector of selectors){
  const control=capture.controls.find(c=>c.selector===selector),option=choices.choices.find(c=>c.selector===selector),mapping=Object.values(form?.mappings||{}).find(m=>m.active!==false&&m.selector===selector);
  const source=mapping?.factKey,ongoing=source?.replace(/\.(?:end|endDate|dateEnd|endMonth)$/u,'.ongoing');
  if(form?.ongoingDateRepresentation&&source&&resolveDateRepresentation(profile,{companyId,pageUrl:capture.pageUrl,roleId:form.ongoingDateRepresentation.roleId},{source}))throw Error('USER_DECISION_ALREADY_RECORDED');
  if(!control?.required||control.renderer!=='ant_date'||option?.status!=='captured_date_options'||!option.restored||option.dateOptions?.ongoingLabel||!option.dateOptions?.panelText?.trim()||!source||ongoing===source||profile.facts[ongoing]?.status!=='known'||profile.facts[ongoing].value!==true)throw Error('VERIFIED_DATE_REPRESENTATION_CONFLICT_REQUIRED');
  fields.push({selector,source,ongoingSource:ongoing});
 }
 return {companyId,status:'waiting_for_user',reason:'ongoing_date_representation',question,fields,captureId:capture.captureId,choicesId:choices.id,
  completion:{complete:false,status:'waiting_for_user'},continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['profile_record_answers','form_build_template']},submission:'not_performed'};
}

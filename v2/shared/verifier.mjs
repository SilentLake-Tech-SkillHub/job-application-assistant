import {verifyMaterialCoverage} from './business-materials.mjs';
import {matchesRole} from './role-identity.mjs';
import {humanActionReason,verificationSummary} from './field-policy.mjs';
import { contentViolations } from './content-policy.mjs';
import {isRedactedReadback,REDACTED_READBACK_REASON} from './readback-state.mjs';
/** Pure deterministic verification. Inputs: compiled expected values + CURRENT DOM observations.
 * Unknown/missing observations never become success. No model grading or fuzzy matching.
 * Persisted draft and final submission are separate evidence states.
 */
export function verifyForm(expected, observed, {now=Date.now(),maxAgeMs=60000}={}) {
  const checks=[];
  const normalize=s=>typeof s==='string'?s.replace(/\r\n/g,'\n').trim():s;
  const equal=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
  if(!observed?.readAt || observed.source!=='live_dom')return {status:'unverified',checks:[{id:'observation',status:'unverified',reason:'LIVE_DOM_READ_REQUIRED'}]};
  const age=now-Date.parse(observed.readAt);
  if(!Number.isFinite(age)||age< -5000||age>maxAgeMs)return {status:'unverified',checks:[{id:'observation',status:'unverified',reason:'STALE_OR_INVALID_OBSERVATION'}]};
  if(!expected.fields?.length||!expected.roleTitle||(!observed.roleTitle&&!observed.roleIdentity)||!Array.isArray(observed.inventoryIds))return {status:'unverified',checks:[{id:'coverage',status:'unverified',reason:'INCOMPLETE_VERIFICATION_INPUT'}]};
  if(new Set(expected.fields.map(f=>f.id)).size!==expected.fields.length)return {status:'unverified',checks:[{id:'coverage',status:'unverified',reason:'DUPLICATE_EXPECTED_FIELD'}]};
  if(expected.pageUrl!==observed.pageUrl)return {status:'blocked',checks:[{id:'page',status:'mismatch',reason:'PAGE_IDENTITY_CHANGED'}]};
  if(!matchesRole(expected,observed))return {status:'blocked',checks:[{id:'role',status:'mismatch',reason:'ROLE_IDENTITY_CHANGED'}]};
  for(const source of contentViolations(Object.values(observed.fields||{}).map(f=>f.value),expected.contentPolicy))
    checks.push({id:'content_policy',source,status:'mismatch',reason:'EXCLUDED_CONTENT_RELOCATED'});
  if(expected.sections){
    if(!Array.isArray(observed.sections))checks.push({id:'sections',status:'unverified',reason:'SECTION_INVENTORY_NOT_READ'});
    else {
      for(const section of observed.sections){
        const planned=expected.sections.find(s=>s.title===section.title);
        checks.push({id:`section:${section.title}`,status:!planned?'unmapped':section.unexpanded?'unverified':'match',reason:!planned?'NEW_SECTION_REQUIRES_REGISTRATION':section.unexpanded?'SECTION_NOT_EXPLORED':null});
      }
      for(const planned of expected.sections)if(!observed.sections.some(s=>s.title===planned.title))checks.push({id:`section:${planned.title}`,status:'unverified',reason:'EXPECTED_SECTION_NOT_OBSERVED'});
    }
  }
  const expectedIds=new Set(expected.fields.map(f=>f.id));
  for(const id of observed.inventoryIds||[]){
    if(!expectedIds.has(id))checks.push({id,status:'unmapped',reason:'REGISTER_NEW_QUESTION_IN_PROFILE'});
  }
  for(const group of expected.groups||[]){
    const actual=observed.groups?.[group.id];
    checks.push({id:`group:${group.id}`,status:actual===undefined?'unverified':actual===group.count?'match':'mismatch',expectedCount:group.count,actualCount:actual??null,reason:actual===group.count?null:'REPEATED_RECORD_COUNT_DIFFERS'});
  }
  for(const field of expected.fields){
    const actual=observed.fields?.[field.id];
    const check={id:field.id,label:field.label,kind:field.kind,status:'unverified',reason:null};
    if(field.userOnly){check.status=humanActionReason(field)?'needs_user':'construction_required';check.reason=humanActionReason(field)?'USER_ACTION_REQUIRED':'ORDINARY_FIELD_MARKED_USER_ONLY';checks.push(check);continue;}
    if(!actual||actual.present!==true){check.reason='FIELD_NOT_READ';checks.push(check);continue;}
    if(field.lockedControl&&(actual.disabled!==true||actual.value!==field.lockedControl.value)){check.status='mismatch';check.reason='LOCKED_CONTROL_STATE_CHANGED';checks.push(check);continue;}
    if(isRedactedReadback(actual.value)){check.reason=REDACTED_READBACK_REASON;check.readbackVisibility='redacted';checks.push(check);continue;}
    if(field.value===undefined||field.value===null){
      const empty=actual.value===null||actual.value===undefined||actual.value===''||(Array.isArray(actual.value)&&!actual.value.length);
      const omit=!field.required && empty && ['confirmed_absent','user_declined','not_applicable'].includes(field.omission?.kind) && typeof field.omission?.evidence==='string' && field.omission.evidence.trim().length>0;
      check.status=field.required?'missing_input':!empty?'mismatch':omit?'confirmed_omission':'needs_user';
      check.reason=!empty?'UNSOURCED_VALUE_ON_PAGE':omit?'USER_RESOLVED_EMPTY_FIELD':'UNANSWERED_FIELD_REQUIRES_USER_RESPONSE';checks.push(check);continue;
    }
    if(actual.errors?.length){check.status='invalid';check.reason='FIELD_VALIDATION_ERROR';checks.push(check);continue;}
    if(field.kind==='choice' && actual.selected!==true){check.status='mismatch';check.reason='DISPLAY_TEXT_WITHOUT_SELECTED_OPTION';checks.push(check);continue;}
    if(field.selectionVerificationRequired&&(actual.selectionProof?.status!=='verified'||actual.selectionProof?.reopenedOptionSelected!==true||actual.selectionProof?.blurConfirmed!==true||actual.selectionProof?.label!==actual.value||field.choiceValue!=null&&actual.selectionProof?.value!==field.choiceValue)){check.status='mismatch';check.reason=actual.selectionProof?.reason||'CHOICE_SELECTION_PROOF_REQUIRED';checks.push(check);continue;}
    if(field.kind==='date'){
      if(field.dateRangeProofRequired&&(actual.dateRangeProof?.status!=='verified'||actual.dateRangeProof.rangeVerified!==true||actual.dateRangeProof.value!==field.value)){check.status='mismatch';check.reason=actual.dateRangeProof?.reason||'DATE_RANGE_SELECTION_PROOF_REQUIRED';checks.push(check);continue;}
      const pattern=field.precision==='year'?/^\d{4}$/:field.precision==='month'?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/;
      const parts=String(actual.value).split('-').map(Number);
      const valid=pattern.test(String(actual.value))&&parts[0]>0&&(parts.length<2||parts[1]>=1&&parts[1]<=12)&&(parts.length<3||parts[2]>=1&&parts[2]<=new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate());
      if(actual.selected!==true||!(valid||(field.allowOngoing&&field.value==='至今'&&actual.value==='至今'))){check.status='mismatch';check.reason='DATE_PRECISION_OR_SELECTION_INVALID';checks.push(check);continue;}
    }
    if(field.kind==='file' && actual.uploadState!=='site_rendered_uploaded'){
      check.reason='UPLOAD_NOT_CONFIRMED_BY_SITE';checks.push(check);continue;
    }
    check.status=equal(actual.value,field.value)?'match':'mismatch';
    if(check.status==='mismatch')check.reason='VALUE_DIFFERS';
    if(!field.sensitive){check.expected=field.value;check.actual=actual.value;}
    checks.push(check);
  }
  for(const error of observed.pageErrors||[])checks.push({id:'page_validation',status:'invalid',reason:'VISIBLE_PAGE_ERROR',selector:error.selector});
  const materialCoverage=verifyMaterialCoverage(expected,observed);checks.push(...materialCoverage.checks);
  const counts={};for(const c of checks)counts[c.status]=(counts[c.status]||0)+1;
  return {status:checks.every(c=>['match','confirmed_omission'].includes(c.status))?'verified':'needs_attention',readAt:observed.readAt,counts,materialCoverage,summary:verificationSummary(checks,expected.fields.map(f=>f.id)),checks,save:observed.saveEvidence||'not_verified',submission:'not_performed'};
}

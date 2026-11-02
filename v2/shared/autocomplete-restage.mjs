import {createHash} from 'node:crypto';
import {lookupCompanyForm} from './profile.mjs';
import {humanActionReason} from './field-policy.mjs';
import {factChoiceAliases} from './choice-resolution.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const autocompleteValueHash=value=>hash(String(value).normalize('NFKC').trim());

// Explicit preparation mutation, separate from read-only acquisition. Values
// come only from the sourced profile; plans and reports contain hashes, not text.
export function autocompleteRestagePlan({capture,profile,selector,scope,authorization}){
 if(authorization?.restage!==true||!authorization.evidence?.trim())throw Error('AUTOCOMPLETE_RESTAGE_AUTHORIZATION_REQUIRED');
 if(!scope?.companyId||!scope.roleId||!scope.pageId||!scope.pageUrl||capture.companyId!==scope.companyId||capture.pageUrl!==scope.pageUrl||capture.pageId!==scope.pageId)throw Error('AUTOCOMPLETE_RESTAGE_SCOPE_CHANGED');
 const controls=capture.controls.filter(c=>c.selector===selector);
 if(controls.length!==1)throw Error('ORDINARY_CAPTURED_AUTOCOMPLETE_REQUIRED');
 const field=controls[0];
 if(field.renderer!=='phoenix_autocomplete'||field.disabled||field.readonly||field.userOnly||humanActionReason(field)||!field.labelSelector)throw Error('ORDINARY_CAPTURED_AUTOCOMPLETE_REQUIRED');
 const form=lookupCompanyForm(profile,scope.companyId,scope.pageUrl).form;
 const mappings=Object.values(form?.mappings||{}).filter(m=>m.active!==false&&m.selector===selector&&m.status==='mapped');
 if(mappings.length!==1)throw Error('AUTOCOMPLETE_RESTAGE_MAPPING_REQUIRED');
 const source=mappings[0].factKey,fact=profile.facts?.[source];
 if(/^(?:identity|auth|credentials)(?:\.|$)|password|passport|bankAccount|idNumber/i.test(source)||profile.fieldRegistry?.[source]?.neverStoreValue)throw Error('ORDINARY_CAPTURED_AUTOCOMPLETE_REQUIRED');
 if(fact?.status!=='known'||typeof fact.value!=='string'||!fact.value.trim()||!fact.sourceIds?.length||fact.sourceIds.some(id=>!profile.sources?.[id]))throw Error('SOURCED_AUTOCOMPLETE_VALUE_REQUIRED');
 const body={schemaVersion:1,kind:'authorized_autocomplete_restage',...scope,captureId:capture.captureId,captureHash:hash(capture.controls),source,sourceHash:hash(fact),selector,labelSelector:field.labelSelector,allowedBeforeValueHashes:factChoiceAliases(profile,source).map(autocompleteValueHash)};
 return {...body,planHash:hash(body)};
}
export async function restageAutocomplete({args,capture,profile,scope,page,store,assertBinding}){
 const plan=autocompleteRestagePlan({capture,profile,selector:args.selector,scope,authorization:args.authorization});
 await assertBinding(plan);
 const id='autocomplete-restage-'+scope.companyId+'-'+hash(args.selector).slice(0,16);
 const record={id,operation:'authorized_autocomplete_restage',plan,status:'attempt_registered',authorizationEvidence:args.authorization.evidence,startedAt:new Date().toISOString(),submission:'not_performed',fullFormVerified:false};
 await store.put('runs',id,record);
 try{
  const result=await page.act({method:'phoenix_autocomplete_restage',selector:plan.selector,labelSelector:plan.labelSelector,expectedPageUrl:plan.pageUrl,allowedBeforeValueHashes:plan.allowedBeforeValueHashes},null,{});
  if(result?.emptyVerified!==true||result.requiresReacquisition!==true)throw Error('AUTOCOMPLETE_RESTAGE_NOT_VERIFIED');
  await assertBinding(plan);
  await store.put('runs',id,{...record,status:'restaged_requires_reacquisition',result,finishedAt:new Date().toISOString()});
  return {runId:id,status:'restaged_requires_reacquisition',source:plan.source,planHash:plan.planHash,...result,fullFormVerified:false,submission:'not_performed',nextTools:['capture_rea_structure','form_search_choices','form_build_template']};
 }catch(error){await store.put('runs',id,{...record,status:'needs_attention',errorCode:/^[A-Z_]+$/.test(error.message)?error.message:'AUTOCOMPLETE_RESTAGE_FAILED',finishedAt:new Date().toISOString()});throw error;}
}
// Real input/blur events only. Erasing a stale selection is an intentional
// preparation step; putting display text back cannot prove entity restoration.
export async function performAutocompleteRestage(adapter,action,{sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!Array.isArray(action.allowedBeforeValueHashes)||!action.allowedBeforeValueHashes.length||action.allowedBeforeValueHashes.some(h=>!/^[a-f0-9]{64}$/.test(h)))throw Error('AUTOCOMPLETE_RESTAGE_PLAN_REQUIRED');
 const samePage=()=>typeof action.expectedPageUrl==='string'&&adapter.page.url()===action.expectedPageUrl;
 if(!samePage())throw Error('AUTOCOMPLETE_RESTAGE_SCOPE_CHANGED');
 const input=adapter.page.locator(action.selector),label=adapter.page.locator(action.labelSelector);
 if(await input.count()!==1||await label.count()!==1)throw Error('AUTOCOMPLETE_RESTAGE_CONTROL_CHANGED');
 const read=()=>input.evaluate(n=>({value:n.value,ordinary:n.tagName==='INPUT'&&!['password','file','hidden'].includes(n.type)&&!!n.closest('.phoenix-auto-complete-container'),disabled:!!n.disabled,readonly:!!n.readOnly,entityPresent:[n,n.closest('.phoenix-auto-complete-container')].some(e=>['data-school-id','data-entity-id','data-value','data-id'].some(a=>!!e?.getAttribute?.(a)))}));
 const before=await read(),empty=state=>state.value===''&&!state.entityPresent;
 if(!before.ordinary||before.disabled||before.readonly)throw Error('AUTOCOMPLETE_RESTAGE_CONTROL_CHANGED');
 if(!empty(before)&&!action.allowedBeforeValueHashes.includes(autocompleteValueHash(before.value)))throw Error('AUTOCOMPLETE_RESTAGE_CURRENT_VALUE_CHANGED');
 if(!samePage())throw Error('AUTOCOMPLETE_RESTAGE_SCOPE_CHANGED');
 if(!empty(before)){await input.fill('',{timeout:10000});await label.click({timeout:10000});}
 const first=await read();await sleep(90);const second=await read();
 if(!samePage())throw Error('AUTOCOMPLETE_RESTAGE_SCOPE_CHANGED');
 if(!empty(first)||!empty(second)||!first.ordinary||!second.ordinary||first.disabled||second.disabled||first.readonly||second.readonly)throw Error('AUTOCOMPLETE_RESTAGE_NOT_CLEARED');
 return {changed:!empty(before),beforeValueHash:autocompleteValueHash(before.value),emptyVerified:true,requiresReacquisition:true,selectionRestored:false};
}

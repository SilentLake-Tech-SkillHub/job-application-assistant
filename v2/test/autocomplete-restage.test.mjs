import test from 'node:test';
import assert from 'node:assert/strict';
import {autocompleteRestagePlan,autocompleteValueHash,restageAutocomplete,performAutocompleteRestage} from '../shared/autocomplete-restage.mjs';
import {CONTROL_METHODS,CONTROL_TYPES} from '../shared/control-registry.mjs';
function fixture(){
 const value='Example University',scope={companyId:'sample',roleId:'J000001',pageId:'chrome:one',pageUrl:'https://sample.test/form?jobId=one'};
 const field={selector:'#school',labelSelector:'#school-label',label:'学校名称',renderer:'phoenix_autocomplete',type:'combobox'};
 const capture={captureId:'capture',...scope,controls:[field]};
 const profile={schemaVersion:1,entities:{},sources:{user:{kind:'user_reply'}},facts:{school:{value,status:'known',sourceIds:['user']}},companyForms:{sample:{companyId:scope.companyId,pageUrl:scope.pageUrl,mappings:{school:{selector:field.selector,factKey:'school',status:'mapped',active:true}}}}};
 const args={selector:field.selector,authorization:{restage:true,evidence:'user authorized preparation recovery'}};
 return {value,scope,field,capture,profile,args,authorization:args.authorization,selector:field.selector};
}
test('restaging freezes sourced references and hashes only; it is not a reusable template action',()=>{
 const f=fixture(),plan=autocompleteRestagePlan(f);
 assert.equal(plan.source,'school');assert.deepEqual(plan.allowedBeforeValueHashes,[autocompleteValueHash(f.value)]);
 assert.equal(JSON.stringify(plan).includes(f.value),false);
 assert.equal(CONTROL_METHODS.phoenix_autocomplete_restage.templateAllowed,false);
 assert.equal(CONTROL_METHODS.phoenix_autocomplete_restage.inspection,false);
 assert.equal(Object.values(CONTROL_TYPES).some(t=>t.methods.includes('phoenix_autocomplete_restage')),false);
});
test('a captured ARIA search container freezes its input separately without granting a template mutation',()=>{
 const f=fixture();Object.assign(f.field,{renderer:undefined,contextProvider:'.atsx-form-item',type:'school_text',searchSelector:'#school input',actionSelector:'#school [role="combobox"]'});
 const plan=autocompleteRestagePlan(f);
 assert.equal(plan.restageMethod,'aria_autocomplete_restage');assert.equal(plan.inputSelector,f.field.searchSelector);
 assert.equal(plan.comboSelector,f.field.actionSelector);assert.equal(CONTROL_METHODS.aria_autocomplete_restage.templateAllowed,false);
 delete f.field.searchSelector;assert.throws(()=>autocompleteRestagePlan(f),/ORDINARY_CAPTURED_AUTOCOMPLETE_REQUIRED/);
});
for(const scenario of ['no_authority','wrong_page','unknown_source','sensitive_label','sensitive_source','unmapped','disabled','readonly','duplicate'])test('restaging refuses '+scenario,()=>{
 const f=fixture();
 if(scenario==='no_authority')f.authorization={restage:false,evidence:'text'};
 if(scenario==='wrong_page')f.scope.pageId='chrome:other';
 if(scenario==='unknown_source')f.profile.facts.school.sourceIds=[];
 if(scenario==='sensitive_label')f.field.label='身份证号码';
 if(scenario==='sensitive_source'){f.profile.companyForms.sample.mappings.school.factKey='identity.idCard.number';f.profile.facts['identity.idCard.number']=f.profile.facts.school;}
 if(scenario==='unmapped')f.profile.companyForms.sample.mappings.school.status='needs_semantic_mapping';
 if(scenario==='disabled')f.field.disabled=true;
 if(scenario==='readonly')f.field.readonly=true;
 if(scenario==='duplicate')f.capture.controls.push({...f.field});
 assert.throws(()=>autocompleteRestagePlan(f));
});
function driverFixture({value='Example University',entityPresent=true,readonly=false,ghost=false,ordinary=true}={}){
 const state={value,entityPresent,readonly,ordinary,disabled:false},calls=[];
 const input={count:async()=>1,evaluate:async()=>({...state}),fill:async value=>{calls.push(['fill',value]);state.value=value;if(!ghost)state.entityPresent=false;}};
 const label={count:async()=>1,click:async()=>calls.push(['blur'])};
 return {state,calls,adapter:{page:{url:()=> 'https://sample.test/form',locator:s=>s==='#school'?input:label}},action:{selector:'#school',labelSelector:'#school-label',expectedPageUrl:'https://sample.test/form',allowedBeforeValueHashes:[autocompleteValueHash('Example University')]}};
}
test('authorized restaging clears one matching ordinary field, verifies absence twice and never claims restoration',async()=>{
 const f=driverFixture(),r=await performAutocompleteRestage(f.adapter,f.action,{sleep:async()=>{}});
 assert.deepEqual(f.calls,[['fill',''],['blur']]);assert.equal(r.emptyVerified,true);assert.equal(r.selectionRestored,false);assert.equal(r.requiresReacquisition,true);
 assert.equal(JSON.stringify(r).includes('Example University'),false);
 const again=await performAutocompleteRestage(f.adapter,f.action,{sleep:async()=>{}});assert.equal(again.changed,false);assert.equal(f.calls.length,2);
});
test('changed user text, readonly controls and a surviving entity are never certified empty',async()=>{
 for(const options of [{value:'User changed value'},{readonly:true},{ordinary:false}]){const f=driverFixture(options);await assert.rejects(performAutocompleteRestage(f.adapter,f.action,{sleep:async()=>{}}));assert.deepEqual(f.calls,[]);}
 const ghost=driverFixture({ghost:true});await assert.rejects(performAutocompleteRestage(ghost.adapter,ghost.action,{sleep:async()=>{}}),/NOT_CLEARED/);
});
test('queue/source binding and durable attempt registration precede the single browser mutation',async()=>{
 const f=fixture(),events=[],records=[];
 const result=await restageAutocomplete({...f,store:{put:async(_kind,_id,r)=>{events.push(r.status);records.push(r);}},assertBinding:async()=>events.push('binding'),page:{act:async()=>{events.push('act');return {emptyVerified:true,requiresReacquisition:true,selectionRestored:false};}}});
 assert.deepEqual(events,['binding','attempt_registered','act','binding','restaged_requires_reacquisition']);assert.equal(result.fullFormVerified,false);assert.equal(JSON.stringify(records).includes(f.value),false);
 let mutated=false;await assert.rejects(restageAutocomplete({...f,store:{put:async()=>{}},assertBinding:async()=>{throw Error('SCOPE_CHANGED');},page:{act:async()=>{mutated=true;}}}),/SCOPE_CHANGED/);assert.equal(mutated,false);
});
test('navigation between binding and the edit is refused before input changes',async()=>{
 const f=driverFixture();f.adapter.page.url=()=> 'https://other.test/form';
 await assert.rejects(performAutocompleteRestage(f.adapter,f.action,{sleep:async()=>{}}),/SCOPE_CHANGED/);assert.deepEqual(f.calls,[]);
});
test('a failed mutation remains an attention record and is not retried or relabeled successful',async()=>{
 const f=fixture(),records=[];let calls=0;
 await assert.rejects(restageAutocomplete({...f,store:{put:async(_kind,_id,r)=>records.push(r)},assertBinding:async()=>{},page:{act:async()=>{calls++;throw Error('AUTOCOMPLETE_RESTAGE_NOT_CLEARED');}}}),/NOT_CLEARED/);
 assert.equal(calls,1);assert.deepEqual(records.map(r=>r.status),['attempt_registered','needs_attention']);
});

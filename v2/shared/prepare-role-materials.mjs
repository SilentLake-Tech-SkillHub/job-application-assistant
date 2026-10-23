import {randomUUID} from 'node:crypto';
import {hash} from './engine.mjs';
import {resolveMaterialValues,MATERIAL_SOURCES} from './business-materials.mjs';
import {compileExecutionPlan,assertPreparedPlan} from './execution-plan.mjs';
import {compileExpected,attachInventory} from './observation.mjs';
import {verifyForm} from './verifier.mjs';
import {controlContractChanges} from './control-contract.mjs';
import {liveControls} from './control-context.mjs';

// Scoped preparation against a full sealed form. Unrelated personal fields are
// preserved; this receipt can never release whole-form review or submission.
export async function prepareRoleMaterials({args,boundRole,resolveContext,engine,queues,store,browser}){
 if(args.authorization?.prepare!==true||!args.authorization.evidence?.trim())throw Error('MATERIAL_PREPARATION_AUTHORIZATION_REQUIRED');
 const {t,state,template}=await boundRole(args),context=await resolveContext(t,state);
 const task={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...resolveMaterialValues(context)};
 if((await engine.formRoute(task)).route!=='reuse')throw Error('FORM_ASSET_NOT_SEALED');
 const pages=template.pages.filter(p=>new URL(task.pageUrl).pathname.startsWith(p.pathPrefix));if(pages.length!==1)throw Error('AMBIGUOUS_VERIFICATION_PAGE');
 const pagePlan=pages[0],sources=context.materials.items.filter(m=>m.status==='available').map(m=>MATERIAL_SOURCES[m.key]);
 const fields=pagePlan.fields.filter(f=>sources.includes(f.source));
 if(!fields.length||sources.some(source=>!fields.some(f=>f.source===source)))throw Error('ROLE_MATERIAL_DESTINATION_REQUIRED');
 if(fields.some(f=>f.kind!=='text'||f.userOnly||f.sensitive||f.when||f.readonly||f.actions?.some(a=>a.method!=='fill')))throw Error('MATERIAL_DEPENDENCY_OR_DRIVER_REQUIRED');
 const scopedPage={...pagePlan,fields,sections:undefined,sectionDiscovery:undefined,groups:[]},scopedTemplate={...template,pages:[scopedPage]};
 const plan=await compileExecutionPlan(scopedTemplate,task);if(!plan.readyForExecution)throw Error('ROLE_MATERIAL_PREPARATION_INCOMPLETE');
 await store.put('plans',plan.id,plan);
 const scope={id:randomUUID(),operation:'prepare_role_materials',scope:'known_role_materials_only',queueId:args.queueId,queueHash:args.queueHash,taskId:args.taskId,templateId:template.id,templateHash:hash(template),planId:plan.id,planHash:plan.planHash,fieldIds:fields.map(f=>f.id),materialContextHash:hash(context),fullFormVerified:false};
 scope.scopeHash=hash(scope);await store.put('plans',scope.id,scope);
 const current=await boundRole(args);if(hash(current.template)!==scope.templateHash||current.state.pageId!==state.pageId)throw Error('MATERIAL_PREPARATION_SCOPE_CHANGED');
 if(hash(await resolveContext(current.t,current.state))!==scope.materialContextHash)throw Error('ROLE_INPUT_CHANGED');
 const saved=await store.get('plans',plan.id);await assertPreparedPlan(saved,scopedTemplate,{...task,planId:plan.id,planHash:plan.planHash},args.authorization);
 const page=await browser.existingPage(task.pageUrl),company=engine.companyForTask(task);await page.assertLocation(company.origin,pagePlan.pathPrefix);await page.wait(pagePlan.readySelector);
 const inventory=await liveControls(page,pagePlan),changes=controlContractChanges(pagePlan,inventory);if(changes.length){if(engine.onInventory)await engine.onInventory(t.companyId,task.pageUrl,inventory,pagePlan);const error=Error('FORM_CONTROL_CONTRACT_CHANGED');error.details={fields:changes};throw error;}
 const before=await page.observe(scopedPage),written=[];
 for(const field of saved.pages[0].fields){
  if(before.fields?.[field.id]?.present!==true)throw Error('PLANNED_FIELDS_MISSING_BEFORE_WRITE');
  if(before.fields[field.id].value!==field.value||before.fields[field.id].errors?.length){for(const action of field.actions)await page.act(action,field.value,{});written.push(field.id);}
 }
 const selectedInventory=inventory.filter(c=>fields.some(f=>f.inventorySelectors?.includes(c.selector)));
 const firstRead=attachInventory(await page.observe(scopedPage),scopedPage,selectedInventory);
 let screenshot=null,screenshotError=null;try{screenshot=await browser.request('screenshot',{pageId:state.pageId,selector:fields[0].read.selector});}catch(e){screenshotError=/^[A-Z_]+$/.test(e.message)?e.message:'FIELD_SCREENSHOT_UNAVAILABLE';}
 const observed=attachInventory(await page.observe(scopedPage),scopedPage,selectedInventory),verification=verifyForm(compileExpected(scopedPage,task),observed);
 verification.readbackStable=hash(firstRead.fields)===hash(observed.fields);
 if(!verification.readbackStable){verification.status='needs_attention';verification.checks.push({id:'material:stability',status:'unverified',reason:'MATERIAL_READBACK_NOT_STABLE'});if(verification.materialCoverage)verification.materialCoverage.complete=false;}
 const id='material-prepare-'+t.taskId,result={id,operation:'prepare_role_materials',companyId:t.companyId,roleId:t.roleId,pageUrl:task.pageUrl,scope:'known_role_materials_only',scopeId:scope.id,scopeHash:scope.scopeHash,planId:plan.id,planHash:plan.planHash,writtenFields:written,verification,screenshot,screenshotError,fullFormVerified:false,save:'not_verified',submission:'not_performed',completion:{complete:false,status:verification.status==='verified'?'material_fields_prepared':'in_progress'},continuation:{state:'prepare',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['workflow_next','role_prepare','role_verify']}};
 await store.put('runs',id,result);
 if(state.verifyRunId){delete state.verifyRunId;delete state.verifiedAt;state.status='ready_to_fill';}
 state.materialPreparationRunId=id;await queues.put(t.taskId,state);return result;
}

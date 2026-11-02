export async function removeRoleProject({args,queues,store,boundRole,profile, browser,hash}){
 if(args.authorization?.remove!==true||!args.authorization.evidence?.trim())throw Error('PROJECT_REMOVAL_AUTHORIZATION_REQUIRED');
 const {t,state,template}=await boundRole(args),plan=template.pages.find(p=>new URL(state.returnUrl).pathname.startsWith(p.pathPrefix));
 const prefix='projects.'+args.projectId+'.',fields=plan.fields.filter(field=>field.source.startsWith(prefix)),anchor=fields.find(field=>field.source===prefix+'name');
 if(!anchor||!anchor.read.selector.startsWith('phoenixq:')||fields.some(field=>field.userOnly||field.sensitive||field.kind==='file'))throw Error('PROJECT_RECORD_CONTRACT_REQUIRED');
 // Removing an obsolete website row must not require restoring it to the
 // current filling source. The operation's explicit target is not a new fact.
 const ref=JSON.parse(anchor.read.selector.slice(9)),expectedName=args.authorization.targetName??profile.facts[prefix+'name']?.value;
 if(typeof expectedName!=='string'||!expectedName.trim())throw Error('PROJECT_RECORD_NAME_REQUIRED');
 const page=await browser.existingPage(state.returnUrl),action={selector:anchor.read.selector,label:ref.label,section:ref.section,expectedName,authorized:true},current=await page.act({method:'inspect_project_record',...action},null,{});
 if(current?.names?.includes(expectedName)){
  const observed=await page.observe({fields:[anchor]}),field=observed.fields?.[anchor.id];
  if(field?.present!==true||field.value!==expectedName)throw Error('PROJECT_RECORD_NAME_CHANGED');
 }
 const nonProject=plan.fields.filter(field=>!(field.inventorySelectors||[field.read.selector]).some(selector=>{try{return selector.startsWith('phoenixq:')&&JSON.parse(selector.slice(9)).section===ref.section;}catch{return false;}}));
 const values=async()=>{const observed=await page.observe({fields:nonProject});return hash(Object.fromEntries(Object.entries(observed.fields).map(([id,field])=>[id,{value:field.value,uploadState:field.uploadState}])));};
 const id='project-removal-'+hash({taskId:t.taskId,projectId:args.projectId}).slice(0,32);
 const invalidate=async()=>{delete state.verifyRunId;delete state.verifiedAt;delete state.planId;delete state.planHash;state.status='ready_to_fill';state.reconstructionRequired={reason:'confirmed_project_removal',projectId:args.projectId,receiptId:id};await queues.put(t.taskId,state);};
 const confirmPending=async(prior,snapshot)=>{
  const confirmation=snapshot?.confirmation;
  if(confirmation?.associated!==true||confirmation.targetName!==expectedName||JSON.stringify(snapshot.names)!==JSON.stringify(prior.current.names)||await values()!==prior.nonProjectBefore)throw Error('PROJECT_REMOVAL_OUTCOME_REQUIRES_INSPECTION');
  const proof={operation:'project_removal_confirmation_preview',receiptId:id,taskId:t.taskId,projectId:args.projectId,expectedName,names:snapshot.names,confirmation},previewHash=hash(proof),previewId=id+'-confirmation';
  if(!args.resumeConfirmation){await store.put('runs',previewId,{...proof,previewHash});return {id,status:'awaiting_confirmation',previewId,previewHash,targetName:expectedName,currentNames:snapshot.names,confirmation,nonProjectFieldsUnchanged:true,removalVerified:false,submission:'not_performed',nextTool:'role_remove_project_record',nextMode:'resumeConfirmation'};}
  if(prior.confirmationStartedAt)throw Error('PROJECT_REMOVAL_OUTCOME_REQUIRES_INSPECTION');
  const reviewed=await store.get('runs',previewId);if(args.expectedPreviewHash!==previewHash||reviewed.previewHash!==previewHash)throw Error('PROJECT_CONFIRMATION_PREVIEW_CHANGED');
  const confirming={...prior,phase:'confirmation_started',confirmationStartedAt:new Date().toISOString(),confirmationPreviewHash:previewHash};await store.put('runs',id,confirming);
  const result=await page.act({method:'remove_project_record',...action,confirmationOnly:true},null,{});
  if(result.status!=='removed_verified')throw Error('PROJECT_REMOVAL_RESULT_UNCERTAIN');
  await boundRole(args);if(await values()!==prior.nonProjectBefore)throw Error('NON_PROJECT_FIELDS_CHANGED_DURING_REMOVAL');
  const done={...confirming,...result,confirmationActionCount:1,nonProjectFieldsUnchanged:true,fullFormVerified:false};await store.put('runs',id,done);return done;
 };
 let prior;try{prior=await store.get('runs',id);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior?.status==='attempted'){
  if(JSON.stringify(current?.names)===JSON.stringify(prior.expectedRemainingNames)&&await values()===prior.nonProjectBefore){const done={...prior,status:'removed_verified',readbackStable:true,recoveredByObservation:true,nonProjectFieldsUnchanged:true};await store.put('runs',id,done);return done;}
  if(current?.confirmation?.associated===true)return confirmPending(prior,current);
  throw Error('PROJECT_REMOVAL_OUTCOME_REQUIRES_INSPECTION');
 }
 if(prior?.status==='removed_verified'&&!current?.names?.includes(expectedName))return {...prior,alreadyRemoved:true};
 const originalNames=plan.fields.filter(field=>{try{const q=JSON.parse(field.read.selector.slice(9));return field.read.selector.startsWith('phoenixq:')&&q.section===ref.section&&q.label===ref.label;}catch{return false;}}).map(field=>field.source===prefix+'name'?expectedName:profile.facts[field.source]?.value),expectedRemaining=originalNames.filter(name=>name!==expectedName);
 if(!prior&&originalNames.every(name=>typeof name==='string')&&originalNames.filter(name=>name===expectedName).length===1&&JSON.stringify(current?.names)===JSON.stringify(expectedRemaining)){
  const receipt={id,operation:'remove_project_record',companyId:t.companyId,roleId:t.roleId,projectId:args.projectId,status:'removed_verified',alreadyRemoved:true,removalPerformed:false,remainingNames:current.names,authorization:args.authorization,fullFormVerified:false,submission:'not_performed'};await store.put('runs',id,receipt);await invalidate();return receipt;
 }
 if(!current?.removeSelector||current.names.filter(name=>name===expectedName).length!==1)throw Error('PROJECT_RECORD_REMOVE_TARGET_REQUIRED');
 const body={operation:'project_removal_preview',companyId:t.companyId,roleId:t.roleId,taskId:t.taskId,pageUrl:state.returnUrl,projectId:args.projectId,expectedName,current},previewHash=hash(body),previewId=id+'-preview';
 if(!args.expectedPreviewHash){await store.put('runs',previewId,{...body,previewHash});return {previewId,previewHash,projectId:args.projectId,projectName:expectedName,currentNames:current.names,removalPerformed:false,nextTool:'role_remove_project_record',submission:'not_performed'};}
 const preview=await store.get('runs',previewId);if(args.expectedPreviewHash!==preview.previewHash||previewHash!==preview.previewHash)throw Error('PROJECT_REMOVAL_PREVIEW_CHANGED');
 const nonProjectBefore=await values(),attempt={id,...body,operation:'remove_project_record',status:'attempted',authorization:args.authorization,expectedRemainingNames:current.names.filter(name=>name!==expectedName),nonProjectBefore,attemptedAt:new Date().toISOString(),submission:'not_performed'};
 await store.put('runs',id,attempt);
 await invalidate();
 const result=await page.act({method:'remove_project_record',...action},null,{});
 if(result.status==='awaiting_confirmation'){const pending={...attempt,phase:'awaiting_confirmation'};await store.put('runs',id,pending);return confirmPending(pending,await page.act({method:'inspect_project_record',...action},null,{}));}
 await boundRole(args);
 if(await values()!==nonProjectBefore)throw Error('NON_PROJECT_FIELDS_CHANGED_DURING_REMOVAL');
 const receipt={...attempt,...result,nonProjectFieldsUnchanged:true,fullFormVerified:false,continuation:{state:'construction',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['capture_rea_structure','form_mapping_candidates','form_build_template']}};
 await store.put('runs',id,receipt);return receipt;
}

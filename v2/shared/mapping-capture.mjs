import {assertCapturedAcquisition,captureContentHash} from './acquisition-chain.mjs';
import {wasBuilt} from './template-validation.mjs';
import {matchesPageIdentity} from './definition-coverage.mjs';
import {samePage} from './page-scope.mjs';
import {formAssetKeys} from './form-identity.mjs';

// Mapping an observed question on a built company form uses its current capture.
// The first-build collector remains mandatory only for companies never built.
export async function assertMappingCapture(store,{companyId,captureId,pageUrl,formId,template}){
 if(!wasBuilt(template))return assertCapturedAcquisition(store,{companyId,captureId,pageUrl,formId});
 const capture=await store.get('runs',captureId||formAssetKeys(formId).capture);
 if(capture.visualPage)return assertCapturedAcquisition(store,{companyId,captureId:capture.captureId,pageUrl,formId:capture.formId});
 if(capture.companyId!==companyId||!capture.formId||capture.formId!==template.evidence?.formId||!capture.pageId||!capture.controls?.length||capture.captureId!==formAssetKeys(capture.formId).capture)throw Error('ACQUISITION_CAPTURE_SCOPE_CHANGED');
 if(pageUrl&&!samePage(pageUrl,capture.pageUrl)||new URL(capture.pageUrl).origin!==new URL(template.evidence.sourceUrl).origin||!template.pages.some(p=>matchesPageIdentity(p,capture.pageUrl)))throw Error('ACQUISITION_CAPTURE_SCOPE_CHANGED');
 if(capture.contentHash!==captureContentHash(capture))throw Error('ACQUISITION_CONTROL_CAPTURE_CHANGED');
 return {capture,mode:'existing_company_capture'};
}

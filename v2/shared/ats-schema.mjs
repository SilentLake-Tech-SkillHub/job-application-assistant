// Internal construction: this observed ATS endpoint returns the company form
// definition, not candidate answers. Only the current document's template ID
// and language are sent. It cannot address a submit/edit/login endpoint.
export async function captureWecruitSchema(page,{endpoint}){
 const current=new URL(page.url()),target=new URL(endpoint);
 if(target.origin!==current.origin||!/^\/wecruit\/resume\/template\/get\/SU[a-z0-9]+$/i.test(target.pathname)||target.search||target.hash)throw Error('SCHEMA_ENDPOINT_SCOPE_REJECTED');
 const templateId=current.searchParams.get('tid'),lang=current.searchParams.get('lang');
 if(!/^[a-z0-9]+$/i.test(templateId||'')||!/^\d+$/.test(lang||'')||!page.request?.post)throw Error('SCHEMA_REQUEST_BINDING_REQUIRED');
 const response=await page.request.post(target.href,{form:{templateId,lang:Number(lang)},timeout:15000});if(!response.ok())throw Error('SCHEMA_ENDPOINT_READ_FAILED');
 const body=await response.json();if(body.type!=='success'||!body.data?.templateJson)return {status:'schema_metadata_or_error',responseType:body.type,state:body.state,message:body.message||body.msg||null,dataKeys:Object.keys(body.data||{}),dataSourceUrl:body.data?.dataSourceUrl||null};
 const template=typeof body.data.templateJson==='string'?JSON.parse(body.data.templateJson):body.data.templateJson;
 const source=new URL(body.data.dataSourceUrl||'');
 if(source.origin!=='https://wecruit-cdn.hotjob.cn'||!/^\/files\/oline\/[A-Za-z0-9_-]+\/[a-z0-9-]+\.json$/i.test(source.pathname)||source.search||source.hash)throw Error('SCHEMA_DICTIONARY_SCOPE_REJECTED');
 const dictResponse=await page.request.get(source.href,{timeout:15000});if(!dictResponse.ok())throw Error('SCHEMA_DICTIONARY_READ_FAILED');const dictionary=await dictResponse.json();

 return {source:'observed_official_template_getter',pageUrl:current.href,readAt:new Date().toISOString(),request:{url:target.href,method:'POST',body:{templateId,lang:Number(lang)}},template,dictionary,dataSourceUrl:body.data.dataSourceUrl||null,candidateValuesRead:false,authenticationSecretsRead:false,submission:'not_performed'};
}

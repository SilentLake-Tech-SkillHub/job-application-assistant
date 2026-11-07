import {resolveEntry,matchEntryPath} from './entry-recipe.mjs';
// Reuse the company's form for another confirmed role on its registered route.
// Stored evidence and template hash stay tied to the original company asset.
export function bindCompanyTemplateRoute(template,pageUrl,config){
 if(template.pages.some(p=>new URL(pageUrl).pathname.startsWith(p.pathPrefix)))return template;
 if(new URL(pageUrl).origin!==config.origin||new URL(template.evidence.sourceUrl).origin!==config.origin)return template;
 const entry=resolveEntry(config);
 if(entry?.kind!=='detail_to_form'||template.pages.length!==1)return template;
 const page=template.pages[0],pathname=new URL(pageUrl).pathname;
 if(!matchEntryPath(entry,page.pathPrefix).form||!matchEntryPath(entry,pathname).form)return template;
 return {...template,pages:[{...page,sourcePathPrefix:page.pathPrefix,pathPrefix:pathname}]};
}

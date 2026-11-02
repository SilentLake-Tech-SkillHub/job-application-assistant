import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Read only the already-bound page. These candidates are evidence for a data
// preview, never automatic configuration writes or permission to click.
export async function inspectEntryPage(page,{entry,expectedTitle,stage}){
 const prefix=stage==='form'?entry.form.rolePrefix||'':'';
 const selectors=['h1:visible','h2:visible','h3:visible','[role="heading"]:visible'];
 if(prefix)selectors.push('span:visible:text-matches('+JSON.stringify('^'+escaped(prefix)+'\\s*\\S.+$')+')');
 else if(/\([A-Z]{1,3}\d+\)$/.test(expectedTitle))selectors.push('span:visible:text-matches("\\\\([A-Z]{1,3}[0-9]+\\\\)$")');
 const candidates=[];
 for(const selector of selectors){
  const locator=page.locator(selector);if(await locator.count()!==1)continue;
  const text=(await locator.innerText()).trim();
  const value=prefix&&text.startsWith(prefix)?text.slice(prefix.length).trim():text;
  if(value!==expectedTitle)continue;
  let domSelector=null;
  if(typeof locator.evaluate==='function'){
   const candidate=await locator.evaluate(element=>{const parts=[];for(let node=element;node&&node!==document.documentElement;node=node.parentElement){if(node===document.body){parts.unshift('body');break;}let position=1;for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling)if(sibling.tagName===node.tagName)position++;parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+position+')');}return parts.join(' > ');});
   const native=page.locator(candidate);if(await native.count()===1&&(await native.innerText()).trim()===text)domSelector=candidate;
  }
  candidates.push({roleSelector:selector,...(domSelector?{domSelector}:{}),...(stage==='form'?{readySelector:selector}:{}),...(prefix?{rolePrefix:prefix}:{}),selectorMatches:1,titleMatches:true,titleHash:sha(value)});
 }
 return {stage,candidates,observedAt:new Date().toISOString(),pageIdentityHash:sha(page.url()),source:'bound_page_unique_rendered_title',configurationWritten:false,submission:'not_performed'};
}

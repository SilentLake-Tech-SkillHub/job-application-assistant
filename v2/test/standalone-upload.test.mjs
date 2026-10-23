import test from 'node:test';
import assert from 'node:assert/strict';
import {controlDOM} from '../shared/control-dom.mjs';
function element(tag,text='',attrs={},children=[]){
 const n={tagName:tag.toUpperCase(),text,attrs,children,parentElement:null,hidden:false,files:[],getAttribute:k=>attrs[k]??null,hasAttribute:k=>Object.hasOwn(attrs,k),getClientRects(){return this.hidden?[]:[{}];}};
 Object.defineProperties(n,{id:{get:()=>attrs.id||''},type:{get:()=>attrs.type||''},innerText:{get:()=>n.text+n.children.filter(c=>!c.hidden).map(c=>c.innerText).join('')},textContent:{get:()=>n.text+n.children.map(c=>c.textContent).join('')},previousElementSibling:{get:()=>n.parentElement?.children[n.parentElement.children.indexOf(n)-1]||null}});
 n.matches=s=>s.split(',').some(raw=>{const p=raw.trim();if(p.startsWith('#'))return n.id===p.slice(1);if(p.startsWith('.'))return (attrs.class||'').split(/\s+/).includes(p.slice(1));const m=p.match(/^([a-z0-9]+)?(?:\[([\w-]+)(\*?=)?"?([^\]"]*)"?\])?$/i);if(!m)return false;if(m[1]&&n.tagName!==m[1].toUpperCase())return false;if(m[2]){if(!n.hasAttribute(m[2]))return false;if(m[3]==='='&&n.getAttribute(m[2])!==m[4])return false;if(m[3]==='*='&&!n.getAttribute(m[2]).includes(m[4]))return false;}return true;});
 n.contains=x=>n===x||n.children.some(c=>c.contains(x));n.querySelectorAll=s=>n.children.flatMap(c=>[...(s==='*'||c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);n.querySelector=s=>n.querySelectorAll(s)[0]||null;n.closest=s=>n.matches(s)?n:n.parentElement?.closest(s)||null;
 children.forEach(c=>{c.parentElement=n;});return n;
}
function fixture({state='empty',nativeHeading=false,multiple=false,titleFilename=false,fakeTitle=false,sameFilenameOnly=false,duplicateFilename=false}={}){
 const filename='current-resume.pdf',name=element('div',filename),replace=element('span','重新上传'),remove=element('span','删除'),controls=element('div','',{},[replace,remove]);
 const record=element('div','',{},state==='empty'?[]:[name,...(sameFilenameOnly?[]:[controls]),...(state==='uploading'?[element('span','上传中')]:[]),...(duplicateFilename?[element('div',filename)]:[])]);
 const input=element('input','',{type:'file'});input.hidden=true;input.files=state==='empty'?[{name:filename}]:[];
 const uploadBody=element('div','',{},[record,input,...(multiple?[element('input','',{type:'file'})]:[])]);
 const title=element(nativeHeading?'h2':'div',titleFilename?filename:'上传简历',nativeHeading?{}:{id:fakeTitle?'random-caption':'special_field_fast_upload_resume'});
 const root=element('section','',{id:'upload-section'},[title,uploadBody]),body=element('body','',{},[root]);
 const oldDocument=globalThis.document,oldStyle=globalThis.getComputedStyle,oldCSS=globalThis.CSS;
 globalThis.document={body,querySelectorAll:s=>body.querySelectorAll(s)};globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.CSS={escape:s=>s};
 const ref=(part,file)=>'uploadq:'+JSON.stringify({label:'上传简历',occurrence:0,part,...(file?{filename:file}:{})});
 return {input,root,title,ref,resolve:(...parts)=>controlDOM({operation:'resolveUpload',references:parts.map(p=>ref(p))}),remove:()=>controlDOM({operation:'resolveUpload',references:[ref('remove',filename)]})[0],restore:()=>{globalThis.document=oldDocument;globalThis.getComputedStyle=oldStyle;globalThis.CSS=oldCSS;}};
}
test('independent semantic upload title and unique sibling file body resolve before uploading, without claiming completion',()=>{
 const f=fixture();try{const [input,container,names,uploaded]=f.resolve('input','container','filenames','uploaded');assert.ok(input);assert.equal(container,'#upload-section');assert.equal(names,null);assert.equal(uploaded,null);assert.equal(f.input.files.length,1);}finally{f.restore();}
});
test('real rendered filename and completion controls prove upload even with FileList empty',()=>{
 for(const nativeHeading of [false,true]){const f=fixture({state:'uploaded',nativeHeading});try{const [input,container,names,uploaded]=f.resolve('input','container','filenames','uploaded');assert.ok(input);assert.equal(container,'#upload-section');assert.ok(names);assert.equal(uploaded,'#upload-section');assert.ok(f.remove());assert.equal(f.input.files.length,0);assert.equal(f.title.innerText,'上传简历');}finally{f.restore();}}
});
test('uploading state and filename-only text cannot become website uploaded proof',()=>{
 for(const options of [{state:'uploading'},{state:'uploaded',sameFilenameOnly:true},{state:'uploaded',duplicateFilename:true}]){const f=fixture(options);try{assert.ok(f.resolve('input')[0]);assert.equal(f.resolve('filenames','uploaded')[0],null);assert.equal(f.resolve('filenames','uploaded')[1],null);assert.equal(f.remove(),null);}finally{f.restore();}}
});
test('filenames cannot become section labels and multiple file inputs or unproven captions remain ambiguous',()=>{
 for(const options of [{state:'uploaded',titleFilename:true},{state:'uploaded',multiple:true},{state:'uploaded',fakeTitle:true}]){const f=fixture(options);try{assert.deepEqual(f.resolve('input','container','filenames','uploaded'),[null,null,null,null]);}finally{f.restore();}}
});

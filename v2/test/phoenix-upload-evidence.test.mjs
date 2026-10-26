import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {controlDOM} from '../shared/control-dom.mjs';
import {verifyForm} from '../shared/verifier.mjs';

const base='https://acdn.bstatics.com/ux/ux-recruitment-portal-2022-form-pc/release/dist/';
// Actual public module 30914/79025 paths captured with module 98670's done branch.
const download='M9.5 12.515c.748-.75 2.353-2.353 4.814-4.812l.707.707-5.303 5.303c-.39.39-1.028.387-1.415 0L3 8.41l.707-.707L8.5 12.496V2.383C8.5 2.17 8.724 2 9 2s.5.171.5.383v10.132zM2.404 16C2.18 16 2 15.776 2 15.5s.18-.5.404-.5h13.192c.223 0 .404.224.404.5s-.18.5-.404.5H2.404z';
const preview='M.156 8.464c.117-.185.33-.487.633-.868.5-.628 1.079-1.254 1.735-1.841C4.437 4.042 6.608 3 9 3c2.38 0 4.549 1.042 6.466 2.754a15.213 15.213 0 0 1 1.74 1.84c.304.38.518.682.636.867a1 1 0 0 1-.002 1.081c-.118.184-.333.486-.64.866a15.36 15.36 0 0 1-1.744 1.839C13.535 13.958 11.37 15 9 15c-2.38 0-4.549-1.042-6.466-2.754a15.213 15.213 0 0 1-1.74-1.84c-.304-.38-.518-.682-.636-.867a1 1 0 0 1-.002-1.075zM1 9s3.2 5 8 5c4.775 0 8-5 8-5s-3.2-5-8-5C4.175 4 1 9 1 9zm5 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm1 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0z';
function element(tag,text='',attrs={},children=[]){
 const n={tagName:tag.toUpperCase(),attrs,children,parentElement:null,hidden:false,getAttribute:k=>attrs[k]??null,getClientRects(){return this.hidden?[]:[{}];}};
 Object.defineProperties(n,{id:{get:()=>attrs.id||''},type:{get:()=>attrs.type||''},innerText:{get:()=>text+children.filter(c=>!c.hidden).map(c=>c.innerText).join('')},textContent:{get:()=>text+children.map(c=>c.textContent).join('')},previousElementSibling:{get:()=>n.parentElement?.children[n.parentElement.children.indexOf(n)-1]||null}});
 n.matches=selector=>selector.split(',').some(raw=>{const parts=raw.trim().split(/\s+/),part=parts.pop();if(parts.length){if(!n.matches(part))return false;let parent=n.parentElement;while(parent){if(parent.matches(parts.join(' ')))return true;parent=parent.parentElement;}return false;}if(part==='*')return true;if(part.startsWith('#'))return n.id===part.slice(1);if(part.startsWith('.'))return (attrs.class||'').split(/\s+/).includes(part.slice(1));const match=part.match(/^([a-z0-9]+)?(?:\[([\w-]+)(\*?=)?"?([^\]"]*)"?\])?$/i);if(!match)return false;if(match[1]&&n.tagName!==match[1].toUpperCase())return false;if(match[2]){if(!(match[2] in attrs))return false;if(match[3]==='='&&attrs[match[2]]!==match[4])return false;if(match[3]==='*='&&!attrs[match[2]].includes(match[4]))return false;}return true;});
 n.querySelectorAll=s=>children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);n.querySelector=s=>n.querySelectorAll(s)[0]||null;n.contains=x=>n===x||children.some(c=>c.contains(x));n.closest=s=>n.matches(s)?n:n.parentElement?.closest(s)||null;
 children.forEach(c=>{c.parentElement=n;});return n;
}
function fixture({icon='download',bundle='entry',wrongLevel=false,state,duplicateName=false,salt=''}={}){
 const c=name=>name.replace('sc-','sc-'+salt);
 const svg=element('svg','',{},[element('path','',{d:'M0 0h18v18H0z'}),element('path','',{d:icon==='download'?download:icon==='preview'?preview:'unrecognized-delete-or-filetype-path'})]);
 const action=element('div','',{class:c('sc-fIosxK')},[svg]),actions=element('div','',{class:c('sc-htJRVC')},wrongLevel?[]:[action]);
 const name=element('div','resume.pdf',{id:'filename',class:c('sc-hAcGzb')}),text=element('div','',{class:c('sc-dUbtfd')},[name,...(duplicateName?[element('div','resume.pdf')]:[])]),type=element('div','',{class:c('sc-cbTzjv')},[element('div','',{class:'upload-file-icon-style pdf-icon file-card-type'}),...(wrongLevel?[action]:[])]);
 const row=element('div','',{class:c('sc-jlRLRk')},[type,text,actions]),card=element('div','',{class:c('sc-lkgTHX')},[row]),list=element('div','',{class:'file-uploader__list-view'},[card]);
 const input=element('input','',{type:'file'});input.hidden=true;
 const extra=state==='progress'?[element('span','63%')]:state==='error'?[element('span','上传错误')]:state==='busy'?[element('div','',{'aria-busy':'true'})]:[];
 const wrapper=element('div','',{class:'file-uploader__wrapper'},[element('span','重新上传'),input,list,...extra]),root=element('div','',{id:'upload',class:'form-item--phoenix'},[element('div','',{class:'form-item__title'},[element('span','简历附件',{class:'form-item__text'})]),wrapper]);
 const entry=base+'pcform-e1944db80b7bd4c43439.chunk.min.js',library=base+'beisen-phoenix-part2-502f98f31630e64ee05b.chk.js';
 const body=element('body','',{},[element('h1','Product',{id:'role'}),root,...(bundle==='resource'?[]:[element('script','',{src:bundle==='entry'?entry:bundle==='library'?library:bundle==='protocol_relative_entry'?entry.replace('https:',''):bundle==='protocol_relative_library'?library.replace('https:',''):base+'unknown-version.js'})])]);
 const read=spec=>JSON.parse(JSON.stringify(vm.runInNewContext('('+controlDOM.toString()+')(spec)',{spec,document:{body,querySelectorAll:s=>body.querySelectorAll(s)},location:{href:'https://fixture.test/form'},Date,URL,CSS:{escape:s=>s},getComputedStyle:()=>({visibility:'visible'}),performance:{getEntriesByType:()=>bundle==='resource'?[{name:library}]:[]}})));
 const ref=part=>'uploadq:'+JSON.stringify({label:'简历附件',occurrence:0,part});
 const resolved=()=>read({operation:'resolveUpload',references:[ref('filenames'),ref('uploaded')]});
 return {read,resolved,observe:()=>{const [names,uploaded]=resolved();return read({roleSelector:'#role',fields:[{id:'resume',kind:'file',read:{selector:'#upload',kind:'files',filenameSelector:names?'#filename':':not(*)',uploadedSelector:uploaded||':not(*)'}}]});}};
}

test('verified Phoenix done-only actions establish website completion with precise source provenance',()=>{
 for(const icon of ['download','preview'])for(const bundle of ['entry','library','resource']){const f=fixture({icon,bundle}),o=f.observe();assert.ok(f.resolved()[1]);assert.equal(o.fields.resume.uploadState,'site_rendered_uploaded');const evidence=o.fields.resume.uploadEvidence[0];assert.equal(evidence.kind,'phoenix_done_action_icon');assert.equal(evidence.icon,icon);assert.equal(evidence.contractSourceSha256.length,64);assert.equal(evidence.loadedVersionEvidence,undefined);assert.equal(evidence.liveSourceHash,undefined);const result=verifyForm({pageUrl:'https://fixture.test/form',roleTitle:'Product',fields:[{id:'resume',kind:'file',value:['resume.pdf']}]},{...o,inventoryIds:['resume']});assert.equal(result.status,'verified');}
});
test('filename, replace text and filetype/delete icons cannot prove completion',()=>{
 const f=fixture({icon:'delete'});assert.equal(f.resolved()[1],null);assert.equal(f.observe().fields.resume.uploadState,'unverified');
});
test('protocol-relative loaded script URLs retain the same source-verified done proof',()=>{
 for(const bundle of ['protocol_relative_entry','protocol_relative_library']){const result=fixture({bundle}).observe();assert.equal(result.fields.resume.uploadState,'site_rendered_uploaded');assert.equal(result.fields.resume.uploadEvidence[0].kind,'phoenix_done_action_icon');}
 const rejected=fixture({bundle:'protocol_relative_entry',icon:'delete'}).observe();assert.equal(rejected.fields.resume.uploadState,'unverified');
});
test('the same done-only SVG outside the exact filecard action hierarchy is rejected',()=>{
 const f=fixture({wrongLevel:true});assert.equal(f.resolved()[1],null);assert.equal(f.observe().fields.resume.uploadState,'unverified');
});
test('progress, error and busy states override a positive action icon',()=>{
 for(const state of ['progress','error','busy']){const f=fixture({state});assert.equal(f.resolved()[1],null);assert.equal(f.observe().fields.resume.uploadState,'unverified');assert.deepEqual(f.observe().fields.resume.uploadEvidence,[]);}
});
test('rebuilt styles and bundle versions do not change the filecard reading; ambiguous same-card filenames stay unverified',()=>{
 for(const options of [{bundle:'unknown'},{salt:'Zq9'},{bundle:'unknown',salt:'Xy7'}]){const f=fixture(options);assert.ok(f.resolved()[1]);assert.equal(f.observe().fields.resume.uploadState,'site_rendered_uploaded');}
 const f=fixture({duplicateName:true});assert.equal(f.resolved()[1],null);assert.equal(f.observe().fields.resume.uploadState,'unverified');
});
test('the Phoenix adapter is the last retrieval route: the download icon is retrievable, a preview-only card is not',()=>{
 const download=fixture({salt:'Ab1'}).read({operation:'resolveUploadDownload',containerSelector:'#upload',filename:'resume.pdf'});assert.equal(download.via,'phoenix_download_icon');assert.ok(download.selector);
 assert.equal(fixture({icon:'preview'}).read({operation:'resolveUploadDownload',containerSelector:'#upload',filename:'resume.pdf'}),null);
});

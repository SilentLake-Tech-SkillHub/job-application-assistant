import test from 'node:test';
import assert from 'node:assert/strict';
import {antDOM} from '../shared/ant-reference.mjs';

function fixture(titles){
 const make=(kind,tagName,innerText='')=>({kind,tagName,innerText,children:[],classList:{contains:()=>false},getClientRects:()=>[{}],getAttribute:()=>null,
  contains(node){return this===node||this.children.some(c=>c.contains(node));},
  closest(selector){for(let n=this;n;n=n.parentElement)if(selector==='form.ant-form'&&n.kind==='form'||selector==='.ant-form-item'&&n.kind==='question')return n;return null;},
  querySelector(selector){if(this.kind==='form'&&selector==='h1,h2,h3,h4,[role="heading"]')return {innerText:this.innerText};return null;},
  querySelectorAll(selector){if(this.kind==='form'&&selector.startsWith('input,'))return this.fields;if(this.kind==='question'&&selector==='.ant-form-item-label')return [this.label];return [];}});
 const add=(parent,child)=>{child.parentElement=parent;child.previousElementSibling=parent.children.at(-1);parent.children.push(child);return child;};
 const body=make('body','BODY'),forms=titles.map(title=>{
  const form=add(body,make('form','FORM',title)),section=add(form,make('section','DIV','Shared section')),q=add(section,make('question','DIV'));
  q.label=add(q,make('label','LABEL','Same question'));
  const input=add(q,make('control','INPUT'));Object.assign(input,{type:'text',readOnly:false,disabled:false});form.fields=[input];return form;
 });
 return {body,querySelectorAll:selector=>selector==='form.ant-form'?forms:[]};
}

test('Ant inventory scopes identical questions to each observed form, then resolves their actual nodes',()=>{
 const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;
 try{
  globalThis.document=fixture(['Referral','Application']);globalThis.getComputedStyle=()=>({visibility:'visible'});
  const controls=antDOM();assert.equal(controls.length,2);
  assert.ok(controls.every(c=>c.label==='Same question'));
  const references=controls.map(c=>JSON.parse(c.selector.slice(5)));
  assert.deepEqual(references.map(r=>r.formKey),['heading:Referral','heading:Application']);
  assert.ok(references.every(r=>r.occurrence===0));
  const paths=antDOM({operation:'resolve',references:controls.map(c=>c.selector)});
  assert.equal(new Set(paths).size,2);assert.ok(paths.every(p=>p.startsWith('body > form:nth-of-type(')));
  assert.equal(antDOM({operation:'resolve',reference:'antq:'+JSON.stringify({...references[0],formKey:undefined})}),null);
  globalThis.document=fixture(['Duplicate','Duplicate']);assert.throws(()=>antDOM(),/ANT_FORM_SCOPE_REQUIRED/);
  globalThis.document=fixture(['Only']);assert.equal(JSON.parse(antDOM()[0].selector.slice(5)).formKey,undefined);
 }finally{globalThis.document=previousDocument;globalThis.getComputedStyle=previousStyle;}
});

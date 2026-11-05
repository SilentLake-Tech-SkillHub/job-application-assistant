import test from 'node:test';
import assert from 'node:assert/strict';
import {antDOM} from '../shared/ant-reference.mjs';

function fixture(titles,repeatButtons=0,rows=repeatButtons?2:1){
 const make=(kind,tagName,innerText='')=>({kind,tagName,innerText,children:[],classList:{contains:()=>false},getClientRects:()=>[{}],getAttribute:()=>null,
  contains(node){return this===node||this.children.some(c=>c.contains(node));},
  closest(selector){for(let n=this;n;n=n.parentElement)if(selector==='form.ant-form'&&n.kind==='form'||selector==='.ant-form-item'&&n.kind==='question')return n;return null;},
  querySelector(selector){if(this.kind==='form'&&selector==='h1,h2,h3,h4,[role="heading"]')return {innerText:this.innerText};return null;},
  querySelectorAll(selector){if(this.kind==='form'&&selector.startsWith('input,'))return this.fields;if(this.kind==='question'&&selector==='.ant-form-item-label')return [this.label];if(this.kind==='section'&&selector==='button[type="button"],[role="button"]')return this.children.filter(n=>n.tagName==='BUTTON');return [];}});
 const add=(parent,child)=>{child.parentElement=parent;child.previousElementSibling=parent.children.at(-1);parent.children.push(child);return child;};
 const body=make('body','BODY'),forms=titles.map(title=>{
  const form=add(body,make('form','FORM',title)),section=add(form,make('section','DIV','Shared section'));
  form.fields=[];
  for(let i=0;i<rows;i++){
   const row=add(section,make('row','DIV')),q=add(row,make('question','DIV'));
   q.label=add(q,make('label','LABEL','Same question'));
   const input=add(q,make('control','INPUT'));Object.assign(input,{type:'text',readOnly:false,disabled:false});form.fields.push(input);
  }
  for(let i=0;i<repeatButtons;i++)add(section,make('add','BUTTON','Add record'));
  return form;
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

test('Ant discovery returns an add control scoped to the observed rows and rejects an ambiguous button',()=>{
 const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;
 try{
  globalThis.document=fixture(['Only'],1);globalThis.getComputedStyle=()=>({visibility:'visible'});
  const [group]=antDOM({operation:'repeatDiscovery',titles:['Shared section']});
  assert.equal(group.addLabel,'Add record');
  assert.equal(antDOM({operation:'resolve',reference:group.selector}).split(',').length,2);
  assert.match(antDOM({operation:'resolve',reference:group.addSelector}),/button:nth-of-type\(1\)$/);
  globalThis.document=fixture(['Only'],1,1);
  const [first]=antDOM({operation:'repeatDiscovery',titles:['Shared section']});
  assert.equal(antDOM({operation:'resolve',reference:first.selector}).split(',').length,1);
  globalThis.document=fixture(['Only'],2);
  assert.deepEqual(antDOM({operation:'repeatDiscovery',titles:['Shared section']}),[]);
  assert.equal(antDOM({operation:'resolve',reference:group.addSelector}),null);
 }finally{globalThis.document=previousDocument;globalThis.getComputedStyle=previousStyle;}
});

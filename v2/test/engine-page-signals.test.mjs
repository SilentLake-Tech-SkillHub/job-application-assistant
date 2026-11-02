import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {unstablePageSignals} from '../shared/selector-stability.mjs';

// Engine code must recognise pages by semantics, public component classes and
// structure. Build-generated class names and content-hashed bundle URLs change
// whenever a site is rebuilt; they may not appear in component code at all.
const roots=['shared','login','scripts','hooks','application'];
test('component code names no build-generated classes or hashed bundle files',async()=>{
 const found=[];
 for(const dir of roots){
  for(const name of await readdir(new URL(`../${dir}/`,import.meta.url))){
   if(!/\.(?:mjs|js|py)$/.test(name))continue;
   const source=await readFile(new URL(`../${dir}/${name}`,import.meta.url),'utf8');
   for(const token of unstablePageSignals(source))found.push(`${dir}/${name}: ${token}`);
  }
 }
 assert.deepEqual(found,[]);
});
test('the scanner catches each kind of build artifact and ignores public classes',()=>{
 assert.deepEqual(unstablePageSignals("closest('.sc-lkgTHX') .Title__sc-1x2y3z-0 .css-1q2w3e4 .title___a1B2c"),['sc-lkgTHX','Title__sc-1x2y3z-0','css-1q2w3e4','title___a1B2c']);
 assert.deepEqual(unstablePageSignals("'https://cdn.test/dist/pcform-e1944db80b7bd4c43439.chunk.min.js' 'beisen-phoenix-part2-502f98f31630e64ee05b.chk.js'"),['pcform-e1944db80b7bd4c43439.chunk.min.js','beisen-phoenix-part2-502f98f31630e64ee05b.chk.js']);
 assert.deepEqual(unstablePageSignals("'.file-uploader__list-view' '.ant-upload-list-item-name' '.form-item--phoenix' '.phoenix-radio__radio-text' sc-xxxx css-modal"),[]);
});

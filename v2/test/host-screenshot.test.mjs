import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {PNG} from 'playwright-core/lib/utilsBundle';
import {redactAndCropScreenshot,screenshotHostTab} from '../shared/host-screenshot.mjs';
const pixels=(width,height)=>{const p=new PNG({width,height});p.data.fill(255);return PNG.sync.write(p);};
test('native screenshot masks sensitive regions in memory before cropping or writing',()=>{
 const p=PNG.sync.read(redactAndCropScreenshot(pixels(100,200),{width:100,height:200,masks:[{x:10,y:20,width:20,height:10}],clip:{x:10,y:20,width:40,height:20}}));assert.equal(p.width,40);assert.equal(p.height,20);assert.deepEqual([...p.data.slice(0,4)],[255,0,204,255]);assert.deepEqual([...p.data.slice(30*4,30*4+4)],[255,255,255,255]);
});
test('viewport-only screenshot cannot masquerade as a full large PDF document',()=>{
 assert.throws(()=>redactAndCropScreenshot(pixels(100,50),{width:100,height:200,masks:[],clip:{x:0,y:0,width:100,height:200}}),/FULL_DOCUMENT_REQUIRED/);
 assert.throws(()=>redactAndCropScreenshot(pixels(100,200),{width:100,height:200,masks:[],clip:{x:0,y:150,width:100,height:100}}),/TARGET_NOT_FULLY_COVERED/);
});
test('official SDK screenshot uses read-only geometry, writes only safe PNG, and reports complete coverage',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'host-shot-'));const geometry={pageUrl:'https://example.test/form',generation:'doc-1',width:100,height:200,masks:[{x:10,y:20,width:20,height:10}],clip:{x:10,y:20,width:40,height:20}};const tab={playwright:{evaluate:async fn=>String(fn).includes('screenshotGeometryDOM')?geometry:['#sensitive']},screenshot:async options=>{assert.deepEqual(options,{fullPage:true});return pixels(100,200);}};
 try{const result=await screenshotHostTab({tab,directory:dir,selector:'#photo'});assert.equal(result.coverage.targetFullyCovered,true);assert.equal(result.sensitiveFieldsMasked,1);assert.equal(PNG.sync.read(await readFile(result.path)).height,20);await assert.rejects(screenshotHostTab({tab,directory:dir,options:{style:'body{}'}}),/STYLE_UNSUPPORTED/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('navigation during native screenshot invalidates the image before persistence',async()=>{
 let i=0;const tab={playwright:{evaluate:async fn=>String(fn).includes('screenshotGeometryDOM')?{pageUrl:'https://example.test/form',generation:'doc-'+i++,width:100,height:200,masks:[],clip:null}:[]},screenshot:async()=>pixels(100,200)};
 await assert.rejects(screenshotHostTab({tab,directory:'/unused'}),/PAGE_OR_LAYOUT_CHANGED/);
});

test('newly appearing sensitive fields invalidate pixels before any image is written',async()=>{
 let masks=0;const geometry={pageUrl:'https://example.test/form',generation:'same',width:100,height:200,masks:[],clip:null};const tab={playwright:{evaluate:async fn=>String(fn).includes('screenshotGeometryDOM')?geometry:masks++?['#new-document-number']:[]},screenshot:async()=>pixels(100,200)};
 await assert.rejects(screenshotHostTab({tab,directory:'/unused'}),/SENSITIVE_FIELDS_CHANGED/);
});

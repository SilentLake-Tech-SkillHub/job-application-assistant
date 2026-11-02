import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeDOMSnapshot,observedScriptOrigins,captureNativePageStructure,scriptCoverage,searchCapturedScripts} from '../shared/page-structure.mjs';
const snapshot=()=>({strings:['INPUT','id','field','value','private answer','role','textbox'],documents:[{frameId:'main',nodes:{nodeType:[1],parentIndex:[-1],backendNodeId:[42],nodeName:[0],attributes:[[1,2,3,4,5,6]],inputValue:{index:[0],value:[4]}},layout:{nodeIndex:[0],bounds:[[1,2,30,40]],clientRects:[[0,0,30,40]]}}]});
test('native structure retains locator attributes and spatial bounds without copying input answers',()=>{
 const node=normalizeDOMSnapshot(snapshot())[0].nodes[0];assert.deepEqual(node.attributes,{id:'field',role:'textbox'});assert.deepEqual(node.layout.bounds,[1,2,30,40]);assert.equal(node.backendNodeId,42);assert.equal(JSON.stringify(node).includes('private answer'),false);
});

test('local script search returns bounded literal evidence and never the entire bundle',()=>{
 const text='prefix'.repeat(100)+'fieldRule'+'.'.repeat(1000),inventory={items:[{script_key:'script',url:'https://assets.example/app.js',source:{included:true,artifact:{text,sha256:'a'.repeat(64)}}}]};
 const found=searchCapturedScripts(inventory,['fieldRule'],{limit:1,radius:10});assert.equal(found.matches.length,1);assert.equal(found.matches[0].excerpt.length,29);assert.equal(found.matches[0].offset,600);assert.equal(found.matches[0].sha256,'a'.repeat(64));assert.equal(found.truncated,false);
});
test('script origin expansion follows actual loaded script resources including their CDN, not arbitrary URLs',()=>{
 const tree={frameTree:{resources:[{type:'Script',url:'https://assets.example/app.js'},{type:'Image',url:'https://images.example/x.png'},{type:'Script',url:'data:text/javascript,example'}],childFrames:[{resources:[{type:'Script',url:'https://modules.example/chunk.js'}]}]}};
 assert.deepEqual(observedScriptOrigins(tree,'https://forms.example/apply'),['https://assets.example','https://forms.example','https://modules.example']);
});
test('one native acquisition returns DOM/AX/layout and script scope on the existing CDP session',async()=>{
 const calls=[],cdp={send:async(method,args)=>{calls.push({method,args});return method==='DOMSnapshot.captureSnapshot'?snapshot():method==='Accessibility.getFullAXTree'?{nodes:[{nodeId:'a',backendDOMNodeId:42,role:{value:'textbox'},name:{value:'Question'},value:{value:'must not copy'}}]}:{frameTree:{resources:[]}};}};
 const capture=await captureNativePageStructure(cdp,{pageUrl:'https://forms.example/apply',targetId:'original'});
 assert.equal(calls.length,3);assert.ok(calls.every(c=>!c.method.includes('navigate')));assert.equal(calls[0].args.includeDOMRects,true);assert.equal(capture.accessibility[0].backendNodeId,42);assert.equal(capture.accessibility[0].value,undefined);assert.equal(capture.executableSelectors,false);assert.ok(capture.attributeScope.names.includes('aria-expanded'));assert.equal(capture.attributeScope.omittedAttributeIsNotAbsenceProof,true);
});
test('script coverage validates complete local source artifacts and preserves exclusions',()=>{
 const text='export const label="School";',artifact={text,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};
 const evidence={normalized_result:{scripts:{items:[{source:{included:true,artifact}},{source:{included:false,reason:'out of scope'}}]},completeness:{excluded:[{section:'scripts',reason:'disallowed_origin',count:1}]}}};
 assert.equal(scriptCoverage(evidence).included,1);assert.equal(scriptCoverage(evidence).excluded,1);assert.equal(scriptCoverage(evidence).limitations.length,1);
 artifact.text+='changed';assert.throws(()=>scriptCoverage(evidence),/SCRIPT_ARTIFACT_HASH_MISMATCH/);
});

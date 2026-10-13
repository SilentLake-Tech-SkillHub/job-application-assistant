'use strict';
const {mapInventory}=require('./form_semantics.cjs');
const {digestCanonicalValue}=require('./vendor/rea_canonical_digest.cjs');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>input+=d);
process.stdin.on('end',()=>{try{
  const {inventory,mapping,url}=JSON.parse(input), current=mapInventory(inventory,url);
  // cacheHit is observation metadata, not an executable assignment.
  const expected={...current,cacheHit:false}, actual={...mapping,cacheHit:false};
  if(digestCanonicalValue(expected)!==digestCanonicalValue(actual))throw Error('Current inventory and rules do not reproduce mapping');
}catch(e){console.error(e.message);process.exitCode=2;}});

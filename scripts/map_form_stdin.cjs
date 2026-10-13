'use strict';
const {mapInventory,verifiedCache,summary}=require('./form_semantics.cjs');
let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>raw+=d);
process.stdin.on('end',()=>{try{
  const {inventory,url,cache,verifiedIndexes}=JSON.parse(raw);
  const mapping=mapInventory(inventory,url,cache);
  process.stdout.write(JSON.stringify({mapping,summary:summary(mapping),cache:verifiedIndexes?verifiedCache(mapping,verifiedIndexes):null}));
}catch(e){console.error(e.message);process.exitCode=2;}});

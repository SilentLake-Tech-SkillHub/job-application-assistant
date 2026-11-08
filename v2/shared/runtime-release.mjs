import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {genericSourceManifest} from './runtime-identity.mjs';
export const CORE_PROTOCOL_VERSION=2;
export async function installedRelease(){
 const [manifest,pkg]=await Promise.all([genericSourceManifest(),readFile(new URL('../package.json',import.meta.url),'utf8')]);
 return {version:JSON.parse(pkg).version,sourceFingerprint:manifest.sourceFingerprint};
}
export async function interfaceFingerprint(){
 const names=['shared/core-client.mjs','shared/mcp-proxy.mjs','shared/runtime-release.mjs','scripts/start.mjs','scripts/cli.mjs'];
 const bytes=await Promise.all(names.map(n=>readFile(new URL('../'+n,import.meta.url))));const hash=createHash('sha256');
 names.forEach((name,i)=>hash.update(name).update('\0').update(bytes[i]));return hash.digest('hex');
}
export function requireSameRelease(actual,expected){
 if(actual?.version!==expected?.version||actual?.sourceFingerprint!==expected?.sourceFingerprint)throw Error('RUNTIME_VERSION_MISMATCH');
}

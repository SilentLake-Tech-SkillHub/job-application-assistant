import {stat,mkdir,readdir,access,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),cache=new Map();
export function attachmentFileDescriptor(asset){if(!asset||typeof asset!=='object')return null;const keys=['paths','displayNames','materialId','id','revision','version','renderedPdf','sensitive'];return Object.fromEntries(keys.filter(k=>Object.hasOwn(asset,k)).map(k=>[k,asset[k]]));}
const metadata=async paths=>Promise.all(paths.map(async file=>{if(typeof file!=='string'||!path.isAbsolute(file))throw Error('ATTACHMENT_LOCAL_SOURCE_REQUIRED');const info=await stat(file);if(!info.isFile()||!info.size)throw Error('ATTACHMENT_LOCAL_SOURCE_UNAVAILABLE');return {device:info.dev,inode:info.ino,size:info.size,mtimeMs:info.mtimeMs};}));
export async function attachmentFileMetadata(asset){if(!asset?.paths?.length)throw Error('ATTACHMENT_LOCAL_SOURCE_REQUIRED');return metadata(asset.paths);}
export async function attachmentSourceRevision(asset){if(!asset?.paths?.length)throw Error('ATTACHMENT_LOCAL_SOURCE_REQUIRED');return JSON.stringify({materialId:asset.materialId||asset.id||asset.displayNames,revision:asset.revision||asset.version||null,files:await metadata(asset.paths)});}
export async function renderAttachmentSource(asset){
 const revision=await attachmentSourceRevision(asset),prior=cache.get(revision);if(prior){try{await Promise.all(prior.pages.map(p=>access(p.path)));return prior;}catch{cache.delete(revision);}}
 if(asset.paths.length!==1)throw Error('MULTI_SOURCE_ATTACHMENT_RENDERER_REQUIRED');
 let source=asset.paths[0],extension=path.extname(source).toLowerCase();
 if(['.jpg','.jpeg','.png'].includes(extension))return {pages:[{pageNumber:1,path:source,mimeType:extension==='.png'?'image/png':'image/jpeg'}],pageCount:1,complete:true,sourceRevision:revision};
 if(['.doc','.docx'].includes(extension)){
  if(!asset.renderedPdf?.path||asset.renderedPdf.sourceRevision!==revision)throw Error('WORD_CONFIRMED_PDF_RENDERER_REQUIRED');
  source=asset.renderedPdf.path;extension='.pdf';
 }
 if(extension!=='.pdf')throw Error('ATTACHMENT_SOURCE_RENDERER_UNAVAILABLE');
 const dir=path.join(tmpdir(),'recruiting-source-pages-'+process.getuid(),randomUUID());await mkdir(dir,{recursive:true,mode:0o700});let count;
 try{
  const info=await execute(process.env.RECRUITING_PDFINFO||'pdfinfo',[source],{timeout:10000,maxBuffer:1024*1024});count=Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);if(!Number.isInteger(count)||count<1||count>40)throw Error('ATTACHMENT_SOURCE_PAGE_COUNT_UNAVAILABLE');
  await execute(process.env.RECRUITING_PDFTOPPM||'pdftoppm',['-png','-r','110',source,path.join(dir,'page')],{timeout:60000,maxBuffer:1024*1024});
 }catch(error){
  if(error.code!=='ENOENT')throw Error(/^[A-Z_]+$/.test(error.message)?error.message:'ATTACHMENT_LOCAL_PDF_RENDER_FAILED');
  if(process.platform!=='darwin')throw Error('ATTACHMENT_LOCAL_PDF_RENDERER_UNAVAILABLE');
  let result;try{result=await execute('/usr/bin/swift',[fileURLToPath(new URL('../scripts/render-attachment-pages.swift',import.meta.url)),source,dir],{timeout:60000,maxBuffer:1024*1024});count=JSON.parse(result.stdout).pageCount;}catch{throw Error('ATTACHMENT_LOCAL_PDF_RENDER_FAILED');}
 }
 const names=(await readdir(dir)).filter(n=>/^page-\d+\.png$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
 if(names.length!==count||revision!==await attachmentSourceRevision(asset))throw Error('ATTACHMENT_SOURCE_CHANGED_DURING_RENDER');
 const result={pages:names.map((name,i)=>({pageNumber:i+1,path:path.join(dir,name),mimeType:'image/png'})),pageCount:count,complete:true,sourceRevision:revision};cache.set(revision,result);if(cache.size>24){const first=cache.keys().next().value,old=cache.get(first);cache.delete(first);const oldDir=old?.pages?.[0]&&path.dirname(old.pages[0].path);if(oldDir?.startsWith(path.join(tmpdir(),'recruiting-source-pages-'+process.getuid())+path.sep))await rm(oldDir,{recursive:true,force:true}).catch(()=>{});}return result;
}

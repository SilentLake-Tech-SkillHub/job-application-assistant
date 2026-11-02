import {PNG,jpegjs} from 'playwright-core/lib/utilsBundle';
import {mkdir,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {screenshotMaskDOM} from './screenshot-mask.mjs';
// Geometry and policy are read from the actual page. Raw pixels stay in memory;
// only a masked, optionally cropped PNG may be written to the private directory.
export function screenshotGeometryDOM({selectors,selector}){
 const box=n=>{const b=n.getBoundingClientRect();return {x:b.left+scrollX,y:b.top+scrollY,width:b.width,height:b.height};};
 const single=s=>{const nodes=[...document.querySelectorAll(s)].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');if(nodes.length!==1)throw Error('HOST_SCREENSHOT_TARGET_NOT_UNIQUE');return box(nodes[0]);};
 return {pageUrl:location.href,generation:String(performance.timeOrigin),width:Math.max(innerWidth,document.documentElement.scrollWidth,document.body.scrollWidth),height:Math.max(innerHeight,document.documentElement.scrollHeight,document.body.scrollHeight),masks:selectors.map(single),clip:selector?single(selector):null};
}
export function redactAndCropScreenshot(bytes,geometry){
 let image;try{image=PNG.sync.read(Buffer.from(bytes));}catch{try{image=jpegjs.decode(Buffer.from(bytes),{useTArray:true});}catch{throw Error('HOST_SCREENSHOT_IMAGE_FORMAT_REQUIRED');}}
 const scale=image.width/geometry.width;if(!Number.isFinite(scale)||scale<=0||!image.height)throw Error('HOST_SCREENSHOT_GEOMETRY_REQUIRED');
 const expectedHeight=geometry.height*scale;if(Math.abs(image.height-expectedHeight)>Math.max(2,scale))throw Error('HOST_SCREENSHOT_FULL_DOCUMENT_REQUIRED');
 if(geometry.clip&&(geometry.clip.x<0||geometry.clip.y<0||geometry.clip.x+geometry.clip.width>geometry.width+1||geometry.clip.y+geometry.clip.height>geometry.height+1))throw Error('HOST_SCREENSHOT_TARGET_NOT_FULLY_COVERED');
 const rect=b=>({x:Math.max(0,Math.floor(b.x*scale)),y:Math.max(0,Math.floor(b.y*scale)),right:Math.min(image.width,Math.ceil((b.x+b.width)*scale)),bottom:Math.min(image.height,Math.ceil((b.y+b.height)*scale))});
 for(const b of geometry.masks){const r=rect(b);for(let y=r.y;y<r.bottom;y++)for(let x=r.x;x<r.right;x++){const i=(image.width*y+x)*4;image.data[i]=255;image.data[i+1]=0;image.data[i+2]=204;image.data[i+3]=255;}}
 const r=geometry.clip?rect(geometry.clip):{x:0,y:0,right:image.width,bottom:image.height},width=r.right-r.x,height=r.bottom-r.y;
 if(width<1||height<1)throw Error('HOST_SCREENSHOT_EMPTY_CLIP');
 const result=new PNG({width,height});for(let y=0;y<height;y++)Buffer.from(image.data).copy(result.data,y*width*4,((y+r.y)*image.width+r.x)*4,((y+r.y)*image.width+r.right)*4);
 return PNG.sync.write(result);
}
export async function screenshotHostTab({tab,directory,selector,options={}}){
 if(options.style)throw Error('HOST_SCREENSHOT_STYLE_UNSUPPORTED');
 if(typeof tab.screenshot!=='function')throw Error('HOST_SCREENSHOT_CAPABILITY_REQUIRED');
 const masks=await tab.playwright.evaluate(screenshotMaskDOM),before=await tab.playwright.evaluate(screenshotGeometryDOM,{selectors:masks,selector});
 const bytes=await tab.screenshot({fullPage:true}),afterMasks=await tab.playwright.evaluate(screenshotMaskDOM),after=await tab.playwright.evaluate(screenshotGeometryDOM,{selectors:afterMasks,selector});
 if(JSON.stringify(masks)!==JSON.stringify(afterMasks))throw Error('HOST_SCREENSHOT_SENSITIVE_FIELDS_CHANGED');
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('HOST_SCREENSHOT_PAGE_OR_LAYOUT_CHANGED');
 const safe=redactAndCropScreenshot(bytes,before),file=options.path||path.join(directory,randomUUID()+'.png');
 if(!path.isAbsolute(file))throw Error('HOST_SCREENSHOT_ABSOLUTE_PATH_REQUIRED');
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});await writeFile(file,safe,{mode:0o600});await chmod(file,0o600);
 return {path:file,scope:selector?'captured_field':'full_page',sensitiveFieldsMasked:masks.length,source:'official_host_browser_sdk',generation:before.generation,coverage:{fullDocument:true,targetFullyCovered:true,documentWidth:before.width,documentHeight:before.height}};
}

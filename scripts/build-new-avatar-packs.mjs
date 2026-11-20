import { createServer } from 'node:http';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url));
const outputRoot=path.join(root,'src/interfaces/web/public/avatar-pack');
const states=['idle','working','waiting'],transitions=['idle-to-working','working-to-idle','working-to-waiting','waiting-to-working'];
const sizes={portrait:[32,48,64,96,128,256],body:[256,512,768]};
const definitions=[{type:'masculine',folder:'masculine-v1',name:'Orion',id:'777c0e52-420e-4367-8b5c-11f91bc1624d'},{type:'neutral',folder:'neutral-v1',name:'Prisme',id:'926bfe65-434a-4255-81ca-a85203f406a3'}];
const onlyPosters=process.argv.includes('--posters-only');
const allow=new Map([
 ['/render.html','scripts/avatar-rig/render.html'],['/renderer.js','scripts/avatar-rig/renderer.js'],
 ...['masculine-atlas.png','masculine-head.png','neutral-atlas.png'].map(name=>['/assets/avatar-sources/'+name,'assets/avatar-sources/'+name]),
]);
const server=createServer((request,response)=>{const file=allow.get(request.url);if(!file){response.writeHead(404);response.end();return;}readFile(path.join(root,file)).then(bytes=>{response.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/html');response.end(bytes);},()=>{response.writeHead(500);response.end();});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const cached=path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell');
const browser=await chromium.launch({headless:true,executablePath:cached,args:process.getuid?.()===0?['--no-sandbox']:[]});
const temp=await mkdtemp(path.join(os.tmpdir(),'heart-new-avatar-'));
function ffmpeg(args){const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-filter_complex_threads','1','-y',...args],{encoding:'utf8',timeout:120000});if(result.status!==0)throw new Error(result.stderr?.slice(-1200)||'Video encode failed');}
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${port}/render.html`);
 for(const definition of definitions){
  const {type,folder,name,id}=definition,out=path.join(outputRoot,folder),files=[];
  for(const dir of ['portrait','body','preview','transitions'])await mkdir(path.join(out,dir),{recursive:true});
  const geometry=await page.evaluate(type=>window.initAvatar(type),type);console.log(type,'parts',JSON.stringify(geometry));
  async function record(relative,metadata){const bytes=await readFile(path.join(out,relative));files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...metadata});}
  async function frame(kind,state,time,size,from=null){return Buffer.from(await page.evaluate(args=>window.drawAvatar(...args),[type,state,time,kind,size,from]),'base64');}
  for(const state of states){
   if(onlyPosters){for(const kind of ['portrait','body'])await writeFile(path.join(out,kind,`${state}-${kind==='portrait'?256:768}.png`),await frame(kind,state,0,kind==='portrait'?256:768));continue;}
   for(const kind of ['portrait','body']){
    const dir=path.join(temp,`${type}-${state}-${kind}`);await mkdir(dir);
    const master=kind==='portrait'?512:768;
    for(let index=0;index<96;index++)await writeFile(path.join(dir,`${String(index).padStart(3,'0')}.png`),await frame(kind,state,index/24,master));
    for(const size of sizes[kind]){
     const relative=`${kind}/${state}-${size}`,fps=size<=64?8:12;
     ffmpeg(['-framerate','24','-i',path.join(dir,'%03d.png'),'-vf',`fps=${fps},scale=${size}:${size}:flags=lanczos,format=bgra`,'-an','-c:v','libwebp_anim','-quality','80','-compression_level','4','-loop','0',path.join(out,relative+'.webp')]);
     await writeFile(path.join(out,relative+'.png'),await frame(kind,state,0,size));
     await record(relative+'.webp',{kind,state,size,animated:true,fps,loop:true,durationMs:4000});await record(relative+'.png',{kind,state,size,animated:false});
    }
    if(kind==='portrait'){
     ffmpeg(['-framerate','24','-i',path.join(dir,'%03d.png'),'-filter_complex','[0:v]fps=12,scale=256:256:flags=lanczos[face];color=c=0xf6f5f8:s=256x256:r=12[bg];[bg][face]overlay=shortest=1:format=auto,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a','-loop','0',path.join(out,'preview',state+'.gif')]);
     await record(`preview/${state}.gif`,{kind:'preview',state,size:256,animated:true});
    }
    await rm(dir,{recursive:true,force:true});
   }
   console.log(name,state,'rendered with new facial and articulated motion.');
  }
  if(onlyPosters)continue;
  for(const transition of transitions){
   const [from,to]=transition.split('-to-');
   for(const kind of ['portrait','body']){
    const dir=path.join(temp,`${type}-${transition}-${kind}`);await mkdir(dir);
    const master=kind==='portrait'?512:768;
    for(let index=0;index<37;index++)await writeFile(path.join(dir,`${String(index).padStart(3,'0')}.png`),await frame(kind,to,index/24,master,from));
    for(const size of kind==='portrait'?[128,256]:[512]){
     const relative=`transitions/${transition}-${kind}-${size}.webp`;
     ffmpeg(['-framerate','24','-i',path.join(dir,'%03d.png'),'-vf',`fps=12,scale=${size}:${size}:flags=lanczos,format=bgra`,'-an','-c:v','libwebp_anim','-quality','80','-compression_level','4','-loop','1',path.join(out,relative)]);
     await record(relative,{kind,from,to,size,animated:true,loop:false,fps:12,durationMs:1542});
    }
    await rm(dir,{recursive:true,force:true});
   }
   console.log(name,transition,'rendered.');
  }
  const initial=name[0];await writeFile(path.join(out,'symbol.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${name}"><circle cx="64" cy="64" r="60" fill="#24445c"/><text x="64" y="86" text-anchor="middle" font-family="sans-serif" font-size="68" font-weight="700" fill="#74efff">${initial}</text></svg>`);await record('symbol.svg',{kind:'symbol',animated:false});
  const sources=[];for(const file of type==='masculine'?['masculine-atlas.png','masculine-head.png']:['neutral-atlas.png'])sources.push({path:'assets/avatar-sources/'+file,sha256:createHash('sha256').update(await readFile(path.join(root,'assets/avatar-sources',file))).digest('hex')});
  const manifest={formatVersion:1,id,version:'1.0.0',displayName:name,identity:type,description:'New original generated artwork with deterministic articulated and facial animation.',states,portraitSizes:sizes.portrait,bodySizes:sizes.body,defaultMode:'portrait',defaultSize:48,accessibility:{reducedMotion:'use-png',offscreen:'pause',hiddenDocument:'pause',statusTextRequired:true},source:{type:'new-original-layered-artwork',generator:'image_gen',animation:'Heart Canvas 2D rig',sources},notes:['New original identity, not derived from Nora videos.','Eyes blink and change expression; head and arms are articulated.','4-second cyclic motion; deterministic transitions.','No speaking or lip-sync.'],files};
  await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(name,files.length,'assets exported.');
 }
}finally{await browser.close();await rm(temp,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve));}

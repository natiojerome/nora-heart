import { spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const action=process.argv.includes('--action');
const robot=action||process.argv.includes('--robot');
const version=action?'v5':robot?'v4':'v3';
const output=path.join(root,'src/interfaces/web/public/avatar-portraits',version);
await mkdir(output,{recursive:true});
function run(binary,args){const r=spawnSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});if(r.status!==0)throw new Error(binary+': '+r.stderr?.slice(-900));return r.stdout;}
function ffmpeg(args){run('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-filter_complex_threads','1','-y',...args]);}
const results=[];
const selected=process.argv.slice(2).find(argument=>!argument.startsWith('--'));
if(selected&&!['orion-working','orion-idle','orion-waiting','prisme-working','prisme-idle','prisme-waiting'].includes(selected))throw new Error('Unknown portrait');
for(const identity of ['orion','prisme'])for(const state of ['working','idle','waiting']){
 if(selected&&selected!==identity+'-'+state)continue;
 const id=identity+'-'+state;
 const sourceVersion=action&&state!=='idle'?'v5':robot&&identity==='orion'?'v4':'v3';
 const source=path.join(root,'assets/avatar-portraits',sourceVersion);
 const sourceId=!action&&id==='prisme-waiting'?'prisme-idle':id;
 const input=path.join(source,sourceId+'-pilot.mp4');
 const probe=JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,duration,nb_frames','-of','json',input])).streams[0];
 if(Number(probe.duration)<3.5||probe.width<400)throw new Error('Unexpected video properties');
 await copyFile(input,path.join(output,id+'-original.mp4'));
 const key='format=rgba,colorkey=0x00ff00:0.20:0.07,despill=type=green:mix=0.4:expand=0.05';
 for(const size of [64,128,256]){
  // The question mark is a deterministic UI status, not baked into the generated face.
  const question=state==='waiting'?`,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text=?:fontcolor=0x41cce8:fontsize=${Math.round(size*.19)}:borderw=${Math.max(1,Math.round(size*.008))}:bordercolor=0x20324e:x=w*0.82:y='h*0.10+h*0.015*sin(2*PI*t/4)'`:'';
  const filters=`${key},scale=${size}:${size}:flags=lanczos${robot?'':question}`;
  const graphBase=robot&&state==='waiting'?`movie=${path.join(root,'assets/avatar-portraits/v4/waiting-bubble.png')},scale=${Math.round(size*.20)}:${Math.round(size*.20)}[bubble];[0:v]${filters}[base];[base][bubble]overlay=x=W*0.76:y='H*0.15+H*0.008*sin(2*PI*t/4)':format=auto`:('[0:v]'+filters);
  ffmpeg(['-i',input,'-filter_complex',graphBase+',fps=24,format=bgra','-an','-c:v','libwebp_anim','-quality','86','-compression_level','5','-loop','0',path.join(output,`${id}-${size}.webp`)]);
  ffmpeg(['-i',input,'-filter_complex',graphBase,'-frames:v','1',path.join(output,`${id}-${size}.png`)]);
  if(size===256){
   const graph=`${graphBase},fps=16[face];color=c=0xf6f5f8:s=256x256:r=16[bg];[bg][face]overlay=shortest=1:format=auto,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`;
   ffmpeg(['-i',input,'-filter_complex',graph,'-an','-loop','0',path.join(output,`${id}.gif`)]);
  }
 }
 ffmpeg(['-i',input,'-vf','fps=2,scale=240:240:flags=lanczos,tile=4x2','-frames:v','1',path.join(source,id+'-contact.png')]);
 const result=JSON.parse(await readFile(path.join(source,sourceId+'-result.json'),'utf8'));
 results.push({id,identity,state,sourceId,sourceVersion,method:sourceId===id?'generated-video':'local-composition',...probe,usage:sourceId===id?result.usage:null,sha256:result.sha256});
 console.log(id+': portraits rendered (64/128/256).');
}
let previous=[];try{previous=JSON.parse(await readFile(path.join(output,'results.json'),'utf8')).portraits;}catch(error){if(error.code!=='ENOENT')throw error;}
const combined=[...previous.filter(item=>!results.some(result=>result.id===item.id)),...results];
await writeFile(path.join(output,'results.json'),JSON.stringify({model:'bytedance/seedance-2.0',status:'awaiting-visual-review',sizes:[64,128,256],questionMark:robot?'rounded 3D speech bubble, local floating overlay; original MP4 has no symbol':'local deterministic overlay on waiting exports; original MP4 has no symbol',portraits:combined},null,2)+'\n');

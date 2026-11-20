import { spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.join(root,'assets/avatar-video-pilots/v2');
const output=path.join(root,'src/interfaces/web/public/avatar-pilots/v2');await mkdir(output,{recursive:true});
const records=[];
function run(binary,args){const result=spawnSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});if(result.status!==0)throw new Error(binary+' failed: '+(result.stderr?.slice(-900)??''));return result.stdout;}
function ffmpeg(args){run('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-filter_complex_threads','1','-y',...args]);}
const key='format=rgba,colorkey=0x00ff00:0.20:0.07,despill=type=green:mix=0.4:expand=0.05';
const identities=process.argv[2]?[process.argv[2]]:['masculine','neutral'];
if(identities.some(id=>!['masculine','neutral'].includes(id)))throw new Error('Unknown pilot identity.');
for(const id of identities){
 const input=path.join(source,id+'-pilot.mp4');
 const info=JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,duration,nb_frames','-of','json',input])).streams[0];
 if(Number(info.duration)<3.5||info.width<700)throw new Error('Unexpected pilot properties.');
 await copyFile(input,path.join(output,id+'-original.mp4'));
 const w=Math.floor(info.width*(id==='masculine'?.42:.46)/2)*2;
 const x=Math.floor(info.width*(id==='masculine'?.29:.27)/2)*2;
 const y=Math.floor(info.height*(id==='masculine'?.04:.13)/2)*2;
 const crop=`crop=${w}:${w}:${x}:${y}`;
 for(const kind of ['body','portrait']){
  const filters=key+','+(kind==='portrait'?crop+',':'')+'scale='+(kind==='body'?'384:384':'256:256')+':flags=lanczos';
  ffmpeg(['-i',input,'-vf',filters+',fps=24,format=bgra','-an','-c:v','libwebp_anim','-quality','84','-compression_level','5','-loop','0',path.join(output,`${id}-${kind}.webp`)]);
  ffmpeg(['-i',input,'-vf',filters,'-frames:v','1',path.join(output,`${id}-${kind}.png`)]);
  const dimensions=kind==='body'?'384x384':'256x256';
  const graph=`[0:v]${filters},fps=16[face];color=c=0xf6f5f8:s=${dimensions}:r=16[bg];[bg][face]overlay=shortest=1:format=auto,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`;
  ffmpeg(['-i',input,'-filter_complex',graph,'-an','-loop','0',path.join(output,`${id}-${kind}.gif`)]);
 }
 const graph=`[0:v]fps=2,scale=240:240:flags=lanczos,tile=4x2`;
 ffmpeg(['-i',input,'-vf',graph,'-frames:v','1',path.join(output,id+'-contact.png')]);
 const result=JSON.parse(await readFile(path.join(source,id+'-result.json'),'utf8'));
 records.push({id,name:id==='masculine'?'Orion':'Prisme',status:'pilot-for-review',...info,usage:result.usage,sha256:result.sha256});
 console.log(id+': body and portrait previews rendered from real Seedance video.');
}
let previous=[];try{previous=JSON.parse(await readFile(path.join(output,'results.json'),'utf8')).pilots;}catch(error){if(error.code!=='ENOENT')throw error;}
const combined=[...previous.filter(item=>!records.some(record=>record.id===item.id)),...records].sort((a,b)=>a.id.localeCompare(b.id));
await writeFile(path.join(output,'results.json'),JSON.stringify({model:'bytedance/seedance-2.0',status:'awaiting-visual-review',pilots:combined},null,2)+'\n');

import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const packId=process.argv.slice(2).find(arg=>arg!=='--') ?? 'nora-v1';
if(!['nora-v1','masculine-v1','neutral-v1'].includes(packId))throw new Error('Unknown pack');
const folder=fileURLToPath(new URL(`../src/interfaces/web/public/avatar-pack/${packId}/`,import.meta.url));
const completeFile=packId==='nora-v1'?'nora-avatar-v1.zip':packId+'.zip';
const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
const symbol=await readFile(path.join(folder,'symbol.svg'));
manifest.files=manifest.files.filter(file=>file.path!=='symbol.svg');
manifest.files.push({path:'symbol.svg',kind:'symbol',animated:false,bytes:symbol.length,sha256:createHash('sha256').update(symbol).digest('hex')});
const script=`from pathlib import Path
import json,zipfile
root=Path(${JSON.stringify(folder)})
manifest=json.loads((root/'manifest.json').read_text())
files=[f for f in manifest['files'] if f['kind']=='portrait' or f['kind']=='symbol']
small={**manifest,'bodySizes':[],'files':files,'variant':'portraits-only'}
small.pop('downloads',None)
with zipfile.ZipFile(root/'portraits-only.zip','w',zipfile.ZIP_DEFLATED) as archive:
 archive.writestr('manifest.json',json.dumps(small,indent=2))
 archive.write(root/'README.md','README.md')
 for f in files:archive.write(root/f['path'],f['path'])
with zipfile.ZipFile(root/${JSON.stringify(completeFile)},'w',zipfile.ZIP_DEFLATED) as archive:
 for file in sorted(root.rglob('*')):
  if file.is_file() and file.suffix!='.zip':archive.write(file,file.relative_to(root))
`;
// Packaging only; Python never processes or changes image pixels.
await writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(folder,'manifest.js'),'window.NORA_AVATAR_PACK = '+JSON.stringify(manifest)+';\n');
let result=spawnSync('python3',['-c',script],{encoding:'utf8'});
if(result.status!==0)throw new Error('Archive creation failed.');
manifest.downloads={portraits:(await stat(path.join(folder,'portraits-only.zip'))).size,complete:(await stat(path.join(folder,completeFile))).size};
await writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(folder,'manifest.js'),'window.NORA_AVATAR_PACK = '+JSON.stringify(manifest)+';\n');
// Include the final manifests in the complete bundle. Approximate display bytes
// are acceptable; verified on-disk sizes are printed after this last archive pass.
result=spawnSync('python3',['-c',script],{encoding:'utf8'});
if(result.status!==0)throw new Error('Final archive creation failed.');
console.log('Avatar archives ready:',(await stat(path.join(folder,'portraits-only.zip'))).size,'bytes portraits,',(await stat(path.join(folder,completeFile))).size,'bytes complete.');

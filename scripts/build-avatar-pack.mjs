import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Video processing only. No provider call, credential, runtime or source mutation.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? '/projects/nora/assets/brand/animation/openrouter/seedance-pack-v1');
const output = path.join(root, 'src/interfaces/web/public/avatar-pack/nora-v1');
const portraitsOnly = process.argv.includes('--portraits-only');
const states = ['idle', 'working', 'waiting'];
const portraitSizes = [32, 48, 64, 96, 128, 256];
const bodySizes = [256, 512, 768];
const crops = { idle: [140, 160, 400, 400], working: [230, 25, 400, 400], waiting: [240, 10, 400, 400] };
const loops = { idle: 'idle-loop-review.mp4', working: 'working-loop-trim.mp4', waiting: 'waiting-loop-review.mp4' };
const transitions = ['idle-to-working', 'working-to-idle', 'working-to-waiting', 'waiting-to-working'];
const inputs = [];
const files = [];

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000 });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr?.slice(-1600) ?? result.error?.message}`);
  return result.stdout;
}
function ffmpeg(args) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', '-y', ...args]);
}
function probe(file) {
  return JSON.parse(run('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,duration','-of','json',file])).streams[0];
}
async function record(relative, metadata) {
  const bytes = await readFile(path.join(output, relative));
  files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...metadata });
}
// Key video before resizing so the background cannot bleed into the small face.
// RGB keying protects cyan highlights, which are far from pure green.
const key = 'format=rgba,colorkey=0x00ff00:0.22:0.08,despill=type=green:mix=0.5:expand=0.05';
const mask = "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(W/2-sqrt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)),0,1)'";
const position = crop => `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`;

for (const folder of ['portrait','body','transitions','preview']) await mkdir(path.join(output, folder), { recursive: true });
for (const state of states) {
  const input = path.join(source, loops[state]);
  const info = probe(input);
  if (info.width !== 960 || info.height !== 960) throw new Error('Expected approved square 960px master.');
  inputs.push({ path: loops[state], sha256: createHash('sha256').update(await readFile(input)).digest('hex'), ...info });
  for (const [kind, sizes] of [['portrait', portraitSizes], ['body', bodySizes]]) {
    for (const size of sizes) {
      const relative = `${kind}/${state}-${size}`;
      if (kind === 'body' && portraitsOnly) {
        await record(relative+'.webp', { kind, state, size, animated: true, fps: 12, loop: true, durationMs: Math.round(Number(info.duration)*1000) });
        await record(relative+'.png', { kind, state, size, animated: false });
        continue;
      }
      const crop = kind === 'portrait' ? `${position(crops[state])},` : '';
      const filters = `${key},${crop}fps=${size <= 64 ? 8 : 12},scale=${size}:${size}:flags=lanczos,${kind === 'portrait' ? mask+',' : ''}format=bgra`;
      ffmpeg(['-i',input,'-vf',filters,'-an','-c:v','libwebp_anim','-quality','82','-compression_level','5','-loop','0',path.join(output,relative+'.webp')]);
      ffmpeg(['-i',input,'-vf',`${key},${crop}scale=${size}:${size}:flags=lanczos${kind === 'portrait' ? ','+mask : ''}`,'-frames:v','1','-c:v','png',path.join(output,relative+'.png')]);
      await record(relative+'.webp', { kind, state, size, animated: true, fps: size <= 64 ? 8 : 12, loop: true, durationMs: Math.round(Number(info.duration)*1000) });
      await record(relative+'.png', { kind, state, size, animated: false });
    }
  }
  // GIF preview uses a solid neutral background for reliable chat rendering.
  const gifFilter = `[0:v]${key},${position(crops[state])},fps=12,scale=256:256:flags=lanczos,${mask}[face];color=c=0xf6f5f8:s=256x256:r=12[bg];[bg][face]overlay=shortest=1:format=auto,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`;
  ffmpeg(['-i',input,'-filter_complex',gifFilter,'-an','-loop','0',path.join(output,`preview/${state}.gif`)]);
  await record(`preview/${state}.gif`, { kind: 'preview', state, size: 256, animated: true });
  console.log(`Exported ${state}: portrait sizes, full body and GIF preview.`);
}

for (const transition of transitions) {
  const input = path.join(source, transition+'.mp4');
  const info = probe(input);
  inputs.push({ path: transition+'.mp4', sha256: createHash('sha256').update(await readFile(input)).digest('hex'), ...info });
  // Follow the head smoothly between source-state framing rather than snapping.
  const [from, to] = transition.split('-to-');
  const a = crops[from], b = crops[to];
  const duration = Number(info.duration);
  const crop = `crop=400:400:x='${a[0]}+(${b[0]}-${a[0]})*min(t/${duration},1)':y='${a[1]}+(${b[1]}-${a[1]})*min(t/${duration},1)'`;
  for (const [kind,size] of [['portrait',128],['portrait',256],['body',512]]) {
    const relative = `transitions/${transition}-${kind}-${size}.webp`;
    if (kind === 'body' && portraitsOnly) {
      await record(relative, { kind, from, to, size, animated: true, loop: false, fps: 12, durationMs: Math.round(duration*1000) });
      continue;
    }
    ffmpeg(['-i',input,'-vf',`${key},${kind === 'portrait' ? crop+',' : ''}fps=12,scale=${size}:${size}:flags=lanczos,${kind === 'portrait' ? mask+',' : ''}format=bgra`,
      '-an','-c:v','libwebp_anim','-quality','82','-compression_level','5','-loop','1',path.join(output,relative)]);
    await record(relative, { kind, from, to, size, animated: true, loop: false, fps: 12, durationMs: Math.round(duration*1000) });
  }
  console.log(`Exported transition ${transition}.`);
}
const manifest = {
  formatVersion: 1, id: 'bdcb9596-cc59-44de-ad7f-b3e783593ca4', version: '1.0.0', displayName: 'Nora',
  description: 'Portraits and optional full-body presence derived from approved Nora video masters.',
  states, portraitSizes, bodySizes, defaultMode: 'portrait', defaultSize: 48,
  accessibility: { reducedMotion: 'use-png', offscreen: 'pause', hiddenDocument: 'pause', statusTextRequired: true },
  source: { project: '/projects/nora', revision: 'ecb473c8156be912a1b0ad4be764ae37b56e4821', directory: 'assets/brand/animation/openrouter/seedance-pack-v1', inputs },
  notes: ['Video-derived portraits, not an independently redrawn face.', 'Small sizes use 8fps; larger sizes use 12fps.', 'No paid video generation. Original seedance loop boundary may remain perceptible.', 'No speaking or lip-sync asset; only rest/work/wait states.'],
  files,
};
await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`${files.length} assets, ${(files.reduce((n,f)=>n+f.bytes,0)/1024/1024).toFixed(2)} MiB total.`);

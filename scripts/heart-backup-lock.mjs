/** Exclusive maintenance lease. Stdout is a protocol, never diagnostic data. */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { Client } from 'pg';
import {fileURLToPath} from 'node:url';
import {webStorageConfig,projectsRootDirectory} from '../src/app/config.ts';
const env=parseEnv(await readFile(process.env.HARNESS_BACKUP_ENV_FILE??'/etc/personal-harness/web.env','utf8'));
const storage=webStorageConfig(env);if(!storage)throw new Error('Database configuration missing.');
if(process.argv.includes('--web-settings')){
 const bind=env.HARNESS_WEB_HOST??'127.0.0.1';
 const host=bind==='0.0.0.0'?'127.0.0.1':bind==='::'?'::1':bind;
 process.stdout.write(JSON.stringify({healthUrl:`http://${host.includes(':')?'['+host+']':host}:${env.PORT??4215}/healthz`,projectsRoot:projectsRootDirectory(env,fileURLToPath(new URL("../",import.meta.url))),maintenanceFile:env.HARNESS_MAINTENANCE_FILE??'/var/lib/personal-harness/maintenance',driver:storage.driver,...(storage.driver==='sqlite'?{sqliteFile:storage.file}:{})}));
 process.exit(0);
}
if(storage.driver==='sqlite'){
 try{
  const {sqliteMaintenance}=await import('../src/modules/storage/sqlite/index.ts');
  const release=sqliteMaintenance(storage.file);
  try{process.stdout.write('LOCKED\n');await new Promise(resolve=>{process.stdin.once('end',resolve);process.stdin.resume();});}finally{release();}
 }catch{process.exitCode=75;}
 process.exit(process.exitCode??0);
}
if(!env.HARNESS_DATABASE_URL)throw new Error('Database configuration missing.');
const client=new Client({connectionString:env.HARNESS_DATABASE_URL,application_name:'heart-backup',connectionTimeoutMillis:5000});
client.on('error',()=>process.exit(1));
try {
  await client.connect();
  const result=await client.query('SELECT pg_try_advisory_lock(170210, 2) AS ok');
  if(!result.rows[0].ok)process.exitCode=75;
  else {
    // Legacy claims are not proof that no writer remains; defer conservatively.
    const claims=await client.query('SELECT 1 FROM harness.sessions WHERE active_run IS NOT NULL LIMIT 1');
    if(claims.rowCount)process.exitCode=75;
    else {
      process.stdout.write('LOCKED\n');
      await new Promise(resolve=>{process.stdin.once('end',resolve);process.stdin.resume();});
    }
  }
} catch {process.exitCode=1;}
finally {await client.end();}

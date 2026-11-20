/** Native database snapshot to stdout. Complete managed backups hold the maintenance lease externally. */
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';import os from 'node:os';
process.umask(0o077);
const source=process.argv[2];if(!source||!path.isAbsolute(source))throw new Error('Absolute SQLite source required.');
const directory=await mkdtemp(path.join(os.tmpdir(),'heart-snapshot-'));
let db;
try{
 const destination=path.join(directory,'database.sqlite');await(await open(destination,'wx',0o600)).close();
 db=new DatabaseSync(source,{readOnly:true});await backup(db,destination);db.close();db=undefined;
 await pipeline(createReadStream(destination),process.stdout);
}finally{db?.close();await rm(directory,{recursive:true,force:true});}

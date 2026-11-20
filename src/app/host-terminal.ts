import {createServer} from 'node:http';
import {chmod,mkdir,realpath,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import type {CommandInput} from '../contracts/execution.ts';
import {HostExecution} from '../modules/tools/terminal/index.ts';

/** Deliberately privileged, opt-in installation; never imports web/LLM credentials. */
export async function openHostTerminal(options:{socket:string;directory:string;workspaceDirectory:string;home:string;ownerUnit?:string}){
  await mkdir(options.directory,{recursive:true,mode:0o700});
  await mkdir(options.home,{recursive:true,mode:0o700});
  const execution=new HostExecution(options.directory,{home:options.home,nodeBinary:process.execPath,ownerUnit:options.ownerUnit});
  const root=await realpath(options.workspaceDirectory);
  try {if((await lstat(options.socket)).isSocket())await unlink(options.socket);else throw new Error('Socket path is occupied');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    try {
      if(req.method!=='POST')throw new Error('POST requis.');
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
      const {workspace,args}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof workspace!=='string'||!Array.isArray(args))throw new Error('Requête invalide.');
      const scope=await realpath(workspace);
      if(path.dirname(scope)!==root||!/^[0-9a-f-]{36}$/.test(path.basename(scope)))throw new Error('Espace du fil invalide.');
      let result:unknown;
      switch(req.url){
        case '/start': result=await execution.start(scope,args[0] as CommandInput);break;
        case '/read': result=await execution.read(scope,args[0],args[1]??undefined,args[2]??undefined);break;
        case '/write': await execution.write(scope,args[0],args[1],args[2]);result={ok:true};break;
        case '/stop': result=await execution.stop(scope,args[0]);break;
        case '/list': result=await execution.list(scope);break;
        default:throw new Error('Opération inconnue.');
      }
      res.end(JSON.stringify(result));
    }catch{res.statusCode=400;res.end(JSON.stringify({error:'Commande YOLO refusée ou indisponible ; vérifier ses arguments et le worker.'}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.socket,()=>resolve());});
  await chmod(options.socket,0o660);
  return {close:async()=>{
    for(const entry of await import('node:fs/promises').then(fs=>fs.readdir(root))){
      if(!/^[0-9a-f-]{36}$/.test(entry))continue;
      for(const command of await execution.list(path.join(root,entry)))if(command.status==='running')await execution.stop(path.join(root,entry),command.id);
    }
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await unlink(options.socket).catch(()=>{});
  }};
}

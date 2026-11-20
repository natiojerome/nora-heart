import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {LocalFiles,WorkspaceError} from '../modules/tools/files/index.ts';
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
      let metadata;
      if(req.url==='/files/import')metadata=JSON.parse(Buffer.from(String(req.headers['x-heart-files-request']),'base64url').toString());
      else{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);metadata=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
      const {workspace,args}=metadata;
      if(typeof workspace!=='string'||!Array.isArray(args))throw new Error('Requête invalide.');
      const scope=await realpath(workspace);
      if(path.dirname(scope)!==root||!/^[0-9a-f-]{36}$/.test(path.basename(scope)))throw new Error('Espace du fil invalide.');
      if(req.url?.startsWith('/files')){
        const files=new LocalFiles(scope,true);
        if(req.url==='/files/import'){await files.import(args[0],req,args[1]??undefined);res.end(JSON.stringify({ok:true}));return;}
        if(req.url==='/files/download'){
          const file=await files.download(args[0]);res.setHeader('content-type','application/octet-stream');res.setHeader('x-heart-file-entry',Buffer.from(JSON.stringify(file.entry)).toString('base64url'));
          try{await pipeline(Readable.from(file.body),res);}catch{res.destroy();}return;
        }
        if(req.url!=='/files')throw new WorkspaceError('Opération fichier inconnue.');
        const [operation,...values]=args;
        let result;
        switch(operation){
          case 'list':result=await files.list(values[0],values[1]??undefined,values[2]??undefined);break;
          case 'read':result=await files.read(values[0],values[1]??undefined,values[2]??undefined);break;
          case 'info':result=await files.info(values[0]);break;
          case 'create':await files.create(values[0],values[1]);break;
          case 'update':await files.update(values[0],values[1],values[2]);break;
          case 'replace':await files.replace(values[0],values[1],values[2],values[3]);break;
          case 'move':await files.move(values[0],values[1],values[2]);break;
          case 'remove':await files.remove(values[0],values[1]);break;
          case 'mkdir':await files.mkdir(values[0]);break;
          default:throw new WorkspaceError('Opération fichier inconnue.');
        }
        res.end(JSON.stringify(result??{ok:true}));return;
      }
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
    }catch(error){if(res.headersSent){res.destroy();return;}res.statusCode=400;res.end(JSON.stringify({error:error instanceof WorkspaceError?error.message:'Commande YOLO refusée ou indisponible ; vérifier ses arguments et le worker.'}));}
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

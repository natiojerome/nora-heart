import {openHostTerminal} from '../app/host-terminal.ts';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error('Missing worker configuration');return value;};
try{
  const worker=await openHostTerminal({socket:required('HARNESS_HOST_SOCKET'),directory:required('HARNESS_HOST_STATE_DIR'),workspaceDirectory:required('HARNESS_HOST_WORKSPACES'),home:required('HARNESS_HOST_HOME')});
  console.log('Worker YOLO prêt sur socket Unix privé.');
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;void worker.close();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{console.error('Démarrage du worker YOLO impossible.');process.exitCode=1;}

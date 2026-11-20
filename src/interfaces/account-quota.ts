import {collectAccountQuota} from '../app/account-quota.ts';
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error('Configuration manquante.');return value;};
try{
  const available=await collectAccountQuota({sourceFile:required('HARNESS_QUOTA_SOURCE_FILE'),heartAccountFile:required('HARNESS_QUOTA_HEART_ACCOUNT_FILE'),snapshotFile:required('HARNESS_QUOTA_SNAPSHOT_FILE')});
  console.log(available?'Compteurs du compte actualisés.':'Compteurs indisponibles ; aucune ancienne mesure conservée comme actuelle.');
  if(!available)process.exitCode=1;
}catch{console.error('Collecte des compteurs impossible.');process.exitCode=1;}

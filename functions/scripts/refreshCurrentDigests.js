// Dry run by default. --apply refreshes only this week's missing/empty digests.
// SMTP is disabled twice: transport configuration and per-user opt-in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
dotenv.config({path:path.join(root,'functions/.env'),override:true});
process.env.SMTP_URL='';
const {generateWeeklyDigest}=await import('../digestService.js');
const {getWeekStart,toIsoDate}=await import('../utils/date.js');
const apply=process.argv.includes('--apply');
const client=new OAuth2Client();
client.setCredentials({access_token:execSync('gcloud auth print-access-token',{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()});
const db=new Firestore({projectId:'role-model-digest-2026',authClient:client});
const week=toIsoDate(getWeekStart(new Date()));
const roles=await db.collection('roleModels').where('isActive','==',true).get();
const backupDir=path.join(root,'.local','refresh-'+new Date().toISOString().replace(/[:.]/g,'-'));
if(apply)fs.mkdirSync(backupDir,{recursive:true});
const results=[];
try {
 for(const role of roles.docs){
  const data=role.data();
  const snapshots=await db.collection('digests').where('roleModelId','==',role.id).get();
  const current=snapshots.docs.filter(d=>d.data().weekStart===week);
  if(current.some(d=>d.data().items?.length)){
   console.log(JSON.stringify({name:data.name,status:'already populated'}));continue;
  }
  if(!apply){console.log(JSON.stringify({name:data.name,week,status:'would refresh'}));continue;}
  fs.writeFileSync(path.join(backupDir,role.id+'.json'),JSON.stringify(current.map(d=>({id:d.id,data:d.data()})),null,2));
  const userDoc=await db.collection('users').doc(data.userId).get();
  if(!userDoc.exists){console.log(JSON.stringify({name:data.name,status:'missing user'}));continue;}
  try {
   const result=await generateWeeklyDigest(db,{user:{...userDoc.data(),weeklyEmailOptIn:false},roleModel:{id:role.id,name:data.name},force:true});
   const stored=await db.collection('digests').doc(result.digestId).get();
   const value=stored.data();
   // Let the existing Monday schedule deliver these at its normal time.
   await stored.ref.update({emailPending:Boolean(userDoc.data().weeklyEmailOptIn && value.items.length)});
   const report={name:data.name,week:value.weekStart,items:value.items.length,digestId:result.digestId,summary:value.summaryText,emailSent:false};
   results.push(report);console.log(JSON.stringify(report));
   fs.writeFileSync(path.join(backupDir,'results.json'),JSON.stringify(results,null,2));
  }catch(error){console.error(JSON.stringify({name:data.name,status:'failed',error:error.message}));process.exitCode=1;}
 }
}finally{await db.terminate();}

import { randomUUID } from 'node:crypto';
import { promises as fs, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const isId = value => typeof value === 'string' && uuid.test(value);

function directory(launch) {
  if (!isId(launch)) throw new Error('Invalid Last Ferry launch.');
  return path.join(tmpdir(), 'last-ferry-' + launch);
}
function record(launch,id,type) {
  if (!isId(id)) throw new Error('Invalid request ID.');
  return path.join(directory(launch), id + '.' + type);
}
export async function createLaunch() {
  const launch = randomUUID();
  await fs.mkdir(directory(launch), {mode:0o700});
  return launch;
}
export async function saveRun(launch,run) {
  const file=path.join(directory(launch),'bookmark.json');
  const temp=file+'.'+randomUUID();
  await fs.writeFile(temp,JSON.stringify(run),{mode:0o600,flag:'wx'});
  await fs.rename(temp,file);
}
export async function loadRun(launch,map) {
  try{
    const run=JSON.parse(await fs.readFile(path.join(directory(launch),'bookmark.json'),'utf8'));
    return run.brief.map===map ? run : null;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
// Publish complete records atomically. A retried submission keeps its original wish.
async function publish(file, value) {
  const temp = file + '.' + randomUUID();
  await fs.writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});
  try { await fs.link(temp,file); } catch (error) { if(error.code!=='EEXIST') throw error; }
  finally { await fs.unlink(temp); }
}
export async function enqueue(launch, id, clientId, wish, context) {
  if (!isId(clientId) || typeof wish !== 'string' || !wish.trim() || wish.length>600) throw new Error('Invalid game request.');
  if(context!==undefined && (!context || typeof context!=='object' || Array.isArray(context) || JSON.stringify(context).length>8192))throw new Error('Invalid wish context.');
  await publish(record(launch,id,'wish'),{id,clientId,wish,context,at:Date.now()});
}
export async function answer(launch, id, message, receiptId) {
  await fs.access(record(launch,id,'wish'));
  if (!message?.trim()) throw new Error('Enter a short reply for the player.');
  const reply = receiptId ? { message, receiptId } : { message };
  await publish(record(launch, id, 'answer'), reply);
}
export async function status(launch,id) {
  try { return JSON.parse(await fs.readFile(record(launch,id,'answer'),'utf8')); }
  catch(error){ if(error.code!=='ENOENT') throw error; }
  const {context}=JSON.parse(await fs.readFile(record(launch,id,'wish'),'utf8'));
  return {pending:true,context};
}
export async function listen(launch) {
  const dir=directory(launch);
  // Install the watch before scanning, so submission during startup cannot be missed.
  let changed = true, wake;
  const watcher=watch(dir, () => { changed=true; wake?.(); });
  try {
    for (;;) {
      if(!changed) await new Promise(resolve=>{wake=resolve;});
      wake=undefined; changed=false;
      const names=new Set(await fs.readdir(dir));
      const pending=[...names].filter(n=>n.endsWith('.wish') && !names.has(n.replace(/\.wish$/,'.answer')));
      if (!pending.length) continue;
      const requests=await Promise.all(pending.map(async n=>JSON.parse(await fs.readFile(path.join(dir,n),'utf8'))));
      requests.sort((a,b)=>a.at-b.at);
      return requests[0];
    }
  } finally { watcher.close(); }
}

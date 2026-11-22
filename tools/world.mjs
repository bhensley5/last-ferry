#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

import { chapterCatalog, expandChapter } from '../src/chapters.js';
import { createLaunch, listen, answer, status, saveRun } from './inbox.mjs';

const base = new URL(process.env.LAST_FERRY_URL || 'http://127.0.0.1:5179').origin;
const [action = 'brief', arg, input] = process.argv.slice(2);
const levels=new URL('../levels/',import.meta.url);
const files=await Promise.all((await fs.readdir(levels)).filter(f=>f.endsWith('.json')).map(async f=>[f,JSON.parse(await fs.readFile(new URL(f,levels),'utf8'))]));
const chapters=chapterCatalog(Object.fromEntries(files));
const maps=Object.fromEntries(chapters.flatMap(c=>[[c.id,c.id],[c.alias,c.id]]));
const print = (value) => console.log(JSON.stringify(value, null, 2));
const usage = `Usage: node tools/world.mjs <action>
  start [${chapters.map(c=>c.alias).join('|')}] [--session]
  listen LAUNCH | status LAUNCH ID | answer LAUNCH ID [--receipt CMD_ID] MESSAGE
  schema [OP|all] [CLIENT_ID] | brief [CLIENT_ID] | patch EDIT_REF 'JSON_OPS'|- [ID] | receipt ID
  rehearse < recipe.json  (offline: {behavior, game, events})
  bookmark LAUNCH CLIENT_ID | snapshot [FILE] | apply COMMAND_FILE`;
async function stdinJSON(){
  let raw='';
  for await(const chunk of process.stdin)raw+=chunk;
  return JSON.parse(raw);
}
async function rehearse(){
  const {behaviorError,runBehavior}=await import('../src/behaviors.js');
  const {behavior,game={},events}=await stdinJSON();
  if(!behavior || behavior.remove || !Array.isArray(events) || !events.length || events.length>64)
    throw new Error('Supply a behavior definition and 1–64 sample events.');
  const error=behaviorError(behavior);
  if(error)throw new Error(error);
  const rule={...behavior,state:behavior.state??{}}, steps=[];
  for(const event of events){
    if(!rule.on.includes(event.type))continue;
    const result=runBehavior(rule,event,{...game,time:event.time??game.time??0});
    rule.state=result.state;
    steps.push({event,ops:result.ops,value:result.value,state:rule.state});
  }
  print({simulation:'logic only; operations not applied',steps});
}
async function api(route, options) {
  const r = await fetch(base + route, { signal: AbortSignal.timeout(3000), ...options });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Bridge HTTP ' + r.status);
  return data;
}
async function health() {
  try {
    const info = await api('/api/health');
    if (info.game === 'last-ferry') return info;
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED') return null;
  }
  throw new Error(base + ' is occupied but is not a Last Ferry live server.');
}
async function start() {
  if (arg && !Object.hasOwn(maps, arg)) throw new Error('Choose '+chapters.map(c=>c.alias).join(' or ')+'.');
  let info = await health();
  if (!info) {
    const url = new URL(base);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Start on the game machine at a loopback URL.');
    const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
    try {
      await fs.access(vite);
    } catch {
      throw new Error('Run npm ci in the checkout first.');
    }
    const child = spawn(
      process.execPath,
      [vite, '--host', url.hostname, '--port', url.port, '--strictPort'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();
    for (let i = 0; i < 50 && !info; i++) {
      await wait(160);
      info = await health();
      if (child.exitCode !== null && !info) break;
    }
    if (!info) throw new Error('Live server did not start at ' + base);
  }
  const level =
    maps[arg] || (Object.values(maps).includes(info.activeLevel) ? info.activeLevel : chapters[0].id);
  const url = new URL('/?play=' + level, base);
  const linked = input === '--session' || input?.startsWith('agent:') || process.env.OPENCLAW_SESSION_KEY;
  const launch = linked ? await createLaunch() : null;
  if (launch) url.hash = 'launch=' + launch;
  print({ url: url.href, ...(launch && {launch}), gameConnected: info.gameConnected, activeLevel: info.activeLevel });
}
async function submit(command) {
  await api('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  for (let i = 0; i < 70; i++) {
    const receipt = await api('/api/receipt?cmd=' + encodeURIComponent(command.cmd));
    if (!receipt.pending && (!receipt.ok || Number.isFinite(receipt.firstVisibleMs))) {
      print(receipt);
      if (!receipt.ok) process.exitCode = 1;
      return;
    }
    await wait(100);
  }
  throw new Error(
    'No confirmed frame yet. Focus the game, then inspect: node tools/world.mjs receipt ' + command.cmd,
  );
}
try {
  if (['help', '--help', '-h'].includes(action)) console.log(usage);
  else if (action === 'rehearse') await rehearse();
  else if (action === 'start') await start();
  else if (action === 'listen') {
    const request = await listen(arg);
    console.log('Last Ferry game event: use the repo skill, answer the player, then re-arm this launch in the same session.');
    print({launch:arg,...request});
  } else if (action === 'status') {
    print(await status(arg,input));
  } else if (action === 'answer') {
    const reply = process.argv.slice(5);
    if (reply[0] === '--receipt' && reply.length > 1) {
      const [, receiptId, ...message] = reply;
      await answer(arg, input, message.join(' '), receiptId);
    } else {
      await answer(arg, input, reply.join(' '));
    }
  }
  else if (action==='schema') {
    const brief=await api(input?'/api/brief?client='+encodeURIComponent(input):'/api/brief');
    const entries=brief.supportedOperations;
    if (!arg) print(entries.map(e=>({op:e.op,...(e.description && {description:e.description})})));
    else if (arg==='all') print(entries);
    else {
      const entry=entries.find(e=>e.op===arg);
      if(!entry) throw new Error('Unknown operation. Run schema to list this tab’s capabilities.');
      print(entry);
    }
  }
  else if (action === 'brief') print(await api(arg ? '/api/brief?client=' + encodeURIComponent(arg) : '/api/brief'));
  else if (action === 'receipt') print(await api('/api/receipt?cmd=' + encodeURIComponent(arg)));
  else if (action === 'apply') await submit(expandChapter(JSON.parse(await fs.readFile(arg, 'utf8'))));
  else if (action === 'patch') {
    const [clientId, levelId, revision] = String(arg).split('/');
    if (!clientId || !levelId || !/^\d+$/.test(revision) || !input)
      throw new Error('patch <editRef from brief> <JSON ops array or ->');
    const ops = input==='-' ? await stdinJSON() : JSON.parse(input);
    await submit({
      v: 1,
      world: 'last-ferry',
      mode: 'patch',
      clientId,
      levelId,
      base: Number(revision),
      cmd: process.argv[5] || crypto.randomUUID(),
      ops,
    });
  } else if(action==='bookmark'){
    const run=await api('/api/bookmark?'+new URLSearchParams({client:input,launch:arg}));
    await saveRun(arg,run);print({saved:true,map:run.brief.map,footing:run.brief.player.footing,stage:run.brief.route.stage});
  } else if (action === 'snapshot') {
    const state = await api('/api/state');
    if (arg) {
      await fs.writeFile(arg, JSON.stringify(state, null, 2) + '\n');
      console.log('Saved ' + arg);
    } else print(state);
  } else throw new Error(usage);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const infer=promisify(execFile);
import { enqueue, loadRun, status as requestStatus } from './tools/inbox.mjs';
import { defineConfig } from 'vite';
import Ajv from 'ajv';
import standalone from 'ajv/dist/standalone/index.js';
import { wishContracts } from './src/wish-schema.js';

// Compile in Node: the browser receives validation functions, not a schema compiler.
function wishValidator() {
  return {name:'wish-contracts',enforce:'pre',transform(source,id) {
    if (!id.endsWith('/src/wish-validator.js')) return;
    const ajv=new Ajv({code:{source:true,esm:true}});
    const names=Object.keys(wishContracts);
    for (const name of names) ajv.addSchema(wishContracts[name].schema,name);
    return standalone(ajv,Object.fromEntries(names.map(n=>[n,n])))+
      '\nexport const validators={'+names.join(',')+'};';
  }};
}

// Local development bridge only. The browser never receives a provider key.
function worldBridge() {
  let latestBrief = null;
  let latestBriefAt = 0;
  let latestState = null;
  let focusTime = 0;
  const samples = new Map();
  function sampleFor(clientId) {
    const sample = samples.get(clientId);
    return sample && Date.now() - sample.at < 5000 ? sample.brief : null;
  }
  const fresh = () => !!latestBrief && Date.now()-latestBriefAt < 5000;
  let cursor = 0;
  const commands = [];
  const receipts = new Map();
  const readBody = async req => {
    const limit = req.url === '/api/brief' ? 512 * 1024 : 128 * 1024;
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > limit) throw new Error('World payload exceeds '+limit/1024+' KB');
    }
    return JSON.parse(body);
  };
  const send = (res, status, value) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
  return {
    name: 'last-ferry-local-world-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (!url.pathname.startsWith('/api/')) return next();
        try {
          if (req.method === 'POST' && ['/api/game-wish','/api/game-answer','/api/game-load'].includes(url.pathname)) {
            const host=req.headers.host;
            if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin!=='http://'+host ||
                !req.headers['content-type']?.startsWith('application/json')) return send(res,403,{error:'Local game requests only.'});
            const {launch,id,clientId,wish,map,context}=await readBody(req);
            if(url.pathname==='/api/game-load')return send(res,200,await loadRun(launch,map));
            if (url.pathname==='/api/game-answer') return send(res,200,await requestStatus(launch,id));
            await enqueue(launch,id,clientId,wish,context);
            return send(res,202,{queued:true});
          }
          if (req.method === 'POST' && url.pathname === '/api/design') {
            if (!['127.0.0.1','localhost','[::1]'].includes(req.headers.host?.split(':')[0]) || req.headers.origin !== 'http://'+req.headers.host || !req.headers['content-type']?.startsWith('application/json')) return send(res,403,{error:'Local game requests only.'});
            const {wish,brief}=await readBody(req);
            if(typeof wish!=='string' || !wish.trim() || wish.length>600) return send(res,400,{error:'Describe the change in 1–600 characters.'});
            const prompt = `You design the running Last Ferry map. Respond with only JSON {"ops":[...]} or {"error":"short explanation"}. Use the operations listed under supportedOperations, up to 16 per edit. For partial updates include only the fields the player wants changed; leave unrelated conditions alone. Prefer finish.dressing for changing an existing building. Use stable IDs from the brief; assign unique IDs for new pieces. Interpret the request in terms of the player's position, facing (radians; forward is [sin(facing),0,cos(facing)]) and footing. North is negative z, east positive x. Stay within bounds and make intended jumps playable. Map: ${JSON.stringify(brief)}. Player asks: ${wish}`;
            try {
              const {stdout}=await infer('openclaw',['infer','model','run','--json','--prompt',prompt],{timeout:45000,maxBuffer:1024*1024});
              const answer=JSON.parse(stdout).outputs[0].text;
              const result=JSON.parse(answer.slice(answer.indexOf('{'),answer.lastIndexOf('}')+1));
              if(!Array.isArray(result.ops) || !result.ops.length || result.ops.some(o=>!brief?.supportedOperations?.some(entry=>entry.op===o?.op))) return send(res,422,{error:result.error||'OpenClaw did not return a usable map edit.'});
              return send(res,200,{ops:result.ops});
            } catch(error) {
              const busy=/429|high traffic|queue_exceeded/i.test(String(error.stderr)+String(error.stdout));
              return send(res,503,{error:busy?'The model is busy. Direct requests like “make it sunrise” or “move the ferry east 2m” still work.':'OpenClaw did not return an edit. Local moves, resizes and boat bridges still work.'});
            }
          }
          if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, game: 'last-ferry', gameConnected: fresh(), activeLevel: fresh()?latestBrief.map:null });
          if (req.method === 'POST' && url.pathname === '/api/brief') {
            const sample = await readBody(req);
            if (!sample.clientId || !sample.brief) return send(res,400,{error:'Expected a live game sample.'});
            const brief = {...sample.brief, map:sample.map, clientId:sample.clientId,
              editRef:[sample.clientId,sample.brief.levelId,sample.brief.revision].join('/')};
            samples.set(sample.clientId, {brief,state:sample.state,launch:sample.launch,at:Date.now()});
            for (const [id, entry] of samples) if (Date.now()-entry.at > 60000) samples.delete(id);
            if (!fresh() || latestBrief.clientId===sample.clientId || sample.focusedAt>focusTime) {
              latestBrief=brief;
              latestState=sample.state;
              focusTime=sample.focusedAt;
              latestBriefAt=Date.now();
            }
            return send(res, 200, { ok: true });
          }
          if (req.method === 'GET' && url.pathname === '/api/brief') {
            if (url.searchParams.has('client')) {
              const brief = sampleFor(url.searchParams.get('client'));
              return brief ? send(res,200,brief) : send(res,503,{error:'Focus the requesting game tab; its live brief is stale.'});
            }
            if (!fresh()) return send(res, 503, { error: 'Open or focus the live game first; no fresh world brief is available.' });
            return send(res, 200, latestBrief);
          }
          if(req.method==='GET' && url.pathname==='/api/bookmark'){
            const id=url.searchParams.get('client'),sample=samples.get(id);
            if(!sampleFor(id) || !sample.launch || sample.launch!==url.searchParams.get('launch'))return send(res,409,{error:'Focus the matching game tab before bookmarking.'});
            return send(res,200,{brief:sample.brief,state:sample.state});
          }
          if (req.method === 'GET' && url.pathname === '/api/state') return fresh()?send(res,200,latestState):send(res,503,{error:'Focus the live game for a current snapshot.'});
          if (req.method === 'GET' && url.pathname === '/api/commands') {
            const after = Number(url.searchParams.get('after') || 0);
            if (url.searchParams.has('sync')) return send(res, 200, { commands: [], cursor });
            return send(res, 200, { commands: commands.filter(c => c.cursor > after && c.clientId===url.searchParams.get('client')) });
          }
          if (req.method === 'POST' && url.pathname === '/api/command') {
            const command = await readBody(req);
            if (typeof command.cmd !== 'string' || !command.cmd) return send(res, 400, { error: 'A command needs a stable cmd ID.' });
            const duplicate = receipts.get(command.cmd);
            if (duplicate) return send(res, 200, duplicate);
            const queued=commands.find(c=>c.cmd===command.cmd);
            if(queued)return send(res,202,{queued:true,cmd:queued.cmd});
            const target = command.clientId ? sampleFor(command.clientId) : fresh() && latestBrief;
            if(!target)return send(res,409,{error:'Focus the intended live game and read a fresh brief.'});
            commands.push({ ...command, clientId:target.clientId, cursor: ++cursor, receivedAt: Date.now() });
            return send(res, 202, { queued: true, cmd: command.cmd, cursor });
          }
          if (req.method === 'POST' && url.pathname === '/api/receipt') {
            const receipt = await readBody(req);
            receipts.set(receipt.cmd, receipt);
            return send(res, 200, { ok: true });
          }
          if (req.method === 'GET' && url.pathname === '/api/receipt') {
            const receipt = receipts.get(url.searchParams.get('cmd'));
            return send(res, receipt ? 200 : 202, receipt || { pending: true });
          }
          return send(res, 404, { error: 'Unknown local world endpoint.' });
        } catch (error) {
          return send(res, 400, { error: error.message });
        }
      });
    },
  };
}

export default defineConfig({ plugins: [wishValidator(),worldBridge()] });

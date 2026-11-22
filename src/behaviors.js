import { activeRules } from './effects.js';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';

const events = [
  'enter','leave','noise','reach','objective',
  'tick',
  'press',
  'release',
  'attack',
  'hit',
  'hurt',
  'defeat',
  'jump',
  'land',
  'overboard',
  'collect',
  'use',
  'impact',
  'surface',
  'turn',
  'intercept',
  'reset',
  'signal',
  'before',
  'resolved',
];
export const behaviorFields = {
  id: '1–48 letters, numbers, hyphens or underscores. Reuse to replace, remove:true to uninstall. Up to 8.',
  on: events.join(' | ') + ' (array of subscriptions)',
  code: 'Synchronous JS function body (up to 6000 characters). Arguments: event, game, state, emit. Mutate state (JSON object, 2 KB), emit up to 16 ordinary ops. No browser APIs. No installing behaviors/cues. Return nothing, except before: optionally return the new numeric value; do not emit during before.',
  state: 'optional initial JSON object; replacement starts fresh unless supplied',
  event:
    '{type,time,target?,key?,tag?,at?,reason?,source?,dt?}; press/release keys "1"–"4"; hit: target=enemy; hurt: target=player, source=attacker; land/impact: surface={id,part,material,state,at} when named. surface: target=deck ID, previous,state,source,surface. turn: target=device ID, source, steps (signed quarter turns). intercept: target=platform or null, reason=arranged|caught|missed|unavailable. enter/leave: target=region, source=player or actor ID; leave.reason is absent on a physical exit, otherwise removed/reset/untracked. noise: tag, source, at. reach: target=query ID, mode/path/takeoff/landing or reason. objective: target=checkpoint platform or finish, reason=stock|alternative (once). impact: see shot; actorPart is distinct from surface.part; stock jet tag=water, optional device ID. tick every .2 game seconds. before/resolved: action=damage (0–3 hearts), attack (0/1), jump or vault (0–20 m/s); value=proposed/final value, source on damage. Zero cancels.',
  game: '{time,stage,player:{position,velocity,facing,footing,health,keys},entities:[{id,kind,position,size}],encounters:[{id,kind,position,arena,hits,maxHits,defeated,friendly,state}],regions:{regionID:[occupantIDs]},lastReach,cargo,weather,traveler}. Coordinates [east,up,south], facing radians. Read-only snapshot; return changes via emit.',
};

const QuickJS = await newQuickJSWASMModuleFromVariant(variant).catch(() => null);
const encode = (value) => JSON.stringify(JSON.stringify(value));
const stateOK = (state) =>
  state && typeof state === 'object' && !Array.isArray(state) && JSON.stringify(state).length <= 2048;

// Each call gets a fresh guest heap. Only validated JSON leaves it; game state is
// committed after the entire emitted patch succeeds, never after a partial script.
function evaluate(source) {
  if (!QuickJS) throw new Error('The behavior engine could not load.');
  const vm = QuickJS.newContext();
  try {
    vm.runtime.setMemoryLimit(3 * 1024 * 1024);
    vm.runtime.setMaxStackSize(128 * 1024);
    const deadline = performance.now() + 12;
    vm.runtime.setInterruptHandler(() => performance.now() > deadline);
    const result = vm.evalCode(source, 'harbor-rule.js', { type: 'global' });
    if (result.error) {
      result.error.dispose();
      throw new Error('Behavior exceeded its execution budget or failed to evaluate.');
    }
    const json = result.value.consume((handle) => vm.getString(handle));
    if (json.length > 24576) throw new Error('Behavior output exceeds 24 KB.');
    const output = JSON.parse(json);
    if (output.error) throw new Error(output.error);
    return output;
  } finally {
    vm.dispose();
  }
}

function guestSource(code, body) {
  return `(()=>{try{
    const run=new Function('event','game','state','emit',${JSON.stringify('"use strict";\n' + code)});
    ${body}
  }catch(e){return JSON.stringify({error:String(e).slice(0,240) || 'Rule failed'});}})()`;
}

export function behaviorError(op) {
  if (typeof op.id !== 'string' || !/^[\w-]{1,48}$/.test(op.id)) return 'Choose a short behavior ID.';
  if (op.remove === true) return null;
  if (
    !Array.isArray(op.on) ||
    !op.on.length ||
    op.on.length > events.length ||
    !op.on.every((name) => events.includes(name))
  )
    return 'Choose events listed in behavior.on.';
  if (typeof op.code !== 'string' || !op.code.trim() || op.code.length > 6000)
    return 'Supply 1–6000 characters of behavior code.';
  if (!stateOK(op.state ?? {})) return 'Behavior state must be a JSON object up to 2 KB.';
  try {
    evaluate(guestSource(op.code, "return '{}';"));
  } catch (error) {
    return error.message;
  }
  return null;
}

export function runBehavior(rule, event, game) {
  const result = evaluate(
    guestSource(
      rule.code,
      `
    const state=JSON.parse(${encode(rule.state)}), ops=[];
    const event=JSON.parse(${encode(event)});
    const returned=run(event,JSON.parse(${encode(game)}),state,op=>{
      if(ops.length>=16)throw Error('At most 16 operations per event');
      ops.push(op);
    });
    if(returned!==undefined && (event.type!=='before' || !Number.isFinite(returned)))throw Error('Only before may return a finite number');
    return JSON.stringify({state,ops,value:returned});`,
    ),
  );
  if (
    !stateOK(result.state) ||
    !Array.isArray(result.ops) ||
    result.ops.length > 16 ||
    result.ops.some((op) => !op || typeof op.op !== 'string' || (['cue', 'behavior'].includes(op.op) || op.op==='effect' && op.change?.op==='behavior'))
  )
    throw new Error('Invalid behavior state or emitted operations.');
  if (event.type === 'before') {
    const max = { damage: 3, attack: 1, jump: 20, vault: 20 }[event.action];
    const value = result.value ?? event.value;
    if (
      !Number.isFinite(max) ||
      result.ops.length ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > max ||
      (['damage', 'attack'].includes(event.action) && !Number.isInteger(value))
    )
      throw new Error('Invalid before response; use resolved to emit follow-up effects.');
  }
  return result;
}

// Queue consequences rather than recursively running player-authored callbacks.
// Replacing/removing a rule invalidates its queued work by object identity.
export class BehaviorEvents {
  constructor(level, snapshot, apply, onError) {
    this.level = level;
    this.snapshot = snapshot;
    this.apply = apply;
    this.onError = onError;
    this.clear();
  }
  clear() {
    this.queue = [];
    this.depth = 0;
    this.tickTime = 0;
  }
  send(event) {
    for (const rule of activeRules(this.level())) {
      if (rule.error || !rule.on.includes(event.type)) continue;
      if (this.depth >= 12 || this.queue.length >= 128) {
        rule.error = 'Event chain exceeded its depth or queue budget.';
        this.onError(rule);
        continue;
      }
      this.queue.push({
        event: { ...event, time: this.level().mechanicTime },
        rule,
        depth: this.depth + 1,
      });
    }
  }
  filter(action, initial, details = {}, preview = false) {
    let value = initial;
    for (const rule of activeRules(this.level())) {
      if (rule.error || !rule.on.includes('before')) continue;
      try {
        const result = runBehavior(
          rule,
          { type: 'before', time: this.level().mechanicTime, action, value, ...details },
          this.snapshot(),
        );
        if (!preview) rule.state = result.state;
        value = result.value ?? value;
      } catch (error) {
        if (preview) return null;
        rule.error = String(error.message ?? error).slice(0, 240);
        this.onError(rule);
      }
    }
    if (!preview) this.send({ type: 'resolved', action, value, ...details });
    return value;
  }
  step(dt) {
    const level = this.level();
    if (!level.behaviors.length && !level.effects?.length && !this.queue.length) return;
    level.mechanicTime += dt;
    this.tickTime += dt;
    if (this.tickTime >= 0.2) {
      this.send({ type: 'tick', dt: this.tickTime });
      this.tickTime = 0;
    }
    const until = performance.now() + 4;
    while (this.queue.length && performance.now() < until) {
      const { event, rule, depth } = this.queue.shift();
      if (rule.error || !activeRules(level).includes(rule)) continue;
      try {
        this.depth = depth;
        const { state, ops } = runBehavior(rule, event, this.snapshot());
        if (ops.length) this.apply(ops,rule);
        rule.state = state;
      } catch (error) {
        rule.error = String(error.message ?? error).slice(0, 240);
        this.onError(rule);
      } finally {
        this.depth = 0;
      }
    }
  }
}

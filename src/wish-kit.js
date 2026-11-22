import { wishContracts } from './wish-schema.js';
import { validators } from './wish-validator.js';
import { Places } from './places.js';
import { objectiveError } from './objectives.js';
import { initEffects, setEffect, activeRules } from './effects.js';
import { ReachQuery } from './reach.js';

export const kitOps = Object.keys(wishContracts);
const collections = { region: 'regions', intent: 'intents', objective: 'objectives', effect: 'effects' };
const limits = { region: 24, intent: 32, objective: 32, effect: 16 };
export function initKit(world) {
  const level = world.level;
  for (const key of Object.values(collections)) level[key] ??= [];
  initEffects(level);
  world.places = new Places(world);
  world.reach = new ReachQuery();
}
// Authored chapters, exported layouts and bookmarks all use the patch contract.
export function restoreDefinitions(level, source, pieces, solidHarbor, checkChange) {
  const actors = new Map(level.encounters.map((e) => [e.id, e]));
  const state = validationState({});
  const host = { level, solidHarbor };
  for (const group of ['weather', 'traveler']) {
    const base = source.effectBase?.[group];
    if (base && Object.keys(base).length) {
      const error = checkChange({ ...base, op: group });
      if (error) throw Error(error);
      Object.assign(level[group], base);
    }
  }
  level.effectBase = { weather: {}, traveler: {} };
  for (const [op, field] of Object.entries(collections)) {
    const saved = source[field] ?? [];
    if (!Array.isArray(saved) || saved.length > limits[op]) throw Error('Invalid ' + field + ' list.');
    level[field] = [];
    for (const entry of saved) {
      if (!entry || state[op].has(entry.id)) throw Error('Invalid or repeated ' + op + ' definition.');
      const { seen, done, remaining, ...definition } = entry;
      const edit = { ...definition, op };
      // A saved timer may be a fraction of a tick from expiring.
      if (op === 'effect' && remaining != null) edit.seconds = Math.max(0.1, remaining);
      const error = kitError(edit, host, pieces, actors, state, checkChange);
      if (error || edit.remove) throw Error(error ?? 'Expected an installed definition.');
      if (op === 'effect') {
        setEffect(level, edit);
        if (remaining != null) level.effects.at(-1).remaining = remaining;
      } else {
        const copy = structuredClone(definition);
        if (op === 'objective' && Array.isArray(seen)) {
          copy.seen = [
            ...new Set(seen.filter((i) => Number.isInteger(i) && i >= 0 && i < copy.tests.length)),
          ];
          if (copy.mode === 'order' && copy.seen.some((value, i) => value !== i))
            throw Error('Invalid ordered objective progress.');
          copy.done =
            copy.mode === 'any' ? copy.seen.length > 0 : copy.seen.length === copy.tests.length;
        }
        level[field].push(copy);
      }
    }
  }
  const rules = activeRules(level);
  if (rules.length > 8 || new Set(rules.map((r) => r.id)).size !== rules.length)
    throw Error('Use at most eight distinct behavior IDs.');
}
export function validationState(level) {
  return Object.fromEntries(
    Object.entries(collections).map(([op, field]) => [
      op,
      new Map((level[field] ?? []).map((s) => [s.id, s])),
    ]),
  );
}
export function kitError(op, world, pieces, actors, state, checkChange) {
  const validate = validators[op.op];
  if (!validate(op)) {
    const error = validate.errors[0];
    return (
      op.op + (error.instancePath || '') + ': ' + error.message + ' ' + JSON.stringify(error.params)
    );
  }
  if (op.op === 'reach') {
    if (
      (typeof op.to === 'string' && !pieces.has(op.to)) ||
      (op.who && op.who !== 'player' && !actors.has(op.who))
    )
      return 'Unknown destination deck or walking actor.';
    return;
  }
  if (op.op === 'noise') return;
  const map = state[op.op];
  if (!map.has(op.id) && !op.remove && map.size >= limits[op.op])
    return 'Active ' + op.op + ' limit: ' + limits[op.op];
  if (op.op === 'region') {
    if (!op.remove && op.deck && !pieces.has(op.deck)) return 'Unknown region deck.';
    if (op.force && op.watch === 'actors')
      return 'Force is traveler-only; use enter/leave rules for actors.';
  } else if (op.op === 'objective') {
    const error = objectiveError(op, world.level, world.routeStage ?? 0);
    if (error) return error;
  } else if (op.op === 'intent' && !op.remove) {
    const actor = actors.get(op.id);
    if (
      !actor ||
      actor.skin === 'cage-lamp' ||
      actor.skin === 'silk-kestrel' ||
      actor.kind === 'heron' ||
      !world.solidHarbor ||
      actor.phases.some((p) => p.sequence)
    )
      return 'Choose an ordinary ground crew, not a flying actor or boss.';
    if (op.mode === 'guide' && !pieces.has(op.to)) return 'Unknown guide destination.';
  } else if (op.op === 'effect' && !op.remove) {
    if (
      !['behavior', 'traveler', 'weather'].includes(op.change?.op) ||
      op.change.remove ||
      (op.change.op === 'weather' && op.scope === 'journey')
    )
      return 'Own a traveler setting, behavior, or local weather override (weather cannot travel).';
    if (op.change.op === 'behavior' && op.change.id !== op.id)
      return 'Owned behavior ID must equal its effect ID.';
    const error = checkChange(op.change);
    if (error) return error;
  }
  if (op.remove === true) map.delete(op.id);
  else map.set(op.id, op);
}
export function applyKit(world, op) {
  const level = world.level;
  if (op.op === 'reach' || op.op === 'noise') {
    world.playerEffects.push(op);
    return;
  }
  if (op.op === 'effect') {
    if (level.effects.some((e) => e.id === op.id)) world.onEffectEnd?.(op.id);
    const { lights, lampPattern } = level.weather;
    setEffect(level, op);
    if (lights !== level.weather.lights || lampPattern !== level.weather.lampPattern)
      world.setLights(level.weather.lights);
    return;
  }
  if (op.op === 'region' && op.remove) world.places.forget(op.id, world.onMechanicEvent);
  const field = collections[op.op];
  level[field] = level[field].filter((s) => s.id !== op.id);
  if (!op.remove) {
    const { op: unused, ...spec } = structuredClone(op);
    // Progress is earned only by game events, never supplied by an edit.
    delete spec.seen;
    delete spec.done;
    level[field].push(spec);
  }
  if (op.op === 'intent') world.onIntent?.(op.id);
}
export function expireEffects(world, dt, reset = false) {
  for (const e of world.level.effects) {
    if (!reset && e.remaining !== null) e.remaining -= dt;
    if ((reset && e.scope === 'life') || (e.remaining !== null && e.remaining <= 0))
      applyKit(world, { op: 'effect', id: e.id, remove: true });
  }
}
export function kitBrief(world) {
  const level = world.level;
  return {
    regions: level.regions.map((r) => ({
      ...r,
      occupants: [...(world.places.members.get(r.id) ?? [])],
    })),
    objectives: level.objectives,
    lastObjective: level.lastObjective ?? null,
    lastReach: world.reach.report ?? null,
    effects: level.effects,
    ...(world.passageConflicts?.length && { passageConflicts: world.passageConflicts }),
    behaviors: activeRules(level),
  };
}

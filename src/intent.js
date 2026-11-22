import { Vector3 } from 'three';
import { landing, traceSolid } from './market-solids.js';
import { advanceCrew } from './pursuit.js';

const eye = new Vector3(),
  at = new Vector3(),
  direction = new Vector3();
export function hear(world, actors, event) {
  if (!event.at) return;
  for (const actor of actors.values()) {
    const spec = actor.intent;
    if (
      spec?.mode !== 'investigate' ||
      spec.tag !== event.tag ||
      actor.defeated ||
      event.source === actor.spec.id
    )
      continue;
    eye.copy(actor.group.position);
    eye.y = actor.floor + 0.85;
    at.fromArray(event.at);
    direction.subVectors(at, eye);
    const distance = direction.length();
    if (distance > (spec.range ?? 12)) continue;
    if (
      distance > 0.05 &&
      traceSolid(world.entities, eye, direction.normalize(), distance - 0.04).target
    )
      continue;
    const floor = landing(world.entities, at, at.y - 4, at.y + 0.35);
    if (!floor) continue;
    actor.memory = { at: [at.x, floor.top, at.z], deck: floor.entity.id, remaining: spec.memory ?? 6 };
    actor.groundPlan = null;
  }
}
export function steerIntent(combat, actor, player, dt) {
  const spec = actor.intent,
    world = combat.world;
  const stop = (status) => {
    actor.intentStatus = status;
    actor.crew.animate(combat.time, 'idle', 0);
    return true;
  };
  if (actor.memory) {
    actor.memory.remaining -= dt;
    if (actor.memory.remaining <= 0) actor.memory = null;
  }
  let deck, goal;
  if (spec.mode === 'investigate') {
    if (!actor.memory) return stop('listening');
    deck = actor.memory.deck;
    goal = at.fromArray(actor.memory.at);
  } else {
    if (actor.group.position.distanceTo(player.position) > (spec.wait ?? 6)) return stop('waiting');
    deck = spec.to;
    const dest = world.get(deck);
    if (!dest) return stop('disconnected');
    goal = world.arrival(dest);
  }
  const p = actor.group.position;
  if (Math.hypot(goal.x - p.x, goal.z - p.z) < 0.45 && actor.deck === deck) return stop('arrived');
  const next = combat.pursuit.target(world, actor, { position: goal, grounded: deck }, true);
  const dx = next.x - p.x,
    dz = next.z - p.z,
    distance = Math.hypot(dx, dz);
  if (distance < 0.01) return stop(actor.groundPlan?.status ?? 'searching');
  const speed = Math.min(distance / dt, spec.speed ?? 2.3);
  advanceCrew(world, actor, (dx / distance) * speed, (dz / distance) * speed, dt, true);
  p.y = actor.floor + (actor.spec.kind === 'crab' ? 0.55 : 1.5);
  actor.group.rotation.y = Math.atan2(dx, dz);
  actor.crew.animate(combat.time, 'forming', 0.75);
  actor.intentStatus = 'moving';
  return true;
}

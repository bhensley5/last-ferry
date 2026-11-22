import { Vector3, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { findGroundRoute, groundBody } from './ground-route.js';
import { ceiling, landing, slide } from './market-solids.js';

const dt = 1 / 60;
function* jumpFrom(world, start, goal, target, tune) {
  const p = start.clone(),
    dir = goal.clone().sub(start);
  dir.y = 0;
  dir.normalize();
  let speed = 0,
    vy = tune.jumpVelocity;
  for (let i = 0; i < 330; i++) {
    if (i % 12 === 0) yield;
    if (world.places.hasForceAt(p)) return;
    speed += (tune.runSpeed - speed) * (1 - Math.exp(-(i === 0 ? 18 : 7) * dt));
    const x = p.x + dir.x * speed * dt,
      z = p.z + dir.z * speed * dt;
    slide(world.entities, p, 'x', x - p.x, i === 0);
    slide(world.entities, p, 'z', z - p.z, i === 0);
    if (Math.hypot(x - p.x, z - p.z) > 0.025) return;
    const prev = p.y;
    vy -= tune.gravity * dt;
    p.y += vy * dt;
    if (vy > 0 && ceiling(world.entities, p, prev, p.y) < p.y) return;
    if (vy <= 0) {
      const floor = landing(world.entities, p, p.y - 0.02, prev + 0.024);
      if (floor) {
        if (
          floor.entity.id === target &&
          floor.top > world.seaAt(p.x, p.z) + 0.12 &&
          Math.abs(floor.top - goal.y) < 0.35
        )
          return [p.x, floor.top, p.z];
        return;
      }
    }
    if (p.y <= world.seaAt(p.x, p.z)) return;
  }
}
export function* reachPlan(world, player, actors, op) {
  const who = op.who ?? 'player',
    actor = actors.get(who);
  const start = (actor?.group.position ?? player.position).clone();
  if (actor) start.y = actor.floor;
  const grounded = actor ? actor.deck : player.grounded;
  if (!grounded || (actor && (!actor.crew?.grounded || actor.defeated)))
    return { reason: 'not grounded' };
  const dest = world.get(op.to),
    goal = dest ? world.arrival(dest) : new Vector3(...op.to);
  const floor = landing(world.entities, goal, goal.y - 0.4, goal.y + 0.4);
  if (!floor || floor.entity.kind === 'wall' || (dest && floor.entity !== dest))
    return { reason: 'no landing at destination' };
  if (floor.entity.motion || world.get(grounded)?.motion)
    return { reason: 'moving endpoint; ride timing not predicted' };
  goal.y = floor.top;
  const span = Math.hypot(start.x - goal.x, start.z - goal.z);
  if (span > 32) return { reason: 'outside local search' };
  const walk = yield* findGroundRoute(world, start, goal, actor && groundBody(actor));
  if (walk.length && walk.some((p) => landing(world.entities, p, p.y - 0.1, p.y + 0.1)?.entity.motion))
    return { reason: 'moving platform on route; timing not predicted' };
  if (!actor && walk.some((p) => world.places.hasForceAt(p)))
    return { reason: 'local force on route; motion not predicted' };
  if (walk.length)
    return { mode: 'walk', path: walk.map((p) => p.toArray()), landing: walk.at(-1).toArray() };
  if (actor) return { reason: 'no walkable route' };
  const jumpVelocity = world.previewJump ? world.previewJump() : world.level.traveler.jumpVelocity;
  if (!jumpVelocity) return { reason: 'jump unavailable under current rules' };
  const tune = { ...world.level.traveler, jumpVelocity };
  const dir = goal.clone().sub(start);
  dir.y = 0;
  dir.normalize();
  const feet = start.clone();
  // Try a standing start first, then walk the approach. Never propose a takeoff
  // on a far ledge the traveler cannot first walk to.
  for (let traveled = 0; traveled <= span; traveled += 0.25) {
    const end = yield* jumpFrom(world, feet, goal, floor.entity.id, tune);
    if (end) {
      const after = yield* findGroundRoute(world, new Vector3(...end), goal);
      if (after.length && !after.some((p) => world.places.hasForceAt(p)))
        return {
          mode: 'jump',
          walkAfter: after.map((p) => p.toArray()),
          takeoff: feet.toArray(),
          landing: end,
          direction: dir.toArray(),
          input: 'from rest, hold Run + forward toward landing and jump once',
        };
    }
    const x = feet.x + dir.x * 0.25,
      z = feet.z + dir.z * 0.25;
    slide(world.entities, feet, 'x', x - feet.x, true);
    slide(world.entities, feet, 'z', z - feet.z, true);
    const next = landing(world.entities, feet, feet.y - 0.3, feet.y + 0.23);
    if (!next || next.entity.id !== grounded || Math.hypot(x - feet.x, z - feet.z) > 0.02) break;
    feet.y = next.top;
  }
  return { reason: 'no walk or straight single jump found' };
}
export class ReachQuery {
  start(world, player, actors, op) {
    if (this.markers) this.markers.visible = false;
    this.show = op.show === true;
    this.version = world.layoutVersion;
    this.tuning = JSON.stringify(world.level.traveler);
    this.report = { id: op.id, who: op.who ?? 'player', to: op.to, status: 'searching' };
    this.search = reachPlan(world, player, actors, op);
  }
  clear() {
    this.search = null;
    this.report = null;
    if (!this.markers) return;
    this.markers.removeFromParent();
    for (const mesh of this.markers.children) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.markers = null;
  }
  mark(world, result) {
    if (!this.markers) {
      this.markers = new Group();
      for (const [color, sides] of [
        [0xffbd4c, 3],
        [0x95f3df, 32],
      ]) {
        const marker = new Mesh(new RingGeometry(0.25, 0.42, sides), new MeshBasicMaterial({ color }));
        marker.rotation.x = -Math.PI / 2;
        this.markers.add(marker);
      }
      world.scene.add(this.markers);
    }
    this.markers.visible = true;
    for (const [i, coords] of [result.takeoff, result.landing].entries()) {
      const marker = this.markers.children[i];
      marker.visible = !!coords;
      if (coords) {
        marker.position.fromArray(coords);
        marker.position.y += 0.045;
      }
    }
    this.until = world.seaTime + 12;
  }
  step(world, send) {
    if (this.markers?.visible && (world.seaTime >= this.until || world.layoutVersion !== this.version))
      this.markers.visible = false;
    if (!this.search) return;
    const until = performance.now() + 0.8;
    let result;
    if (this.version !== world.layoutVersion || this.tuning !== JSON.stringify(world.level.traveler))
      result = { reason: 'world changed; query again' };
    else
      do {
        const next = this.search.next();
        if (next.done) {
          result = next.value;
          break;
        }
      } while (performance.now() < until);
    if (result) {
      this.search = null;
      Object.assign(this.report, result, { status: result.mode ? 'reachable' : 'unproven' });
      if (this.show && result.mode) this.mark(world, result);
      send({ type: 'reach', target: this.report.id, ...result });
    }
  }
}

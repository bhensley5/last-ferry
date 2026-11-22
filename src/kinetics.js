import { partAt,tracePart } from './actor-parts.js';
import * as T from 'three';
import { slide, traceSolid } from './market-solids.js';
import { basin } from './basin.js';

export const kineticFields = {
  motion: {
    who: 'player or live enemy ID',
    velocity: '[vx,vy,vz] m/s, each ±25; OR toward:point/ID plus speed .1–25 (negative for repel)',
    seconds:
      'optional duration .02–4. Tracks a moving target. Player uses normal collision; enemies slide horizontally on their arena. Without seconds, one player impulse or a short enemy shove.',
  },
  shot: {
    from: 'player (default), encounter ID, deck ID or absolute [x,y,z]',
    aim: 'forward, point, player, encounter or deck',
    speed: '.5–35 m/s',
    gravity: '0–30 downward acceleration; lift: -12 to 12 extra initial vertical speed',
    life: '.1–6 seconds, default 2',
    hits: 'enemy (default) | player | terrain; solid scenery stops all shots',
    tag: 'name delivered on impact',
    color: 'optional #rrggbb',
    radius: '.04–.6; projectile size and actor contact tolerance',
    impact:
      'event {type:"impact",tag,source,target,at,normal,velocity,offset,reason:"actor"|"terrain"|"water"|"expired"}; actorPart is the named hit or null; emits no damage by itself',
  },
  tether: {
    anchor: 'deck/encounter ID or [x,y,z]. Player rope; reissue to change or {remove:true} to release.',
    part: 'encounter anchor only: exact encounters[].parts[].id. Follows the animated point through reskins; omit offset. Releases on removal/defeat.',
    offset: 'optional offset [x,y,z] in world axes from moving anchor (impact.offset)',
    length: 'rest length .5–35 m',
    stiffness: '1–100 spring acceleration per meter; damping:0–15 radial damping',
    seconds: 'optional lifetime .1–60; default lasts until release or respawn',
    color: 'optional #rrggbb',
  },
  vitality: {
    hearts:
      'signed integer ±1–3, heals or damages player; incoming damage respects invulnerability and normal death/respawn',
  },
  signal: {
    tag: '1–48 character event name',
    data: 'optional JSON payload up to 1 KB; subscribe to signal to chain behaviors',
  },
};
const between = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
const vector = (v, a, b) => Array.isArray(v) && v.length === 3 && v.every((n) => between(n, a, b));
const label = (s) => typeof s === 'string' && s.length > 0 && s.length <= 48;
export function kineticError(op, pieces, actors) {
  const location = (v) =>
    v === 'player' ||
    pieces.has(v) ||
    actors.has(v) ||
    (vector(v, -300, 300) &&
      between(v[0], basin.west, basin.east) &&
      between(v[2], basin.north, basin.south) &&
      between(v[1], -5, 85));
  if (op.op === 'tether') {
    if (op.remove === true) return null;
    if (
      !location(op.anchor) ||
      op.anchor === 'player' ||
      (op.part !== undefined && (!actors.has(op.anchor) || typeof op.part!=='string' || op.offset!==undefined)) ||
      (op.offset !== undefined && !vector(op.offset, -100, 100)) ||
      !between(op.length, 0.5, 35) ||
      !between(op.stiffness ?? 38, 1, 100) ||
      !between(op.damping ?? 5, 0, 15) ||
      (op.seconds !== undefined && !between(op.seconds, 0.1, 60)) ||
      (op.color !== undefined && !(typeof op.color === 'string' && /^#[a-f\d]{6}$/i.test(op.color)))
    )
      return 'Invalid rope anchor, length, spring or duration.';
    return null;
  }
  if (op.op === 'signal')
    return label(op.tag) && JSON.stringify(op.data ?? null).length <= 1024
      ? null
      : 'Invalid signal name or payload.';
  if (op.op === 'vitality')
    return Number.isInteger(op.hearts) && op.hearts !== 0 && Math.abs(op.hearts) <= 3
      ? null
      : 'Use a signed change of 1–3 hearts.';
  if (op.op === 'motion') {
    if (op.who !== 'player' && !actors.has(op.who))
      return 'Choose the player or an encounter for motion.';
    if (op.seconds !== undefined && !between(op.seconds, 0.02, 4))
      return 'Drive duration must be .02–4 seconds.';
    if (op.velocity !== undefined)
      return vector(op.velocity, -25, 25) && op.toward === undefined
        ? null
        : 'Supply a single velocity vector within ±25.';
    return location(op.toward) && between(Math.abs(op.speed), 0.1, 25)
      ? null
      : 'Supply a destination and signed speed.';
  }
  if (
    !location(op.from ?? 'player') ||
    !(op.aim === 'forward' || location(op.aim)) ||
    !between(op.speed, 0.5, 35) ||
    !label(op.tag)
  )
    return 'Shot needs an origin, aim, tag and speed.';
  if (
    !['enemy', 'player', 'terrain'].includes(op.hits ?? 'enemy') ||
    !between(op.gravity ?? 0, 0, 30) ||
    !between(op.lift ?? 0, -12, 12) ||
    !between(op.life ?? 2, 0.1, 6) ||
    !between(op.radius ?? 0.12, 0.04, 0.6)
  )
    return 'Invalid shot collision or trajectory settings.';
  if (op.color !== undefined && !(typeof op.color === 'string' && /^#[a-f\d]{6}$/i.test(op.color)))
    return 'Use #rrggbb for shot color.';
  return null;
}

export class Kinetics {
  constructor(world, combat, player) {
    this.lastImpact = null;
    this.world = world;
    this.combat = combat;
    this.player = player;
    this.shots = [];
    this.drives = new Map();
    this.orb = new T.SphereGeometry(1, 10, 8);
  }
  brief() {
    return {
      shots: this.shots.length,
      lastImpact: this.lastImpact,
      tether: this.rope?.op ?? null,
      driving: [...this.drives.keys()],
    };
  }
  clear() {
    for (const shot of this.shots) this.discard(shot);
    this.shots = [];
    this.lastImpact = null;
    this.drives.clear();
    this.setTether({ remove: true });
  }
  releaseOwner(id) {
    if (this.rope?.op.owner===id) this.setTether({remove:true});
    for (const [who,drive] of this.drives) if (drive.op.owner===id) this.drives.delete(who);
    for (let i=this.shots.length-1;i>=0;i--) if (this.shots[i].op.owner===id) {
      this.discard(this.shots[i]);this.shots.splice(i,1);
    }
  }
  discard(shot) {
    shot.mesh.removeFromParent();
    shot.mesh.material.dispose();
  }
  position(ref) {
    if (Array.isArray(ref)) return new T.Vector3(...ref);
    if (ref === 'player') return this.player.position;
    return this.combat.actors.get(ref)?.group.position ?? this.world.get(ref)?.group.position;
  }
  velocity(op, dt) {
    if (op.velocity) return new T.Vector3(...op.velocity);
    const target = this.position(op.toward),
      origin = this.position(op.who);
    if (!target || !origin) return new T.Vector3();
    const delta = target.clone().sub(origin);
    return delta
      .normalize()
      .multiplyScalar(op.speed > 0 ? Math.min(op.speed, target.distanceTo(origin) / dt) : op.speed);
  }
  motion(op, lockedBoss) {
    if (op.who !== 'player') {
      const actor = this.combat.actors.get(op.who);
      if (!actor || actor.defeated || actor.spec.id === lockedBoss) return;
    }
    this.drives.set(op.who, { op, remaining: op.seconds ?? (op.who === 'player' ? 0 : 0.22) });
  }
  setTether(op) {
    if (op.remove && op.owner && this.rope?.op.owner!==op.owner) return;
    if (this.rope) {
      const line = this.rope.line;
      line.removeFromParent();
      line.geometry.dispose();
      line.material.dispose();
      this.rope = null;
    }
    if (op.remove) return;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(6), 3));
    const line = new T.Line(geometry, new T.LineBasicMaterial({ color: op.color ?? '#ffd29b' }));
    line.frustumCulled = false;
    this.world.scene.add(line);
    this.rope = { op, line, remaining: op.seconds ?? Infinity };
  }
  pullTether(dt) {
    if (!this.rope) return;
    const { op, line } = this.rope,
      p = this.player,
      anchor = op.part ? partAt(this.combat.actors.get(op.anchor),op.part) : this.position(op.anchor)?.clone();
    if (anchor && op.offset) anchor.add(new T.Vector3(...op.offset));
    if (!anchor || (this.rope.remaining -= dt) <= 0) {
      this.setTether({ remove: true });
      return;
    }
    const hand = p.position.clone();
    hand.y += 0.85;
    const coords = line.geometry.attributes.position;
    coords.setXYZ(0, hand.x, hand.y, hand.z);
    coords.setXYZ(1, anchor.x, anchor.y, anchor.z);
    coords.needsUpdate = true;
    const radial = anchor.clone().sub(hand),
      stretch = radial.length() - op.length;
    if (stretch <= 0) return;
    radial.normalize();
    const accel = T.MathUtils.clamp(
      stretch * (op.stiffness ?? 38) - p.velocity.dot(radial) * (op.damping ?? 5),
      0,
      140,
    );
    p.velocity.addScaledVector(radial, accel * dt).clampScalar(-30, 30);
    if (p.velocity.y > 0) {
      p.grounded = null;
      p.coyote = 0;
    }
  }
  drivePlayer(dt) {
    const drive = this.drives.get('player');
    if (!drive) return;
    const v = this.velocity(drive.op, dt),
      p = this.player;
    if (drive.op.seconds) p.velocity.copy(v);
    else p.velocity.add(v).clampScalar(-30, 30);
    if (p.velocity.y > 0) {
      p.grounded = null;
      p.coyote = 0;
    }
    if ((drive.remaining -= dt) <= 0) this.drives.delete('player');
  }
  driveEnemies(dt) {
    for (const [id, drive] of this.drives) {
      if (id === 'player') continue;
      const actor = this.combat.actors.get(id);
      if (!actor || actor.defeated) {
        this.drives.delete(id);
        continue;
      }
      const speed = this.velocity(drive.op, dt);
      const feet = actor.group.position.clone();
      feet.y = actor.floor ?? actor.anchor.y;
      const deck = this.world.get(actor.deck ?? actor.spec.arena);
      for (const axis of ['x', 'z']) {
        const delta = speed[axis] * dt;
        if (this.world.solidHarbor) slide(this.world.entities, feet, axis, delta, true);
        else this.world.slidePastWalls(feet, axis, delta);
        if (deck) {
          const edge = Math.max(0, deck.size[axis === 'x' ? 0 : 1] / 2 - 0.4);
          feet[axis] = T.MathUtils.clamp(
            feet[axis],
            deck.group.position[axis] - edge,
            deck.group.position[axis] + edge,
          );
        }
      }
      const delta = feet.sub(actor.group.position);
      delta.y = 0;
      actor.group.position.add(delta);
      // Perching/orbiting actors use the anchor next frame; move that too.
      if (!actor.deck || actor.deck===actor.spec.arena) {
        actor.anchor.add(delta);
        actor.spec.at = actor.anchor.toArray();
        const spec = this.world.level.encounters.find((e) => e.id === id);
        if (spec) spec.at = [...actor.spec.at];
      }
      if ((drive.remaining -= dt) <= 0) this.drives.delete(id);
    }
  }
  shoot(op) {
    const from = op.from ?? 'player',
      p = this.position(from);
    if (!p) return;
    const start = p.clone();
    if (from === 'player' || this.world.get(from)) start.y += 0.94;
    const end = this.position(op.aim)?.clone();
    if (end && op.aim === 'player') end.y += 0.8;
    const angle = this.player.facing ?? Math.PI;
    const v = end ? end.sub(start) : new T.Vector3(Math.sin(angle), 0, Math.cos(angle));
    v.normalize().multiplyScalar(op.speed);
    v.y += op.lift ?? 0;
    const mesh = new T.Mesh(this.orb, new T.MeshBasicMaterial({ color: op.color ?? '#9ce9e0' }));
    mesh.scale.setScalar(op.radius ?? 0.12);
    mesh.position.copy(start);
    if (this.shots.length >= 32) this.discard(this.shots.shift());
    this.world.scene.add(mesh);
    this.shots.push({ mesh, v, from, op, remaining: op.life ?? 2 });
  }
  update(dt, lockedBoss, emit) {
    this.driveEnemies(dt);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i],
        { mesh, v, op, from } = shot,
        start = mesh.position;
      v.y -= (op.gravity ?? 0) * dt;
      const direction = v.clone().normalize(),
        ray = new T.Ray(start, direction);
      const travel = v.length() * dt;
      const solid = this.world.traceTerrain ? this.world.traceTerrain(start,direction,travel) : traceSolid(this.world.entities,start,direction,travel);
      let distance = solid.distance,
        target = solid.target,
        normal = solid.normal;
      let actorPart=null;
      let reason = target ? 'terrain' : null;
      const water = this.world.seaAt(start.x, start.z);
      if (start.y <= water || (direction.y < 0 && start.y + direction.y * distance <= water)) {
        distance = start.y <= water ? 0 : (water - start.y) / direction.y;
        reason = 'water';
        target = null;
        normal.set(0, 1, 0);
      }
      const test = (id, center, radius) => {
        if (id === from) return;
        const sphere = new T.Sphere(center, radius + (op.radius ?? 0.12)),
          point = new T.Vector3();
        const hit = sphere.containsPoint(start)
          ? 0
          : ray.intersectSphere(sphere, point)?.distanceTo(start);
        if (hit !== undefined && hit <= distance) {
          distance = hit;
          target = id;actorPart=null;
          reason = 'actor';
          normal.copy(start).addScaledVector(direction, hit).sub(center).normalize();
        }
      };
      if (op.hits === 'player')
        test('player', this.player.position.clone().add(new T.Vector3(0, 0.8, 0)), 0.58);
      else if (op.hits !== 'terrain')
        for (const actor of this.combat.actors.values()) {
          if (actor.defeated || actor.spec.friendly || actor.spec.id===lockedBoss || actor.spec.id===from) continue;
          const part=tracePart(actor,ray,distance,op.radius??.12);
          if (part) {distance=part.distance;target=actor.spec.id;actorPart=part.id;normal.copy(part.normal);reason='actor';}
          else test(actor.spec.id, actor.group.position, 0.62);
        }
      start.addScaledVector(direction, distance);
      shot.remaining -= dt;
      if (!reason && shot.remaining > 0) continue;
      const anchor = this.position(target);
      this.lastImpact = {
        type: 'impact',
        tag: op.tag,
        source: from,
        target,
        reason: reason ?? 'expired',actorPart,
        ...(reason==='terrain' && {surface:this.world.surfaces?.describe(target,solid.part)??null,device:solid.device??null}),
        at: start.toArray(),
        offset: anchor ? start.clone().sub(anchor).toArray() : null,
        normal: normal.toArray(),
        velocity: v.toArray(),
      };
      emit(this.lastImpact);
      this.discard(shot);
      this.shots.splice(i, 1);
    }
  }
}

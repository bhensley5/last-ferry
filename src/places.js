import { Matrix4, Vector3 } from 'three';

export const named = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(id);
const point = new Vector3(),
  inverse = new Matrix4();

function contains(spec, local) {
  const [x, y, z] = spec.at,
    [w, h, d] = spec.size;
  return (
    Math.abs(local.x - x) <= w / 2 && Math.abs(local.y - y) <= h / 2 && Math.abs(local.z - z) <= d / 2
  );
}
// Regions live in deck-local meters, or world meters when unanchored. No render meshes.
export class Places {
  constructor(world) {
    this.world = world;
    this.members = new Map();
  }
  hasForceAt(position) {
    for (const spec of this.world.level.regions) {
      if (!spec.force || spec.watch === 'actors') continue;
      point.copy(position);
      const anchor = spec.deck && this.world.get(spec.deck);
      if (anchor) anchor.group.worldToLocal(point);
      if (contains(spec, point)) return true;
    }
    return false;
  }
  forget(id, send, reason = 'removed') {
    for (const source of this.members.get(id) ?? [])
      send?.({ type: 'leave', target: id, source, reason });
    this.members.delete(id);
  }
  step(specs, player, actors, dt, send) {
    for (const spec of specs) {
      const anchor = spec.deck && this.world.get(spec.deck);
      if (spec.deck && !anchor) {
        this.forget(spec.id, send);
        continue;
      }
      if (anchor) {
        anchor.group.updateWorldMatrix(true, false);
        inverse.copy(anchor.group.matrixWorld).invert();
      }
      let inside = this.members.get(spec.id);
      if (!inside) this.members.set(spec.id, (inside = new Set()));
      const check = (id, position, y = position.y) => {
        point.copy(position);
        point.y = y;
        if (anchor) point.applyMatrix4(inverse);
        const present = contains(spec, point);
        if (present !== inside.has(id)) {
          if (present) inside.add(id);
          else inside.delete(id);
          send({ type: present ? 'enter' : 'leave', target: spec.id, source: id });
        }
        return present;
      };
      if (spec.watch !== 'actors' && check('player', player.position) && spec.force) {
        player.velocity.x += spec.force[0] * dt;
        player.velocity.y += spec.force[1] * dt;
        player.velocity.z += spec.force[2] * dt;
        if (player.velocity.y > 0) {
          player.grounded = null;
          player.coyote = 0;
        }
      }
      if (spec.watch === 'both' || spec.watch === 'actors') {
        for (const [id, actor] of actors)
          if (!actor.defeated)
            check(id, actor.group.position, actor.crew?.grounded ? actor.floor : actor.group.position.y);
      }
      for (const id of inside) {
        const tracked =
          id === 'player'
            ? spec.watch !== 'actors'
            : (spec.watch === 'both' || spec.watch === 'actors') &&
              actors.has(id) &&
              !actors.get(id).defeated;
        if (!tracked) {
          inside.delete(id);
          send({ type: 'leave', target: spec.id, source: id, reason: 'untracked' });
        }
      }
    }
  }
}

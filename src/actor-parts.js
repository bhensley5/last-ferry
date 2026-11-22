import { Sphere, Vector3 } from 'three';
const center = new Vector3(),
  contact = new Vector3(),
  forward = new Vector3();
const sphere = new Sphere();

// The semantic anchor belongs to the rig, not the removable costume mesh.
export function addPart(parts, id, node, radius, rear = false) {
  parts.set(id, { node, radius, rear });
}
export function partAt(actor, id) {
  const part = actor?.parts?.get(id);
  if (part && !actor.defeated) return part.node.getWorldPosition(new Vector3());
}
export function tracePart(actor, ray, limit, padding = 0) {
  let best = null;
  for (const [id, part] of actor.parts ?? []) {
    if (
      part.rear &&
      ray.direction.dot(forward.set(0, 0, 1).applyQuaternion(actor.group.quaternion)) <= 0.15
    )
      continue;
    part.node.getWorldPosition(center);
    sphere.set(center, part.radius + padding);
    if (!ray.intersectSphere(sphere, contact)) continue;
    const distance = contact.distanceTo(ray.origin);
    if (distance <= limit) {
      limit = distance;
      best = { id, distance, normal: contact.clone().sub(center).normalize() };
    }
  }
  return best;
}

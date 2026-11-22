import { tracePart } from './actor-parts.js';
import * as T from 'three';

const picker=new T.Raycaster();
const rounded=v=>v.toArray().map(n=>+n.toFixed(3));

function visible(node) {
  for (let current=node;current;current=current.parent) if (!current.visible) return false;
  return true;
}

// Run on a wish or aimed shot, not on every pointer movement. Terrain uses
// gameplay solids so a wall that stops a shot also hides targets behind it.
export function viewHit(world,actors,camera,pointer,range=65){
  camera.updateMatrixWorld();
  picker.setFromCamera(pointer,camera);
  const {origin,direction}=picker.ray;
  const solid=world.traceTerrain(origin,direction,range);
  const at=origin.clone().addScaledVector(direction,solid.distance);
  let hit=solid.target?{id:solid.target,part:solid.part,device:solid.device??null,surface:world.surfaces.describe(solid.target,solid.part),at:rounded(at),kind:'terrain'}:null;
  picker.far=solid.distance;
  for(const actor of actors.values()){
    if(actor.defeated || !actor.group.visible || actor.group.position.distanceToSquared(origin)>(range+6)**2)continue;
    const found=picker.intersectObject(actor.group,true).find(h=>h.object.isMesh && visible(h.object) && !h.object.material?.transparent);
    const part=tracePart(actor,picker.ray,picker.far);
    if(part && (!found || part.distance<=found.distance+.23)){
      picker.far=part.distance;hit={id:actor.spec.id,kind:'encounter',actorPart:part.id,at:rounded(picker.ray.at(part.distance,new T.Vector3()))};
    }else if(found && found.distance<picker.far){
      picker.far=found.distance;
      hit={id:actor.spec.id,kind:'encounter',at:rounded(found.point)};
    }
  }
  return hit;
}
export function wishView(world,actors,camera,pointer,player,recent){
  return {levelId:world.level.levelId,revision:world.level.revision,sampledAt:Date.now(),
    position:rounded(player.position),facing:player.facing??Math.PI,
    eye:rounded(camera.position),look:rounded(camera.getWorldDirection(new T.Vector3())),
    aim:viewHit(world,actors,camera,pointer),footing:player.grounded,
    underfoot:world.surfaces.describe(player.grounded,player.part),lastAttacker:recent.attacker??null,
    lastContact:recent.contact??null,nearby:world.surfaces.nearby(player.position,12,8)};
}

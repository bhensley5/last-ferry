import * as T from 'three';
import { findGroundRoute, groundBody } from './ground-route.js';
import { landing, slide } from './market-solids.js';

const feet = new T.Vector3(), relative=new T.Vector3();

// Keep a short trail relative to its supports, not fixed coordinates. It stays
// valid on a moving boat; removing a deck invalidates its crumbs.
function restore(world, mark) {
  return world.get(mark.id)?.group.position.clone().add(mark.offset);
}
function record(world, trail, id, position) {
  const deck=world.get(id);
  if(!deck)return;
  const last=trail.at(-1);
  if(last?.id===id && last.offset.distanceToSquared(relative.subVectors(position,deck.group.position))<.65)return;
  trail.push({id,offset:position.clone().sub(deck.group.position)});
  if (trail.length > 64) trail.shift();
}
export class Pursuit {
  trail = [];
  jobs=[];
  time=0;
  recordPlayer(world, player,dt) {
    this.time+=dt;
    const deadline=performance.now()+.85;
    for(let i=0;i<20&&this.jobs.length&&performance.now()<deadline;i++){
      const plan=this.jobs.shift();
      if(plan.version!==world.layoutVersion || this.time-plan.used>1)continue;
      const result=plan.search.next();
      if(result.done){plan.path=result.value;plan.status=plan.path.length?'following':'disconnected';plan.retry=this.time+2;}
      else this.jobs.push(plan);
    }
    if (player.grounded) record(world,this.trail,player.grounded,player.position);
  }
  target(world, actor, player, planOnDeck=false) {
    if (!actor.crew.grounded || !planOnDeck && actor.deck === player.grounded) return player.position;
    if(player.grounded){
      const p=actor.group.position,goal=player.position;
      let plan=actor.groundPlan;
      if(!plan || plan.version!==world.layoutVersion || plan.to!==player.grounded || plan.goal.distanceToSquared(goal)>2.25 ||
        this.time-plan.used>.9 || !plan.path?.length && this.time>=plan.retry ||
        plan.path?.length && this.time-plan.progress>1.3){
        if(plan)this.jobs=this.jobs.filter(job=>job!==plan);
        const start=new T.Vector3(p.x,actor.floor,p.z);
        plan=actor.groundPlan={version:world.layoutVersion,to:player.grounded,goal:goal.clone(),used:this.time,
          status:'searching',retry:Infinity,progress:this.time,search:findGroundRoute(world,start,goal.clone(),groundBody(actor))};
        this.jobs.push(plan);
      }
      plan.used=this.time;
      while(plan.path?.length && Math.hypot(plan.path[0].x-p.x,plan.path[0].z-p.z)<.23){
        plan.path.shift();plan.progress=this.time;
      }
      if(plan.path && !plan.path.length && plan.status==='following')plan.retry=0;
      return plan.path?.[0]??p;
    }
    const exit = this.trail.findLastIndex(point => point.id === actor.deck);
    if (exit < 0) return player.position;
    const entry=this.trail[exit+1];
    if(!entry)return player.position;
    let next=entry;
    for(const point of this.trail.slice(exit+2)){
      if(point.id!==entry.id || point.offset.distanceToSquared(entry.offset)>4)break;
      next=point;
    }
    return restore(world,next) || player.position;
  }
}
export function returnTarget(world, actor) {
  while (actor.trail.length) {
    const target = restore(world,actor.trail.at(-1));
    const p = actor.group.position;
    if (target && Math.hypot(target.x-p.x,target.z-p.z) > .45) return target;
    actor.trail.pop();
  }
  return actor.anchor;
}
export function advanceCrew(world, actor, vx, vz, dt, returning) {
  const p = actor.group.position;
  if (!actor.crew.grounded) {
    feet.set(p.x, actor.floor+.45, p.z);
    slide(world.entities,feet,'x',vx*dt,false);
    slide(world.entities,feet,'z',vz*dt,false);
    if(!returning)record(world,actor.trail,actor.deck,p);
    p.x = feet.x; p.z = feet.z;
    const under = world.supportAt(p.x,p.z,0,actor.floor+1.4);
    if (under && under.kind !== 'wall') {
      actor.deck = under.id;
      actor.floor = T.MathUtils.damp(actor.floor,under.group.position.y,5,dt);
    }
    return;
  }
  // Never extrapolate a floor across a gap. A small step is walkable, an
  // unsupported edge isn't. Side probes let a pursuer slide around a post.
  for (const turn of [0,.76,-.76]) {
    const c = Math.cos(turn), s = Math.sin(turn);
    feet.set(p.x,actor.floor,p.z);
    const body=groundBody(actor);
    slide(world.entities,feet,'x',(vx*c-vz*s)*dt,true,body.radius,body.height);
    slide(world.entities,feet,'z',(vx*s+vz*c)*dt,true,body.radius,body.height);
    if (Math.hypot(feet.x-p.x,feet.z-p.z) < Math.hypot(vx,vz)*dt*.18) continue;
    const support = landing(world.entities,feet,actor.floor-.32,actor.floor+.23);
    if (!support || support.entity.kind === 'wall' || support.top <= world.seaAt(feet.x,feet.z)+.12) continue;
    if (!returning) record(world,actor.trail,actor.deck,p);
    p.x = feet.x; p.z = feet.z;
    actor.deck = support.entity.id;
    actor.floor = support.top;
    return;
  }
}

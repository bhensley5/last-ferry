import * as T from 'three';
import { insideBasin } from './basin.js';

const pad=.15, floorMargin=.08;
export function isCarrier(e){
  return e && (['skiff','ferry'].includes(e.kind) || ['hoist','skyBarge'].includes(e.dressing) || e.built && e.kind==='dock' && !e.dressing);
}
// Sweep the carrier's occupied rectangle through nearby solids at its riding
// height. Reject an obstructed trip rather than warping through a pier or cliff.
function clearLane(world,e,to){
  const p=e.group.position, ray=new T.Ray(), box=new T.Box3(),hit=new T.Vector3();
  ray.origin.set(p.x,p.y+.12,p.z);
  ray.direction.set(to.x-p.x,0,to.z-p.z);
  const distance=ray.direction.length();if(distance<.02)return true;
  ray.direction.divideScalar(distance);
  for(const other of world.entities.values()){
    if(other===e)continue;
    const q=other.group.position;
    const test=b=>{
      box.copy(b).translate(q);
      box.min.x-=e.size[0]/2-pad;box.max.x+=e.size[0]/2-pad;
      box.min.z-=e.size[1]/2-pad;box.max.z+=e.size[1]/2-pad;
      box.min.y-=.32;box.max.y+=.12;
      return box.containsPoint(ray.origin) || !!ray.intersectBox(box,hit) && hit.distanceTo(ray.origin)<=distance;
    };
    if(other.obstacleBounds && test(other.obstacleBounds) && other.obstacles.some(test))return false;
  }
  return true;
}
function interceptPoint(world,e,p,speed){
  const at=e.group.position;
  let top=at.y;
  for(const b of e.obstacles)if(b.min.x<=pad && b.max.x>=-pad && b.min.z<=pad && b.max.z>=-pad)top=Math.max(top,b.max.y+at.y);
  if(top>=p.position.y-floorMargin || top<=world.seaAt(at.x,at.z)+.16)return null;
  const gravity=world.level.traveler.gravity,vy=p.velocity.y;
  const t=(vy+Math.sqrt(vy*vy+2*gravity*(p.position.y-top)))/gravity;
  if(t<.045 || t>2.5)return null;
  const drag=(1-Math.exp(-7*t))/7, input=p.airTarget??[0,0];
  const to=new T.Vector3(p.position.x+input[0]*t+(p.velocity.x-input[0])*drag,at.y,
    p.position.z+input[1]*t+(p.velocity.z-input[1])*drag);
  if(!insideBasin(to.toArray()))return null;
  const travel=Math.hypot(to.x-at.x,to.z-at.z);
  if(travel>speed*t+Math.min(...e.size)*.32 || !clearLane(world,e,to))return null;
  // Another landing directly under the predicted point would catch the traveler first.
  for(const other of world.entities.values()){
    if(other===e)continue;
    const q=other.group.position,x=to.x-q.x,z=to.z-q.z,b=other.obstacleBounds;
    if(!b || x<b.min.x || x>b.max.x || z<b.min.z || b.max.y+q.y<top+.15)continue;
    if(other.obstacles.some(s=>x>=s.min.x&&x<=s.max.x&&z>=s.min.z&&z<=s.max.z&&s.max.y+q.y>top+.15&&s.max.y+q.y<p.position.y))return null;
  }
  return {to,travel,time:t};
}
export class Interceptor {
  constructor(world){this.world=world;}
  report(reason,target,at){
    this.last={type:'intercept',reason,target,at:at?.toArray()??null};this.world.onMechanicEvent?.(this.last);
  }
  start(op,player){
    const w=this.world,speed=op.speed??10;
    if(this.job || player.grounded || player.velocity.y>=0){this.report('unavailable',null);return;}
    let best=null;
    for(const e of w.entities.values()){
      if(!isCarrier(e) || op.id && op.id!==e.id || w.transitions.some(t=>t.entity===e))continue;
      const plan=interceptPoint(w,e,player,speed);
      if(plan && (!best || plan.travel<best.travel))best={...plan,e};
    }
    if(!best){this.report('unavailable',null);return;}
    this.job={e:best.e,home:best.e.group.position.clone(),to:best.to,speed,phase:'catch',wait:best.time+.35,refresh:.1};
    this.report('arranged',best.e.id,best.to);
  }
  prepare(player,dt){
    const j=this.job;if(!j)return;
    if(this.world.get(j.e.id)!==j.e){this.report('missed',j.e.id);this.job=null;return;}
    if(j.phase==='catch'){
      j.wait-=dt;j.refresh-=dt;
      if(player.grounded===j.e.id){j.phase='aboard';this.report('caught',j.e.id,player.position);}
      else if(player.grounded || j.wait<=0 || player.position.y<j.e.group.position.y-.15){
        j.phase='return';this.report('missed',j.e.id);
      }else if(j.refresh<=0){
        j.refresh=.09;const plan=interceptPoint(this.world,j.e,player,j.speed);
        if(plan)j.to=plan.to;
      }
    }else if(j.phase==='aboard' && player.grounded!==j.e.id)j.phase='return';
  }
  move(e,dt){
    const j=this.job;if(j?.e!==e)return false;
    if(j.phase==='aboard')return true;
    const dest=j.phase==='return'?j.home:j.to,p=e.group.position;
    const dx=dest.x-p.x,dz=dest.z-p.z,len=Math.hypot(dx,dz);
    if(len>.001){const f=Math.min(1,j.speed*dt/len);p.x+=dx*f;p.z+=dz*f;}
    if(j.phase==='return' && len<=j.speed*dt)this.job=null;
    return true;
  }
}

import * as T from 'three';
import { landing, slide } from './market-solids.js';

const crabBody={radius:.42,height:1}, crewBody={radius:.26,height:1.65};
export const groundBody = actor => actor.spec?.kind==='crab' ? crabBody : crewBody;
const cell=.75,feet=new T.Vector3();
function step(entities,world,from,x,z,body){
  feet.copy(from);
  // Sample the middle too: two walkable endpoints need not share a floor.
  for(let i=1;i<=2;i++){
    const xx=from.x+(x-from.x)*i/2,zz=from.z+(z-from.z)*i/2;
    slide(entities,feet,'x',xx-feet.x,true,body?.radius,body?.height);slide(entities,feet,'z',zz-feet.z,true,body?.radius,body?.height);
    if(Math.hypot(feet.x-xx,feet.z-zz)>.02)return null;
    const floor=landing(entities,feet,feet.y-.32,feet.y+.23);
    if(!floor || floor.entity.kind==='wall' || floor.top<=world.seaAt(xx,zz)+.12)return null;
    feet.y=floor.top;
  }
  return feet.clone();
}
// Only engaged ground crews search. Yield one expansion at a time so several
// pursuers share a frame budget rather than rebuilding a whole-level navmesh.
export function* findGroundRoute(world,start,goal,body){
  const entities=new Map(),pad=7;
  const west=Math.min(start.x,goal.x)-pad,east=Math.max(start.x,goal.x)+pad;
  const north=Math.min(start.z,goal.z)-pad,south=Math.max(start.z,goal.z)+pad;
  for(const [id,e] of world.entities){
    const p=e.group.position,b=e.obstacleBounds;
    if(b && p.x+b.max.x>=west && p.x+b.min.x<=east && p.z+b.max.z>=north && p.z+b.min.z<=south)entities.set(id,e);
  }
  const heuristic=p=>(Math.abs(goal.x-p.x)+Math.abs(goal.z-p.z))/cell;
  const open=[{ix:0,iz:0,p:start,g:0,score:heuristic(start),prev:null}],cost=new Map();
  const shifts=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let visited=0;open.length && visited<700;visited++){
    yield;
    let best=0;
    for(let i=1;i<open.length;i++)if(open[i].score<open[best].score)best=i;
    const node=open[best],last=open.pop();if(best<open.length)open[best]=last;
    if(Math.hypot(goal.x-node.p.x,goal.z-node.p.z)<cell*1.25){
      const end=step(entities,world,node.p,goal.x,goal.z,body);
      if(end && Math.abs(goal.y-end.y)<.35){
        const path=[end];for(let n=node;n.prev;n=n.prev)path.push(n.p);return path.reverse();
      }
    }
    for(const [dx,dz] of shifts){
      const ix=node.ix+dx,iz=node.iz+dz,x=start.x+ix*cell,z=start.z+iz*cell;
      if(x<west||x>east||z<north||z>south)continue;
      const p=step(entities,world,node.p,x,z,body);if(!p)continue;
      const k=ix+','+iz+','+Math.round(p.y*3),g=node.g+1;
      if((cost.get(k)??Infinity)<=g)continue;
      cost.set(k,g);open.push({ix,iz,p,g,score:g+heuristic(p),prev:node});
    }
  }
  return [];
}

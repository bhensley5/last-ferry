import * as T from 'three';

const radius=.22, bodyHeight=1.42;

// Collect before render meshes are merged. Keep local bounds so a recolored, moved,
// resized or quarter-turned piece never leaves an invisible obstacle behind.
export function collectSolids(group) {
  const counts=new Map();
  function identify(box,tag){
    if(tag){
      const n=(counts.get(tag.kind)??0)+1;counts.set(tag.kind,n);
      box.part={key:tag.kind+'-'+n,material:tag.material};
    }
    return box;
  }
  group.updateWorldMatrix(true,true);
  const inverse=group.matrixWorld.clone().invert(), solids=[];
  group.traverse(node=>{
    if(!node.isMesh || node.material.transparent || node.material.wireframe) return;
    if(node.isInstancedMesh && !node.userData.solidInstances)return;
    const geo=node.geometry;
    if(geo.type==='RingGeometry' || geo.type==='TubeGeometry' || geo.type==='IcosahedronGeometry')return;
    const local=new T.Matrix4().multiplyMatrices(inverse,node.matrixWorld);
    geo.computeBoundingBox();
    if(node.isInstancedMesh){
      const instance=new T.Matrix4();
      for(let i=0;i<node.count;i++){
        node.getMatrixAt(i,instance);
        solids.push(identify(geo.boundingBox.clone().applyMatrix4(instance.premultiply(local)),node.userData.surface));
      }
      return;
    }
    const box=geo.boundingBox.clone().applyMatrix4(local), size=box.getSize(new T.Vector3());
    if(size.y<.025 || Math.max(size.x,size.z)<.16 && size.y<.75)return;
    if(geo.type==='ExtrudeGeometry' && geo.parameters.shapes?.getPoints) {
      // Cut the moon gate into piers/arch sections instead of filling its opening.
      const points=geo.parameters.shapes.getPoints(32), step=(geo.boundingBox.max.x-geo.boundingBox.min.x)/32;
      for(let i=0;i<32;i++){
        const x0=geo.boundingBox.min.x+i*step,x=x0+step/2, levels=[];
        for(let j=0;j<points.length;j++){
          const a=points[j], b=points[(j+1)%points.length];
          if((a.x<=x && b.x>x)||(b.x<=x && a.x>x))levels.push(a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x));
        }
        levels.sort((a,b)=>a-b);
        for(let j=1;j<levels.length;j+=2)solids.push(new T.Box3(new T.Vector3(x0,levels[j-1],geo.boundingBox.min.z),new T.Vector3(x0+step,levels[j],geo.boundingBox.max.z)).applyMatrix4(local));
      }
    } else solids.push(identify(box,node.userData.surface));
  });
  return solids;
}

export function fitSolids(entity) {
  const transform=new T.Matrix4().compose(new T.Vector3(),entity.group.quaternion,entity.group.scale);
  entity.parts=new Map();
  entity.obstacles=entity.localSolids.map(box=>{
    const fitted=box.clone().applyMatrix4(transform);
    if(box.part){fitted.part=box.part;entity.parts.set(box.part.key,fitted);}
    return fitted;
  });
  entity.obstacleBounds=new T.Box3();
  for(const box of entity.obstacles)entity.obstacleBounds.union(box);
}

function near(entities,x,z,margin,visit) {
  for(const entity of entities.values()){
    const p=entity.group.position, lx=x-p.x,lz=z-p.z,b=entity.obstacleBounds;
    if(lx<b.min.x-margin || lx>b.max.x+margin || lz<b.min.z-margin || lz>b.max.z+margin)continue;
    for(const box of entity.obstacles){
      if(lx>box.min.x-margin && lx<box.max.x+margin && lz>box.min.z-margin && lz<box.max.z+margin) visit(entity,box,p);
    }
  }
}

export function slide(entities,position,axis,delta,grounded,width=radius,height=bodyHeight){
  const before=position[axis];position[axis]+=delta;
  if(!delta)return;
  near(entities,position.x,position.z,width,(entity,box,p)=>{
    if(position.y+(grounded ? .23 : .025)>=box.max.y+p.y || position.y+height<=box.min.y+p.y+.015)return;
    const edge=p[axis]+(delta>0?box.min[axis]-width:box.max[axis]+width);
    if(delta>0 && before<=edge+.001)position[axis]=Math.min(position[axis],edge);
    if(delta<0 && before>=edge-.001)position[axis]=Math.max(position[axis],edge);
  });
}

export function landing(entities,position,lower,upper){
  let best=null;
  near(entities,position.x,position.z,radius*.68,(entity,box,p)=>{
    const top=box.max.y+p.y;
    if(top>=lower && top<=upper && (!best || top>best.top))best={entity,top,part:box.part?.key??null};
  });
  return best;
}

export function ceiling(entities,position,fromY,toY){
  let result=toY;
  near(entities,position.x,position.z,radius,(entity,box,p)=>{
    const bottom=box.min.y+p.y-bodyHeight;
    if(fromY<=bottom+.001 && result>bottom)result=bottom;
  });
  return result;
}

const sightline=new T.Ray(), impact=new T.Vector3();
export function cameraDistance(entities,eye,desired){
  const direction=sightline.direction.subVectors(desired,eye);
  let distance=direction.length();
  if(distance<.001)return distance;
  direction.divideScalar(distance);
  for(const entity of entities.values()){
    sightline.origin.subVectors(eye,entity.group.position);
    const broad=entity.obstacleBounds;
    if(!broad.containsPoint(sightline.origin) && (!sightline.intersectBox(broad,impact) || impact.distanceTo(sightline.origin)>distance))continue;
    for(const box of entity.obstacles){
      // Tiny hardware shouldn't yank the camera forward as the player walks past it.
      if(box.max.x-box.min.x<.18 || box.max.z-box.min.z<.18 || box.containsPoint(sightline.origin))continue;
      if(sightline.intersectBox(box,impact))distance=Math.min(distance,Math.max(.28,impact.distanceTo(sightline.origin)-.14));
    }
  }
  return distance;
}

export function traceSolid(entities,origin,direction,range,deckFloors=true){
  const ray=new T.Ray(),hit=new T.Vector3();
  const normal=new T.Vector3();let target=null,part=null;
  ray.direction.copy(direction);
  function test(box,id){
    const inside=box.containsPoint(ray.origin);
    if(!inside && !ray.intersectBox(box,hit))return;
    const distance=inside?0:hit.distanceTo(ray.origin);
    if(distance>range)return;
    range=distance;target=id;part=box.part?.key??null;
    if(inside){normal.copy(direction).negate();return;}
    // Collision boxes are axis-aligned in deck-relative world coordinates.
    let nearest=Infinity;
    for(const axis of ['x','y','z'])for(const sign of [-1,1]){
      const gap=Math.abs(hit[axis]-box[sign<0?'min':'max'][axis]);
      if(gap<nearest){nearest=gap;normal.set(0,0,0);normal[axis]=sign;}
    }
  }
  for(const entity of entities.values()){
    ray.origin.subVectors(origin,entity.group.position);
    if(entity.obstacles){
      if(!ray.intersectsBox(entity.obstacleBounds))continue;
      for(const box of entity.obstacles)test(box,entity.id);
    }else if(deckFloors || entity.kind==='wall'){
      const [w,d]=entity.size;
      const depth=entity.kind==='wall'?entity.height:.2;
      test(new T.Box3(new T.Vector3(-w/2,-depth,-d/2),new T.Vector3(w/2,0,d/2)),entity.id);
    }
  }
  return {distance:range,target,part,normal};
}

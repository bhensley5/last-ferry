import * as T from 'three';

export function rotor(id,mesh,wind=false){
  return {id,mesh,wind,angularSpeed:0,angle:0,turns:0,source:null};
}
export function wheelModel(world){
  const wheel=new T.Group(),mat=world.wood[0];
  const add=(geo,material,x,y,z,angle=0)=>{
    const m=new T.Mesh(geo,material);m.position.set(x,y,z);m.rotation.z=angle;wheel.add(m);
  };
  add(new T.TorusGeometry(.74,.095,6,24),world.brass,0,0,0);
  add(new T.CylinderGeometry(.14,.14,.26,10).rotateX(Math.PI/2),world.brass,0,0,0);
  for(let i=0;i<4;i++)add(new T.BoxGeometry(1.55,.065,.12),mat,0,0,0,i*Math.PI/4);
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    add(new T.BoxGeometry(.43,.14,.42),world.lacquer,.81*Math.sin(a),.81*Math.cos(a),0,-a);
  }
  return wheel;
}
const ray=new T.Raycaster(),normalMatrix=new T.Matrix3(),nearby=new T.Vector3();
export function traceWheels(entities,origin,direction,hit){
  ray.set(origin,direction);
  for(const deck of entities.values())for(const device of deck.devices?.values()??[]){
    device.mesh.updateWorldMatrix(true,true);
    device.mesh.getWorldPosition(nearby);
    const radius=(device.wind?4:1.15)*Math.max(deck.group.scale.x,deck.group.scale.z,1);
    if(ray.ray.distanceSqToPoint(nearby)>radius*radius)continue;
    ray.far=hit.distance;
    const face=ray.intersectObject(device.mesh,true)[0];
    if(!face)continue;
    hit.distance=face.distance;hit.target=deck.id;hit.part=null;hit.device=device.id;
    hit.normal.copy(face.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(face.object.matrixWorld));
  }
  return hit;
}
export function driveWheel(device,speed,source){
  device.angularSpeed=T.MathUtils.clamp(device.angularSpeed+speed,-12,12);
  device.source=source;
}
export function stepWheels(deck,world,dt){
  for(const d of deck.devices.values()){
    const spin=d.angularSpeed*dt;
    if(d.wind)d.mesh.rotation.z+=dt*(.58+world.level.weather.wind*1.4);
    if(Math.abs(d.angularSpeed)<.025){d.angularSpeed=0;continue;}
    d.mesh.rotation.z+=spin;d.angle+=spin;d.angularSpeed*=Math.exp(-1.8*dt);
    const steps=Math.trunc(d.angle/(Math.PI/2));
    if(steps){d.turns+=steps;d.angle-=steps*Math.PI/2;world.onMechanicEvent?.({type:'turn',target:d.id,source:d.source,steps});}
  }
}

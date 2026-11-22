import * as T from 'three';
import { traceSolid } from './market-solids.js';

// Attach semantics before geometry is batched. Contact, view picking and effects
// then use the same fitted box, including on resized or moving pieces.
export function surface(mesh, kind, material) {
  mesh.userData.surface={kind,material};
  return mesh;
}
export const surfaceFields={
  id:'deck ID',part:'exact part key from wish context or nearbySurfaces',
  action:'ignite | wet | dry', seconds:'1–120 game seconds (default: fire 20, wet 8); wet blocks ignition. Cloth and wood burn; uncovered fire goes out in rain.'
};
const limit=48, key=(id,part)=>JSON.stringify([id,part]);
const point=new T.Vector3(), up=new T.Vector3(0,1,0);
const rounded=v=>v.toArray().map(n=>+n.toFixed(3));
export class SurfaceSystem {
  active=new Map();
  lastChange=null;
  sinceRain=0;
  constructor(world){this.world=world;}
  describe(id,part){
    const deck=this.world.get(id), box=deck?.parts?.get(part);
    if(!box)return null;
    box.getCenter(point).add(deck.group.position);
    return {id,part,material:box.part.material,state:this.active.get(key(id,part))?.state??'dry',at:rounded(point)};
  }
  isBurning(id,part){return this.active.get(key(id,part))?.state==='burning';}
  nearby(at,radius=10,count=12){
    const found=[];
    for(const deck of this.world.entities.values()){
      const p=deck.group.position;
      if(!deck.parts || deck.obstacleBounds.distanceToPoint(point.subVectors(at,p))>radius)continue;
      for(const [part,box] of deck.parts){
        const distance=box.distanceToPoint(point.subVectors(at,p));
        if(distance<=radius)found.push({id:deck.id,part,distance});
      }
    }
    return found.sort((a,b)=>a.distance-b.distance).slice(0,count).map(x=>this.describe(x.id,x.part));
  }
  error(op,pieces){
    const box=pieces.get(op.id)?.parts?.get(op.part);
    if(!box)return 'No such interactive part. Use the current deck ID and part key.';
    if(!['ignite','wet','dry'].includes(op.action) || op.seconds!==undefined && !(Number.isFinite(op.seconds)&&op.seconds>=1&&op.seconds<=120))return 'Choose ignite, wet or dry and an optional 1–120 seconds.';
    if(op.action==='ignite' && !['wood','cloth'].includes(box.part.material))return 'That material does not burn.';
    return null;
  }
  exposed(id,part){
    const deck=this.world.get(id),box=deck.parts.get(part);
    box.getCenter(point).add(deck.group.position);point.y=box.max.y+deck.group.position.y+.025;
    return !traceSolid(this.world.entities,point,up,120).target;
  }
  change(op,source='edit'){
    const {id,part,action}=op,entryKey=key(id,part),box=this.world.get(id)?.parts?.get(part);
    const previous=this.active.get(entryKey)?.state??'dry';
    const state=action==='ignite'?'burning':action==='wet'?'wet':'dry';
    let reason=null;
    if(!box)return;
    if(state==='burning'){
      if(!['cloth','wood'].includes(box.part.material))reason='not combustible';
      else if(previous==='wet')reason='still wet';
      else if(this.world.level.weather.rain>.15 && this.exposed(id,part))reason='exposed to rain';
    }
    if(state!=='dry' && !this.active.has(entryKey) && this.active.size>=limit)reason='active surface limit';
    if(!reason){
      if(state==='dry')this.active.delete(entryKey);
      else this.active.set(entryKey,{id,part,state,remaining:op.seconds??(state==='wet'?8:20)});
    }
    this.lastChange={id,part,previous,state:reason?previous:state,source,reason};
    if(!reason && state!==previous)this.onChange?.({...this.lastChange,type:'surface',target:id,surface:this.describe(id,part)});
    return this.lastChange;
  }
  forget(id){
    for(const [k,s] of this.active)if(s.id===id)this.active.delete(k);
    if(this.lastChange?.id===id)this.lastChange=null;
  }
  restore(records){
    this.active.clear();this.lastChange=null;
    for(const s of (Array.isArray(records)?records:[]).slice(0,limit)){
      const box=this.world.get(s?.id)?.parts?.get(s?.part);
      if(!box || !['wet','burning'].includes(s.state) || !(s.remaining>0&&s.remaining<=120) ||
        s.state==='burning'&&!['cloth','wood'].includes(box.part.material))continue;
      this.active.set(key(s.id,s.part),{...s});
    }
  }
  step(dt){
    if(!this.active.size)return;
    this.sinceRain+=dt;
    const rainCheck=this.sinceRain>=.45;
    if(rainCheck)this.sinceRain=0;
    for(const s of this.active.values()){
      s.remaining-=dt;
      if(s.remaining<=0)this.change({...s,action:'dry'},'elapsed');
      else if(rainCheck && s.state==='burning' && this.world.level.weather.rain>.15 && this.exposed(s.id,s.part))
        this.change({...s,action:'wet'},'rain');
    }
  }
  draw(time){
    if(!this.active.size){if(this.fx)this.fx.visible=false;return;}
    if(!this.fx){
      this.fx=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshBasicMaterial({toneMapped:false}),limit*12);
      this.fx.name='Active surface effects';this.fx.frustumCulled=false;this.fx.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.world.scene.add(this.fx);this.particle=new T.Object3D();this.color=new T.Color();
    }
    const obj=this.particle,fx=this.fx;
    let n=0;
    for(const s of this.active.values()){
      const deck=this.world.get(s.id),box=deck?.parts?.get(s.part);
      if(!box || !deck.group.visible)continue;
      const fire=s.state==='burning',width=box.max.x-box.min.x,depth=box.max.z-box.min.z;
      const center=box.getCenter(point).add(deck.group.position),top=deck.group.position.y+box.max.y;
      for(let i=0;i<12;i++){
        const t=(time*(fire?1.3:.8)+i*.618)%1, a=i*2.4;
        const smoke=fire && i%4===3;
        obj.position.set(center.x+Math.cos(a)*Math.min(width*.35,.95),top+(fire?.1+t*(smoke?1.4:.54):.07+t*.12),center.z+Math.sin(a)*Math.min(depth*.35,.75));
        const r=fire?(smoke?.09+t*.10:.15*(1-t)+.035):.035;
        obj.scale.set(r,fire?r*(smoke?1:2.6):.025,r);obj.rotation.z=fire?.22*Math.sin(t*6+a):0;
        obj.updateMatrix();fx.setMatrixAt(n,obj.matrix);
        fx.setColorAt(n++,this.color.setHex(fire?(smoke?0x71655c:i%2?0xffa42b:0xff5b17):0x75d5df));
      }
    }
    fx.visible=n>0;fx.count=n;fx.instanceMatrix.needsUpdate=true;
    if(fx.instanceColor)fx.instanceColor.needsUpdate=true;
  }
}

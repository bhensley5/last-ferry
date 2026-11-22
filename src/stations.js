import * as T from 'three';
import { wheelModel,rotor } from './wheels.js';

// Small things that ride on a deck, not separate platforms with another collider.
export function stationModel(spec, deck, world) {
  const root=new T.Group();
  const [u,v]=spec.offset ?? [0,0];
  root.position.set(u*deck.originalSize[0],.015,v*deck.originalSize[1]);
  deck.group.add(root);
  function part(geometry,material,x,y,z){
    const mesh=new T.Mesh(geometry,material);
    mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  function timber(w,h,d,x,y,z,mat=world.darkWood){
    return part(new T.BoxGeometry(w,h,d),mat,x,y,z);
  }
  if(spec.kind==='cargo'){
    timber(.64,.43,.46,0,.23,0,world.wood[0]);
    timber(.68,.07,.49,0,.48,0,world.lacquer);
    for(const x of [-.21,.21])timber(.045,.45,.48,x,.24,0,world.brass);
    timber(.12,.13,.04,0,.38,.25,world.brass);
  }else if(spec.kind==='wheel'){
    timber(.28,1.32,.31,0,.66,-.26);timber(1.15,.13,.71,0,.08,-.26);
    const wheel=wheelModel(world);wheel.position.y=1.12;root.add(wheel);
    const device=rotor('wheel:'+spec.id,wheel);deck.devices.set(device.id,device);
  }else if(spec.kind==='bell'){
    for(const x of [-.43,.43])timber(.085,1.48,.13,x,.74,0);
    timber(1.08,.11,.17,0,1.52,0,world.lacquer);
    const profile=[[.04,.02],[.23,.02],[.24,.06],[.18,.13],[.15,.33],[.11,.40],[.04,.41]];
    part(new T.LatheGeometry(profile.map(([x,y])=>new T.Vector2(x,y)),24),world.brass,0,.92,0);
    timber(.045,.20,.045,0,1.40,0);
    part(new T.SphereGeometry(.064,12,8),world.darkWood,0,.91,0);
    timber(.025,.34,.025,0,.71,0,world.cream);
  }else{
    timber(.65,.09,.54,0,.05,0);
    timber(.49,.70,.38,0,.44,0,world.lacquer);
    part(new T.ConeGeometry(.52,.32,4),world.darkWood,0,.94,0).rotation.y=Math.PI/4;
    part(new T.SphereGeometry(.13,12,8),world.lamp,0,.59,.21);
  }
  root.visible=!spec.taken;
  return root;
}

export function stationError(op,pieces){
  if(typeof op.id!=='string' || !op.id.trim())return 'Name the station.';
  if(op.remove===true)return null;
  if(!pieces.has(op.deck) || !['bell','cargo','shrine','wheel'].includes(op.kind))return 'Choose a deck and station kind: bell, cargo, shrine or wheel.';
  if(op.offset!==undefined && (!Array.isArray(op.offset)||op.offset.length!==2||!op.offset.every(n=>Number.isFinite(n)&&Math.abs(n)<=.45)))return 'Use two deck-relative offsets between -.45 and .45.';
  if(op.kind==='cargo' && (typeof op.item!=='string'||!op.item.trim()||!Number.isInteger(op.count??1)||(op.count??1)<1))return 'Cargo needs an item name and a positive integer count.';
  if(op.label!==undefined && typeof op.label!=='string')return 'A station label must be text.';
}

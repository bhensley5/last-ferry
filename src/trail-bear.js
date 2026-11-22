import * as T from 'three';
import { landing } from './market-solids.js';

// No bear meshes or ground queries until a traveler actually strays from a trail.
function cedarBear(scene) {
  const root=new T.Group(), torso=new T.Group(), legs=[];
  const fur=new T.MeshStandardMaterial({color:0x503529,roughness:.95,flatShading:true});
  const tawny=fur.clone();tawny.color.setHex(0xa37c54);
  const black=fur.clone();black.color.setHex(0x251f1d);
  const geometry=new T.SphereGeometry(1,12,9);
  function part(parent,material,x,y,z,w,h,d){
    const node=new T.Mesh(geometry,material);node.position.set(x,y,z);node.scale.set(w,h,d);
    node.castShadow=true;parent.add(node);return node;
  }
  root.add(torso);scene.add(root);
  part(torso,fur,0,1.04,-.27,.74,.83,1.10);
  part(torso,fur,0,1.36,.39,.86,.88,.86);
  part(torso,fur,0,1.62,1.13,.63,.59,.65);
  part(torso,tawny,0,1.48,1.65,.40,.29,.38);
  part(torso,black,0,1.62,1.94,.24,.13,.13);
  for(const s of [-1,1]){
    part(torso,fur,s*.48,2.11,.97,.23,.24,.16);
    part(torso,tawny,s*.49,2.12,1.09,.135,.14,.07);
    part(torso,black,s*.37,1.77,1.59,.079,.077,.06);
    for(const z of [-.71,.61]){
      const leg=new T.Group();leg.position.set(s*.46,.93,z);root.add(leg);
      part(leg,fur,0,-.33,0,.28,.46,.32);part(leg,black,0,-.69,.12,.27,.18,.36);
      for(let i=-1;i<=1;i++)part(leg,tawny,i*.105,-.74,.40,.025,.036,.088);
      legs.push(leg);
    }
  }
  return {root,scent(time){torso.rotation.x=.08+.09*Math.sin(time*4);torso.position.y=.04*Math.cos(time*3);},run(time){torso.rotation.x=0;const p=time*12;torso.position.y=.10*Math.abs(Math.sin(p));
    legs.forEach((leg,i)=>leg.rotation.x=(i===0||i===3?1:-1)*.64*Math.cos(p));}};
}

export function trailBear(scene,alert,onPhase){
  let phase='safe',elapsed=0,body,ground,bearGround;
  function change(next){
    if(next===phase)return;
    phase=next;alert.hidden=next==='safe';
    alert.textContent=next==='warning'?'A cedar bear has your scent. Get back to a trail.':next==='hunting'?'Cedar bear! Reach a trail before it catches you.':'';
    if(next==='warning'||next==='hunting')onPhase(next);
  }
  function reset(){
    elapsed=0;ground=bearGround=null;
    if(body)body.root.visible=false;
    change('safe');
  }
  function emerge(world,player,yaw){
    body??=cedarBear(scene);
    const pos=body.root.position, p=player.position;
    const origin=ground.group.position, halfX=ground.size[0]/2-.8,halfZ=ground.size[1]/2-.8;
    // Try the visible forest edge first; skip tree trunks and raised roadbeds.
    for(const angle of [.38,-.38,.84,-.84,1.45,-1.45,Math.PI]){
      pos.set(T.MathUtils.clamp(p.x-10*Math.sin(yaw+angle),origin.x-halfX,origin.x+halfX),origin.y,
        T.MathUtils.clamp(p.z-10*Math.cos(yaw+angle),origin.z-halfZ,origin.z+halfZ));
      const top=landing(world.entities,pos,origin.y-.1,origin.y+20);
      if(top?.entity===ground && top.top<origin.y+.25 && Math.hypot(pos.x-p.x,pos.z-p.z)>4)break;
    }
    bearGround=ground;body.root.visible=true;
  }
  function step(dt,world,player,yaw){
    const config=world.level.wilderness;
    if(!config || world.level.traveler.trailWard){if(elapsed)reset();return false;}
    const deck=world.get(player.grounded);
    if(deck && deck.dressing!==config.ground){if(elapsed)reset();return false;}
    if(deck)ground=deck;
    if(!ground)return false; // Airborne from safety is still safe until first contact with wild ground.
    elapsed+=dt;
    if(elapsed<config.warning)return false;
    if(phase==='safe')emerge(world,player,yaw);
    const p=player.position,pos=body.root.position,dx=p.x-pos.x,dz=p.z-pos.z,d=Math.hypot(dx,dz);
    body.root.rotation.y=Math.atan2(dx,dz);
    if(elapsed<config.pursuit){change('warning');body.scent(elapsed);return false;}
    change('hunting');body.run(elapsed);
    const stride=Math.min(d,dt*10.5),x=pos.x+dx*stride/(d||1),z=pos.z+dz*stride/(d||1);
    const contains=e=>Math.abs(x-e.group.position.x)<=e.size[0]/2 && Math.abs(z-e.group.position.z)<=e.size[1]/2;
    if(!contains(bearGround)){
      const next=[...world.entities.values()].find(e=>e.dressing===config.ground && contains(e));
      if(!next)return false; // A bear can't charge through the air over a cut in the valley.
      bearGround=next;
    }
    pos.set(x,T.MathUtils.damp(pos.y,bearGround.group.position.y,8,dt),z);
    if(d<1.48 && p.y>=pos.y-.8 && p.y<pos.y+2.05 && elapsed-config.pursuit>.4){reset();return true;}
    return false;
  }
  return {step,reset,brief:()=>({phase,offTrailSeconds:+elapsed.toFixed(1)})};
}

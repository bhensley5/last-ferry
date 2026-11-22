import * as T from 'three';
import { surface as interactive } from './surfaces.js';
import { canopyGeometry, curvedRoofGeometry } from './art.js';

import { trailStyles, ropework, landmark, forkMarker } from './trail-landmarks.js';

export const landStyles=[...trailStyles,'foothill','pilgrimRoad','stoneSpan','teaTerrace','kilnYard','cedarGrove','mapleGrove','shoreGate','pilgrimGate','hartRing'];
const colorMaterial=color=>new T.MeshStandardMaterial({color,roughness:.94});
const stone=colorMaterial(0x786f60), bark=colorMaterial(0x554033), tile=colorMaterial(0x36484b);
const leaf=new T.MeshStandardMaterial({roughness:.91,flatShading:true,side:T.DoubleSide});
function pigments() {
  const loader=new T.TextureLoader();
  const meadow=loader.load(new URL('./assets/uplands/meadow.webp',import.meta.url).href);
  const road=loader.load(new URL('./assets/uplands/road.webp',import.meta.url).href);
  for(const texture of [meadow,road]){
    texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=8;
  }
  const surface=(map,color)=>new T.MeshStandardMaterial({map,color,roughness:.95});
  return {meadow:surface(meadow,0xc5d1a3),soil:surface(road,0xe2c7a4),paving:surface(road,0xb2b6a8)};
}
function surface(group,width,depth,height,top,x,z,material) {
  const geo=new T.BoxGeometry(width, height, depth), p=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv;
  for(let i=0;i<p.count;i++){
    const u=Math.abs(n.getX(i))>.5?p.getZ(i)+z:p.getX(i)+x;
    const v=Math.abs(n.getY(i))>.5?p.getZ(i)+z:p.getY(i);
    uv.setXY(i,u/3,v/3);
  }
  const block=new T.Mesh(geo,material);block.position.set(x,top-height/2,z);
  block.receiveShadow=true;group.add(block);return block;
}
function cedarSkirt() {
  const pos=[],index=[];
  // Alternating needle fans droop at the outside, lift again toward each branch tip.
  for(let ring=0;ring<4;ring++)for(let i=0;i<32;i++){
    const a=i*Math.PI/16, tip=i%4===0?1:.70+(i%2)*.12;
    const radius=[.06,.58,1,.55][ring]*tip;
    pos.push(Math.sin(a)*radius,[.5,.04,-.22-.20*tip,-.43][ring],Math.cos(a)*radius);
    if(ring){const n=ring*32+i,k=ring*32+(i+1)%32;index.push(n-32,n,k,k,k-32,n-32);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(index);g.computeVertexNormals();return g;
}
function grassTuft(flowers=false){
  const pos=[],colors=[];
  for(let i=0;i<7;i++){
    const a=i*2.4, x=.23*Math.sin(a), z=.23*Math.cos(a),h=.28+.27*(i%3);
    pos.push(x-.055,0,z+.035,x+.06,0,z-.035,x*2.1,h,z*2.1);
    colors.push(.40,.46,.30,.48,.58,.34,.91,.88,.52);
  }
  if(flowers)for(let i=0;i<5;i++){
    const a=i*2.4,x=.2*Math.sin(a),z=.2*Math.cos(a),y=.36+i%3*.1;
    for(let j=0;j<4;j++){
      const u=j*Math.PI/2;
      pos.push(x,y,z,x+.11*Math.sin(u-.65),y+.065,z+.11*Math.cos(u-.65),x+.11*Math.sin(u+.65),y+.065,z+.11*Math.cos(u+.65));
      colors.push(1,.66,.23,1,.91,.61,.92,.64,.36);
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
const grass=new T.MeshStandardMaterial({color:0x789260,vertexColors:true,side:T.DoubleSide,roughness:1});
function groundcover(group,w,d,random){
  const count=Math.min(300,Math.ceil(w*d/10)),mesh=new T.InstancedMesh(grassTuft(group.position.z<5),grass,count);
  const obj=new T.Object3D();
  for(let i=0;i<count;i++){
    obj.position.set((random()-.5)*w,.014,(random()-.5)*d);
    obj.rotation.y=random()*6.28;obj.scale.setScalar(.65+random()*.75);obj.updateMatrix();mesh.setMatrixAt(i,obj.matrix);
  }
  group.add(mesh);
}
function flagstones(group,w,d,top,random,axis=2){
  const along=axis===0?w:d,cross=axis===0?d:w,rows=Math.max(2,Math.ceil(along/1.15));
  const stoneMat=stone;
  const marks=new T.InstancedMesh(new T.CylinderGeometry(1,1,.04,7),stoneMat,rows*3);
  const obj=new T.Object3D();
  for(let i=0;i<rows;i++)for(let j=0;j<3;j++){
    const f=(i+.5)/rows,v=along*(f-.5),u=(j-1)*Math.min(.78,cross*.19)+random()*.12;
    obj.position.set(axis===0?v:u,top(f)+.014,axis===0?u:v);
    obj.rotation.y=random()*.38;obj.scale.set(axis===0?along/rows*.41:.39,1,axis===0?.4:along/rows*.42);obj.updateMatrix();
    const k=i*3+j;marks.setMatrixAt(k,obj.matrix);marks.setColorAt(k,new T.Color().setScalar(.76+random()*.35));
  }
  marks.receiveShadow=true;group.add(marks);
}
function waysidePavilion(group,x,z,world,mesh){
  const post=(w,h,d,mat,px,py,pz)=>mesh(group,new T.BoxGeometry(w,h,d),mat,x+px,py,z+pz);
  post(3.8,.24,2.95,stone,0,.12,0);
  for(const dx of [-1.42,1.42])for(const dz of [-1,1]){
    post(.16,2.55,.16,world.lacquer,dx,1.4,dz);
    post(.43,.22,.43,world.brass,dx,.30,dz);
  }
  post(3.25,.82,.16,world.cream,0,.75,-1);
  post(3.35,.24,2.4,world.lacquer,0,2.68,0);
  for(const s of [-1,1]){
    const panel=post(4.3,.14,1.72,tile,0,3.02,s*.72);interactive(panel,'roof','stone');panel.rotation.x=s*.31;
    post(4.48,.15,.13,world.lacquer,0,2.77,s*1.48);
  }
  post(4.3,.23,.22,tile,0,3.35,0);
  world.lantern(group,x-.93,2.18,z+.63,1.25);
  world.lantern(group,x+.93,2.18,z+.63,1.25);
}


function grove(group,spots){
  if(!spots.length)return;
  const shapes=[new T.CylinderGeometry(.12,.23,1,7),cedarSkirt(),new T.IcosahedronGeometry(1,1)];
  const layers=shapes.map(()=>[]), dummy=new T.Object3D();
  const add=(index,x,y,z,w,h,d,angle,color)=>{
    dummy.position.set(x,y,z);dummy.scale.set(w,h,d);dummy.rotation.set(0,angle,0);dummy.updateMatrix();
    layers[index].push([dummy.matrix.clone(),color]);
  };
  for(const [x,z,h,a,maple] of spots){
    add(0,x,h*.37,z,h*.30,h*.74,h*.30,a,0x644d39);
    if(maple)for(let i=0;i<5;i++){
      const t=a+i*2.4,r=i===4?0:h*.19;
      add(2,x+r*Math.sin(t),h*(.63+i*.055),z+r*Math.cos(t),h*.31,h*.19,h*.27,t,[0xbe6448,0xca8451,0x9c583c,0xd49452,0xe6ad63][i]);
    }else for(let i=0;i<4;i++) {
      const w=h*(.29-i*.046);
      add(1,x,h*(.38+i*.16),z,w,h*(.57-i*.057),w*.91,a+i*.6,[0x344e42,0x436351,0x4e7056,0x607d5c][i]);
    }
  }
  for(const [index,rows] of layers.entries()){
    if(!rows.length){shapes[index].dispose();continue;}
    const m=new T.InstancedMesh(shapes[index],leaf,rows.length);
    rows.forEach(([matrix,color],i)=>{m.setMatrixAt(i,matrix);m.setColorAt(i,new T.Color(color));});
    if(index===0)interactive(m,'tree','wood');
    m.userData.solidInstances=index===0;m.receiveShadow=true;group.add(m);
  }
}

export function landTerrace(group,e,world,mesh) {
  const [w,d]=e.size, type=e.dressing, earth=world.landPigments??=pigments();
  const base=2+Math.max(0,e.at[1]), maxGrade=Math.abs(e.grade||0), steps=Math.max(1,Math.ceil(maxGrade/.185));
  const alongX=e.axis===0, sign=Math.sign(e.grade);
  const field=type==='foothill', road=type==='pilgrimRoad', rope=type==='ropeSpan', span=type==='stoneSpan'||rope;
  const top=rope?world.wood[1]:field?earth.meadow:span||type==='hartRing'?earth.paving:earth.soil;
  for(let i=0;i<steps;i++){
    const f=(i+.5)/steps, y=maxGrade*(sign<0?1-f:f);
    const thick=rope?.23:span?.56:base+y;
    const block=surface(group,alongX?w/steps:w,alongX?d:d/steps,thick,y,alongX?w*(f-.5):0,alongX?0:d*(f-.5),top);
    if(rope)interactive(block,'tread','wood');
    if(type==='lotusStone')interactive(block,'stone','stone');
  }
  const random=(()=>{let seed=Array.from(e.id).reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0)|0,world.level.seed);return ()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);})();
  if(e.trailExits)forkMarker(group,e,world,mesh);
  if(rope){ropework(group,e,world,mesh);return;}
  if(trailStyles.includes(type)){landmark(group,e,world,mesh);return;}
  if(field){
    const trees=[];
    for(let i=0;i<w*d/110;i++){
      const x=(random()-.5)*(w-2),z=(random()-.5)*(d-2),gx=e.at[0]+x,gz=e.at[2]+z;
      if(world.level.entities.some(p=>p.at&&p.size&&p.dressing!=='foothill'&&Math.abs(gx-p.at[0])<p.size[0]/2+2.2&&Math.abs(gz-p.at[2])<p.size[1]/2+2.2))continue;
      trees.push([x,z,2.9+random()*5.6,random()*6.28,random()<(gz< -83?.41:.15)]);
    }
    grove(group,trees);groundcover(group,w,d,random);return;
  }
  if(e.grade!==undefined || type==='shoreGate'||type==='pilgrimGate'||type==='hartRing'){
    const height=f=>maxGrade*(sign<0?1-(Math.floor(f*steps)+.5)/steps:(Math.floor(f*steps)+.5)/steps);
    flagstones(group,w,d,height,random,e.axis??2);
  }
  if(road || span){
    if(span)for(const side of [-1,1]){
      const extent=alongX?w:d;
      for(let i=0;i<Math.max(2,Math.ceil(extent/6));i++){
        const f=i/(Math.max(2,Math.ceil(extent/6))-1),x=alongX?(f-.5)*(w-.5):side*(w/2-.25),z=alongX?side*(d/2-.25):(f-.5)*(d-.5);
        mesh(group,new T.CylinderGeometry(.13,.22,.84,6),stone,x,.35+maxGrade*(sign<0?1-f:f),z);
      }
    }
    return;
  }
  const side=w*.38, back=-d*.34;
  if(type==='shoreGate'){
    waysidePavilion(group,-side,-back,world,mesh);
    for(const s of [-1,1])for(let i=0;i<3;i++){
      const stonework=mesh(group,new T.DodecahedronGeometry(1,0),stone,s*(w*.48),-.32,back+i*2.5);
      stonework.scale.set(1.1,.57,1.4);
    }
  }
  if(type==='cedarGrove'||type==='mapleGrove'){
    grove(group,[[-side,back,5,.3,type==='mapleGrove'],[side,-back,4.5,2.7,type==='mapleGrove']]);
  }else if(type==='teaTerrace'){
    waysidePavilion(group,side,back,world,mesh);
    const shade=mesh(group,canopyGeometry(2.4,2.1),world.fabric,-side,2.05,back);
    interactive(shade,'awning','cloth');
    for(const dx of [-1.09,1.09])for(const dz of [-.93,.93])mesh(group,new T.CylinderGeometry(.045,.06,2.12,7),bark,-side+dx,1.03,back+dz);
    for(const s of [-1,1])for(let i=0;i<5;i++){
      if(s===1 && i<3)continue;
      const shrub=mesh(group,new T.IcosahedronGeometry(1,1),world.teaLeaf??=colorMaterial(0x617e43),s*side,.38,back+i*.9);
      shrub.scale.set(.72,.54,.72);
    }
  }else if(type==='kilnYard'){
    for(const s of [-1,1]){
      const x=side*s, z=back*s;
      const kiln=mesh(group,new T.SphereGeometry(1,16,9,0,Math.PI*2,0,Math.PI/2),world.lacquer,x,0,z);interactive(kiln,'kiln','stone');kiln.scale.set(1.6,1.8,1.45);
      mesh(group,new T.CylinderGeometry(.36,.56,2.8,10),stone,x,.99,z-.4);
      mesh(group,new T.BoxGeometry(.72,.62,.11),world.darkWood,x,.31,z+1.34);
      mesh(group,new T.BoxGeometry(.54,.22,.12),world.lamp,x,.17,z+1.36);
    }
  }else{
    // Frame the walking line with a roofed gate, leaving its center physically open.
    const z=back, frame=Math.min(3.6,w*.32);
    for(const s of [-1,1]){
      mesh(group,new T.CylinderGeometry(.15,.23,3.9,10),world.lacquer,s*frame,1.94,z);
      mesh(group,new T.BoxGeometry(.65,.3,.65),stone,s*frame,.15,z);
      world.lantern(group,s*(frame-.33),3.05,z,1.45);
    }
    mesh(group,new T.BoxGeometry(frame*2+.8,.23,.34),world.lacquer,0,3.43,z);
    mesh(group,curvedRoofGeometry(frame*2+1.5,1.65),tile,0,3.85,z);
    for(const s of [-1,1]){
      const tip=mesh(group,new T.BoxGeometry(1.22,.19,.48),world.lacquer,s*frame,3.77,z);tip.rotation.z=s*.17;
    }
    mesh(group,new T.BoxGeometry(.54,.71,.13),world.darkWood,0,3.64,z+.18);
    mesh(group,new T.OctahedronGeometry(.13),world.brass,0,3.67,z+.27);
    for(let i=-2;i<=2;i++){
      const streamer=mesh(group,new T.ConeGeometry(.16,.53,3),i%2?world.cream:world.lacquer,i*.55,2.98+Math.abs(i)*.04,z+.13);
      streamer.scale.z=.14;streamer.rotation.z=.13;
    }
    if(type==='hartRing'){
      const ring=mesh(group,new T.RingGeometry(4.8,4.91,64),world.brass,0,.018,0);ring.rotation.x=-Math.PI/2;
      grove(group,[[-side,-back,6,.8,true],[side,-back,5.8,2.3,true]]);
    }
  }
  if(!['shoreGate','pilgrimGate','hartRing'].includes(type)){
    mesh(group,new T.BoxGeometry(.17,1.52,.17),bark,-side,.76,-back);
    world.lantern(group,-side,1.75,-back,1);
  }
}

// A continuous ridgeline beyond the playable terraces; no individual mountain draw calls.
export function mountainRim(scene){
  const positions=[],colors=[],indices=[];
  for(let r=0;r<5;r++)for(let i=0;i<=180;i++){
    const a=i*Math.PI/90, t=1+r*.21;
    const crag=.5+.20*Math.sin(a*9)+.16*Math.sin(a*17+.8)+.1*Math.cos(a*31);
    const y=[-30,14,43+crag*44,31+crag*32,5][r];
    positions.push(Math.sin(a)*190*t,y,-78+Math.cos(a)*224*t);
    const col=new T.Color([0x526b57,0x647658,0x929078,0x8a917e,0xa09b87][r]).multiplyScalar(.92+.12*crag);
    colors.push(col.r,col.g,col.b);
    if(r&&i){const k=r*181+i;indices.push(k-182,k-1,k,k-182,k,k-181);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  scene.add(new T.Mesh(g,new T.MeshStandardMaterial({vertexColors:true,flatShading:true,side:T.DoubleSide})));
}

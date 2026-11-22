// Each landmark is built once with the deck, then batched by material with its scenery.
import * as T from 'three';
import { surface } from './surfaces.js';
import { curvedRoofGeometry } from './art.js';

const colors = [0xa84c32,0x438c83,0xeecb83,0x807098,0x485755].map(color=>new T.MeshStandardMaterial({color,roughness:.82}));
const [cinnabar,jade,gold,violet,slate]=colors;
export const trailStyles=['ropeSpan','lotusStone','carpPort','steamCourt','moonCourt','bellTower'];

function cord(group,points,radius,material,mesh){
  const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
  return mesh(group,new T.TubeGeometry(curve,Math.max(8,points.length*3),radius,5,false),material);
}
function oval(group,mesh,material,x,y,z,sx,sy,sz){
  const body=mesh(group,new T.SphereGeometry(1,14,9),material,x,y,z);
  body.scale.set(sx,sy,sz);return body;
}
const markerPaint=new T.MeshStandardMaterial({vertexColors:true,roughness:.85});
export function forkMarker(group,e,world,mesh){
  if(!Array.isArray(e.trailExits))return;
  const x=-e.size[0]*.27,z=-e.size[1]*.27;
  mesh(group,new T.CylinderGeometry(.115,.17,3.25,7),world.darkWood,x,1.62,z);
  mesh(group,new T.SphereGeometry(.23,10,7),world.brass,x,3.34,z);
  e.trailExits.slice(0,4).forEach(({bearing,color},i)=>{
    if(!Number.isFinite(bearing))return;
    const arrow=new T.Shape();arrow.moveTo(-.48,-.13);arrow.lineTo(.72,-.13);
    arrow.lineTo(.72,-.29);arrow.lineTo(1.15,0);arrow.lineTo(.72,.29);
    arrow.lineTo(.72,.13);arrow.lineTo(-.48,.13);arrow.closePath();
    const cut=new T.ExtrudeGeometry(arrow,{depth:.09,bevelEnabled:false});
    const tint=new T.Color(/^#[0-9a-f]{6}$/i.test(color)?color:'#d5ad69'), rgb=[];
    for(let j=0;j<cut.attributes.position.count;j++)rgb.push(tint.r,tint.g,tint.b);
    cut.setAttribute('color',new T.Float32BufferAttribute(rgb,3));
    mesh(group,cut,markerPaint,x,2.87-i*.57,z).rotation.y=bearing-Math.PI/2;
  });
}
export function ropework(group,e,world,mesh){
  const alongX=e.axis===undefined?e.size[0]>e.size[1]:e.axis===0, length=e.size[alongX?0:1], width=e.size[alongX?1:0];
  const rise=e.grade||0, height=f=>Math.abs(rise)*(rise<0?1-f:f);
  const at=(f,s,h)=>alongX?[(f-.5)*length,height(f)+h,s]:[s,height(f)+h,(f-.5)*length];
  const n=Math.max(1,Math.ceil(length/7));
  for(const side of [-1,1]){
    const s=side*(width/2-.09), knots=[];
    for(let i=0;i<=n;i++){
      const f=i/n;
      mesh(group,new T.CylinderGeometry(.085,.13,1.46,7),world.darkWood,...at(f,s,.61));
      mesh(group,new T.CylinderGeometry(.125,.125,.12,8),gold,...at(f,s,1.12));
      knots.push(at(f,s,1.23));
      if(i<n){
        const mid=(i+.5)/n;knots.push(at(mid,s,.82));
        const pennant=mesh(group,new T.ConeGeometry(.26,.62,3),[jade,gold,cinnabar][i%3],...at(mid,s,.54));
        pennant.rotation.z=Math.PI; pennant.scale[alongX?'z':'x']=.15;
      }
    }
    cord(group,knots,.045,world.darkWood,mesh);
  }
  const count=Math.ceil(length/.55), stamp=new T.InstancedMesh(new T.BoxGeometry(alongX?.04:width,.024,alongX?width:.04),world.darkWood,count);
  for(let i=0;i<count;i++)stamp.setMatrixAt(i,new T.Matrix4().makeTranslation(...at((i+.5)/count,0,.014)));
  group.add(stamp);
}
export function landmark(group,e,world,mesh){
  const [w,d]=e.size, type=e.dressing, x=w*.34,z=-d*.3;
  const box=(w,h,d,m,a,b,c)=>mesh(group,new T.BoxGeometry(w,h,d),m,a,b,c);
  const pole=(a,c,h)=>mesh(group,new T.CylinderGeometry(.10,.15,h,9),world.lacquer,a,h/2,c);
  if(type==='lotusStone'){
    const r=Math.min(w,d)*.33, petal=new T.InstancedMesh(new T.SphereGeometry(1,8,5),jade,8), obj=new T.Object3D();
    for(let i=0;i<8;i++){const a=i*Math.PI/4;obj.position.set(Math.sin(a)*r*.5,.02,Math.cos(a)*r*.5);
      obj.rotation.y=a;obj.scale.set(r*.2,.035,r*.49);obj.updateMatrix();petal.setMatrixAt(i,obj.matrix);}
    group.add(petal);return;
  }
  if(type==='carpPort'){
    for(let i=0;i<2;i++){
      const px=i?x:-x, pz=i?z:-z, h=i?5.7:4.25;
      pole(px,pz,h);oval(group,mesh,gold,px,h,pz,.23,.26,.23);
      for(let j=0;j<2;j++){
        const y=h-.6-j*.98,dir=i?-1:1, tint=j?jade:cinnabar;
        const body=oval(group,mesh,tint,px+dir*1.05,y,pz,.86,.32,.28);
        surface(body,'windsock','cloth');
        const cuff=mesh(group,new T.TorusGeometry(.265,.047,6,16),gold,px+dir*.39,y,pz);cuff.rotation.y=Math.PI/2;
        for(const s of [-1,1]){
          oval(group,mesh,world.cream,px+dir*.68,y+.07,pz+s*.238,.12,.13,.05);
          oval(group,mesh,slate,px+dir*.65,y+.07,pz+s*.278,.06,.07,.031);
          const tail=oval(group,mesh,tint,px+dir*1.93,y+s*.18,pz,.43,.14,.085);tail.rotation.z=s*.55*dir;
        }
        cord(group,[[px,y+.13,pz],[px+dir*.2,y+.03,pz],[px+dir*.4,y+.11,pz]],.028,gold,mesh);
      }
    }
  }else if(type==='steamCourt'){
    const pot=oval(group,mesh,jade,x,1.52,z,1.72,1.27,1.35);surface(pot,'kettle','metal');
    mesh(group,new T.CylinderGeometry(.77,1.12,.27,20),gold,x,2.64,z);
    oval(group,mesh,cinnabar,x,2.95,z,.24,.25,.24);
    cord(group,[[x+1.1,2.25,z],[x+2.12,2.55,z],[x+2.29,1.42,z],[x+1.3,1.07,z]],.18,world.brass,mesh);
    cord(group,[[x-1.2,1.15,z],[x-1.82,1.77,z],[x-2.22,2.52,z],[x-2.66,2.77,z]],.24,jade,mesh);
    for(let i=0;i<2;i++)cord(group,[[x-2.55+i*.3,2.98,z],[x-2.77+i*.39,3.66,z],[x-2.26+i*.31,4.18,z],[x-2.44+i*.32,4.83,z]],.045,world.cream,mesh);
    for(const side of [-1,1])world.lantern(group,x+side, .52,z+1.15,1.2);
  }else if(type==='moonCourt'){
    box(3.7,.42,1.4,slate,x,.21,z);
    for(const [r,tilt,mat] of [[2.18,0,gold],[1.73,.78,violet],[1.33,-.74,jade]]){
      const rim=mesh(group,new T.TorusGeometry(r,.09,8,44),mat,x,2.51,z);
      rim.rotation.y=tilt;
    }
    oval(group,mesh,world.lamp,x,2.53,z,.48,.48,.48);
    for(const s of [-1,1]){pole(x+s*1.54,z,2);world.lantern(group,x+s*1.54,2.16,z,.8);}
  }else if(type==='bellTower'){
    for(const a of [-1.43,1.43])for(const c of [-.91,.91])pole(x+a,z+c,5);
    mesh(group,curvedRoofGeometry(4.5,3.1),slate,x,5,z);
    mesh(group,curvedRoofGeometry(3.3,2.4),jade,x,5.7,z);
    const bell=mesh(group,new T.LatheGeometry([[.08,1.3],[.48,1.13],[.7,.85],[.82,-.5],[1,-.88],[1.04,-.99]].map(([a,b])=>new T.Vector2(a,b)),24),world.brass,x,2.9,z);
    surface(bell,'bell','metal');
    oval(group,mesh,cinnabar,x,1.8,z,.22,.29,.22);
    for(const s of [-1,1])world.lantern(group,x+s*1.4,4.35,z+1.05,1.3);
  }
}

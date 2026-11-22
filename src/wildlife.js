import * as T from 'three';

const chalk=0xe4dfcb, slate=0x53606b, ink=0x253a43, amber=0xc39146;
const tissue=new T.SphereGeometry(1,12,8);
function foil(points) {
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(points,3));
  geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();
  return geo;
}
const innerWing=foil([0,0,-.10, .54,.025,-.18, .58,.025,.08, 0,0,.13]);
const pinion=foil([0,0,-.17, .58,-.02,-.37, .34,-.015,-.06, 0,0,.08]);
const fin=foil([0,0,-.18, 0,.29,-.13, 0,.16,.07, 0,0,.19]);
const fluke=foil([-.30,0,-.15, 0,.03,.06, .30,0,-.15, 0,0,-.06]);

// Animate articulated silhouettes, then submit one instanced draw per shape.
export function wildlife(scene, world, marine=true) {
  const root=new T.Group(), batches=new Map(), birds=[], swimmers=[];
  root.name='Wildlife';
  const joint=(parent,x,y,z)=>{
    const node=new T.Object3D();node.position.set(x,y,z);parent.add(node);return node;
  };
  function part(parent,shape,color,x,y,z,w,h,d){
    const node=joint(parent,x,y,z);node.scale.set(w,h,d);
    if(!batches.has(shape))batches.set(shape,[]);
    batches.get(shape).push({node,color});
    return node;
  }
  for(let i=0;i<12;i++){
    const bird=joint(root,0,0,0), wings=[];
    part(bird,tissue,chalk,0,0,0,.12,.12,.33);
    part(bird,tissue,chalk,0,.06,.27,.09,.10,.13);
    part(bird,tissue,amber,0,.055,.40,.038,.035,.10);
    part(bird,fluke,slate,0,0,-.29,.77,1,1.5);
    for(const side of [-1,1]){
      const shoulder=joint(bird,side*.08,.04,0);shoulder.scale.x=side;
      part(shoulder,innerWing,chalk,0,0,0,1,1,1);
      const wrist=joint(shoulder,.55,.02,0);
      part(wrist,pinion,slate,0,0,0,1,1,1);
      wings.push({shoulder,wrist,side});
    }
    birds.push({bird,wings,phase:Math.random()*6, speed:.087+Math.random()*.028});
  }
  const waters=[[4,-7],[-20,-15],[-41,-52],[-60,-110],[-111,-150],[-40,-180],[22,-79]];
  if(marine)waters.forEach(([x,z],i)=>{
    const dolphin=i%3===1;
    for(let k=0;k<(dolphin?2:4);k++){
      const body=joint(root,0,0,0), tail=joint(body,0,0,-.42);
      body.scale.setScalar(dolphin?1.35:.64);
      part(body,tissue,dolphin?0x667f87:0x809b85,0,0,0,.17,.20,.55);
      part(body,tissue,dolphin?0xb8c8c2:0xdcc8a1,0,-.085,.02,.145,.12,.45);
      part(body,fin,slate,0,.14,-.13,1,1,1);
      if(dolphin)part(body,tissue,slate,0,-.02,.50,.088,.075,.22);
      part(tail,tissue,slate,0,0,-.13,.09,.10,.25);
      const blade=part(tail,fluke,dolphin?slate:amber,0,0,-.33,1,1,1.2);
      if(!dolphin)blade.rotation.z=Math.PI/2;
      swimmers.push({body,tail,x:x+k*.6,z:z+k*.47,phase:i*1.84+k*.33+Math.random()*.25,dolphin});
    }
  });
  const material=new T.MeshStandardMaterial({side:T.DoubleSide,roughness:.68});
  const meshes=[];
  for(const [shape,parts] of batches){
    const mesh=new T.InstancedMesh(shape,material,parts.length);
    mesh.name='Wildlife · '+(shape===tissue?'bodies':'fins and feathers');
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;
    parts.forEach(({color},i)=>mesh.setColorAt(i,new T.Color(color)));
    scene.add(mesh);meshes.push({mesh,parts});
  }
  const hidden=new T.Matrix4().makeScale(0,0,0);
  const flightSites=world.level.entities.filter(e=>e.dressing && !['foothill','pilgrimRoad','stoneSpan'].includes(e.dressing) && e.at);
  return (time)=>{
    birds.forEach(({bird,wings,phase,speed},i)=>{
      const a=time*speed+phase, x= Math.sin(a)*17, z=Math.cos(a)*9;
      bird.position.set((i%3===0?-48:i%3===1?1:-63)+x,8+(i%4)*1.1+Math.sin(a*2)*.85, -15-(i%3)*48+z);
      if(!marine && flightSites.length){
        const perch=flightSites[Math.floor(i*flightSites.length/birds.length)].at;
        bird.position.set(perch[0]+x,perch[1]+8+Math.sin(a*2)*1.4,perch[2]+z);
      }
      bird.rotation.set(-.09*Math.cos(a*2),Math.atan2(17*Math.cos(a),-9*Math.sin(a)),.19+.12*Math.sin(a),'YXZ');
      const flap=T.MathUtils.smoothstep(Math.sin(time*.9+phase),-.3,.65);
      for(const {shoulder,wrist,side} of wings){
        shoulder.rotation.z=side*(.12+flap*.51*Math.sin(time*6.5+phase));
        wrist.rotation.z=-.13+flap*.42*Math.sin(time*6.5+phase-.9);
      }
    });
    for(const s of swimmers){
      const a=time*(s.dolphin?.42:.65)+s.phase, angle=a*.52;
      const x=s.x+Math.sin(angle)*2.7,z=s.z+Math.cos(angle)*1.65;
      const crest=Math.sin(a);
      s.body.position.set(x,world.seaAt(x,z)-.46+(s.dolphin?.93:.84)*crest,z);
      s.body.visible=crest>-.1 && !world.supportAt(x,z,-.3);
      s.body.rotation.set(-.64*Math.cos(a),Math.atan2(2.7*Math.cos(angle),-1.65*Math.sin(angle)),.12*Math.sin(a),'YXZ');
      s.tail.rotation[s.dolphin?'x':'y']=.43*Math.sin(time*5+s.phase);
    }
    root.updateMatrixWorld(true);
    for(const {mesh,parts} of meshes){
      parts.forEach(({node},i)=>{
        const visible=node.parent.visible && node.parent.parent?.visible!==false;
        mesh.setMatrixAt(i,visible?node.matrixWorld:hidden);
      });
      mesh.instanceMatrix.needsUpdate=true;
    }
  };
}

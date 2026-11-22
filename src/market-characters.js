import { addPart } from './actor-parts.js';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const fabric=(color,roughness=.88,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
const oilskin=fabric(0xbd7334,.6), wool=fabric(0x263c44), trouser=fabric(0x39484a);
const hide=fabric(0x543c30,.71), boot=fabric(0x252928,.65), ochre=fabric(0xe0b574,.75);
const copper=fabric(0x986743,.44,.57), bronze=fabric(0xb39154,.38,.55), patina=fabric(0x426d68,.64,.28);
const canvas=fabric(0x626351), linen=fabric(0xc4b59c), skin=fabric(0xb58166), hair=fabric(0x483b35);
const shell=fabric(0x754932,.54), shellEdge=fabric(0xa56642,.50);
const lens=new T.MeshStandardMaterial({color:0x324e4d,roughness:.2,metalness:.32,emissive:0x194a48,emissiveIntensity:.33});

// Tile material detail in physical space so a helmet and its fittings share the
// same grain instead of each stretching one texture over the whole mesh.
function wearTile(metal) {
  const size=128, bytes=new Uint8Array(size*size*4);
  let seed=3459;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const u=x*2*Math.PI/size,v=y*2*Math.PI/size;
    const patches=(Math.sin(3*u+2*Math.sin(v))+.6*Math.sin(5*v-u)+.36*Math.sin(11*u+5*v))/1.96;
    const grain=(seed/4294967296-.5)*.1;
    const weave=metal ? 0 : Math.cos(x*Math.PI/2)*Math.cos(y*Math.PI/4)*.058;
    const tarnish=metal ? Math.max(0,patches-.18)*.56 : 0;
    const value=.87+.10*patches+grain+weave,i=(y*size+x)*4;
    bytes[i]=255*Math.min(1,value-tarnish);
    bytes[i+1]=255*Math.min(1,value-.01+tarnish*.17);
    bytes[i+2]=255*Math.min(1,value-.02+tarnish*.29);
    bytes[i+3]=255;
  }
  const texture=new T.DataTexture(bytes,size,size);
  texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;
  texture.magFilter=T.LinearFilter;texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}
const canvasGrain=wearTile(false),copperGrain=wearTile(true);
for(const mat of [oilskin,wool,trouser,canvas,boot,hide,ochre,copper,bronze,shell,shellEdge,patina]){
  mat.map=[copper,bronze,patina,shell,shellEdge].includes(mat) ? copperGrain : canvasGrain;
}
function surfaceUV(geometry) {
  const pos=geometry.attributes.position,n=geometry.attributes.normal,uv=[];
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));
    if(ay>ax && ay>az)uv.push(x*2.5,z*2.5);
    else uv.push((ax>az ? z : x)*2.5,y*2.5);
  }
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
}
function group(parent,x=0,y=0,z=0){
  const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g;
}
function part(parent,geometry,material,x=0,y=0,z=0){
  if(material.map && !geometry.attributes.uv) surfaceUV(geometry);
  const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;
}
function oval(g,m,x,y,z,w,h,d){
  const o=part(g,new T.SphereGeometry(1,16,12),m,x,y,z);o.scale.set(w,h,d);return o;
}
function cuff(g,m,x,y,z,top,base,h,depth=1){
  const o=part(g,new T.CylinderGeometry(top,base,h,16),m,x,y,z);o.scale.z=depth;return o;
}
function line(g,m,a,b,r1,r2=r1){
  const start=new T.Vector3(...a),end=new T.Vector3(...b),d=end.clone().sub(start);
  const o=part(g,new T.CylinderGeometry(r2,r1,d.length(),9),m);
  o.position.copy(start).lerp(end,.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;
}
function ring(g,m,x,y,z,r,width){
  return part(g,new T.TorusGeometry(r,width,6,24),m,x,y,z);
}
// Closed elliptical sections provide an actual shoulder line, waist, jaw and fabric hem.
function tailored(g,m,rows){
  const points=[],indices=[],sides=20;
  for(const [y,w,d,z=0] of rows)for(let j=0;j<sides;j++){
    const a=j/sides*Math.PI*2;points.push(w*Math.sin(a),y,z+d*Math.cos(a));
  }
  for(let i=1;i<rows.length;i++)for(let j=0;j<sides;j++){
    const a=(i-1)*sides+j,b=(i-1)*sides+(j+1)%sides;
    indices.push(a,b,a+sides,b,b+sides,a+sides);
  }
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3));geo.setIndex(indices);geo.computeVertexNormals();return part(g,geo,m);
}
// Keep articulated branches, but batch the rivets, seams, and static equipment per joint.
function bake(g){
  for(const child of [...g.children])if(child.isGroup)bake(child);
  const batches=new Map();
  for(const o of g.children)if(o.isMesh){
    if(!batches.has(o.material))batches.set(o.material,[]);
    batches.get(o.material).push(o);
  }
  for(const [material,nodes] of batches){
    if(nodes.length<2)continue;
    const geos=nodes.map(o=>{
      o.updateMatrix();const geom=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
      geom.applyMatrix4(o.matrix);
      if(material.map) surfaceUV(geom); else geom.deleteAttribute('uv');
      return geom;
    });
    const geom=mergeGeometries(geos);part(g,geom,material);
    nodes.forEach(o=>{o.removeFromParent();o.geometry.dispose();});geos.forEach(o=>o.dispose());
  }
}
function leg(g,side,heavy=false){
  const hip=group(g,side*.115,.81,0),knee=group(hip,0,-.34,.02);
  line(hip,heavy?canvas:trouser,[0,.025,0],[0,-.33,.02],.109,.081);
  oval(knee,heavy?patina:trouser,0,0,.014,.086,.085,.09);
  cuff(knee,boot,0,-.18,-.012,.088,.067,.31);
  cuff(knee,hide,0,-.067,-.012,.09,.087,.038);
  oval(knee,boot,0,-.375,.054,.088,.072,.164);
  oval(knee,heavy?bronze:boot,0,-.418,.053,.091,.027,.165);
  return {hip,knee};
}
function arm(g,side,coat){
  const shoulder=group(g,side*.228,1.275,0),elbow=group(shoulder,side*.035,-.244,.018);
  oval(shoulder,coat,0,0,0,.105,.115,.112);
  line(shoulder,coat,[0,-.01,0],[side*.035,-.24,.018],.095,.071);
  line(elbow,coat,[0,.025,0],[0,-.226,.035],.077,.064);
  cuff(elbow,hide,0,-.203,.032,.07,.065,.065);
  oval(elbow,boot,0,-.258,.054,.063,.09,.058);
  return {shoulder,elbow};
}
function strap(g,x1,y1,z1,x2,y2,z2,mat=hide){
  const m=part(g,new T.BoxGeometry(.059,Math.hypot(x2-x1,y2-y1,z2-z1),.022),mat,(x1+x2)/2,(y1+y2)/2,(z1+z2)/2);
  m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(x2-x1,y2-y1,z2-z1).normalize());
}
export function pumpTool(parent){
  const pump=group(parent,.29,.90,.28);
  // A brass harbor wash-pump with a jade reservoir and bound wooden grip.
  line(pump,copper,[0,0,-.19],[0,0,.32],.082,.065);
  line(pump,bronze,[0,0,.30],[0,0,.42],.078,.05);
  line(pump,hide,[0,-.14,-.09],[0,0,-.12],.04);
  oval(pump,patina,0,.085,-.08,.10,.12,.17);
  ring(pump,bronze,0,0,.42,.05,.012);
  bake(pump);pump.visible=false;
  return pump;
}
export function harborHand(parent){
  const body=group(parent);body.scale.setScalar(.93);
  const coat=oilskin.clone();
  coat.color.setHex(0x9f612b);
  tailored(body,coat,[[.59,.197,.15],[.62,.226,.16],[.86,.187,.138],[1.02,.17,.132],[1.19,.219,.151],[1.29,.235,.133],[1.35,.125,.106]]);
  tailored(body,oilskin,[[1.14,.223,.161],[1.19,.257,.167],[1.29,.252,.146],[1.37,.135,.114]]);
  cuff(body,hide,0,.932,0,.188,.193,.079,.77);
  part(body,new T.BoxGeometry(.076,.063,.031),bronze,0,.934,.144);
  cuff(body,wool,0,1.375,.009,.114,.142,.107);
  const head=group(body,0,1.39,.014);
  tailored(head,skin,[[.013,.062,.071,.024],[.04,.088,.095,.021],[.11,.112,.105,.017],[.19,.121,.109],[.255,.103,.098],[.284,.065,.07]]);
  oval(head,hair,0,.083,-.044,.118,.108,.084);
  for(const side of [-1,1]){
    oval(head,skin,side*.11,.137,0,.024,.041,.026);
    oval(head,hair,side*.049,.173,.108,.036,.009,.008);
    oval(head,boot,side*.049,.154,.111,.012,.008,.005);
  }
  oval(head,skin,0,.125,.122,.023,.036,.022);
  oval(head,hair,0,.082,.113,.053,.012,.008);
  // Shallow woven cone, bound brim, radial bamboo ribs and a chin cord.
  const strawHat=group(head,0,.226,-.018);
  strawHat.rotation.x=-.095;
  const brim=.414, crown=.24;
  part(strawHat,new T.ConeGeometry(brim,crown,48),ochre,0,crown/2,0);
  for(const radius of [brim,.31,.20,.10]){
    const binding=ring(strawHat,radius===brim ? hide : ochre,0,crown*(1-radius/brim),0,radius,.006);
    binding.rotation.x=Math.PI/2;
  }
  for(let i=0;i<18;i++){
    const angle=i*2*Math.PI/18;
    line(strawHat,ochre,[0,crown,0],[Math.cos(angle)*brim,0,Math.sin(angle)*brim],.003,.005);
  }
  for(const side of [-1,1]) line(head,hide,[side*.162,.22,.022],[side*.024,.023,.075],.009);
  // Front placket, brass press studs and pocket flaps sit proud of the oilskin.
  line(body,hide,[.008,.62,.166],[.008,1.31,.153],.009);
  for (const y of [.73,.86,1.06,1.22]) oval(body,bronze,.01,y,.17,.014,.014,.009);
  for (const side of [-1,1]) {
    const flap=part(body,new T.BoxGeometry(.096,.045,.018),hide,side*.126,.861,.119);
    flap.rotation.y=side*.51;
  }
  strap(body,-.149,1.32,.152,.13,.82,.156);
  strap(body,-.165,1.32,-.113,.143,.84,-.144);
  const pack=group(body,.038,.98,-.147);
  oval(pack,hide,0,0,-.045,.162,.147,.079);
  oval(pack,oilskin,0,.087,-.077,.161,.074,.066);
  for(const x of [-.079,.079]){
    part(pack,new T.BoxGeometry(.025,.174,.019),boot,x,-.009,-.116);
    part(pack,new T.BoxGeometry(.033,.036,.024),bronze,x,-.028,-.127);
  }
  for(let i=0;i<4;i++) ring(body,ochre,-.191+i*.01,.84,-.056,.095,.012).rotation.y=1.05;
  const left=leg(body,-1),right=leg(body,1),la=arm(body,-1,coat),ra=arm(body,1,coat);
  ra.elbow.rotation.x=-.65;la.elbow.rotation.x=-.20;
  const oar=group(ra.elbow,0,-.263,.056);
  line(oar,hide,[0,-.48,0],[0,.81,0],.027,.034);
  const blade=group(oar,0,.75,0);
  tailored(blade,oilskin,[[0,.037,.026],[.12,.085,.031],[.43,.113,.028],[.55,.075,.017],[.59,.026,.013]]);
  cuff(oar,bronze,0,.63,0,.035,.035,.05);
  const tail=group(body,-.103,1.26,-.13);
  part(tail,new T.BoxGeometry(.07,.25,.022),wool,0,-.1,0);
  bake(body);
  let stride=0, gait=0, breath=0, crouch=0, lastFall=0, visualHeading=null;
  return {coat,oar,animate(dt,speed,onGround,swing,health,combo,vy=0,heading=0){
    gait=T.MathUtils.damp(gait,Math.min(1,speed/5),11,dt);
    if(onGround && lastFall < -1.8)crouch=Math.min(.16,-lastFall*.014);
    crouch=T.MathUtils.damp(crouch,0,12,dt);lastFall=onGround?0:vy;
    stride+=dt*speed*2.6;breath+=dt*2.2;
    visualHeading??=heading;
    const turn=Math.atan2(Math.sin(heading-visualHeading),Math.cos(heading-visualHeading));
    visualHeading+=turn*(1-Math.exp(-14*dt));
    const cycle=Math.sin(stride),s=cycle*gait, rise=onGround?1:0;
    const idle=Math.sin(breath)*.012*(1-gait);
    body.position.set(s*.026*rise, idle-crouch+Math.abs(Math.cos(stride))*gait*.034*rise,0);
    body.rotation.x=.065*gait+.42*crouch;body.rotation.z=.037*s*rise;
    body.rotation.y=visualHeading-heading+.08*s+swing*(combo===2 ? -.52 : combo===3 ? .82 : .26);
    head.rotation.z=-body.rotation.z*.72;head.rotation.y=.08*Math.sin(breath*.52)*(1-gait);
    const tuck=T.MathUtils.clamp(vy/8,-1,1);
    left.hip.rotation.x=onGround?s*.67-crouch:-.34-.27*tuck;
    right.hip.rotation.x=onGround?-s*.67-crouch:.14-.17*tuck;
    left.knee.rotation.x=onGround?.10+Math.max(0,-s)*.91+crouch*2:.55+.21*tuck;
    right.knee.rotation.x=onGround?.10+Math.max(0,s)*.91+crouch*2:.72-.25*tuck;
    la.shoulder.rotation.x=-.12-s*.46+idle;
    ra.shoulder.rotation.x=-.25+s*.27-swing*.91;
    ra.shoulder.rotation.y=swing*1.15;
    oar.rotation.set(.25,-.22+swing*(combo===2 ? -1.4 : 1.6),-.48-swing*.85);
    tail.rotation.x=-.12+.2*s;coat.emissive.setHex(health?0x462218:0x000000);
  }};
}

function uplandActor(root,spec,light){
  const bird=spec.skin==='silk-kestrel',hart=spec.skin==='ember-hart', keeper=spec.skin==='gate-ram';
  const rig=group(root),limbs=[],phase=spec.id.length*.41;
  const body=group(rig,0,bird?0:hart?.62:.10,0);
  const size=hart?1.7:keeper?1.32:1;
  if(keeper){body.position.y=.22;
    for(const s of [-1,1]){line(body,bronze,[s*.18,.21,-.25],[s*.24,.86,-.3],.028);
      const sail=part(body,new T.ConeGeometry(.14,.43,3),oilskin,s*.24,.67,-.3);sail.rotation.z=s*.32;}
  }
  body.scale.setScalar(size);
  const parts=new Map();
  let head;
  if(bird){
    oval(body,linen,0,.07,.01,.17,.17,.49);
    head=group(body,0,.14,.35);
    oval(head,ochre,0,0,.05,.135,.14,.18);
    line(head,bronze,[0,0,.16],[0,-.03,.36],.091,.007);
    for(const side of [-1,1]){
      const wing=group(body,side*.12,.075,0);limbs.push(wing);
      for(let i=0;i<5;i++){
        const quill=oval(wing,i%2?ochre:linen,side*(.19+i*.16),.025, .04-i*.078,.24,.038,.30-i*.013);
        quill.rotation.y=side*(.15+i*.13);
      }
      line(wing,copper,[0,.03,.18],[side*.91,.03,-.17],.025,.01);
      const tail=oval(body,wool,side*.085,0,-.48,.09,.035,.27);tail.rotation.y=-side*.23;
    }
  }else{
    oval(body,hart?bronze:ochre,0,.09,-.07,.32,.34,.61);
    for(const s of [-1,1]){
      oval(body,patina,s*.275,.16,-.07,.065,.19,.34);
      for(const z of [-.40,.29]){
        const leg=group(body,s*.21,-.04,z);limbs.push(leg);
        line(leg,bronze,[0,.06,0],[s*.035,-.33,-.07],.10,.072);
        line(leg,hide,[s*.035,-.33,-.07],[0,-.56,.015],.065,.045);
        oval(leg,boot,0,-.56,.04,.084,.064,.11);
      }
    }
    head=group(body,0,.18,.37);
    line(head,ochre,[0,-.02,0],[0,.32,.16],.21,.15);
    oval(head,hart?copper:ochre,0,.34,.2,.19,.18,.23);
    oval(head,hide,0,.28,.39,.13,.11,.16);
    for(const s of [-1,1]){
      oval(head,linen,s*.18,.49,.13,.08,.13,.05).rotation.z=-s*.63;
      if(hart){
        addPart(parts,s<0?'left-antler':'right-antler',group(head,s*.39,.94,-.03),.33);
        const fork=[s*.39,.94,-.03],peak=[s*.58,1.34,-.22];
        line(head,bronze,[s*.12,.44,.11],fork,.066,.049);
        line(head,copper,fork,peak,.05,.015);
        line(head,ochre,fork,[s*.59,1.13,.25],.041,.009);
        line(head,linen,[s*.49,1.13,-.13],[s*.37,1.43,.02],.034,.008);
      }else{
        addPart(parts,s<0?'left-horn':'right-horn',group(head,s*.18,.41,.13),.16);
        const horn=ring(head,copper,s*.18,.41,.13,.18,.053);horn.rotation.y=Math.PI/2;horn.scale.y=1.17;
      }
    }
  }
  bake(rig);
  const crest=group(head,0,bird?.035:.37,bird?.17:.385);
  oval(crest,light,0,0,0,bird?.055:.095,.063,.033);
  let clock=phase,previous=null;
  return {parts,crest,grounded:!bird,label:bird?'Silk kestrel':hart?'Ember Hart':keeper?'Ashhorn Gate Ram':'Kiln ram',animate(time,state,pace,move){
    const dt=previous===null?1/60:Math.min(.06,time-previous);previous=time;
    clock+=dt*(bird?6.1:8*Math.max(.06,pace));
    if(bird){
      limbs.forEach((wing,i)=>{wing.rotation.z=(i?1:-1)*(.15+.47*Math.sin(clock));});
      body.rotation.z=.11*Math.sin(time*2+phase);body.position.y=.11*Math.cos(clock);
    }else{
      limbs.forEach((leg,i)=>{leg.rotation.x=Math.sin(clock+(i===0||i===3?0:Math.PI))*.54*pace;});
      body.position.y=(hart?.62:keeper?.22:.10)+.035*Math.abs(Math.sin(clock))*pace;
      head.rotation.x=T.MathUtils.damp(head.rotation.x,state==='tell'?.65:state==='recover'?-.16:0,9,dt);
      head.rotation.y=move==='antlerSweep' && state==='release' ? .88*Math.sin(time*7):0;
    }
  }};
}


export function salvageActor(root,spec,light){
  if(['kiln-ram','gate-ram','silk-kestrel','ember-hart'].includes(spec.skin))return uplandActor(root,spec,light);
  const crab=spec.kind==='crab', drone=spec.skin==='cage-lamp';
  const limbs=[],claws=[],knees=[],parts=new Map();
  const rig=group(root);root=rig;
  let lampAt,gauntletArm,freeArm,clock=0,lastTime=null,paceBlend=0;
  const offset=[...spec.id].reduce((n,ch)=>n+ch.charCodeAt(0),0)*.37;
  if(crab){
    if(spec.skin==='matriarch'){
      // A crown of tide gauges and a green harbor beacon distinguish her at a distance.
      root=group(root,0,.26,0);
      root.scale.set(1.65,1.48,1.55);
      for(const side of [-1,1]){
        line(root,bronze,[side*.30,.23,-.25],[side*.51,.8,-.32],.055,.024);
        oval(root,patina,side*.51,.82,-.32,.095,.13,.095);
      }
      cuff(root,bronze,0,.48,-.19,.15,.22,.18);
      oval(root,light,0,.68,-.19,.13,.20,.13);
      cuff(root,bronze,0,.87,-.19,.16,.10,.09);
    }
    oval(root,shell,0,0,0,.73,.31,.53);
    oval(root,patina,0,.23,-.04,.46,.14,.35);
    for(let j=-2;j<=2;j++) {
      const z=j*.134;
      line(root,shellEdge,[-.48,.20,z],[0,.32,z+.072],.024);
      line(root,shellEdge,[0,.32,z+.072],[.48,.20,z],.024);
    }
    for(const s of [-1,1]){
      for (let j=0;j<3;j++) line(root,shell,[s*.58,.08,j*.14-.26],[s*(.81-j*.033),.16,j*.14-.35],.088,.008);
      line(root,bronze,[s*.3,.30,-.26],[s*.45,.19,.25],.027);
      for(let j=0;j<4;j++){
        const z=-.41+j*.207,limb=group(root,s*.53,-.01,z);
        line(limb,shellEdge,[0,0,0],[s*.34,.095,z*.48],.097,.066);
        line(limb,shell,[s*.34,.095,z*.48],[s*.57,-.47,z*.79],.07,.018);
        oval(limb,copper,s*.34,.095,z*.48,.081,.075,.07);
        limbs.push(limb);
      }
      line(root,shell,[s*.47,.025,.36],[s*.69,.10,.57],.14,.09);
      const claw=group(root,s*.69,.10,.57);claws.push(claw);
      addPart(parts,s<0?'left-claw':'right-claw',group(claw,0,.04,.2),.24);
      oval(claw,shellEdge,s*.03,.04,.1,.19,.14,.26);
      line(claw,shellEdge,[s*.14,.06,.22],[s*.07,.12,.47],.11,.015);
      line(claw,shell,[-s*.04,.03,.23],[0,.03,.46],.085,.012);
      line(root,shellEdge,[s*.21,.18,.41],[s*.26,.39,.47],.045,.027);
      oval(root,lens,s*.26,.39,.47,.058,.055,.058);
    }
    lampAt=[0,.29,.29];
  }else if(drone){
    oval(root,lens,0,.04,0,.27,.37,.27);
    for (const y of [-.21,0,.21]) {
      const band=ring(root,bronze,0,y,0,.323,.014);band.rotation.x=Math.PI/2;
    }
    cuff(root,copper,0,.39,0,.17,.38,.18);
    cuff(root,copper,0,-.34,0,.37,.21,.18);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;
      line(root,bronze,[Math.sin(a)*.31,-.29,Math.cos(a)*.31],[Math.sin(a)*.33,.30,Math.cos(a)*.33],.024);
    }
    ring(root,hide,0,.59,0,.135,.033);
    for(const s of [-1,1]){
      line(root,patina,[s*.26,.17,0],[s*.52,.21,0],.034);
      const guard=ring(root,copper,s*.54,.21,0,.214,.021);guard.rotation.x=Math.PI/2;
      const rotor=group(root,s*.54,.215,0);
      for(let j=0;j<3;j++){
        const blade=group(rotor);blade.rotation.y=j*2*Math.PI/3;
        oval(blade,bronze,0,0,.099,.047,.016,.1);
      }
      limbs.push(rotor);
    }
    lampAt=[0,.04,.338];
  }else{
    // Origin is the encounter's aim point; put the lead boots on the actual pier.
    const suit=group(root,0,-1.5,0);suit.scale.setScalar(spec.skin==='captain' ? 1.48 : 1.06);
    tailored(suit,canvas,[[.68,.18,.15],[.85,.22,.16],[1.06,.222,.18],[1.26,.245,.155],[1.36,.18,.12]]);
    cuff(suit,hide,0,.91,.005,.227,.222,.084,.76);
    const left=leg(suit,-1,true),right=leg(suit,1,true);
    limbs.push(left.hip,right.hip);
    knees.push(left.knee,right.knee);
    const leftArm=arm(suit,-1,canvas);freeArm=leftArm.shoulder;
    leftArm.elbow.rotation.x=-.35;
    const throwingArm=arm(suit,1,canvas);
    throwingArm.elbow.rotation.x=-.8;
    gauntletArm=throwingArm.shoulder;
    const gauntlet=group(throwingArm.elbow,0,-.16,.052);
    cuff(gauntlet,patina,0,0,0,.095,.077,.184);
    cuff(gauntlet,bronze,0,-.09,0,.081,.084,.027);
    for(const side of [-1,1]) line(gauntlet,copper,[side*.069,.1,.045],[side*.066,-.09,.04],.014);
    for (const x of [-.14,0,.14]) {
      const weight=part(suit,new T.BoxGeometry(.09,.116,.05),bronze,x,.91,.154-Math.abs(x)*.22);
      weight.rotation.y=x*2;
    }
    addPart(parts,'tank',group(suit,0,1.06,-.22),.22,true);
    for(const side of [-1,1]){
      const bottle=oval(suit,patina,side*.103,1.06,-.173,.095,.28,.098);
      for(const y of [-.42,.47])cuff(suit,hide,bottle.position.x,1.06+y*.28,-.173,.097,.097,.042);
      strap(suit,side*.16,1.33,.102,side*.115,.92,.156);
    }
    oval(suit,copper,0,1.34,.01,.276,.084,.215);
    oval(suit,copper,0,1.55,.024,.231,.24,.213);
    if (spec.skin==='captain') {
      // A salvaged ship's bell serves as his hammer; back pennants read above the crew.
      const hammer=group(gauntlet,0,-.12,.04);
      line(hammer,hide,[0,0,-.24],[0,0,.74],.042,.05);
      const bell=part(hammer,new T.LatheGeometry([[.08,.37],[.21,.28],[.27,-.08],[.37,-.16],[.39,-.22],[.33,-.22]].map(([r,y])=>new T.Vector2(r,y)),24),bronze,0,.06,.65);
      bell.rotation.z=-.18;
      oval(hammer,patina,0,-.16,.65,.09,.12,.09);
      for(const side of [-1,1]){
        line(suit,bronze,[side*.14,1.16,-.20],[side*.34,2.16,-.24],.022);
        const flag=part(suit,new T.ConeGeometry(.16,.46,3),side===1 ? wool : oilskin,side*.34,1.96,-.25);
        flag.rotation.z=side*.40;
      }
      tailored(suit,wool,[[.46,.29,.19,-.04],[.52,.31,.20,-.04],[.88,.205,.165],[1,.202,.16]]);
      cuff(suit,bronze,0,1.62,.024,.226,.233,.044,.94);
      for(const side of [-1,1]) oval(suit,bronze,side*.239,1.285,0,.116,.072,.147);
    }
    const glass=oval(suit,lens,0,1.55,.20,.139,.145,.052);
    ring(suit,bronze,0,glass.position.y,.237,.144,.024);
    for(const x of [-.065,.065])line(suit,copper,[x,1.435,.247],[x,1.665,.247],.011);
    line(suit,copper,[-.12,1.55,.25],[.12,1.55,.25],.012);
    for(const side of [-1,1])ring(suit,bronze,side*.206,1.55,.034,.088,.015).rotation.y=Math.PI/2;
    const hose=new T.CatmullRomCurve3([[.18,1.51,-.04],[.269,1.39,-.09],[.255,1.23,-.24],[.13,1.32,-.19]].map(v=>new T.Vector3(...v)));
    part(suit,new T.TubeGeometry(hose,16,.032,8,false),boot);
    lampAt=spec.skin==='captain' ? [-.21,.32,.27] : [-.16,-.2,.185];
  }
  bake(root);
  const crest=group(root,...lampAt);
  oval(crest,light,0,0,0,crab ? .086 : .102,crab ? .066 : .103,.065);
  return {parts,crest,grounded:!drone,label:spec.skin==='matriarch'?'Breakwater Matriarch':crab?'Copperback crab':drone?'Cage-lamp sentry':spec.skin==='captain'?'Captain Bellbreaker':'Brasswake diver',animate(time,state,pace,move){
    const dt=lastTime===null ? 1/60 : Math.min(.06,time-lastTime);lastTime=time;
    const damp=(a,b)=>T.MathUtils.damp(a,b,13,dt);
    paceBlend=damp(paceBlend,state==='charge'?1.3:pace);
    clock+=dt*paceBlend*(crab?9:7);
    const stride=Math.sin(clock+offset), breath=Math.sin(time*2+offset);
    rig.position.y=(drone?.07*breath:.012*breath+.024*Math.abs(stride)*paceBlend);
    rig.rotation.z=damp(rig.rotation.z,stride*paceBlend*(drone?.11:.045));
    rig.rotation.x=damp(rig.rotation.x,state==='tell'?-.09:state==='recover'?.10:paceBlend*.065);
    if(gauntletArm){
      const raised=spec.skin==='captain'?-2.55:-1.22;
      gauntletArm.rotation.x=damp(gauntletArm.rotation.x,state==='tell'?raised:
        state==='release'||state==='charge'?-1.42:state==='recover'?.12:-.14+stride*paceBlend*.2);
      gauntletArm.rotation.z=damp(gauntletArm.rotation.z,move==='breaker'?-.82:move==='broadside'?-.28:0);
      freeArm.rotation.x=-.22-stride*paceBlend*.34;
    }
    claws.forEach(claw=>{claw.rotation.x=damp(claw.rotation.x,state==='tell'?-.85:state==='charge'||state==='release'?-.35:0);});
    limbs.forEach((limb,i)=>{
      const phase=clock+offset+i*(crab?2.1:Math.PI), walk=Math.sin(phase)*paceBlend;
      if(crab){limb.rotation.y=walk*.24;limb.rotation.z=Math.sign(limb.position.x)*Math.max(0,Math.cos(phase))*.15*paceBlend;}
      else if(drone)limb.rotation.y=time*18*(i===0 ? 1 : -1);
      else {limb.rotation.x=walk*.47;knees[i].rotation.x=.10+Math.max(0,-walk)*.65;}
    });
  }};
}

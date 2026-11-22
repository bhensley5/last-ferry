import * as T from 'three';

const colorOK = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const vectorOK = (v, min, max) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && n >= min && n <= max);
const shapes = ['orb', 'cone', 'shell', 'fin', 'arm', 'ring'];
const motions = ['still', 'wave', 'pulse', 'spin'];

export const formFields = 'null restores original; {body:octopus|jellyfish|custom, name?:display label, color?:#rrggbb, parts?:1–24 extra shapes}. Each part: {shape:orb|cone|shell|fin|arm|ring, at:[x,y,z] within ±2, size:[width,height,depth] .03–3, turn?:[x,y,z] degrees, color?:#rrggbb, motion?:still|wave|pulse|spin}. Local +Z faces forward. Appearance only; edit phases or friendly for behavior.';
export const castFields = {
  center: 'point [x,y,z], encounter ID, deck ID, player, or nearest (living hostile to player)',
  visual: 'lightning | tornado | ripple | spray',
  spray: 'optional for spray only: {count:1–96, velocity:[x,y,z] m/s ±8, spread:0–6 m/s, gravity:-10–10 m/s², spin:-8–8 rad/s, seconds:.2–4, size:.03–.8 m}',
  range: 'optional for nearest: only target within 0–40 meters of the player',
  radius: '0–12 meters; omit for a single enemy, required for player/deck area',
  damage: 'optional 1–8 hits or defeat; never hits the player or friendly actors',
  stun: 'optional .1–15 seconds; interrupts attacks, then enemy recovers',
  color: 'optional #rrggbb'
};

export function formError(form) {
  if (form === null || form === undefined) return null;
  if (!['octopus','jellyfish','custom'].includes(form.body)) return 'Choose an octopus, jellyfish or custom body.';
  if (form.name !== undefined && !(typeof form.name === 'string' && form.name.trim() && form.name.length <= 48)) return 'Use a creature name of 1–48 characters.';
  if (form.color !== undefined && !colorOK(form.color)) return 'Expected a hex body color.';
  const parts = form.parts ?? [];
  if (!Array.isArray(parts) || parts.length > 24 || (form.body === 'custom' && !parts.length)) return 'Custom bodies need parts; use at most 24.';
  for (const part of parts) {
    if (!part || !shapes.includes(part.shape) || !vectorOK(part.at,-2,2) || !vectorOK(part.size,.03,3)) return 'Invalid creature part shape, position or size.';
    if (part.turn !== undefined && !vectorOK(part.turn,-360,360)) return 'Use degrees for part rotation.';
    if (part.color !== undefined && !colorOK(part.color)) return 'Expected a hex part color.';
    if (part.motion !== undefined && !motions.includes(part.motion)) return 'Unknown part motion.';
  }
  return null;
}

export function castError(op, pieces, encounters) {
  if (!['lightning','tornado','ripple','spray'].includes(op.visual)) return 'Choose a supported cast visual.';
  const pointCenter=vectorOK(op.center,-300,300);
  if (!pointCenter && !['player','nearest'].includes(op.center) && !pieces.has(op.center) && !encounters.has(op.center)) return 'Choose a cast center from the brief.';
  if (op.range !== undefined && (op.center !== 'nearest' || !Number.isFinite(op.range) || op.range < 0 || op.range > 40)) return 'Nearest-target range must be 0–40 meters.';
  if (op.radius !== undefined && (!Number.isFinite(op.radius) || op.radius < 0 || op.radius > 12)) return 'Cast radius must be 0–12 meters.';
  if ((pointCenter || op.center === 'player' || pieces.has(op.center)) && !op.radius) return 'Supply a radius around that location.';
  if (op.damage !== undefined && op.damage !== 'defeat' && !(Number.isInteger(op.damage) && op.damage >= 1 && op.damage <= 8)) return 'Damage must be 1–8 or defeat.';
  if (op.stun !== undefined && !(Number.isFinite(op.stun) && op.stun >= .1 && op.stun <= 15)) return 'Stun must last .1–15 seconds.';
  if (op.spray !== undefined) {
    const ranges = {count:[1,96],spread:[0,6],gravity:[-10,10],spin:[-8,8],seconds:[.2,4],size:[.03,.8]};
    if (op.visual !== 'spray' || !op.spray || typeof op.spray !== 'object' || Array.isArray(op.spray)) return 'Only spray takes particle settings.';
    for (const [key,value] of Object.entries(op.spray)) {
      if (key === 'velocity' && vectorOK(value,-8,8)) continue;
      if (!Object.hasOwn(ranges,key) || !Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1] || (key==='count' && !Number.isInteger(value))) return 'Invalid spray setting: '+key;
    }
  }
  if (op.color !== undefined && !colorOK(op.color)) return 'Expected a hex cast color.';
  return null;
}

const point = (x,y,z) => new T.Vector3(x,y,z);
function geometry(shape) {
  switch (shape) {
    case 'arm': {
      const curve = new T.CatmullRomCurve3([point(0,0,0),point(.24,-.26,.04),point(.64,-.33,.15),point(.88,-.23,.08),point(.94,-.16,-.03)]);
      const tube = new T.TubeGeometry(curve,14,.12,8,false);
      const pos = tube.attributes.position, vertex = new T.Vector3();
      for (let i=0;i<=14;i++) {
        const center = curve.getPointAt(i/14);
        for (let j=0;j<=8;j++) {
          const k=i*9+j;
          vertex.fromBufferAttribute(pos,k).sub(center).multiplyScalar(1-.93*i/14).add(center);
          pos.setXYZ(k,vertex.x,vertex.y,vertex.z);
        }
      }
      tube.computeVertexNormals();
      return tube;
    }
    case 'cone': return new T.ConeGeometry(.5,1,12);
    case 'fin': return new T.ConeGeometry(.5,1,3);
    case 'shell': return new T.IcosahedronGeometry(.5,1);
    case 'ring': return new T.TorusGeometry(.43,.07,7,24);
    default: return new T.SphereGeometry(.5,16,12);
  }
}

export function creatureModel(form) {
  const root = new T.Group(), moving = [];
  const tint = form.color ?? (form.body === 'jellyfish' ? '#63b9b6' : '#b95353');
  const materials = new Map(), geometries = new Map();
  function part({shape,at,size,color=tint,turn=[0,0,0],motion='still'}) {
    if (!materials.has(color)) materials.set(color,new T.MeshStandardMaterial({color,roughness:.42}));
    if (!geometries.has(shape)) geometries.set(shape,geometry(shape));
    const node = new T.Mesh(geometries.get(shape),materials.get(color));
    node.position.fromArray(at); node.scale.fromArray(size);
    node.rotation.set(...turn.map(T.MathUtils.degToRad),'YXZ');
    node.castShadow = true;
    root.add(node);
    if (motion !== 'still') moving.push({node,motion,base:node.rotation.z,scale:node.scale.clone()});
  }
  if (form.body !== 'custom') {
    const jelly = form.body === 'jellyfish';
    part({shape:'orb',at:[0,.19,0],size:jelly?[1.45,.8,1.45]:[.95,1.18,.99],motion:'pulse'});
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4;
      part({shape:'arm',at:[.26*Math.cos(a),-.13,-.26*Math.sin(a)],size:[1,1,1],turn:[0,i*45,jelly?-53:0],motion:'wave'});
    }
    if (!jelly) for (const side of [-1,1]) {
      part({shape:'orb',at:[side*.26,.22,.39],size:[.23,.24,.17],color:'#f6d599'});
      part({shape:'orb',at:[side*.26,.22,.47],size:[.15,.055,.055],color:'#17343a'});
    }
  }
  for (const spec of form.parts ?? []) part(spec);
  return {root, animate(time) {
    moving.forEach(({node,motion,base,scale},i) => {
      if (motion==='spin') node.rotation.z=base+time;
      else if (motion==='wave') node.rotation.z=base+.18*Math.sin(time*3+i);
      else node.scale.copy(scale).multiplyScalar(1+.046*Math.sin(time*3+i));
    });
  }, dispose() {
    root.removeFromParent();
    geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
  }};
}

function particleSpray(op, position, glow) {
  const {count=48,velocity=[0,2,0],spread=2,gravity=-2,spin=0,seconds=1.5,size=.25}=op.spray ?? {};
  const coordinates=new Float32Array(count*3), speeds=new Float32Array(count*3);
  for (let i=0;i<speeds.length;i++) speeds[i]=velocity[i%3]+(Math.random()*2-1)*spread;
  const geometry=new T.BufferGeometry();
  const attribute=new T.BufferAttribute(coordinates,3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position',attribute);
  const material=new T.PointsMaterial({color:op.color ?? '#94ede2',map:glow,size,transparent:true,depthWrite:false});
  const root=new T.Points(geometry,material);
  root.frustumCulled=false;
  root.position.copy(position);
  let age=0;
  return {root,update(dt) {
    age+=dt;
    for (let i=0;i<coordinates.length;i++) {
      if (i%3===1) speeds[i]+=gravity*dt;
      coordinates[i]+=speeds[i]*dt;
    }
    attribute.needsUpdate=true;
    root.rotation.y+=spin*dt;
    material.opacity=Math.max(0,1-age/seconds);
    return age<seconds;
  },dispose() {root.removeFromParent();geometry.dispose();material.dispose();}};
}

export function castModel(op, position, glow) {
  if (op.visual === 'spray') return particleSpray(op,position,glow);
  const root = new T.Group(), material = new T.MeshBasicMaterial({
    color:op.color ?? ({lightning:'#def6ff',tornado:'#a2cece',ripple:'#65dcca'})[op.visual],
    transparent:true,depthWrite:false,side:T.DoubleSide
  });
  root.position.copy(position);
  const radius = Math.max(.95,op.radius ?? 1);
  function strand(points,width) {
    root.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),points.length*2,width,5,false),material));
  }
  if (op.visual==='lightning') {
    const bolt=[point(.4,7,0),point(-.36,4.8,.12),point(.22,4.1,-.12),point(-.42,2.8,.06),point(.15,2.55,0),point(0,0,0)];
    strand(bolt,.064);
    strand([bolt[2],point(.7,3.4,.08),point(.65,3,.2),point(1.2,2.35,.35)],.034);
  } else if (op.visual==='tornado') {
    for (let i=0;i<3;i++) {
      const points=[];
      for (let j=0;j<=40;j++) {
        const t=j/40, a=t*13+i*2.094, r=(.12+.92*t)*radius;
        points.push(point(Math.cos(a)*r,t*3.75,Math.sin(a)*r));
      }
      strand(points,.07);
    }
  } else {
    const ring=new T.Mesh(new T.TorusGeometry(radius,.055,8,48),material);
    ring.rotation.x=Math.PI/2;root.add(ring);
  }
  return {root, age:0, update(dt) {
    this.age+=dt;
    const t=this.age/({lightning:.52,tornado:1.8,ripple:1})[op.visual];
    if (op.visual==='tornado') root.rotation.y+=dt*6;
    if (op.visual==='ripple') root.scale.setScalar(.18+.82*t);
    material.opacity=Math.min(1,Math.max(0,(1-t)*2));
    return t<1;
  }, dispose() {
    root.removeFromParent(); root.children.forEach(n=>n.geometry.dispose());material.dispose();
  }};
}

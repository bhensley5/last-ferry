import * as T from 'three';
import { surface } from './surfaces.js';
import { curvedRoofGeometry } from './art.js';

const leaf = new T.MeshStandardMaterial({ color: 0x65957c, flatShading: true });
const blossom = new T.MeshStandardMaterial({ color: 0xefacaf, flatShading: true });
const stone = new T.MeshStandardMaterial({color:0x79796e,roughness:.95});
const clay = new T.MeshStandardMaterial({ color: 0xab5741, roughness: 0.92 });
const glaze = new T.MeshStandardMaterial({ color: 0x4c9493, roughness: 0.29 });

export function dressMarket(group, style, w, d, kit, mesh) {
  const x = -w * 0.32,
    z = -d * 0.28;
  if (style === 'moonGate') {
    const shape = new T.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(-w / 2, -group.position.y);
    shape.lineTo(-w * 0.34, -group.position.y);
    shape.bezierCurveTo(-w * 0.33, 1.3, w * 0.33, 1.3, w * 0.34, -group.position.y);
    shape.lineTo(w / 2, -group.position.y);
    shape.lineTo(w / 2, 0);
    shape.closePath();
    mesh(
      group,
      new T.ExtrudeGeometry(shape, { depth: d * 0.8, bevelEnabled: false }),
      kit.solidHarbor?stone:glaze,
      0,
      -0.14,
      -d * 0.4,
    );
  } else if (style === 'lighthouse') {
    const h = 10;
    for (let i = 0; i < 5; i++)
      mesh(
        group,
        new T.CylinderGeometry(1.52 - i * 0.14, 1.66 - i * 0.14, h / 5, 12),
        i % 2 ? kit.lacquer : kit.cream,
        x,
        i * 2 + 1,
        z,
      );
    mesh(group, new T.CylinderGeometry(1.65, 1.28, 0.38, 12), kit.brass, x, 10.1, z);
    mesh(group, new T.CylinderGeometry(0.87, 0.94, 1.6, 12), kit.lamp, x, 11.1, z);
    for (let i = 0; i < 6; i++)
      mesh(
        group,
        new T.CylinderGeometry(0.065, 0.065, 1.65, 6),
        kit.darkWood,
        x + Math.cos((i * Math.PI) / 3),
        11.1,
        z + Math.sin((i * Math.PI) / 3),
      );
    mesh(group, new T.ConeGeometry(1.78, 1.5, 12), kit.lacquer, x, 12.6, z);
    kit.lantern(group, x, 11.2, z, 4);
  } else if (style === 'garden') {
    for (const side of [-1, 1]) {
      const px = side * w * 0.34,
        pz = side * d * 0.24;
      mesh(group, new T.CylinderGeometry(1.65, 1.9, 0.6, 10), kit.cream, px, 0.3, pz);
      mesh(group, new T.CylinderGeometry(0.24, 0.46, 3.8, 8), kit.darkWood, px, 2.2, pz);
      for (let j = 0; j < 5; j++) {
        const a = j * 2.4;
        const crown = mesh(
          group,
          new T.IcosahedronGeometry(1, 1),
          j % 3 ? blossom : leaf,
          px + Math.cos(a) * 1.25,
          3.7 + j * 0.22,
          pz + Math.sin(a),
        );
        crown.scale.set(1.55, 1, 1.38);
      }
    }
  } else if (style === 'pottery') {
    for (let i = 0; i < 7; i++) {
      const r = 0.48 + (i % 3) * 0.19;
      const profile = [
        [0.48, 0],
        [0.77, 0.1],
        [1, 0.77],
        [0.75, 1.25],
        [0.48, 1.34],
        [0.53, 1.43],
      ].map(([a, b]) => new T.Vector2(r * a, r * b));
      mesh(
        group,
        new T.LatheGeometry(profile, 12),
        i % 2 ? glaze : clay,
        kit.solidHarbor ? ((i%4)-1.5)*w*.15 : x + (i % 2) * 1.6,
        0,
        kit.solidHarbor ? d*.38-Math.floor(i/4)*1.25 : z + Math.floor(i / 2) * 1.8,
      );
    }
    mesh(group, new T.CylinderGeometry(1, 1.6, 2.5, 12), clay, -x, 1.25, z);
    mesh(group, new T.CylinderGeometry(0.42, 0.6, 2, 9), kit.darkWood, -x, 3.3, z);
  } else if (style === 'windmill') {
    mesh(group, new T.CylinderGeometry(0.95, 1.85, 5, 8), kit.cream, x, 2.5, z);
    mesh(group, new T.ConeGeometry(1.65, 1.8, 8), kit.lacquer, x, 5.6, z);
  }
}
export function millSails(entity, kit, mesh) {
  const rotor = new T.Group();
  rotor.position.set(-entity.size[0] * 0.32, 4.8, -entity.size[1] * 0.28 + 1.42);
  entity.group.add(rotor);
  for (let i = 0; i < 4; i++) {
    const spoke = new T.Group();
    spoke.rotation.z = (i * Math.PI) / 2;
    rotor.add(spoke);
    mesh(spoke, new T.BoxGeometry(0.11, 3.4, 0.12), kit.darkWood, 0, 1.7, 0);
    mesh(spoke, new T.BoxGeometry(0.66, 2.15, 0.08), kit.fabric, 0.3, 2.25, 0.03);
  }
  return rotor;
}

export function setSail(entity, color, kit, mesh) {
  const old = entity.sailRig;
  if (old) {
    old.traverse((n) => {
      if (n.isMesh) n.geometry.dispose();
    });
    old.userData.cloth.dispose();
    old.removeFromParent();
  }
  entity.sailRig = null;
  entity.sail = color;
  if (color === 'none') return;
  const rig = new T.Group(),
    cloth = kit.fabric.clone();
  cloth.color.set(color);
  cloth.side = T.DoubleSide;
  rig.userData.cloth = cloth;
  entity.group.add(rig);
  entity.sailRig = rig;
  const w = entity.originalSize[0],
    d = entity.originalSize[1],
    h = Math.min(6, d * 0.97);
  rig.position.set(w * 0.27, 0, -d * 0.2);
  mesh(rig, new T.CylinderGeometry(0.05, 0.09, h + 0.35, 8), kit.darkWood, 0, h / 2, 0);
  const verts = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.85 + (i * (h - 0.85)) / 5,
      top = 0.85 + ((i + 1) * (h - 0.85)) / 5;
    const span = (t) => d * 0.55 * (1 - 0.65 * Math.pow(t / 5, 1.6));
    const z = span(i),
      end = span(i + 1);
    verts.push(0, y, 0, 0.14, y, z, 0.14, top, end, 0, y, 0, 0.14, top, end, 0, top, 0);
    mesh(rig, new T.BoxGeometry(0.055, 0.055, z), kit.darkWood, 0.15, y, z / 2);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const sail = new T.Mesh(geo, cloth);
  sail.castShadow = true;
  rig.add(sail);
}

// Fixtures are attached to the stall component so live edits move the merchandise too.
const basket = new T.MeshStandardMaterial({color:0x92704a,roughness:.93});
const silver = new T.MeshStandardMaterial({color:0x85a7a0,roughness:.39,metalness:.28});
export function fishCounter(stall, kit, mesh) {
  for (const side of [-1,1]) {
    const x=side*.42, z=-.36;
    mesh(stall,new T.CylinderGeometry(.31,.24,.14,16),basket,x,.79,z);
    const rim=mesh(stall,new T.TorusGeometry(.30,.022,5,20),kit.wood[2],x,.86,z);
    rim.rotation.x=Math.PI/2;
    for(let i=0;i<3;i++) {
      const px=x+(i-1)*.13;
      const fish=mesh(stall,new T.SphereGeometry(1,10,6),silver,px,.88,z);
      fish.scale.set(.067,.039,.20);
      const tail=mesh(stall,new T.ConeGeometry(.062,.11,3),silver,px,.88,z+.19);
      tail.rotation.x=-Math.PI/2;
    }
  }
  // A broken row of noren, rather than one rigid striped slab.
  for(let i=0;i<4;i++){
    const x=(i-1.5)*.415;
    const panel=mesh(stall,new T.BoxGeometry(.395,.33,.025),kit.fabric,x,1.93,.98);
    panel.rotation.z=.018*Math.sin(i*2);
    mesh(stall,new T.BoxGeometry(.36,.016,.029),kit.cream,x,1.82,.98);
  }
  for(const x of [-.85,.85]){
    mesh(stall,new T.CylinderGeometry(.06,.065,2.26,9),kit.wood[1],x,1.1,.9);
    for(const h of [.45,1.56,1.96])mesh(stall,new T.CylinderGeometry(.068,.068,.037,8),basket,x,h,.9);
  }
}

export function teaFacade(group,w,d,kit,mesh){
  for(const side of [-1,1]){
    const z=side*d*.474;
    for(let i=-2;i<=2;i++) {
      const x=i*w*.165;
      mesh(group,new T.BoxGeometry(.045,.65,.07),kit.darkWood,x,-.85,z);
      mesh(group,new T.BoxGeometry(w*.134,.045,.07),kit.darkWood,x,-.85,z);
    }
    for(let i=-3;i<=3;i++) mesh(group,new T.BoxGeometry(.105,1.46,.14),kit.wood[2],i*w*.144,-.84,z);
    const eave=mesh(group,curvedRoofGeometry(w*1.03,.84),kit.tile,0,-.24,side*(d*.47+.2));
    surface(eave,'roof','stone');eave.rotation.x=side*.12;
    mesh(group,new T.BoxGeometry(w*1.03,.095,.13),kit.wood[0],0,-.25,side*(d*.47+.58));
  }
}

// Repeated shoreline scenery uses instancing to keep draw calls low.
import * as T from 'three';

export function makeHarbor(scene) {
  const batches = new Map();
  const shapes = {
    box: new T.BoxGeometry(),
    roof: new T.CylinderGeometry(0.58, 1, 1, 4, 1, false, Math.PI / 4),
    cliff: new T.IcosahedronGeometry(1, 0),
    crown: new T.IcosahedronGeometry(1, 1),
    spire: new T.ConeGeometry(1, 1, 7),
    pole: new T.CylinderGeometry(0.8, 1, 1, 7),
  };
  const dummy = new T.Object3D();
  function add(shape, x, y, z, w, h, d, color, angle = 0) {
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    if (!batches.has(shape)) batches.set(shape, []);
    batches.get(shape).push([dummy.matrix.clone(), new T.Color(color)]);
  }
  function pavilion(x, y, z, width, tiers, angle) {
    for (let k = 0; k < tiers; k++) {
      add('box', x, y + 1, z, width, 2, width * 0.86, k % 2 ? '#be6954' : '#f2bc87', angle);
      for (const side of [-1, 1]) {
        const dx = Math.sin(angle) * width * 0.436 * side,
          dz = Math.cos(angle) * width * 0.436 * side;
        add('box', x + dx, y + 1.2, z + dz, width * 0.77, 0.74, 0.08, '#ffda8b', angle);
        for (const j of [-1, 0, 1])
          add(
            'box',
            x + dx + j * width * 0.27 * Math.cos(angle),
            y + 1.2,
            z + dz - j * width * 0.27 * Math.sin(angle),
            0.12,
            1.1,
            0.13,
            '#633c40',
            angle,
          );
      }
      for (const side of [-1, 1])
        for (const edge of [-1, 1]) {
          const lx = side * width * 0.49,
            lz = edge * width * 0.42;
          add(
            'box',
            x + lx * Math.cos(angle) + lz * Math.sin(angle),
            y + 1,
            z - lx * Math.sin(angle) + lz * Math.cos(angle),
            0.16,
            2.05,
            0.16,
            '#6c4949',
            angle,
          );
        }
      add('roof', x, y + 2.3, z, width * 1.12, 1.2, width, '#31485a', angle);
      add('roof', x, y + 1.85, z, width * 1.14, 0.14, width * 1.02, '#e49362', angle);
      add('box', x, y + 0.08, z, width * 1.12, 0.18, width, '#63505a', angle);
      y += 2.75;
      width *= 0.76;
    }
    add('spire', x, y + 0.85, z, 0.19, 2, 0.19, '#e8b775');
  }
  for (let i = 0; i < 27; i++) {
    const a = i * 2.39996,
      r = 185 + (i % 4) * 3,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r - 57;
    add('cliff', x, -0.1, z, 5 + (i % 3), 2.8, 5, '#42626a', a);
    add('cliff', x + 1.8, 0, z - 1.6, 5, 3.6, 4.2, '#708a78', a);
    if (i % 3 !== 1) pavilion(x, 1.55, z, 2.7 + (i % 3), i % 5 === 0 ? 4 : 1 + (i % 2), -a);
    for (let j = 0; j < 3; j++) {
      const tx = x + Math.cos(j * 2 + a) * 3.6,
        tz = z + Math.sin(j * 2 + a) * 3;
      add('pole', tx, 2.6, tz, 0.17, 3.2, 0.17, '#684547');
      for (const sign of [-1, 1]) {
        add(
          'crown',
          tx + sign * 0.68,
          3.8 + Math.cos(a) * 0.25,
          tz + 0.43,
          1.03,
          0.64,
          1.25,
          '#52867a',
          a + sign,
        );
      }
      add(
        'crown',
        tx,
        4.3,
        tz,
        1.65,
        1.15,
        1.35,
        ['#71928b', '#46776f', '#8da394'][j],
        a,
      );
    }
  }
  {
    // A continuous wooded shoreline gives the outer lights a place to stand.
    const sections=144, rows=8, vertices=[], colors=[], indices=[];
    function shore(a,row){
      const shoreRadius=192+9*Math.sin(a*5)+6*Math.cos(a*9);
      const ridge=18+8*Math.sin(a*3.0)+5*Math.sin(a*13);
      const r=shoreRadius+row*5;
      const y=row===0?-1.8:row===1?.85:1.5+ridge*Math.pow((row-1)/6,1.18)+row*.38*Math.sin(a*26+row*.5);
      return [Math.sin(a)*r,y,Math.cos(a)*r-65];
    }
    const c=new T.Color();
    for(let i=0;i<=sections;i++){
      const a=i/sections*Math.PI*2;
      for(let row=0;row<rows;row++){
        vertices.push(...shore(a,row));
        c.setHex(row<2?0x596460:row===2?0x647466:0x3e5c53).multiplyScalar(.91+.12*Math.sin(17*a+row));
        colors.push(c.r,c.g,c.b);
        if(i && row){
          const b=i*rows+row;
          indices.push(b-rows-1,b-rows,b,b-rows-1,b,b-1);
        }
      }
      if(i%2===0){
        const [x,y,z]=shore(a,2);
        if(i%8<5) pavilion(x,y,z,3.8+i%3,1+i%3,-a);
        for(let tree=0;tree<6;tree++){
          const az=a+.005*tree, r=3+tree%5;
          const [tx,ty,tz]=shore(az,r);
          const h=2.5+(i*7+tree*3)%6;
          add('spire',tx,ty+h*.46,tz,h*.23,h,h*.23,tree%2?'#34584c':'#456453',a);
        }
      }
    }
    const coast=new T.BufferGeometry();
    coast.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    coast.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    coast.setIndex(indices);coast.computeVertexNormals();
    scene.add(new T.Mesh(coast,new T.MeshStandardMaterial({vertexColors:true,roughness:.96,side:T.DoubleSide})));
  }
  // Painted cargo sails and small islets break up the shoreline at water level.
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996,
      x = Math.sin(a) * 86,
      z = Math.cos(a) * 105 - 53;
    for (let j = 0; j < 3; j++)
      add('cliff', x + j * 0.86, 0.05, z + j * 0.45, 0.85, 0.34 + j * 0.14, 1.1, '#608486', a);
  }
  for (const [shape, items] of batches) {
    const m = new T.InstancedMesh(
      shapes[shape],
      new T.MeshStandardMaterial({ roughness: 0.89, flatShading: true }),
      items.length,
    );
    items.forEach(([matrix, color], i) => {
      m.setMatrixAt(i, matrix);
      m.setColorAt(i, color);
    });
    scene.add(m);
  }
  const lanterns = new T.InstancedMesh(
    new T.CylinderGeometry(0.28, 0.21, 0.43, 6),
    new T.MeshBasicMaterial({ color: 0xffcb8e }),
    16,
  );
  lanterns.frustumCulled = false;
  scene.add(lanterns);
  return (time, lights=true, pattern='all') => {
    lanterns.visible=lights;
    for (let i = 0; i < lanterns.count; i++) {
      const a = i * 2.4,
        drift = time * 0.11 + i;
      dummy.rotation.set(0.12 * Math.sin(drift), a, 0.07 * Math.cos(drift));
      dummy.scale.setScalar(pattern==='all' || i%2===(pattern==='odd' ? 0 : 1) ? .8+(i%4)*.23 : 0);
      dummy.position.set(
        Math.sin(a) * 30 + Math.sin(drift) * 0.8,
        5 + (i % 7) * 1.25 + Math.sin(drift * 0.6) * 0.65,
        Math.cos(a) * 37 - 12,
      );
      dummy.updateMatrix();
      lanterns.setMatrixAt(i, dummy.matrix);
    }
    lanterns.instanceMatrix.needsUpdate = true;

  };
}

import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function textureFromCanvas(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  draw(context, size);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function makeWoodTexture() {
  return textureFromCanvas(256, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#b28a62'); gradient.addColorStop(.45, '#886344'); gradient.addColorStop(1, '#a17b55');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
    for (let line = 0; line < 52; line++) {
      const y = line * 5 + Math.sin(line * 3.7) * 2;
      ctx.strokeStyle = `rgba(48,31,22,${.035 + (line % 5) * .009})`;
      ctx.lineWidth = line % 7 === 0 ? 1.4 : .65;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) ctx.lineTo(x, y + Math.sin(x * .045 + line * 2.1) * (1.1 + line % 3));
      ctx.stroke();
    }
    for (const x of [13, size - 13]) for (const y of [18, size - 18]) {
      ctx.fillStyle = '#3a3a32'; ctx.beginPath(); ctx.arc(x, y, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c6aa7a77'; ctx.beginPath(); ctx.arc(x - .6, y - .7, .7, 0, Math.PI * 2); ctx.fill();
    }
  });
}

export function makeFabricTexture(indigo=false) {
  return textureFromCanvas(256, (ctx, size) => {
    if(indigo){
      ctx.fillStyle='#345763';ctx.fillRect(0,0,size,size);
      for(let y=0;y<size;y+=2){ctx.fillStyle=y%6?'#253c4929':'#a7b6a94a';ctx.fillRect(0,y,size,1);}
      for(let x=0;x<size;x+=3){ctx.fillStyle=x%2?'#55778349':'#b9cfc018';ctx.fillRect(x,0,1,size);}
      for(const y of [9,15,239,246]){ctx.fillStyle='#b9b89f';ctx.fillRect(0,y,size,y%2?2:1);}
      // Resist-printed nested waves, stitched into a band down the cloth.
      ctx.strokeStyle='#c6c5aa';ctx.lineWidth=1.8;
      for(let x=-16;x<=size;x+=32)for(const radius of [5,10,15]){
        ctx.beginPath();ctx.arc(x,215,radius,Math.PI,0);ctx.stroke();
      }
      return;
    }
    ctx.fillStyle = '#dbcba5'; ctx.fillRect(0, 0, size, size);
    const stripe = size / 8;
    for (let i = 0; i < 8; i += 2) { ctx.fillStyle = '#a74536'; ctx.fillRect(i * stripe, 0, stripe, size); }
    ctx.strokeStyle = '#fff3cf26'; ctx.lineWidth = 1;
    for (let y = 1; y < size; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
    ctx.strokeStyle = '#3d1f2330';
    for (let x = 0; x < size; x += stripe) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
  });
}

export function makePaperTexture() {
  return textureFromCanvas(128, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, '#e8ac63'); gradient.addColorStop(.5, '#ffe1a1'); gradient.addColorStop(1, '#d89453');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#824e3d42';
    for (let x = 0; x <= size; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
    ctx.strokeStyle = '#fff8cd3a';
    for (let y = 2; y < size; y += 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  });
}

export function roundedMesh(parent, width, height, depth, material, x = 0, y = 0, z = 0, radius = .035) {
  const value = new T.Mesh(new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, height * .3)), material);
  value.position.set(x, y, z);
  value.castShadow = true;
  value.receiveShadow = true;
  parent.add(value);
  return value;
}

export function boatHullGeometry(width, depth, height = .95) {
  const shape = new T.Shape();
  shape.moveTo(0, -depth * .55);
  shape.bezierCurveTo(width * .25, -depth * .53, width * .48, -depth * .32, width * .49, -.12 * depth);
  shape.bezierCurveTo(width * .52, depth * .22, width * .34, depth * .47, width * .18, depth * .5);
  shape.lineTo(-width * .18, depth * .5);
  shape.bezierCurveTo(-width * .34, depth * .47, -width * .52, depth * .22, -width * .49, -.12 * depth);
  shape.bezierCurveTo(-width * .48, -depth * .32, -width * .25, -depth * .53, 0, -depth * .55);
  const outline = shape.getPoints(6);
  outline.pop();
  const vertices = [], uvs = [], indices = [];
  const count = outline.length;
  for (const lower of [false, true]) for (const point of outline) {
    const taper = lower ? .67 : 1;
    vertices.push(point.x * taper, lower ? -height : 0, point.y * (lower ? .78 : 1));
    uvs.push(point.x / width + .5, point.y / depth + .5);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + i, next, count + next, count + i);
  }
  const topCenter = vertices.length / 3;
  vertices.push(0, 0, 0); uvs.push(.5, .5);
  const bottomCenter = vertices.length / 3;
  vertices.push(0, -height, 0); uvs.push(.5, .5);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(topCenter, next, i, bottomCenter, count + i, count + next);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function canopyGeometry(width, depth, rise = .12) {
  const geometry = new T.PlaneGeometry(width, depth, 16, 4);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = (positions.getX(i) / width) + .5;
    const v = (positions.getY(i) / depth) + .5;
    positions.setZ(i, -Math.sin(u * Math.PI) * rise - Math.sin(v * Math.PI) * .035);
  }
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function curvedRoofGeometry(width, depth) {
  const geometry = new T.PlaneGeometry(width, depth, 18, 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = (positions.getX(i) / width) * 2;
    positions.setZ(i, Math.cos(u * Math.PI / 2) * .34);
  }
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function softPoolTexture() {
  return textureFromCanvas(128, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, '#ffffffb0'); gradient.addColorStop(.3, '#ffffff65'); gradient.addColorStop(.7, '#ffffff18'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
  });
}

export function wakeTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  for (let line = 0; line < 6; line++) {
    ctx.strokeStyle = `rgba(255,255,255,${.34 - line * .043})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(64, 8 + line * 13); ctx.quadraticCurveTo(38 - line * 3, 58 + line * 18, 5 + line * 4, 112 + line * 23); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, 8 + line * 13); ctx.quadraticCurveTo(90 + line * 3, 58 + line * 18, 123 - line * 4, 112 + line * 23); ctx.stroke();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

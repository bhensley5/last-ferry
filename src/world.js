import { wishContracts } from './wish-schema.js';
import { kitOps,initKit,restoreDefinitions,validationState,kitError,applyKit,kitBrief } from './wish-kit.js';
import { baseEdit } from './effects.js';
import { landStyles, landTerrace } from './uplands.js';
import { bossMoves } from './boss-patterns.js';
import { behaviorError, behaviorFields } from './behaviors.js';
import { kineticError, kineticFields } from './kinetics.js';
import { formError, castError, formFields, castFields } from './sea-magic.js';
import { stationModel, stationError } from './stations.js';
import { fishCounter, teaFacade, dressMarket, millSails, setSail } from './market-craft.js';
import { driveWheel, rotor, stepWheels, traceWheels } from './wheels.js';
import { Interceptor,isCarrier } from './intercept.js';
import { SurfaceSystem, surface, surfaceFields } from './surfaces.js';
import { collectSolids, fitSolids, traceSolid } from './market-solids.js';
import { pierMaterial } from './market-waterfront.js';
import { basin, insideBasin } from './basin.js';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedMesh, boatHullGeometry, canopyGeometry, curvedRoofGeometry, makeWoodTexture, makeFabricTexture, makePaperTexture, softPoolTexture, wakeTexture } from './art.js';

function encounterTargets(specs, op) {
  if (op.id !== undefined) return specs.filter(e => e.id === op.id);
  const where = op.where;
  if (!where || typeof where !== 'object' || !Object.keys(where).length ||
      Object.keys(where).some(k => !['arena','kind','skin','friendly'].includes(k))) return [];
  return specs.filter(e => Object.entries(where).every(([key,value]) =>
    (key === 'friendly' ? Boolean(e.friendly) : e[key]) === value));
}

const clamp = T.MathUtils.clamp;
function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const value = new T.Mesh(geometry, material);
  value.position.set(x, y, z);
  value.castShadow = true;
  value.receiveShadow = true;
  parent.add(value);
  return value;
}
function seeded(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Each deck moves as a unit. Batch its many static planks, posts and lamps once.
function batchDeck(group) {
  group.updateWorldMatrix(true,true);
  const inverse=group.matrixWorld.clone().invert(), batches=new Map();
  group.traverse(node=>{
    if(!node.isMesh || node.isInstancedMesh || node.userData.switchable || Array.isArray(node.material))return;
    const geometry=node.geometry;
    const key=[node.material.uuid,!!geometry.index,Object.keys(geometry.attributes).sort(),node.castShadow,node.receiveShadow].join('/');
    if(!batches.has(key))batches.set(key,[]);
    batches.get(key).push(node);
  });
  for(const nodes of batches.values()){
    if(nodes.length<2)continue;
    const geometries=nodes.map(node=>node.geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,node.matrixWorld)));
    const combined=new T.Mesh(mergeGeometries(geometries),nodes[0].material);
    combined.castShadow=nodes[0].castShadow; combined.receiveShadow=nodes[0].receiveShadow;
    group.add(combined);
    for(const node of nodes){node.removeFromParent();node.geometry.dispose();}
  }
}
const defaultTraveler={tool:'oar',dash:false,water:'map',trailWard:false,power:1,jetRange:18,speed:5,runSpeed:7.5,jumpVelocity:7.8,airVaultVelocity:6.5,gravity:17};
const tuneLimits={speed:[1,12],runSpeed:[1,18],jumpVelocity:[3,16],airVaultVelocity:[0,14],gravity:[6,30]};
function travelerError(edit){
  for(const [key,value] of Object.entries(edit)){
    if(key==='op')continue;
    if(key==='water' && ['map','swim','danger'].includes(value))continue;
    if((key==='dash'||key==='trailWard') && typeof value==='boolean')continue;
    if(key==='power' && Number.isInteger(value) && value>=1 && value<=8)continue;
    if(key==='jetRange' && Number.isFinite(value) && value>=2 && value<=40)continue;
    if(key==='tool' && ['oar','waterCannon'].includes(value))continue;
    const range=tuneLimits[key];
    if(!range || !Number.isFinite(value) || value<range[0] || value>range[1])return 'Invalid traveler setting: '+key;
  }
  if(!Object.keys(edit).some(k=>k!=='op'))return 'Specify a traveler setting.';
}
const defaultWeather = { lampPattern:'all', waves: 0, lights: true, time:'sunset', tide:0, wind:0, rain:0, fog:.385 };
const weatherFields={waves:[0,1.5],tide:[-1,3],wind:[-1,1],rain:[0,1],fog:[0,1]};
function weatherError(edit){
  for(const [field,value] of Object.entries(edit)){
    if(field==='op')continue;
    if(field==='time' && ['sunrise','day','sunset','night'].includes(value))continue;
    if(field==='lampPattern' && ['all','odd','even'].includes(value))continue;
    if(field==='lights' && typeof value==='boolean')continue;
    const range=weatherFields[field];
    if(!range || !Number.isFinite(value) || value<range[0] || value>range[1])return 'Invalid harbor weather: '+field;
  }
  if(!Object.keys(edit).some(k=>k!=='op'))return 'Specify a harbor condition.';
}
function ownedChangeError(change) {
  if (change.op==='behavior') return behaviorError(change);
  return change.op==='weather'?weatherError(change):travelerError(change);
}
const deckStyles=[...landStyles,'bridge','market','teahouse','garden','pottery','windmill','moonGate','lighthouse','beacon','lanternGate','hoist','skyBarge'];
const buildKinds = ['platform','wall','skiff','ferry',...deckStyles];

const slopeStyles=['pilgrimRoad','stoneSpan','ropeSpan'];
function slopeError(slope,style){
  if(slope!==undefined && (!slopeStyles.includes(style) || !slope || !['x','z'].includes(slope.axis) ||
      !Number.isFinite(slope.rise) || Math.abs(slope.rise)>48))
    return 'Use a pilgrimRoad, stoneSpan or ropeSpan with slope {axis:"x" or "z", rise:-48..48 meters}.';
}
function setSlope(piece,slope){
  piece.grade=slope.rise;piece.axis=slope.axis==='x'?0:2;
}
function newPiece(op) {
  const piece = { id: op.id, kind: op.kind, at: [...op.at], size: [...op.size], built: true };
  if (op.kind === 'platform' || deckStyles.includes(op.kind)) {
    piece.kind = 'dock';
    if (op.kind !== 'platform') piece.dressing=op.kind;
  }
  if(op.slope)setSlope(piece,op.slope);
  if(op.kind==='ferry'){
    piece.path=[[...op.at],[...op.at]];piece.speed=1.6;piece.paused=true;piece.footprint=[...op.size];
  }
  if (op.kind === 'wall') piece.height = op.height;
  return piece;
}
function validSize(size) {
  return Array.isArray(size) && size.length === 2 && size.every(n => Number.isFinite(n) && n >= .35 && n <= 96);
}
function validPoint(at) {
  return Array.isArray(at) && at.length === 3 && at.every(Number.isFinite) && insideBasin(at);
}

export class World {
  constructor(scene, level, solidHarbor=false) {
    this.solidHarbor=solidHarbor;
    this.layoutVersion=0;
    if(solidHarbor)this.pierTimber=pierMaterial();
    this.scene = scene;
    this.surfaces=new SurfaceSystem(this);
    this.intercept=new Interceptor(this);
    this.level = structuredClone(level);
    initKit(this);
    this.level.levelId ??= 'first-light';
    this.level.encounters ??= [];
    this.level.behaviors ??= [];
    this.level.mechanicTime ??= 0;
    this.level.cues ??= [];
    this.level.stations ??= [];
    this.level.cargo ??= [];
    this.playerEffects=[];
    this.level.weather = { ...defaultWeather, ...this.level.weather };
    this.seaTime = 0;
    this.tide=this.level.weather.tide;
    this.waveHeight = this.level.weather.waves;
    this.level.traveler={...defaultTraveler,...this.level.traveler};
    this.entities = new Map();
    this.transitions = [];
    this.pendingVisibility = new Map();
    this.random = seeded(level.seed);
    this.woodTexture = makeWoodTexture();
    this.fabric = new T.MeshStandardMaterial({ map: makeFabricTexture(), color: 0xc7c1ae, roughness: .94, side: T.DoubleSide });
    if(solidHarbor){
      this.fabric.map=makeFabricTexture(true);
      this.fabric.color.setHex(0xc5d0cf);
      this.tile=new T.MeshStandardMaterial({color:0x2e434c,roughness:.72,side:T.DoubleSide});
    }
    this.poolTexture = softPoolTexture();
    this.wakeTexture = wakeTexture();
    this.poolMaterial = new T.MeshBasicMaterial({ map: this.poolTexture, color: 0xffb75f, transparent: true, opacity: .23, blending: T.AdditiveBlending, depthWrite: false });
    this.contactMaterial = new T.MeshBasicMaterial({ color: 0x79b7b1, transparent: true, opacity: .22, side: T.DoubleSide, depthWrite: false });
    this.wood = [0xd8c4a5, 0xc9b18e, 0xb69a7a].map(color => new T.MeshStandardMaterial({ color, map: this.woodTexture, bumpMap: this.woodTexture, bumpScale: .018, roughness: .88 }));
    this.darkWood = new T.MeshStandardMaterial({ color: 0x293634, roughness: .87 });
    this.lacquer = new T.MeshStandardMaterial({ color: 0x963d2d, roughness: .66 });
    this.cream = new T.MeshStandardMaterial({ color: 0xd1bf91, roughness: .94, side: T.DoubleSide });
    this.brass = new T.MeshStandardMaterial({ color: 0x9e7041, metalness: .4, roughness: .55 });
    const paperTexture = makePaperTexture();
    this.lamp = new T.MeshStandardMaterial({ color: 0xffdca1, map: paperTexture, emissiveMap: paperTexture, emissive: 0xff9d41, emissiveIntensity: .95, roughness: .85 });
    this.darkLamp=this.lamp.clone();this.darkLamp.emissiveIntensity=0;this.darkLamp.color.setHex(0x756b61);
    this.glow = this.makeGlow();
    this.root = new T.Group();
    scene.add(this.root);
    for (const entity of this.level.entities) this.buildEntity(entity);
    restoreDefinitions(this.level,this.level,this.entities,this.solidHarbor,ownedChangeError);
    this.surfaces.restore(this.level.surfaceStates);delete this.level.surfaceStates;
    this.setLights(this.level.weather.lights);
  }
  makeGlow() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, '#fff5c5'); gradient.addColorStop(.18, '#ffc06988'); gradient.addColorStop(1, '#ffac4100');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 96, 96);
    return new T.CanvasTexture(canvas);
  }
  lantern(parent, x, y, z, scale = 1) {
    const group = new T.Group(); group.position.set(x, y, z); group.scale.setScalar(scale); parent.add(group);
    const paper = mesh(group, new T.SphereGeometry(.19, 16, 12), this.lamp); surface(paper,'lantern','paper');paper.scale.y = 1.25; paper.castShadow = false;
    surface(mesh(group, new T.CylinderGeometry(.09, .09, .065, 12), this.brass, 0, .25, 0),'lamp-cap','metal');
    mesh(group, new T.CylinderGeometry(.09, .09, .065, 12), this.brass, 0, -.25, 0);
    mesh(group, new T.CylinderGeometry(.012, .012, .22, 6), this.brass, 0, -.37, 0);
    if(this.solidHarbor){
      for (const band of [-.13,.13]) {
        const ring=mesh(group,new T.TorusGeometry(.16,.012,5,14),this.darkWood,0,band,0);
        ring.rotation.x=Math.PI/2;ring.castShadow=false;
      }
    }
    const glow = new T.Sprite(this.lanternGlow ??= new T.SpriteMaterial({ map:this.glow,color:0xffb55d,transparent:true,opacity:.48,blending:T.AdditiveBlending,depthWrite:false }));
    glow.scale.set(.9, .9, 1); glow.userData.baseScale = .9; group.add(glow);
    paper.userData.switchable=true;group.userData.fixture={paper,glow,pools:[]};
    return group;
  }
  lightPool(parent, x, z, size = 1.7) {
    const pool = mesh(parent, new T.PlaneGeometry(size, size), this.poolMaterial, x, .018, z);
    pool.userData.switchable=true;
    pool.rotation.x = -Math.PI / 2; pool.castShadow = false; pool.receiveShadow = false;
  }
  makeWake(width, depth, x, z) {
    const wake = mesh(this.root, new T.PlaneGeometry(width * 2, depth * 2.9), new T.MeshBasicMaterial({ map: this.wakeTexture, color: 0x8ac7c2, transparent: true, opacity: .17, depthWrite: false }), x, .028, z + depth * .35);
    wake.rotation.x = -Math.PI / 2; wake.castShadow = false; wake.receiveShadow = false;
    return wake;
  }
  deck(group, width, depth, pilings = true) {
    if(this.solidHarbor) {
      // One continuous mipmapped surface: no vibrating hairline gaps or intersecting planks.
      const geo=new T.BoxGeometry(width,.20,depth);
      const pos=geo.attributes.position, uv=geo.attributes.uv, normals=geo.attributes.normal;
      const offset=this.random()*3;
      for(let i=0;i<pos.count;i++){
        const u=Math.abs(normals.getY(i))>.5 ? pos.getZ(i) : pos.getY(i);
        const v=Math.abs(normals.getX(i))>.5 ? pos.getZ(i) : pos.getX(i);
        uv.setXY(i,u/2.4+offset,v/3.6+offset);
      }
      // Authored landings sometimes overlap. Give each wearing surface a distinct elevation.
      surface(mesh(group,geo,this.pierTimber,0,-.10+this.random()*.013,0),'deck','wood');
    } else {
      const boards = Math.min(32, Math.ceil(depth / .28));
      for (let i = 0; i < boards; i++) {
        const boardDepth = depth / boards;
        const plank = roundedMesh(group, width, .16, boardDepth - .018, this.wood[i % 3], 0, -.08, -depth / 2 + (i + .5) * boardDepth, .017);
        plank.rotation.y = (this.random() - .5) * .007;
      }
    }
    for (const x of [-width / 2 + .13, width / 2 - .13])
      roundedMesh(group, .14, .2, depth + .1, this.darkWood, x, -.19, 0, .025);
    if (pilings) for (const x of [-width / 2 + .16, width / 2 - .16]) for (const z of [-depth / 2 + .2, depth / 2 - .2]) {
      const pileHeight=Math.max(2.4,group.position.y+.65);
      mesh(group,new T.CylinderGeometry(.12,.18,pileHeight,8),this.darkWood,x,-pileHeight/2,z);
      const ripple = mesh(group, new T.RingGeometry(.15, .18, 28), this.contactMaterial, x, -group.position.y + .032, z);
      ripple.rotation.x = -Math.PI / 2; ripple.castShadow = ripple.receiveShadow = false;
    }
  }
  buildDock(entity) {
    const group = new T.Group(); group.position.fromArray(entity.at); this.root.add(group);
    if(landStyles.includes(entity.dressing)){
      landTerrace(group,entity,this,mesh);
      this.entities.set(entity.id,{...entity,group,velocity:[0,0,0]});
      return;
    }
    const [width, depth] = entity.size;
    this.deck(group, width, depth, !['skyBarge','hoist'].includes(entity.dressing));
    dressMarket(group,entity.dressing,width,depth,this,mesh);
    if(entity.dressing==='skyBarge'){
      const h=3.7, radius=Math.max(.65,Math.min(width*.52,2.6));
      const envelope=mesh(group,new T.SphereGeometry(1,32,18),this.fabric,0,h+radius*.78,0);
      envelope.scale.set(radius,radius*.78,depth*.60);
      for(const z of [-.28,0,.28]){
        const band=mesh(group,new T.TorusGeometry(1,.017,6,40),this.lacquer,0,envelope.position.y,depth*z);
        const taper=Math.sqrt(1-(z/.60)**2);
        band.scale.set(radius*taper,radius*.78*taper,1);
      }
      for(const side of [-1,1])for(const end of [-1,1]){
        const a=new T.Vector3(side*width*.46,.06,end*depth*.36);
        const b=new T.Vector3(side*radius*.76,envelope.position.y,end*depth*.36);
        const cable=mesh(group,new T.CylinderGeometry(.025,.03,a.distanceTo(b),8),this.brass);
        cable.position.copy(a).lerp(b,.5);cable.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.sub(a).normalize());
      }
    }
    if(entity.dressing === 'hoist'){
      for(const side of [-1,1]){
        const x=side*(width/2-.3);
        const z=this.solidHarbor ? -depth*.34 : 0;
        mesh(group,new T.CylinderGeometry(.08,.12,3.6,8),this.brass,x,1.8,z);
        const float=mesh(group,new T.SphereGeometry(1.05,12,10),this.fabric,x,4.15,z);
        float.scale.set(.83,1.3,.83);
        this.lantern(group,x,2.75,z,.9);
      }
    }
    if(entity.dressing === 'beacon'){
      if(this.level.goal.type==='defeat'){
        mesh(group,new T.LatheGeometry([[.08,-.7],[.82,-.7],[.68,-.48],[.50,.43],[.24,.73],[.07,.76]].map(([r,y])=>new T.Vector2(r,y)),20),this.brass,0,2.8,-1.2);
        mesh(group,new T.BoxGeometry(width-1.2,.17,.24),this.lacquer,0,4.14,-1.2);
        mesh(group,new T.CylinderGeometry(.035,.035,.8,8),this.darkWood,0,3.7,-1.2);
      }
      const seal=mesh(group,new T.RingGeometry(1.05,1.4,12),this.brass,0,.025,0);
      seal.rotation.x=-Math.PI/2;
      for(const side of [-1,1]){
        const x=side*(width/2-.75);
        mesh(group,new T.CylinderGeometry(.17,.31,4.5,10),this.lacquer,x,2.2,-1.2);
        this.lantern(group,x,4.8,-1.2,2.6);
      }
    }
    for (let i = 0; i < 3; i++) {
      const z = -depth / 2 + .55 + i * 1.2;
      mesh(group,new T.CylinderGeometry(.035,.06,.63,8),this.brass,-width/2+.15,.30,z);
      this.lantern(group, -width / 2 + .15, .72 + i * .04, z, .8);
      this.lightPool(group, -width / 2 + .15, z, 1.8);
    }
    if (entity.dressing === 'teahouse') {
      // The playable landing is the roof terrace; the storey below reads from the canal.
      const wall=Math.max(1.7,entity.at[1]-.4);
      mesh(group,new T.BoxGeometry(width*.92,wall,depth*.92),this.lacquer,0,-wall/2-.15,0);
      for(let floor=3;floor<wall;floor+=3){
        mesh(group,new T.BoxGeometry(width*.97,.24,depth*.97),this.darkWood,0,-floor,0);
        for(const side of [-1,1]) for(const offset of [-.25,0,.25]){
          mesh(group,new T.BoxGeometry(width*.12,.72,.06),this.lamp,width*offset,.9-floor,side*depth*.467);
        }
      }
      for (const side of [-1,1]) for(let i=-2;i<=2;i++)
        mesh(group,new T.BoxGeometry(width*.13,.62,.05),this.lamp,i*width*.165,-.85,side*depth*.465);
      if(this.solidHarbor)teaFacade(group,width,depth,this,mesh);
      const tower = new T.Group(); tower.position.set(-width*.3,0,-depth*.28); group.add(tower);
      for(let i=0;i<2;i++){
        mesh(tower,new T.BoxGeometry(1.55-i*.45,1.15,1.55-i*.45),this.cream,0,.6+i*1.15,0);
        mesh(tower,curvedRoofGeometry(2.45-i*.65,2.3-i*.6),this.tile || this.lacquer,0,1.16+i*1.15,0);
      }
      this.lantern(tower,.95,1,0,.9);
    }
    if(['bridge','moonGate','court'].includes(entity.dressing)) {
      for(const side of [-1,1]){
        for(const end of [-1,1]){
          const x=side*(width*.5-.12),z=end*(depth*.5-.18);
          mesh(group,new T.CylinderGeometry(.09,.13,1.25,8),this.lacquer,x,.5,z);
          this.lantern(group,x,1.22,z,.78);
        }
        if(entity.dressing==='bridge') {
          if(this.solidHarbor && width>depth)mesh(group,new T.BoxGeometry(width,.12,.09),this.lacquer,0,.86,side*(depth*.5-.12));
          else mesh(group,new T.BoxGeometry(.09,.12,depth),this.lacquer,side*(width*.5-.12),.86,0);
        }
      }
      if(entity.dressing==='court'){
        const bz=-depth*.41;
        for(const side of [-1,1])
          mesh(group,new T.CylinderGeometry(.16,.22,3.9,10),this.lacquer,side*2.05,1.85,bz);
        mesh(group,curvedRoofGeometry(5.3,1.35),this.lacquer,0,3.83,bz);
        mesh(group,new T.BoxGeometry(4.6,.2,.32),this.darkWood,0,3.64,bz);
        mesh(group,new T.CylinderGeometry(.035,.035,.5,8),this.darkWood,0,3.34,bz);
        const bellProfile=[[.05,-.52],[.51,-.51],[.48,-.39],[.4,-.32],[.35,.26],[.26,.39],[.09,.42]];
        mesh(group,new T.LatheGeometry(bellProfile.map(([r,y])=>new T.Vector2(r,y)),20),this.brass,0,2.75,bz);
        this.lantern(group,-1.6,3,bz,1.1);this.lantern(group,1.6,3,bz,1.1);
        const seal=mesh(group,new T.RingGeometry(2.6,2.72,8),this.brass,0,.025,0);
        seal.rotation.x=-Math.PI/2;
      }
    }
    if (entity.dressing === 'market') {
      const stall = new T.Group();
      if(this.solidHarbor && width>=8) stall.position.set(-width*.30,0,depth*.5-1.05);
      else stall.position.set(-1.55,0,.55);
      group.add(stall);
      const line=new T.CatmullRomCurve3([new T.Vector3(-2.3,3.15,-1),new T.Vector3(.2,2.78,-1),new T.Vector3(2.55,3.15,-1)]);
      mesh(group,new T.TubeGeometry(line,12,.014,4,false),this.darkWood);
      for(const x of [-2.3,2.55])mesh(group,new T.CylinderGeometry(.043,.065,3.18,8),this.darkWood,x,1.56,-1);
      for(let i=1;i<9;i++){
        const pt=line.getPoint(i/9);
        const pennant=mesh(group,new T.ConeGeometry(.15,.43,3),i%2?this.lacquer:this.cream,pt.x,pt.y-.2,pt.z);
        pennant.rotation.z=Math.PI+.16; pennant.scale.z=.2;
      }
      for (const x of [-.72, .72]) for (const z of [-.75, .75])
        mesh(stall, new T.BoxGeometry(.07, 2.1, .07), this.darkWood, x, 1, z);
      const canopy = mesh(stall, canopyGeometry(1.85, 2.05, .13), this.fabric, 0, 2.15, 0);
      surface(canopy,'awning','cloth');canopy.castShadow = true;
      mesh(stall, new T.BoxGeometry(1.55, .65, .55), this.wood[1], 0, .38, -.35);
      if(this.solidHarbor)fishCounter(stall,this,mesh);
      else for (let i = 0; i < 3; i++) mesh(stall, new T.SphereGeometry(.13, 10, 8), new T.MeshStandardMaterial({ color: [0xc46c46, 0x9aa85e, 0xdfb878][i] }), -.4 + i * .38, .77, -.3);
      this.lantern(stall, 0, 1.64, -.5, 1.25);
      this.lightPool(stall, 0, -.25, 2.6);
      const crate = roundedMesh(group, .6, .48, .6, this.wood[0], 1.85, .24, 1.62, .045); crate.rotation.y = -.1;
      mesh(group, new T.BoxGeometry(.63, .035, .63), this.darkWood, 1.85, .49, 1.62);
    }
    if (entity.dressing === 'lanternGate') {
      for (const x of [-1.48, 1.48]) {
        mesh(group, new T.BoxGeometry(.13, 2.55, .13), this.darkWood, x, 1.25, -.8);
        mesh(group, new T.BoxGeometry(.25, .09, .25), this.lacquer, x, 2.56, -.8);
      }
      mesh(group, new T.BoxGeometry(3.45, .14, .18), this.lacquer, 0, 2.36, -.8);
      this.lantern(group, 0, 1.78, -.8, 1.65);
      this.lightPool(group, 0, -.8, 3.1);
      for (const x of [-1.8, 1.8]) { this.lantern(group, x, .55, 1.42, 1.0); this.lightPool(group, x, 1.42, 1.8); }
    }
    this.entities.set(entity.id, { ...entity, group, velocity: [0, 0, 0] });
  }
  buildStallRun(entity) {
    const from = new T.Vector3(...entity.from), to = new T.Vector3(...entity.to);
    if (Math.abs(from.y - to.y) > .02 || (Math.abs(from.x - to.x) > .02 && Math.abs(from.z - to.z) > .02)) throw new Error('stallRun currently needs a level, axis-aligned span');
    const bays = entity.bays;
    const horizontal = Math.abs(from.x - to.x) > .02;
    const span = Math.abs(horizontal ? from.x - to.x : from.z - to.z);
    const walkwayWidth = entity.width ?? 2.2;
    const size = horizontal ? [span + 1.6, walkwayWidth] : [walkwayWidth, span + 1.6];
    const at = from.clone().add(to).multiplyScalar(.5).toArray();
    const baySize = (span + 1.6) / bays;
    const group = new T.Group(); group.position.fromArray(at); this.root.add(group);
    for (let i = 0; i < bays; i++) {
      const offset = -(span + 1.6) / 2 + baySize * (i + .5);
      const bay = new T.Group();
      if (horizontal) bay.position.x = offset; else bay.position.z = offset;
      group.add(bay);
      this.deck(bay, horizontal ? baySize + .03 : walkwayWidth, horizontal ? walkwayWidth : baySize + .03);
      const outer = entity.outerSide === 'left' ? -1 : 1;
      const canopy = new T.Group();
      if (horizontal) canopy.position.z = outer * (walkwayWidth / 2 - .18); else canopy.position.x = outer * (walkwayWidth / 2 - .18);
      bay.add(canopy);
      for (const y of [.95]) {
        if (horizontal) for (const x of [-baySize * .36, baySize * .36]) mesh(canopy, new T.BoxGeometry(.055, 1.9, .055), this.darkWood, x, y, 0);
        else for (const z of [-baySize * .36, baySize * .36]) mesh(canopy, new T.BoxGeometry(.055, 1.9, .055), this.darkWood, 0, y, z);
      }
      const awning = surface(mesh(canopy, canopyGeometry(horizontal ? baySize + .03 : 1.4, horizontal ? 1.4 : baySize + .03, .12), this.fabric, 0, 1.98, 0),'awning','cloth');

      this.lantern(canopy, 0, 1.52, 0, .85);
      if (i % 2 === 0) mesh(bay, new T.BoxGeometry(.48, .55, .48), this.wood[i % 3], horizontal ? 0 : outer * .55, .29, horizontal ? outer * .55 : 0);
      if(i%2===0){
        const counter=new T.Group();
        counter.position.copy(canopy.position);
        if(horizontal) counter.rotation.y=Math.PI/2;
        bay.add(counter);
        mesh(counter,new T.BoxGeometry(.55,.7,1.55),this.wood[2],0,.36,0);
        for(let j=0;j<3;j++){
          const jar=mesh(counter,new T.SphereGeometry(.17,10,8),j===1?this.cream:this.lacquer,0,.89,(j-1)*.41);
          jar.scale.y=1.2;
          mesh(counter,new T.CylinderGeometry(.086,.09,.08,10),this.brass,0,1.07,(j-1)*.41);
        }
      }
    }
    this.entities.set(entity.id, { ...entity, at, size, kind: 'stallRun', group, velocity: [0, 0, 0] });
  }
  buildFerry(entity) {
    if (!Array.isArray(entity.path) || entity.path.length !== 2 || entity.speed <= 0) throw new Error('ferry needs a two-point path and positive speed');
    const group = new T.Group(); group.position.fromArray(entity.at ?? entity.path[0]); this.root.add(group);
    const width = 4.2, depth = 3.1;
    this.deck(group, width, depth, false);
    const hull = mesh(group, boatHullGeometry(width, depth, 1.08), this.lacquer, 0, -.12, 0);
    for (const x of [-1.5, 1.5]) {
      mesh(group, new T.BoxGeometry(.12, 2.4, .12), this.darkWood, x, 1.18, .5);
      mesh(group, new T.BoxGeometry(.12, 2.4, .12), this.darkWood, x, 1.18, -.55);
    }
    mesh(group, curvedRoofGeometry(3.75, 2.05), this.lacquer, 0, 2.32, 0);
    for (const x of [-1.15, 1.15]) roundedMesh(group, .68, .55, 1.4, this.wood[0], x, .28, .25, .06);
    for (const x of [-1.6, 0, 1.6]) this.lantern(group, x, 1.75, .68, 1.3);
    mesh(group, new T.CylinderGeometry(.03, .055, 3.2, 8), this.darkWood, 0, 2.7, .8);
    const flag = mesh(group, new T.PlaneGeometry(.72, .38), this.cream, .37, 3.85, .8); flag.rotation.y = Math.PI / 2;
    mesh(group, new T.SphereGeometry(.1, 12, 8), this.lamp, .15, 1.02, .85);
    const wake = this.makeWake(width, depth, group.position.x, group.position.z);
    this.entities.set(entity.id, { ...entity, at: [...(entity.at ?? entity.path[0])], size: [width, depth], group, wake, velocity: [0, 0, 0], motion: { path: entity.path.map(p => new T.Vector3(...p)), segment: entity.runtime?.segment ?? 1, direction: 1, dwell: entity.runtime?.dwell ?? entity.initialDwell ?? 10 } });
  }
  buildSkiff(entity) {
    const group = new T.Group(); group.position.fromArray(entity.at); this.root.add(group);
    const [width, depth] = entity.size;
    const hull = mesh(group, boatHullGeometry(width, depth, 1.02), this.lacquer, 0, -.12, 0);
    this.deck(group, width, depth, false);
    for (const x of [-width / 2 + .045, width / 2 - .045]) mesh(group, new T.BoxGeometry(.085, .18, depth), this.lacquer, x, .035, 0);
    mesh(group, new T.CylinderGeometry(.025, .04, 1.6, 7), this.darkWood, -width * .3, .68, depth * .24);
    const flag = mesh(group, new T.PlaneGeometry(.44, .28), this.cream, -width * .3 + .22, 1.29, depth * .24); flag.rotation.y = Math.PI / 2;
    this.lantern(group, width * .27, .65, depth * .25, .95);
    const wake = this.makeWake(width, depth, group.position.x, group.position.z);
    this.entities.set(entity.id, { ...entity, group, wake, velocity: [0, 0, 0] });
  }
  setLights(on) {
    this.lamp.emissiveIntensity = on ? .95 : 0;
    this.lamp.color.setHex(on ? 0xffdca1 : 0x756b61);
    this.poolMaterial.opacity = on ? .23 : 0;
    if (this.lanternGlow) this.lanternGlow.opacity = on ? .48 : 0;
    let number=0;
    for(const entity of this.entities.values())entity.fixtures.forEach((fixture,i)=>{
      number++;
      const pattern=this.level.weather.lampPattern;
      const enabled=entity.lampOverrides?.[i+1] ?? (pattern==='all' || number%2===(pattern==='odd' ? 1 : 0));
      const lit=on && entity.lamps!==false && enabled;
      fixture.paper.visible=true;fixture.paper.material=lit ? this.lamp : this.darkLamp;
      fixture.glow.visible=lit;
      fixture.pools.forEach(pool=>{pool.visible=lit;});
    });
  }
  seaAt(x, z) {
    return this.tide + this.waveHeight * (.68*Math.sin(x*.31+z*.19+this.seaTime*1.85) +
      .32*Math.sin(z*.44-x*.13-this.seaTime*1.31));
  }
  buildWall(entity) {
    const group = new T.Group();
    group.position.fromArray(entity.at);
    this.root.add(group);
    const [width, depth] = entity.size;
    surface(mesh(group,new T.BoxGeometry(width,entity.height,depth),this.wood[1],0,-entity.height/2,0),'wall','wood');
    mesh(group,new T.BoxGeometry(width,.12,depth),this.lacquer,0,-.06,0);
    this.entities.set(entity.id,{...entity, group, velocity:[0,0,0]});
  }
  // Resolve the traveler against the side faces. The existing deck solver handles landing on top.
  slidePastWalls(position, axis, delta) {
    position[axis] += delta;
    const cross = axis === 'x' ? 'z' : 'x';
    for (const wall of this.entities.values()) {
      if (wall.kind !== 'wall') continue;
      const p = wall.group.position;
      if (position.y >= p.y-.04 || position.y+1.45 <= p.y-wall.height) continue;
      const half = wall.size[axis === 'x' ? 0 : 1]/2+.20;
      const side = wall.size[axis === 'x' ? 1 : 0]/2+.20;
      if (Math.abs(position[cross]-p[cross]) >= side || Math.abs(position[axis]-p[axis]) >= half) continue;
      const previous = position[axis]-delta-p[axis];
      if (Math.abs(previous) >= half-.001) position[axis] = p[axis]+Math.sign(previous)*half;
    }
  }
  wallBlocks(start, end) {
    const direction = end.clone().sub(start);
    const distance = direction.length();
    const ray = new T.Ray(start,direction.normalize());
    for (const wall of this.entities.values()) {
      if (wall.kind !== 'wall') continue;
      const p = wall.group.position, [w,d] = wall.size;
      const box = new T.Box3(new T.Vector3(p.x-w/2,p.y-wall.height,p.z-d/2),new T.Vector3(p.x+w/2,p.y,p.z+d/2));
      const hit = ray.intersectBox(box,new T.Vector3());
      if (box.containsPoint(start) || (hit && hit.distanceTo(start) <= distance)) return true;
    }
    return false;
  }
  jetDistance(origin,direction,range){return traceSolid(this.entities,origin,direction,range,false).distance;}
  traceTerrain(origin,direction,range){return traceWheels(this.entities,origin,direction,traceSolid(this.entities,origin,direction,range));}
  disposePiece(entity) {
    entity.group.traverse(node => { if(node.isInstancedMesh)node.dispose();if(node.isMesh)node.geometry.dispose(); });
    entity.sailRig?.userData.cloth.dispose();
    entity.trimMaterial?.dispose();
    entity.group.removeFromParent();
    if(entity.wake){entity.wake.geometry.dispose();entity.wake.material.dispose();entity.wake.removeFromParent();}
  }
  removePiece(id) {
    const entity=this.get(id);
    this.surfaces.forget(id);this.disposePiece(entity);
    this.entities.delete(id);
    this.level.stations=this.level.stations.filter(station=>station.deck!==id);
    this.transitions = this.transitions.filter(t => t.entity !== entity);
    this.level.entities = this.level.entities.filter(e => e.id !== id);
  }
  buildEntity(entity) {
    if (entity.kind === 'dock') this.buildDock(entity);
    else if (entity.kind === 'wall') this.buildWall(entity);
    else if (entity.kind === 'skiff') this.buildSkiff(entity);
    else if (entity.kind === 'stallRun') this.buildStallRun(entity);
    else if (entity.kind === 'ferry') this.buildFerry(entity);
    else throw new Error(`Unsupported entity kind: ${entity.kind}`);
    const live=this.get(entity.id);
    if(entity.paused)live.motion=null;
    else if(entity.path && !live.motion)live.motion={path:entity.path.map(p=>new T.Vector3(...p)),segment:entity.runtime?.segment??1,dwell:entity.runtime?.dwell??0};
    if(this.solidHarbor) {
      live.localSolids=collectSolids(live.group);
      fitSolids(live);
    }
    live.fixtures=[];
    const pools=[];
    live.group.traverse(n=>{
      if(n.userData.fixture)live.fixtures.push(n.userData.fixture);
      if(n.material===this.poolMaterial)pools.push(n);
    });
    live.group.updateWorldMatrix(true,true);
    for(const pool of pools){
      const at=pool.getWorldPosition(new T.Vector3());
      let nearest=null,best=Infinity;
      for(const fixture of live.fixtures){
        const dist=fixture.paper.getWorldPosition(new T.Vector3()).distanceToSquared(at);
        if(dist<best){nearest=fixture;best=dist;}
      }
      nearest?.pools.push(pool);
    }
    if(live.motion)live.motion.waiting=entity.runtime?.waiting ?? (entity.depart==='board');
    batchDeck(live.group);
    live.devices=new Map();
    if(entity.dressing==='windmill'){
      const device=rotor('mill:'+live.id,millSails(live,this,mesh),true);live.devices.set(device.id,device);
    }
    live.originalSize=[...live.size];
    if(entity.footprint) this.resize(live,entity.footprint);
    if(entity.sail)setSail(live,entity.sail,this,mesh);
    if(entity.turn || entity.paint || entity.lamps===false)this.finishPiece(live,entity,entity,true);
    live.stations=new Map();
    for(const station of this.level.stations)if(station.deck===entity.id)live.stations.set(station.id,stationModel(station,live,this));
  }
  finishPiece(live,spec,edit,loading=false){
    if(!loading && (edit.slope || edit.dressing!==undefined && spec.dressing!==edit.dressing)){
      const previous=live;
      this.surfaces.forget(spec.id);
      if(edit.dressing!==undefined)spec.dressing=edit.dressing;
      if(edit.slope)setSlope(spec,edit.slope);
      if(!slopeStyles.includes(spec.dressing)){delete spec.grade;delete spec.axis;}
      this.buildEntity(spec);
      live=this.get(spec.id);
      live.group.position.copy(previous.group.position);
      live.motion=previous.motion;live.velocity=previous.velocity;
      for(const transition of this.transitions)if(transition.entity===previous)transition.entity=live;
      this.disposePiece(previous);
    }
    if(edit.sail!==undefined && !loading){spec.sail=edit.sail;setSail(live,edit.sail,this,mesh);}
    if(edit.turn!==undefined){
      const old=loading?0:live.turn||0;
      if((old%180)!==(edit.turn%180) && !(loading && spec.footprint))live.size=[...live.size].reverse();
      live.turn=spec.turn=edit.turn;
      live.group.rotation.y=edit.turn*Math.PI/180;
      this.resize(live,live.size);
      if(!loading)spec.footprint=[...live.size];
      if(live.wake) live.wake.rotation.z=live.group.rotation.y;
    }
    if(edit.paint!==undefined){
      live.paint=spec.paint=edit.paint;
      live.trimMaterial??=this.lacquer.clone();
      live.trimMaterial.color.set(edit.paint);
      live.group.traverse(n=>{if(n.material===this.lacquer || Object.values(this.landPigments??{}).includes(n.material) || (this.wood.includes(n.material) || n.material===this.pierTimber) && (live.kind==='wall' || live.kind==='dock'))n.material=live.trimMaterial;});
    }
    if(edit.lamps!==undefined){
      live.lamps=spec.lamps=edit.lamps;
      live.group.traverse(n=>{
        if(n.material===this.lanternGlow || n.material===this.poolMaterial || n.material===this.lamp)n.visible=edit.lamps;
      });
    }
  }
  resize(entity, size) {
    const swap=entity.turn%180===90;
    entity.group.scale.set(size[swap?1:0]/entity.originalSize[0],1,size[swap?0:1]/entity.originalSize[1]);
    entity.size=[...size];
    if(entity.localSolids)fitSolids(entity);
    if(entity.wake) entity.wake.scale.set(entity.group.scale.x,entity.group.scale.z,1);
  }
  clearEntities() {
    this.root.traverse(object => { if(object.isInstancedMesh)object.dispose();if (object.isMesh) object.geometry.dispose(); });
    this.scene.remove(this.root); this.root.clear(); this.entities.clear(); this.transitions.length = 0;
    this.root = new T.Group(); this.scene.add(this.root); this.random = seeded(this.level.seed);
  }
  replaceLevel(command) {
    if (command.base !== this.level.revision) throw new Error(`Stale base ${command.base}; current revision is ${this.level.revision}.`);
    const spec = {
      v: 1, world: command.world, levelId: command.cmd, revision: this.level.revision + 1, seed: command.seed ?? 71, look: command.look || 'indigo-rain', traveler:{...defaultTraveler,...command.traveler},
      weather: { ...defaultWeather, ...command.weather },
      behaviors:structuredClone(command.behaviors ?? []), mechanicTime:Number.isFinite(command.mechanicTime)?Math.max(0,command.mechanicTime):0,
      stations:structuredClone(command.stations ?? []),cargo:structuredClone(command.cargo ?? []),cues:structuredClone(command.cues ?? []), spawn: command.spawn, goal: structuredClone(command.goal), entities: structuredClone(command.entities), encounters: structuredClone(command.encounters ?? []),
    };
    if(command.wilderness!=null){
      const {ground,warning,pursuit}=command.wilderness;
      if(!landStyles.includes(ground) || !Number.isFinite(warning) || !Number.isFinite(pursuit) || warning<0 || pursuit<warning+.5 || pursuit>120)
        throw Error('Wilderness needs a terrain style, warning time and later pursuit (up to 120s).');
      spec.wilderness={ground,warning,pursuit};
    }
    if(command.trailNotes)spec.trailNotes=Object.fromEntries(Object.entries(command.trailNotes).filter(([,note])=>typeof note==='string'));
    if (!Array.isArray(spec.behaviors) || spec.behaviors.length>8 || new Set(spec.behaviors.map(b=>b?.id)).size!==spec.behaviors.length) throw new Error('Use up to eight distinct behaviors.');
    for (const rule of spec.behaviors) {
      if(!rule || rule.remove)throw new Error('Expected a behavior definition.');
      const error=behaviorError(rule);if(error)throw new Error(error);
      rule.state??={};delete rule.error;
    }
    if (!Array.isArray(command.entities) || command.entities.length < 2 || command.entities.length > 128) throw new Error('A generated level needs 2–128 entities.');
    if(!Array.isArray(spec.stations)||!Array.isArray(spec.cargo)||spec.cargo.some(c=>typeof c.item!=='string'||!Number.isInteger(c.count)||c.count<0))throw new Error('Invalid station or cargo list.');
    const decks=new Map(spec.entities.map(e=>[e.id,e]));
    for(const station of spec.stations){const error=stationError(station,decks);if(error)throw new Error(error);}
    if(travelerError(spec.traveler))throw new Error(travelerError(spec.traveler));
    if(weatherError(spec.weather))throw new Error(weatherError(spec.weather));
    const unique = new Set();
    for (const entity of command.entities) {
      if (!entity.id || unique.has(entity.id)) throw new Error('Entity IDs must be unique.');
      unique.add(entity.id);
      if (!['dock', 'skiff', 'stallRun', 'ferry','wall'].includes(entity.kind)) throw new Error(`Unsupported kind ${entity.kind}.`);
      if(landStyles.includes(entity.dressing)){
        if(!validSize(entity.size) || !validPoint(entity.at))throw new Error('Terrain needs an in-bounds center and dimensions of .35–96 m.');
        if(entity.grade!==undefined && (!Number.isFinite(entity.grade) || Math.abs(entity.grade)>48 || ![0,2].includes(entity.axis)))throw new Error('Terrain grade needs a finite rise up to 48 m on X or Z.');
      }
      if(entity.kind==='wall' && (!validSize(entity.size) || !Number.isFinite(entity.height) || entity.height<.35 || entity.height>30)) throw new Error('Invalid wall dimensions.');
      if (entity.kind === 'stallRun') {
        if (!Array.isArray(entity.from) || !Array.isArray(entity.to) || entity.from.length !== 3 || entity.to.length !== 3 || !entity.from.concat(entity.to).every(Number.isFinite) || !Number.isInteger(entity.bays) || entity.bays < 1 || entity.bays > 8 || (entity.width !== undefined && (!Number.isFinite(entity.width) || entity.width < 1.6 || entity.width > 4))) throw new Error(`Invalid stallRun ${entity.id}.`);
      } else if (entity.kind === 'ferry') {
        if (!Array.isArray(entity.path) || entity.path.length !== 2 || !entity.path.flat().every(Number.isFinite) || !Number.isFinite(entity.speed) || entity.speed <= 0 || entity.speed > 4) throw new Error(`Invalid ferry ${entity.id}.`);
      } else if (!Array.isArray(entity.at) || entity.at.length !== 3 || !entity.at.every(Number.isFinite)) throw new Error(`Invalid position for ${entity.id}.`);
    }
    const spawnEntity = this.findEntitySpec(spec, command.spawn?.split(':')[0]);
    if (!spawnEntity || !['dock', 'skiff', 'stallRun'].includes(spawnEntity.kind)) throw new Error('Spawn must name a dock, skiff, or stallRun.');
    if (!Array.isArray(spec.encounters) || spec.encounters.length > 32) throw new Error('A level supports up to 32 encounters.');
    const encounterIds = new Set();
    for (const encounter of spec.encounters) {
      const error = this.validateEncounter(encounter);
      if (error) throw new Error(error);
      if (unique.has(encounter.id) || encounterIds.has(encounter.id)) throw new Error('Entity and encounter IDs must be unique.');
      encounterIds.add(encounter.id);
      if (encounter.arena && !unique.has(encounter.arena)) throw new Error(`Encounter ${encounter.id} names a missing arena.`);
    }
    if (!command.goal || !['reach', 'board', 'defeat'].includes(command.goal.type)) throw new Error('Goal type must be reach, board, or defeat.');
    if (command.goal.type === 'defeat') {
      if (!encounterIds.has(command.goal.target)) throw new Error('Defeat goal must name an encounter.');
    } else if (!this.findEntitySpec(spec, command.goal.target)) throw new Error('Reach/board goal needs a target entity ID.');
    if(spec.goal.stops && (!Array.isArray(spec.goal.stops) || spec.goal.stops.some(stop=>!unique.has(stop.platform) || (stop.guardian && !encounterIds.has(stop.guardian))))) throw new Error('Route stops must reference existing platforms and guardians.');
    const oldRoot = this.root;
    const oldLevel = this.level;
    const oldEntities = this.entities;
    try {
      this.level = spec;
      this.root = new T.Group();
      this.entities = new Map();
      this.random = seeded(spec.seed);
      for (const entity of spec.entities) this.buildEntity(entity);
      restoreDefinitions(spec,command,this.entities,this.solidHarbor,ownedChangeError);
      if(!Array.isArray(spec.cues))throw new Error('Expected an array of cues.');
      for(const cue of spec.cues){
        const error=this.validateOps([{...cue,op:'cue'}],new Map(this.entities),new Map(spec.encounters.map(e=>[e.id,e])));
        if(error)throw new Error(error);
      }
      this.waveHeight=this.level.weather.waves; this.setLights(this.level.weather.lights);
      this.scene.add(this.root);
      this.scene.remove(oldRoot);
      oldRoot.traverse(object => { if(object.isInstancedMesh)object.dispose();if (object.isMesh) object.geometry.dispose(); });
      this.surfaces.restore(command.surfaceStates);this.intercept.job=null;this.intercept.last=null;this.layoutVersion++;
      this.reach.clear();initKit(this);this.playerEffects.length=0;
      this.transitions.length = 0;
      this.entities.forEach(entity => { groupSafe(entity.group); });
      const spawn=this.get(command.spawn.split(':')[0]);
      const side=command.spawn.endsWith(':exit')?-1:1;
      return this.arrival(spawn,side*spawn.size[1]*(spawn.kind==='stallRun'?.3:.25)).toArray();
    } catch (error) {
      this.level = oldLevel;
      this.root = oldRoot;
      this.entities = oldEntities;
      throw error;
    }
  }
  findEntitySpec(spec, id) { return spec.entities.find(entity => entity.id === id); }
  get(id) { return this.entities.get(id); }
  validateEncounter(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id || !['wisp', 'heron', 'crab'].includes(spec.kind)) return 'Encounter needs a unique ID and kind wisp, heron or crab.';
    const appearanceError = formError(spec.form);
    if (appearanceError) return appearanceError;
    if (!Array.isArray(spec.at) || spec.at.length !== 3 || !spec.at.every(Number.isFinite) || !insideBasin(spec.at)) return `Invalid encounter position for ${spec.id}.`;
    if (!Number.isInteger(spec.maxHits) || spec.maxHits < 1 || spec.maxHits > 8) return `${spec.id} needs 1–8 hits.`;
    if (!Number.isFinite(spec.activationRange) || spec.activationRange < 1 || spec.activationRange > 20) return `${spec.id} activationRange must be 1–20 meters.`;
    if (spec.pulseRange !== undefined && (!Number.isFinite(spec.pulseRange) || spec.pulseRange < 1.8 || spec.pulseRange > 4)) return `${spec.id} pulseRange must be 1.8–4 meters.`;
    if (spec.friendly !== undefined && typeof spec.friendly !== 'boolean') return `${spec.id} friendly must be boolean.`;
    if (spec.arena !== undefined && typeof spec.arena !== 'string') return `${spec.id} arena must name an entity.`;
    if (!Array.isArray(spec.phases) || spec.phases.length < 1 || spec.phases.length > 3) return `${spec.id} needs 1–3 phases.`;
    let previousAfter = -1;
    for (const phase of spec.phases) {
      if (!Number.isInteger(phase.afterHits) || phase.afterHits < 0 || phase.afterHits >= spec.maxHits || phase.afterHits <= previousAfter) return `${spec.id} afterHits must increase and stay below maxHits.`;
      previousAfter = phase.afterHits;
      const movements=this.solidHarbor && spec.kind!=='heron' ? ['perch','orbit','advance','flank'] : ['perch','orbit'];
      if (!movements.includes(phase.movement) || !['aimedPearl', 'pearlFan', 'pearlRing', 'charge'].includes(phase.attack)) return `${spec.id} has an unsupported movement or attack.`;
      if (phase.sequence !== undefined && (!spec.arena || !Array.isArray(phase.sequence) || !phase.sequence.length ||
          phase.sequence.length>6 || phase.sequence.some(move=>typeof move!=='string' || !Object.hasOwn(bossMoves,move)))) return 'Boss phases need an arena and a sequence of 1–6 broadside, breaker, pincers, bellfall or antlerSweep moves.';
      if (phase.attack === 'charge' && phase.movement !== 'perch') return 'A charging enemy needs a stationary starting perch.';
      if (!Number.isInteger(phase.count) || phase.count < 1 || phase.count > 7 || (phase.attack === 'aimedPearl' && phase.count !== 1)) return `${spec.id} needs valid projectile counts.`;
      if (!Number.isFinite(phase.spread) || phase.spread < 0 || phase.spread > 1.2) return `${spec.id} spread must be 0–1.2 radians.`;
      if (!Number.isFinite(phase.projectileSpeed) || phase.projectileSpeed < 1.5 || phase.projectileSpeed > 7) return `${spec.id} projectileSpeed must be 1.5–7 m/s.`;
      if (!Number.isFinite(phase.tell) || phase.tell < .5 || phase.tell > 3 || !Number.isFinite(phase.recover) || phase.recover < 1 || phase.recover > 5 || !Number.isFinite(phase.interval) || phase.interval < .2 || phase.interval > 3) return `${spec.id} has invalid attack timing.`;
      if ((phase.radius !== undefined && (!Number.isFinite(phase.radius) || phase.radius < 0 || phase.radius > 3)) || (phase.speed !== undefined && (!Number.isFinite(phase.speed) || phase.speed < .1 || phase.speed > 3))) return `${spec.id} has invalid orbit movement.`;
    }
    return null;
  }
  supportAt(x, z, margin = .04, ceiling = Infinity) {
    let highest=null;
    for (const entity of this.entities.values()) {
      const p = entity.group.position;
      if (p.y<=ceiling && (!highest || p.y>highest.group.position.y) && Math.abs(x-p.x)<=entity.size[0]/2-margin && Math.abs(z-p.z)<=entity.size[1]/2-margin) highest=entity;
    }
    return highest;
  }
  validate(command) {
    if (!command || command.v !== 1 || typeof command.cmd !== 'string') return 'Expected world schema v1 and a command ID.';
    if (command.base !== this.level.revision) return `Stale base ${command.base}; current revision is ${this.level.revision}.`;
    if (command.mode === 'replace') {
      try { this.replacementSpawn = this.replaceLevel(command); return null; } catch (error) { return error.message; }
    }
    if (command.world !== this.level.world || command.mode !== 'patch') return 'This room accepts patches for the current world only.';
    if (command.levelId !== this.level.levelId) return `Level ID mismatch: expected ${this.level.levelId}.`;
    return this.validateOps(command.ops,new Map(this.entities),new Map(this.level.encounters.map(e=>[e.id,e])));
  }
  validateOps(ops,pieces,encounters,stations=new Map(this.level.stations.map(s=>[s.id,s]))) {
    if(!Array.isArray(ops) || !ops.length || ops.length>16)return 'Provide 1–16 operations.';
    const kit=validationState(this.level);
    const ruleIds=new Set(this.level.behaviors.map(b=>b.id));
    for(const op of ops){
      if (!op || typeof op !== 'object') return 'Expected a world operation.';
      if (Object.hasOwn(op,'owner')) return 'Ownership is assigned by an effect, not an operation field.';
      if(kitOps.includes(op.op)){
        const error=kitError(op,this,pieces,encounters,kit,ownedChangeError);
        if(error)return error;
      }else if(op.op==='behavior'){
        const error=behaviorError(op);if(error)return error;
        if(op.remove===true)ruleIds.delete(op.id);else ruleIds.add(op.id);

      }else if(op.op==='intercept'){
        if(op.id!==undefined && !isCarrier(pieces.get(op.id)) || op.speed!==undefined && !(Number.isFinite(op.speed)&&op.speed>=1&&op.speed<=18))return 'Use an existing mobile deck and speed 1–18 m/s, or omit id to choose the nearest viable carrier.';
      }else if(op.op==='drive'){
        const deck=pieces.get(op.id),station=typeof op.device==='string' && op.device.startsWith('wheel:') && stations.get(op.device.slice(6));
        const installed=deck && (deck.dressing==='windmill' && op.device==='mill:'+op.id || station?.kind==='wheel' && station.deck===op.id);
        if(!installed || !Number.isFinite(op.spin) || Math.abs(op.spin)>12)return 'Choose an installed device and spin from -12 to 12 rad/s.';
      }else if(op.op==='surface'){
        const error=this.surfaces.error(op,pieces);if(error)return error;
      }else if(Object.hasOwn(kineticFields,op.op)){
        const error=kineticError(op,pieces,encounters);if(error)return error;
      }else if(op.op==='station'){
        const error=stationError(op,pieces);if(error)return error;
        if(op.remove===true)stations.delete(op.id);else stations.set(op.id,op);
      }else if(op.op==='cast'){
        const error=castError(op,pieces,encounters);if(error)return error;
      }else if(op.op==='passage'){
        if(!pieces.has(op.to) || pieces.get(op.to).kind==='wall')return 'Choose a landing deck.';
      }else if(op.op==='mend'){
        if(!Number.isInteger(op.hearts)||op.hearts<1||op.hearts>3)return 'Restore one to three hearts.';
      }else if(op.op==='say'){
        if(typeof op.text!=='string'||!op.text.trim())return 'Supply the message to show the player.';
      }else if(op.op==='cue'){
        if(typeof op.id!=='string' || !op.id.trim())return 'Name the cue.';
        if(op.remove===true)continue;
        const targets=op.when==='land' ? pieces : op.when==='defeat' ? encounters : null;
        if(op.when==='after'){
          if(!Number.isFinite(op.seconds)||op.seconds<1)return 'A timer needs at least one second.';
        }else if(['use','collect'].includes(op.when)){
          const station=stations.get(op.target);
          if(!station || station.kind==='wheel' || (op.when==='collect')!==(station.kind==='cargo'))return 'Use a bell/shrine for use, or cargo for collect.';
        }else if(!['hurt','overboard','jump','attack'].includes(op.when) && !targets?.has(op.target))return 'Choose a supported event and matching target.';
        if(op.needs && (typeof op.needs.item!=='string'||!op.needs.item.trim()||!Number.isInteger(op.needs.count)||op.needs.count<1))return 'A cargo condition needs an item and a positive integer count.';
        if(!Array.isArray(op.then) || op.then.some(action=>['cue','behavior'].includes(action?.op) || action?.op==='effect' && action.change?.op==='behavior'))return 'A cue runs ordinary harbor operations, not another cue.';
        const error=this.validateOps(op.then,new Map(pieces),new Map(encounters),new Map(stations));if(error)return error;
      }else if(op.op==='traveler'){
        const error=travelerError(op);if(error)return error;
      }else if(op.op==='lantern'){
        const fixtures=pieces.get(op.id)?.fixtures;
        if(!Number.isInteger(op.index) || !fixtures || op.index<1 || op.index>fixtures.length || ![true,false,'pattern'].includes(op.on))return 'Choose an existing fixture by its one-based index and on: true, false or pattern.';
      }else if (op.op === 'weather') {
        const error=weatherError(op);
        if(error)return error;
      } else if(op.op==='finish'){
        if(!pieces.has(op.id) || (op.turn===undefined && op.paint===undefined && op.lamps===undefined && op.sail===undefined && op.dressing===undefined && op.slope===undefined))return 'Choose a piece and a finish.';
        if(op.dressing!==undefined && (pieces.get(op.id).kind!=='dock' || !['plain',...deckStyles].includes(op.dressing)))return 'Use a dock or building and a supported deck style.';
        const error=slopeError(op.slope,op.dressing??pieces.get(op.id).dressing);if(error)return error;
        if(op.slope || op.dressing!==undefined && pieces.get(op.id).dressing!==op.dressing)pieces.set(op.id,{...pieces.get(op.id),parts:null,dressing:op.dressing??pieces.get(op.id).dressing});
        if(op.sail!==undefined && (!['skiff','ferry'].includes(pieces.get(op.id).kind) || (op.sail!=='none' && !/^#[a-f0-9]{6}$/i.test(op.sail))))return 'Sails: choose a boat and use a #rrggbb color or none.';
        if(op.turn!==undefined && ![0,90,180,270].includes(op.turn))return 'turn is an absolute quarter-turn in degrees.';
        if(op.paint!==undefined && !/^#[a-f0-9]{6}$/i.test(op.paint))return 'Use a #rrggbb paint color.';
        if(op.lamps!==undefined && typeof op.lamps!=='boolean')return 'lamps must be true or false.';
      } else if(op.op==='waypoint'){
        const stop=this.level.goal.stops?.findIndex((s,i)=>i>=(this.routeStage||0) && s.platform===op.from);
        if(stop==null || stop<(this.routeStage||0) || !pieces.has(op.to) || !op.title?.trim?.() || !op.hint?.trim?.())return 'Choose an upcoming checkpoint, destination, title and hint.';
        if(ops.length!==1)return 'Change the checkpoint in its own patch.';
      } else if(op.op==='build'){
        if(typeof op.id!=='string' || !op.id || pieces.has(op.id) || encounters.has(op.id))return 'Give the new piece a unique ID.';
        if(!buildKinds.includes(op.kind) || !validPoint(op.at) || !validSize(op.size))return 'Use a listed build kind, a deck-top position within the basin, and width/depth .35–96 m.';
        const error=slopeError(op.slope,op.kind);if(error)return error;
        if(op.kind==='wall' && (!Number.isFinite(op.height)||op.height<.35||op.height>30))return 'Wall height must be .35–30 m below its top.';
        if(pieces.size>=128)return 'Harbor already contains 128 pieces.';
        pieces.set(op.id,newPiece(op));
      } else if(op.op==='removePiece'){
        if(!pieces.has(op.id) || [...encounters.values()].some(e=>e.arena===op.id) || this.level.spawn.split(':')[0]===op.id || this.level.goal.target===op.id || this.level.goal.stops?.some(s=>s.platform===op.id))return 'Choose an existing piece not used by spawn, a checkpoint, the goal, or an encounter.';
        if([...stations.values()].some(station=>station.deck===op.id))return 'Remove the stations on this deck first.';
        if([...kit.region.values()].some(r=>r.deck===op.id) || [...kit.intent.values()].some(r=>r.to===op.id))return 'Remove region or guide references to this deck first.';
        pieces.delete(op.id);
      } else if (op.op === 'move' || op.op === 'shuttle') {
        const entity = pieces.get(op.id);
        if (!entity) return `No platform named ${op.id}.`;
        if (!Array.isArray(op.to) || op.to.length !== 3 || !op.to.every(Number.isFinite)) return 'move.to must be [x,y,z].';
        if (!insideBasin(op.to)) return 'Destination is outside the authored harbor bounds.';
        if (op.duration !== undefined && (!Number.isFinite(op.duration) || op.duration < .4 || op.duration > 5)) return 'duration must be between 0.4 and 5 seconds.';
        if(op.op==='shuttle' && ((op.depart!==undefined && !['now','board'].includes(op.depart)) || (op.trip!==undefined && !['once','loop'].includes(op.trip))))return 'Use depart now/board and trip once/loop.';
        if(op.op==='shuttle' && (!Number.isFinite(op.speed) || op.speed<=0 || op.speed>4))return 'Shuttle speed must be above zero and at most 4 m/s.';
      } else if(op.op==='stop'){
        if(!pieces.get(op.id))return 'Choose an existing platform.';
      } else if (op.op === 'resize') {
        if (!pieces.get(op.id) || !Array.isArray(op.size) || op.size.length !== 2 || !op.size.every(n => Number.isFinite(n) && n >= 1 && n <= 96)) return 'Resize needs an existing platform and width/depth between 1 and 96 m.';
      } else if (op.op === 'spawnEncounter') {
        const error = this.validateEncounter(op.spec);
        if (error) return error;
        if (pieces.get(op.spec.id) || encounters.has(op.spec.id)) return `An entity or encounter named ${op.spec.id} already exists.`;
        encounters.set(op.spec.id,op.spec);
        if (encounters.size > 32) return 'The encounter budget is 32.';
        if (op.spec.arena && !pieces.get(op.spec.arena)) return `Missing arena ${op.spec.arena}.`;
      } else if (op.op === 'setEncounter') {
        if (op.id !== undefined && op.where !== undefined) return "Choose either an ID or a group filter.";
        const targets = encounterTargets([...encounters.values()],op);
        if (!targets.length || !op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) return "No matching encounters or missing patch.";
        const allowed = ['form', 'friendly', 'at', 'phases', 'maxHits', 'activationRange', 'pulseRange', 'arena'];
        if (Object.keys(op.patch).some(key => !allowed.includes(key))) return `Unsupported encounter fields: ${Object.keys(op.patch).filter(key => !allowed.includes(key)).join(', ')}`;
        for (const existing of targets) {
          const merged = { ...structuredClone(existing), ...structuredClone(op.patch), id: existing.id, kind: existing.kind };
          const error = this.validateEncounter(merged);
          if (error) return error;
          if(kit.intent.has(existing.id) && merged.phases.some(p=>p.sequence))return 'Remove the movement intent before giving this actor a boss sequence.';
          encounters.set(existing.id,merged);
          if (merged.arena && !pieces.get(merged.arena)) return `Missing arena ${merged.arena}.`;
        }
      } else if (op.op === 'removeEncounter') {
        if (!encounters.delete(op.id)) return `No encounter named ${op.id}.`;
        if (this.level.goal.type === 'defeat' && this.level.goal.target === op.id) return 'Cannot remove the current defeat goal target.';
      } else return `Unsupported operation: ${op.op}`;
      const owned=[...kit.effect.values()].filter(e=>e.change.op==='behavior');
      if(owned.some(e=>ruleIds.has(e.id)) || ruleIds.size+owned.length>8) return 'Use distinct IDs and at most eight active behaviors including owned effects.';
    }
    return null;
  }
  apply(command, receivedAt, fromBehavior=false, owner) {
    let spawnPosition = null;
    const error = this.validate(command);
    if (error) return { ok: false, cmd: command.cmd, error, revision: this.level.revision };
    if (command.mode === 'replace') {
      spawnPosition = this.replacementSpawn;
      this.replacementSpawn = null;
      return { ok: true, cmd: command.cmd, revision: this.level.revision, receivedAt, firstVisibleMs: null, applied: [`replace:${command.world}`], spawnPosition, generated: true, visibleOnRender: true };
    }
    if (!Array.isArray(command.ops)) return { ok: false, cmd: command.cmd, error: 'Patches need ops.', revision: this.level.revision };
    if(command.ops.some(op=>['build','finish','removePiece','move','resize','shuttle','stop'].includes(op.op)))this.layoutVersion++;
    const reactions=[];
    for (const op of command.ops) {
      if(op.id && this.intercept.job?.e.id===op.id && ['move','shuttle','removePiece','stop','finish','resize'].includes(op.op))this.intercept.job=null;
      if(kitOps.includes(op.op)){applyKit(this,op);continue;}
      if(op.op==='intercept'){this.playerEffects.push(op);continue;}
      if(op.op==='drive'){const device=this.get(op.id)?.devices.get(op.device);if(device)driveWheel(device,op.spin,'edit');continue;}
      if(op.op==='surface'){reactions.push(this.surfaces.change(op));continue;}
      if(op.op==='behavior'){
        this.level.behaviors=this.level.behaviors.filter(rule=>rule.id!==op.id);
        if(op.remove!==true)this.level.behaviors.push({id:op.id,on:[...op.on],code:op.code,state:structuredClone(op.state??{})});
        continue;
      }
      if(op.op==='station'){
        const old=this.level.stations.find(s=>s.id===op.id);
        if(old){
          const deck=this.get(old.deck),root=deck?.stations.get(old.id);
          if(old.kind==='wheel')deck?.devices.delete('wheel:'+old.id);
          root?.traverse(n=>n.geometry?.dispose());root?.removeFromParent();deck?.stations.delete(old.id);
        }
        this.level.stations=this.level.stations.filter(s=>s.id!==op.id);
        if(old && (op.remove===true || op.kind==='wheel' || (old.kind==='cargo')!==(op.kind==='cargo'))){
          this.level.cues=this.level.cues.filter(c=>!(['collect','use'].includes(c.when) && c.target===old.id));
        }
        if(op.remove!==true){
          const {op:unused,...spec}=structuredClone(op), deck=this.get(spec.deck);
          this.level.stations.push(spec);deck.stations.set(spec.id,stationModel(spec,deck,this));
        }
        continue;
      }
      if(Object.hasOwn(kineticFields,op.op)||['cast','mend','passage','say'].includes(op.op)){this.playerEffects.push(owner ? {...op,owner} : op);continue;}
      if(op.op==='cue'){
        this.level.cues=this.level.cues.filter(c=>c.id!==op.id);
        if(op.remove!==true)this.level.cues.push({id:op.id,when:op.when,target:op.target,seconds:op.seconds,remaining:op.seconds,repeat:op.repeat===true,needs:structuredClone(op.needs),then:structuredClone(op.then)});
        continue;
      }
      if(op.op==='traveler'){
        baseEdit(this.level,op);continue;
      }
      if(op.op==='lantern'){
        const spec=this.level.entities.find(e=>e.id===op.id);
        const overrides=spec.lampOverrides??={};
        if(op.on==='pattern')delete overrides[op.index];else overrides[op.index]=op.on;
        this.get(op.id).lampOverrides=overrides;this.setLights(this.level.weather.lights);continue;
      }
      if(op.op==='weather'){
        const {op:unused,...conditions}=op;
        if(conditions.time!==undefined && conditions.lights===undefined)conditions.lights=['night','sunset'].includes(conditions.time);
        baseEdit(this.level,op);
        if(conditions.lights!==undefined || conditions.lampPattern!==undefined)this.setLights(this.level.weather.lights);
        continue;
      }
      if(op.op==='waypoint'){
        const stop=this.level.goal.stops.find((s,i)=>i>=(this.routeStage||0) && s.platform===op.from);
        const objective=this.level.objectives.find(o=>o.id===op.from);if(objective)objective.id=op.to;
        Object.assign(stop,{platform:op.to,title:op.title,hint:op.hint});
        if(op.to!==op.from)delete stop.guardian;
        continue;
      }
      if(op.op==='finish'){
        const spec=this.level.entities.find(e=>e.id===op.id), live=this.get(op.id);
        this.finishPiece(live,spec,op);this.setLights(this.level.weather.lights);continue;
      }
      if(op.op==='build'){
        const piece=newPiece(op);
        this.buildEntity(piece); this.level.entities.push(piece);this.setLights(this.level.weather.lights);
        continue;
      }
      if(op.op==='removePiece'){this.removePiece(op.id);this.setLights(this.level.weather.lights);continue;}
      if (op.op === 'spawnEncounter') {
        this.level.encounters.push(structuredClone(op.spec));
        continue;
      }
      if (op.op === 'setEncounter') {
        for (const spec of encounterTargets(this.level.encounters,op)) Object.assign(spec,structuredClone(op.patch));
        continue;
      }
      if (op.op === 'removeEncounter') {
        this.level.intents=this.level.intents.filter(i=>i.id!==op.id);
        this.level.encounters = this.level.encounters.filter(encounter => encounter.id !== op.id);
        for(const stop of this.level.goal.stops || []){
          if(stop.guardian===op.id)delete stop.guardian;
        }
        continue;
      }
      const entity = this.get(op.id);
      const spec = this.level.entities.find(e => e.id === op.id);
      if(op.op==='resize'){ this.resize(entity,op.size); spec.footprint=[...op.size]; continue; }
      this.transitions=this.transitions.filter(tr=>tr.entity!==entity);
      if(op.op==='stop'){entity.motion=null;spec.paused=true;delete spec.runtime;continue;}
      if(op.op==='shuttle'){
        const anchor=entity.group.position.toArray();
        anchor[1]-=entity.bob || 0;
        spec.path=[anchor,[...op.to]];
        spec.depart=entity.depart=op.depart ?? 'now';spec.trip=entity.trip=op.trip ?? 'loop';
        entity.motion={path:spec.path.map(p=>new T.Vector3(...p)),segment:1,dwell:0,waiting:spec.depart==='board'};
        spec.speed=entity.speed=op.speed;delete spec.paused;continue;
      }
      if(entity.motion){
        const shift=new T.Vector3(...op.to).sub(entity.group.position);
        shift.y+=entity.bob || 0;
        entity.motion.path.forEach(point=>point.add(shift));
        spec.path=entity.motion.path.map(point=>point.toArray());
      }
      this.transitions.push({ cmd: command.cmd, receivedAt, op, entity, from: entity.group.position.clone().sub(new T.Vector3(0,entity.bob || 0,0)), to: new T.Vector3(...op.to), elapsed: 0, duration: op.duration || 1.8, visible: false });
      spec.at = [...op.to];
    }
    if(!fromBehavior || command.ops.some(o=>!Object.hasOwn(kineticFields,o.op)&&!['say','mend','cast'].includes(o.op)))this.level.revision += 1;
    if (command.ops.some(op => op.op === 'move')) this.pendingVisibility.set(command.cmd, receivedAt);
    return { ok: true, cmd: command.cmd, revision: this.level.revision, receivedAt, firstVisibleMs: null, ...(reactions.length && {reactions}), applied: command.ops.map(op => `${op.op}:${op.id || op.spec?.id || 'harbor'}`), syncEncounters: command.ops.some(op => op.op.endsWith('Encounter')), visibleOnRender: command.ops.some(op => op.op !== 'move') };
  }
  update(dt, footing=null) {
    this.seaTime += dt*(1+this.level.weather.wind*.6);
    this.tide=T.MathUtils.damp(this.tide,this.level.weather.tide,1.6,dt);
    this.waveHeight = T.MathUtils.damp(this.waveHeight,this.level.weather.waves,2,dt);
    for(const entity of this.entities.values()) if(entity.bob)entity.group.position.y-=entity.bob;
    const deltas = new Map();
    const events = [];
    for (const entity of this.entities.values()) {
      if(entity.sailRig)entity.sailRig.rotation.y=.22+this.level.weather.wind*.6+.04*Math.sin(this.seaTime*1.4);
      if(entity.devices.size)stepWheels(entity,this,dt);
      if(this.intercept.job?.e===entity){
        const previous=entity.group.position.clone();this.intercept.move(entity,dt);
        const delta=entity.group.position.clone().sub(previous);deltas.set(entity.id,delta);entity.velocity=delta.clone().divideScalar(dt).toArray();continue;
      }
      if (!entity.motion || this.transitions.some(tr => tr.entity === entity)) continue;
      const motion = entity.motion, previous = entity.group.position.clone();
      if(motion.waiting && footing!==entity.id){entity.velocity=[0,0,0];continue;}
      motion.waiting=false;
      if (motion.dwell > 0) motion.dwell -= dt;
      else {
        const target = motion.path[motion.segment];
        const distance = previous.distanceTo(target);
        if (distance < .03) {
          entity.group.position.copy(target);
          if(entity.trip==='once' && motion.segment===1){
            entity.motion=null;
            this.level.entities.find(e=>e.id===entity.id).paused=true;
          }
          motion.waiting=motion.segment===0 && entity.depart==='board';
          motion.segment = motion.segment === 0 ? 1 : 0;
          motion.dwell = entity.kind==='ferry'?4:this.solidHarbor && entity.dressing==='hoist'?2.5:1;
        } else entity.group.position.add(target.clone().sub(previous).normalize().multiplyScalar(Math.min(entity.speed * dt, distance)));
      }
      deltas.set(entity.id, entity.group.position.clone().sub(previous));
      entity.velocity = entity.group.position.clone().sub(previous).divideScalar(Math.max(dt, .0001)).toArray();
      const spec = this.level.entities.find(e => e.id === entity.id);
      if (spec) spec.at = entity.group.position.toArray();
    }
    for (let i = this.transitions.length - 1; i >= 0; i--) {
      const tr = this.transitions[i];
      tr.elapsed += dt;
      const t = clamp(tr.elapsed / tr.duration, 0, 1);
      const eased = t * t * (3 - 2 * t);
      const previous = tr.entity.group.position.clone();
      tr.entity.group.position.lerpVectors(tr.from, tr.to, eased);
      deltas.set(tr.entity.id, tr.entity.group.position.clone().sub(previous));
      tr.entity.velocity = tr.entity.group.position.clone().sub(previous).divideScalar(Math.max(dt, .0001)).toArray();
      if (!tr.visible && previous.distanceTo(tr.entity.group.position) > .0001) {
        tr.visible = true; events.push({ cmd: tr.cmd, firstVisibleMs: Date.now() - tr.receivedAt });
        this.pendingVisibility.delete(tr.cmd);
      }
      if (t === 1) this.transitions.splice(i, 1);
    }
    for (const entity of this.entities.values()) {
      if (!entity.motion && !deltas.has(entity.id) && !this.transitions.some(tr => tr.entity === entity)) entity.velocity = [0, 0, 0];
      if (entity.wake) {
        const p=entity.group.position, oldBob=entity.bob || 0;
        entity.bob=this.tide+(this.seaAt(p.x,p.z)-this.tide)*.82;
        p.y+=entity.bob;
        const delta=deltas.get(entity.id) || new T.Vector3();
        delta.y+=entity.bob-oldBob; deltas.set(entity.id,delta);
        const yaw=entity.group.rotation.y, stern=(entity.turn%180===90?entity.size[0]:entity.size[1])*.35;
        entity.wake.position.set(p.x+Math.sin(yaw)*stern,.028+entity.bob,p.z+Math.cos(yaw)*stern);
        entity.wake.material.opacity = .23 + Math.min(.2, Math.hypot(...entity.velocity) * .15);
      }
    }
    return { deltas, events };
  }
  brief(player, combat = { encounters: [], projectiles: 0, pulseCooldown: 0 }) {
    return {
      world: this.level.world, levelId: this.level.levelId, revision: this.level.revision, sampledAt: Date.now(),
      player: { position: player.position.toArray().map(v => +v.toFixed(3)), footing: player.grounded, facing: player.facing ?? Math.PI, health: player.health, invulnerable: +player.invulnerable.toFixed(3) },
      lastIntercept:this.intercept.last,devices:[...this.entities.values()].flatMap(d=>[...d.devices.values()].map(r=>({id:r.id,deck:d.id,turns:r.turns,speed:r.angularSpeed}))),
      nearbySurfaces:this.surfaces.nearby(player.position),activeSurfaces:[...this.surfaces.active.values()],lastSurfaceChange:this.surfaces.lastChange,
      ...kitBrief(this), mechanicTime:this.level.mechanicTime,
      goal: this.level.goal, cues:this.level.cues, stations:this.level.stations, cargo:this.level.cargo,
      ...combat,
      weather: {...this.level.weather}, traveler:{...this.level.traveler}, bounds: basin, jumpEnvelope:Object.fromEntries(Object.keys(tuneLimits).map(k=>[k,this.level.traveler[k]])),
      entities: [...this.entities.values()].map(({ id, kind, group, size, velocity, height, built, dressing, routeName, grade, axis, turn, paint, sail, lamps, fixtures, depart, trip, motion }) => ({ id, kind, ...(routeName && {routeName}), ...(grade!==undefined && {slope:{axis:axis===0?'x':'z',rise:grade}}), lanternCount:fixtures.length, depart, trip, waiting:!!motion?.waiting, height, built, dressing, turn, paint, sail, lamps, position: group.position.toArray().map(v => +v.toFixed(3)), size, velocity: velocity.map(v => +v.toFixed(3)) })),
      supportedOperations: [
        ...Object.values(wishContracts),
        {op:'behavior',fields:behaviorFields},
        {op:'surface',fields:surfaceFields},
        {op:'intercept',fields:{id:'optional skiff, ferry, lift or built plain platform; omit to choose closest viable',speed:'1–18 m/s, default 10. During descent, move a real carrier to predicted feet, wait until dismount, return. Inspect lastIntercept for outcome.'}},
        {op:'drive',fields:{id:'deck ID',device:'exact device ID',spin:'angular impulse ±12 radians per second; turn event each driven quarter turn'}},
        ...Object.entries(kineticFields).map(([op,fields])=>({op,fields})),
        {op:'station',fields:{id:'station ID (reuse to move/refill, remove:true to erase)',kind:'bell | cargo | shrine | wheel',deck:'piece ID',offset:'[across,along] fractions of deck size, -.45 to .45',label:'player-facing name',item:'cargo item name',count:'cargo units, default 1'}},
        {op:'cast',fields:castFields},
        {op:'passage',fields:{to:'deck ID; transports the player'}},
        {op:'mend',fields:{hearts:'restore 1–3 hearts'}},
        {op:'say',fields:{text:'display a clue or dialogue'}},
        {op:'cue',fields:{id:'unique cue name; reuse to edit',when:'land | defeat | use | collect | after | hurt | overboard | jump | attack',target:'deck, encounter or station ID for targeted events; omit otherwise',seconds:'after: interval in game seconds',repeat:'boolean; default once',needs:'optional {item,count,spend:true/false}',then:'1–16 ordinary patch operations; remove:true cancels instead'}},
        {op:'traveler',fields:{tool:'oar | waterCannon',dash:'boolean; X wind-step',water:'map | swim | danger',trailWard:'boolean; safe passage on wilderness ground',power:'1–8 damage per hit',jetRange:'2–40 m',...tuneLimits}},
        {op:'lantern',fields:{id:'piece ID',index:'1 through lanternCount',on:'true, false or pattern (use global setting)'}},
        {op:'weather',fields:{lampPattern:'all | odd | even across deck lanterns',waves:'optional 0–1.5 m swell; 0 is calm',lights:'boolean',time:'sunrise | day | sunset | night',tide:'-1 to +3 meters; lifts boats',rain:'0 to 1',fog:'0 to 1',wind:'-1 to 1'}},
        {op:'build',fields:{id:'unique string',kind:buildKinds.join(' | '),slope:'pilgrimRoad/stoneSpan/ropeSpan: {axis:x or z,rise:signed meters}; at.y is the low end',at:'[x,deckTopY,z]',size:'[width,depth], .35–96 m',height:'walls only: .35–30 m measured down from top'}},
        {op:'finish',fields:{id:'existing piece',turn:'absolute 0/90/180/270 degrees',dressing:'on docks: plain | '+deckStyles.join(' | '),slope:'pilgrimRoad/stoneSpan/ropeSpan: {axis:x or z,rise:signed meters}',paint:'#rrggbb trim',sail:'boat canvas: #rrggbb or none',lamps:'boolean (master lights must be on)'}},
        {op:'waypoint',fields:{from:'upcoming checkpoint platform',to:'new destination platform',title:'new objective',hint:'directions; changing platform unlinks old guardian'}},
        {op:'removePiece',fields:{id:'any unreferenced piece (not spawn, goal, route or arena)'}},
        { op: 'move', targets: ['skiff','ferry','dock','stallRun','wall'], fields: { to: '[x,topY,z]', duration: '0.4–5 seconds' } },
        { op:'shuttle', fields:{id:'platform',to:'[x,topY,z]',speed:'above 0 to 4 m/s',depart:'now | board',trip:'loop | once (park at destination)'} },
        { op:'stop', fields:{id:'moving platform'} },
        { op:'resize', fields:{id:'platform',size:'[width,depth], 1–96 meters each'} },
        { op: 'spawnEncounter', fields: { spec: 'validated wisp/crab/heron definition. Upland skins: silk-kestrel (wisp), kiln-ram, gate-ram, ember-hart (crab).' } },
        { op: 'setEncounter', fields: { id: 'one encounter, or omit and use where', where:'match all fields: {arena,kind,skin,friendly}; e.g. {friendly:false} selects every hostile', patch: 'form, friendly, at, phases, maxHits, activationRange, pulseRange, arena', 'phases[].sequence':'optional boss attack cycle: 1–6 broadside (parry/sidestep), breaker (jump), pincers (safe center), bellfall (leave circles), antlerSweep (vault). Uses phase tell/recover/interval. Armored outside recovery; requires arena.', 'patch.form': formFields } },
        { op: 'removeEncounter', fields: { id: 'non-goal encounter' } },
      ],
      levelComposition: { mode: 'replace', kinds: ['dock', 'skiff', 'stallRun', 'ferry', 'wall'], encounterKinds: ['wisp', 'heron', 'crab'], entityLimit: 128, encounterLimit: 32 },
    };
  }
  arrival(entity,zOffset=0) {
    const point=entity.group.position.clone();point.z+=zOffset;
    if(entity.grade){
      const dz=point.z-entity.group.position.z;
      for(const box of entity.obstacles){
        if(box.min.x<=0 && box.max.x>=0 && box.min.z<=dz && box.max.z>=dz)
          point.y=Math.max(point.y,entity.group.position.y+box.max.y);
      }
    }
    return point;
  }
  getSpawnPosition() {
    const id = this.level.spawn.split(':')[0];
    const entity = this.get(id);
    return this.arrival(entity,entity.size[1]*.25);
  }
  serialize() {
    const level = structuredClone(this.level);
    if(this.surfaces.active.size)level.surfaceStates=[...this.surfaces.active.values()].map(s=>({...s}));
    level.jumpEnvelope=Object.fromEntries(Object.keys(tuneLimits).map(k=>[k,level.traveler[k]]));
    for (const spec of level.entities) {
      const live = this.get(spec.id);
      if (live && spec.kind === 'stallRun') {
        const center=new T.Vector3(...spec.from).lerp(new T.Vector3(...spec.to),.5);
        for(const key of ['from','to']) spec[key]=new T.Vector3(...spec[key]).sub(center).add(live.group.position).toArray();
      }
      if (live && spec.kind !== 'stallRun') {spec.at = live.group.position.toArray(); spec.at[1]-=live.bob || 0;}
      if (live?.motion) spec.runtime = { segment: live.motion.segment, dwell: live.motion.dwell, waiting: !!live.motion.waiting };
    }
    return level;
  }
}

function groupSafe(group) {
  group.updateMatrixWorld(true);
}

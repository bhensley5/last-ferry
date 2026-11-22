import { tracePart,partAt } from './actor-parts.js';
import { steerIntent } from './intent.js';
import { creatureModel, castModel } from './sea-magic.js';
import * as T from 'three';
import { BossAttack } from './boss-patterns.js';
import { Pursuit, advanceCrew, returnTarget } from './pursuit.js';
import { slide, landing } from './market-solids.js';
import { salvageActor } from './market-characters.js';

const planarDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const rounded = vector => vector.toArray().map(value => +value.toFixed(3));

function mesh(parent, geometry, material, position = [0, 0, 0]) {
  const value = new T.Mesh(geometry, material);
  value.position.fromArray(position);
  value.castShadow = true;
  parent.add(value);
  return value;
}

const projectilePath = new T.Line3();
const closestPoint = new T.Vector3();
const playerHitSphere = new T.Sphere(new T.Vector3(), .48);

export class EncounterSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new T.Group();
    scene.add(this.root);
    this.actors = new Map();
    this.projectiles = [];
    this.pulses = [];
    this.casts = [];
    this.sparks = [];
    this.time = 0;
    this.pursuit = new Pursuit();
    this.resetOar();
    this.crewFeet = new T.Vector3();
    this.pulseCooldown = 0;
    this.materials = {
      paper: new T.MeshStandardMaterial({ color: 0xe0cfac, roughness: .86, side: T.DoubleSide }),
      ink: new T.MeshStandardMaterial({ color: 0x173c47, roughness: .7 }),
      red: new T.MeshStandardMaterial({ color: 0xa74334, roughness: .78 }),
      pearl: new T.MeshStandardMaterial({ color: 0xb9eeed, emissive: 0x75cfd5, emissiveIntensity: 1.8 }),
      warning: new T.MeshBasicMaterial({ color: 0x8cddd5, transparent: true, opacity: .82, side: T.DoubleSide, depthWrite: false }),
      sparkGold: new T.MeshBasicMaterial({ color: 0xffd07a }),
    };
    this.loadLevel();
  }

  resetOar() {
    this.combo = 0;
    this.comboUntil = 0;
    this.parryUntil = -1;
    this.riposteUntil = -1;
    this.pulseCooldown = 0;
    this.feedback = null;
  }

  cancelPattern(actor) {
    actor.pattern?.dispose();
    actor.pattern = null;
  }

  clearCasts() {
    for (const cast of this.casts) cast.dispose();
    this.casts.length = 0;
    this.lastCast = null;
  }

  clear() {
    this.clearCasts();
    this.resetOar();
    this.pursuit.trail.length = 0;this.pursuit.jobs.length=0;
    for (const actor of this.actors.values()) {
      this.cancelPattern(actor);
      actor.form?.dispose();
    }
    this.root.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
    this.root.clear();
    this.actors.clear();
    this.projectiles.length = 0;
    this.pulses.length = 0;
    this.sparks.length = 0;
    this.pulseCooldown = 0;
  }

  loadLevel() {
    this.clear();
    for (const spec of this.world.level.encounters || []) this.addActor(spec);
  }

  addActor(spec) {
    const group = new T.Group();
    this.root.add(group);
    const crestMaterial = new T.MeshStandardMaterial({ color: 0xb4d9d3, emissive: 0x366e78, emissiveIntensity: .45, roughness: .65 });
    let crest;
    const wings = [];
    const crew = this.world.solidHarbor && spec.kind !== 'heron' ? salvageActor(group,spec,crestMaterial) : null;
    if (crew) crest=crew.crest;
    else if (spec.kind === 'heron') {
      const body = mesh(group, new T.SphereGeometry(.72, 12, 8), this.materials.paper, [0, -.05, .06]);
      body.scale.set(.82, 1.1, .88);
      const tail = mesh(group, new T.ConeGeometry(.39, 1.25, 3), this.materials.paper, [0, -.45, .64]);
      tail.rotation.x = Math.PI / 2.8;
      const neckCurve = new T.CatmullRomCurve3([
        new T.Vector3(0, .35, -.38), new T.Vector3(0, .72, -.55),
        new T.Vector3(0, 1.05, -.3), new T.Vector3(0, 1.36, -.62),
      ]);
      mesh(group, new T.TubeGeometry(neckCurve, 12, .115, 6, false), this.materials.paper);
      const head = mesh(group, new T.SphereGeometry(.25, 14, 10), this.materials.paper, [0, 1.4, -.65]);
      head.scale.set(.9, 1, 1.1);
      const beak = mesh(group, new T.ConeGeometry(.105, .82, 4), this.materials.red, [0, 1.35, -1.13]);
      beak.rotation.x = -Math.PI / 2;
      for (const side of [-1, 1]) mesh(group, new T.SphereGeometry(.035, 8, 6), this.materials.ink, [side * .16, 1.5, -.78]);
      for (const side of [-1, 1]) {
        const wing = mesh(group, new T.ConeGeometry(.52, 1.75, 3), this.materials.paper, [side * .55, -.03, .12]);
        wing.rotation.z = side * 1.16;
        wing.userData.side = side;
        wings.push(wing);
        if(spec.arena && spec.phases.some(phase=>phase.sequence)){
          for(let i=0;i<4;i++){
            const quill=mesh(wing,new T.ConeGeometry(.145,.94-i*.09,3),i%2===0 ? this.materials.paper : this.materials.red,[side*(i-1.5)*.14,-.59,.16+i*.045]);
            quill.rotation.z=side*(i-1.5)*.14;
          }
        }
        const rib = mesh(group, new T.CylinderGeometry(.024, .038, 1.48, 6), this.materials.red, [side * .7, -.1, .08]);
        rib.rotation.z = side * 1.16;
      }
      crest = mesh(group, new T.OctahedronGeometry(.34, 0), crestMaterial, [0, 1.79, -.61]);
      for (const x of [-.24, .24]) {
        mesh(group, new T.CylinderGeometry(.035, .045, .85, 6), this.materials.ink, [x, -.92, 0]);
        const foot = mesh(group, new T.CylinderGeometry(.018, .026, .38, 6), this.materials.ink, [x, -1.33, -.15]);
        foot.rotation.x = Math.PI / 2;
      }
    } else if(spec.kind==='crab'){
      const shell=mesh(group,new T.IcosahedronGeometry(.7,1),this.materials.red);
      shell.scale.set(1.1,.62,.83);
      for(const side of [-1,1]){
        for(let i=0;i<3;i++){
          const leg=mesh(group,new T.ConeGeometry(.105,.86,5),this.materials.ink,[side*.67,-.24,(i-1)*.28]);
          leg.rotation.z=side*1.1;
        }
        const claw=mesh(group,new T.IcosahedronGeometry(.36,0),this.materials.red,[side*.78,.17,.49]);
        claw.scale.set(.8,1,1.2);
        mesh(group,new T.SphereGeometry(.085,8,6),this.materials.pearl,[side*.25,.33,.36]);
      }
      crest=mesh(group,new T.OctahedronGeometry(.16),crestMaterial,[0,.42,0]);
    } else {
      mesh(group, new T.SphereGeometry(.38, 16, 12), this.materials.ink);
      const cage = mesh(group, new T.TorusGeometry(.48, .035, 6, 24), this.materials.red);
      cage.rotation.x = Math.PI / 2;
      const secondCage = mesh(group, new T.TorusGeometry(.48, .025, 6, 24), this.materials.paper);
      secondCage.rotation.y = Math.PI / 2;
      crest = mesh(group, new T.SphereGeometry(.19, 12, 10), crestMaterial);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: this.world.glow, color: 0xa4e7e0, transparent: true, opacity: .55, blending: T.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.8, 1.8, 1);
      group.add(glow);
    }
    const original = new T.Group();
    original.add(...group.children.slice());
    group.add(original);
    const crestRing = mesh(group, new T.TorusGeometry(.46, .026, 6, 32), crestMaterial);
    crestRing.visible=!crew;
    crestRing.position.copy(crest.position);
    const crestHalo = new T.Sprite(new T.SpriteMaterial({ map: this.world.glow, color: 0xffbd59, transparent: true, opacity: .18, blending: T.AdditiveBlending, depthWrite: false }));
    crestHalo.position.copy(crest.position);
    crestHalo.scale.set(1.45, 1.45, 1);
    group.add(crestHalo);
    const marker = mesh(this.root, new T.RingGeometry(.46, .62, 40), this.materials.warning.clone());
    const markerFill = mesh(marker, new T.CircleGeometry(.45, 40), this.materials.warning.clone());
    markerFill.material.opacity = .18;
    markerFill.castShadow = false;
    marker.rotation.x = -Math.PI / 2;
    marker.castShadow = marker.receiveShadow = false;
    marker.visible = false;
    const actor = {
      spec: structuredClone(spec), group, original, stun:0, crew, crest, crestRing, crestHalo, crestMaterial, marker, wings,
      deck: spec.arena, floor: spec.at[1], trail: [], engaged: false, sequenceIndex: 0,
      anchor: new T.Vector3(...spec.at), hits: 0, defeated: false,
      state: spec.friendly ? 'friendly' : 'forming', timer: 1.25, hitThisOpening: false,
      aim: new T.Vector3(), phaseIndex: 0, flankSide: 1, bash: false,
    };
    group.position.copy(actor.anchor).add(new T.Vector3(0, spec.kind === 'heron' ? 2.05 : 1.5, 0));
    if (crew) {
      let seed=0;
      for(const ch of spec.id) seed=(Math.imul(seed,31)+ch.charCodeAt(0))>>>0;
      actor.patrol={seed, target:actor.anchor.clone(), pause:0, remaining:0};
    }
    actor.parts=crew?.parts??new Map();
    actor.parts.set('crest',{node:crest,radius:.13});
    this.setForm(actor,spec.form);
    this.actors.set(spec.id, actor);
    if(this.world.level.intents?.some(i=>i.id===spec.id))this.world.onIntent?.(spec.id);
    return actor;
  }

  setForm(actor, spec) {
    actor.form?.dispose();
    actor.form = spec ? creatureModel(spec) : null;
    actor.original.visible = !spec;
    actor.crestRing.visible = !spec && !actor.crew;
    actor.crestHalo.visible = !spec;
    if (actor.form) {
      if (spec.body === 'octopus' && actor.crew?.grounded && actor.spec.kind !== 'crab') actor.form.root.position.y=-.98;
      actor.group.add(actor.form.root);
    }
  }

  removeActor(id) {
    const actor = this.actors.get(id);
    if (!actor) return;
    this.cancelPattern(actor);
    actor.form?.dispose();
    this.clearOwnedProjectiles(id);
    actor.group.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
    actor.group.removeFromParent();
    actor.marker.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
    actor.marker.removeFromParent();
    this.actors.delete(id);
  }

  reconcile() {
    const specs = this.world.level.encounters || [];
    const ids = new Set(specs.map(spec => spec.id));
    for (const id of this.actors.keys()) if (!ids.has(id)) this.removeActor(id);
    for (const spec of specs) {
      const actor = this.actors.get(spec.id);
      if (!actor) { this.addActor(spec); continue; }
      const changed = JSON.stringify(actor.spec) !== JSON.stringify(spec);
      if (!changed) continue;
      if (JSON.stringify(actor.spec.form) !== JSON.stringify(spec.form)) this.setForm(actor,spec.form);
      const wasFriendly = actor.spec.friendly;
      const phasesChanged = JSON.stringify(actor.spec.phases) !== JSON.stringify(spec.phases);
      const relocated = actor.spec.arena !== spec.arena || actor.spec.at.some((n,i)=>n!==spec.at[i]);
      actor.spec = structuredClone(spec);
      actor.group.position.sub(actor.anchor);
      actor.anchor.fromArray(spec.at);
      actor.group.position.add(actor.anchor);
      actor.hits = Math.min(actor.hits, spec.maxHits);
      actor.defeated = actor.hits >= spec.maxHits;
      if (relocated) {
        actor.group.position.copy(actor.anchor);
        actor.deck=spec.arena; actor.floor=spec.at[1]; actor.trail.length=0;actor.groundPlan=null;
      }
      if (spec.friendly || wasFriendly || phasesChanged || relocated) {
        this.cancelPattern(actor);
        actor.sequenceIndex=0;
        actor.engaged=false;
        this.clearOwnedProjectiles(spec.id);
        actor.state = spec.friendly ? 'friendly' : 'forming';
        actor.timer = spec.friendly ? 0 : .8;
        actor.hitThisOpening = false;
        actor.marker.visible = false;
      }
    }
  }

  reset(keepDefeated = false) {
    this.resetOar();
    this.pursuit.trail.length=0;this.pursuit.jobs.length=0;
    this.clearCasts();
    for (const projectile of this.projectiles) this.disposeProjectile(projectile);
    this.projectiles.length = 0;
    for (const pulse of this.pulses) { pulse.mesh.geometry.dispose(); pulse.mesh.removeFromParent(); }
    this.pulses.length = 0;
    for (const spark of this.sparks) { spark.mesh.geometry.dispose(); spark.mesh.removeFromParent(); }
    this.sparks.length = 0;
    for (const actor of this.actors.values()) {
      this.cancelPattern(actor);
      actor.sequenceIndex=0; actor.engaged=false; actor.trail.length=0;actor.groundPlan=null;
      actor.deck=actor.spec.arena; actor.floor=actor.anchor.y;
      if(keepDefeated && actor.defeated)continue;
      actor.stun = 0;
      actor.hits = 0;
      actor.defeated = false;
      actor.state = actor.spec.friendly ? 'friendly' : 'forming';
      actor.timer = actor.spec.friendly ? 0 : 1.25;
      actor.hitThisOpening = false;
      actor.marker.visible = false;
      actor.crestMaterial.color.setHex(0xb4d9d3);
      actor.crestMaterial.emissive.setHex(0x366e78);
      actor.crestMaterial.emissiveIntensity = .45;
      actor.crestHalo.material.opacity = .18;
      actor.group.scale.setScalar(1);
      actor.group.rotation.z=0;
      actor.flankSide=1;
      actor.bash=false;
      actor.group.position.copy(actor.anchor);
    }
  }

  phase(actor) {
    let selected = actor.spec.phases[0], index = 0;
    for (let i = 0; i < actor.spec.phases.length; i++) {
      if (actor.hits >= actor.spec.phases[i].afterHits) { selected = actor.spec.phases[i]; index = i; }
    }
    actor.phaseIndex = index;
    return selected;
  }

  patrolTarget(actor, arena, dt) {
    const patrol=actor.patrol, p=actor.group.position;
    if(patrol.pause>0){
      patrol.pause-=dt;
      return p;
    }
    if(patrol.remaining<=0){
      const roll=()=>{patrol.seed=(Math.imul(patrol.seed,1664525)+1013904223)>>>0; return patrol.seed/4294967296;};
      const center=arena?.group.position ?? actor.anchor;
      const spanX=arena ? Math.min(6,arena.size[0]*.36) : 2;
      const spanZ=arena ? Math.min(6,arena.size[1]*.36) : 2;
      patrol.target.set(center.x+(2*roll()-1)*spanX,actor.anchor.y,center.z+(2*roll()-1)*spanZ);
      patrol.remaining=2.2+3.4*roll();
    }
    patrol.remaining-=dt;
    if(planarDistance(p,patrol.target)<.16 || patrol.remaining<=0){
      patrol.remaining=0;
      patrol.pause=actor.crew.grounded ? .55 : .25;
      return p;
    }
    return patrol.target;
  }

  moveCrew(actor, player, phase, dt, elevation) {
    const {group,anchor,state}=actor, p=group.position;
    const crab=phase.attack==='charge', flank=phase.movement==='flank';
    const resting=state==='sleep' || actor.spec.friendly;
    const committed=state==='tell' || state==='charge';
    const arena=this.world.get(actor.spec.arena);
    const patrolling=state==='sleep' && !actor.spec.friendly;
    const following=actor.engaged && !phase.sequence && (player.grounded!==actor.spec.arena || actor.deck!==actor.spec.arena);
    const returning=!actor.engaged && (actor.trail.length>0 || actor.deck!==actor.spec.arena);
    const target=returning ? returnTarget(this.world,actor) : following && !committed ? this.pursuit.target(this.world,actor,player) : patrolling ? this.patrolTarget(actor,arena,dt) : resting ? anchor : committed ? actor.aim : player.position;
    const dx=target.x-p.x, dz=target.z-p.z, distance=Math.hypot(dx,dz);
    const nx=dx/(distance || 1), nz=dz/(distance || 1);
    let vx=0,vz=0;
    if(returning || resting || state==='charge'){
      const patrolSpeed=crab ? 1.1 : flank ? 1.6 : 1.35;
      const speed=Math.min(distance/dt,returning ? 2.8 : resting ? patrolSpeed : actor.bash ? 7 : 12);
      vx=nx*speed;vz=nz*speed;
    } else if(state==='forming' || state==='cooldown' || state==='pursue'){
      // Divers close for an oar-range brawl. Lamps hold a firing lane, then
      // slip to the opposite side after each shot instead of orbiting a point.
      const standOff=following && actor.deck!==player.grounded ? .05 : crab ? 2.2 : flank ? 4.5 : 1.6;
      const forward=T.MathUtils.clamp((distance-standOff)*2,flank ? -1.1 : 0,crab ? 3.4 : 2.6);
      const strafe=flank && !(following && actor.crew.grounded) ? actor.flankSide*2.6 : 0;
      vx=nx*forward+nz*strafe;vz=nz*forward-nx*strafe;
    }
    const oldX=p.x, oldZ=p.z;
    const roaming=!phase.sequence && (following || returning || actor.deck!==actor.spec.arena);
    if (roaming) {
      if (vx || vz) advanceCrew(this.world,actor,vx,vz,dt,returning);
    } else {
      const feet=this.crewFeet.set(p.x,anchor.y,p.z);
      if(actor.crew.grounded && (vx || vz)){
        slide(this.world.entities,feet,'x',vx*dt,true);
        slide(this.world.entities,feet,'z',vz*dt,true);
      }else{feet.x+=vx*dt;feet.z+=vz*dt;}
      if(arena){
        const center=arena.group.position, pad=crab ? .65 : .35;
        const w=Math.max(0,arena.size[0]/2-pad), d=Math.max(0,arena.size[1]/2-pad);
        feet.x=T.MathUtils.clamp(feet.x,center.x-w,center.x+w);
        feet.z=T.MathUtils.clamp(feet.z,center.z-d,center.z+d);
      }
      p.x=feet.x; p.z=feet.z;
      actor.floor=anchor.y;
    }
    const pace=Math.min(1,Math.hypot(p.x-oldX,p.z-oldZ)/(dt*2.5));
    // Pick another destination rather than walking in place against cargo.
    if(patrolling && distance>.16 && pace<.045) actor.patrol.remaining=0;
    p.y=actor.floor+elevation+(actor.crew.grounded ? 0 : .075*Math.sin(this.time*2));
    if(distance>.12 && (!resting || pace>.04)){
      const heading=Math.atan2(dx,dz)-group.rotation.y;
      const turn=Math.atan2(Math.sin(heading),Math.cos(heading));
      group.rotation.y+=T.MathUtils.clamp(turn,-5*dt,5*dt);
    }
    actor.crew.animate(this.time,state,pace,actor.pattern?.move);
  }

  keepClear(actor, player, dt) {
    if(!actor.crew?.grounded || !player.grounded || Math.abs(actor.floor-player.position.y)>.55)return;
    const p=actor.group.position, dx=player.position.x-p.x, dz=player.position.z-p.z;
    const distance=Math.hypot(dx,dz), radius=actor.spec.phases[actor.phaseIndex].sequence ? 1.04 : .62;
    if(distance>=radius)return;
    const feet=this.crewFeet.copy(player.position);
    const step=Math.min(radius-distance,dt*7);
    const angle=distance>.001 ? Math.atan2(dx,dz) : actor.group.rotation.y;
    slide(this.world.entities,feet,'x',Math.sin(angle)*step,true);
    slide(this.world.entities,feet,'z',Math.cos(angle)*step,true);
    if(landing(this.world.entities,feet,feet.y-.25,feet.y+.23))player.position.copy(feet);
  }

  enterTell(actor, player) {
    actor.state = 'tell';
    const phase=this.phase(actor);
    const deck=this.world.get(actor.spec.arena);
    if (phase.sequence && deck) {
      const move=phase.sequence[actor.sequenceIndex++ % phase.sequence.length];
      actor.pattern=new BossAttack(this.root,deck,actor,player,move,phase.tell);
      actor.bash=false; actor.timer=phase.tell; actor.hitThisOpening=false;
      actor.aim.copy(player.position);
      return;
    }
    actor.bash=phase.movement==='advance' && planarDistance(actor.group.position,player.position)<3.1;
    actor.timer=actor.bash ? .68 : phase.tell;
    actor.aim.copy(player.position).add(new T.Vector3(0, .62, 0));
    const warningSupport = this.world.supportAt(actor.aim.x, actor.aim.z);
    actor.marker.position.set(actor.aim.x, (warningSupport?.group.position.y ?? .02) + .035, actor.aim.z);
    actor.marker.scale.setScalar(1.8);
    actor.marker.material.opacity = .8;
    actor.marker.visible = true;
    actor.hitThisOpening = false;
  }

  fire(actor) {
    const phase = this.phase(actor);
    if(phase.attack==='charge' || actor.bash){
      actor.state='charge';actor.timer=actor.bash ? .34 : .52;actor.marker.visible=false;
      return;
    }
    actor.flankSide *= -1;
    const origin = actor.group.position.clone();
    const base = actor.aim.clone().sub(origin);
    const count = phase.count;
    for (let index = 0; index < count; index++) {
      const direction = base.clone();
      const offset = count === 1 ? 0 : (index / (count - 1) - .5) * phase.spread * (count - 1);
      if (phase.attack !== 'pearlRing') direction.applyAxisAngle(new T.Vector3(0, 1, 0), offset);
      else direction.set(Math.sin(index / count * Math.PI * 2), -.08, Math.cos(index / count * Math.PI * 2));
      direction.normalize();
      const projectileMesh = mesh(this.root, new T.SphereGeometry(.14, 10, 8), this.materials.pearl);
      projectileMesh.position.copy(origin);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: this.world.glow, color: 0x9be8e5, transparent: true, opacity: .65, blending: T.AdditiveBlending, depthWrite: false }));
      glow.scale.set(.8, .8, 1);
      projectileMesh.add(glow);
      this.projectiles.push({ owner: actor.spec.id, mesh: projectileMesh, velocity: direction.multiplyScalar(phase.projectileSpeed), life: 5 });
    }
    actor.state = 'recover';
    actor.timer = phase.recover;
    actor.hitThisOpening = false;
    actor.marker.visible = false;
  }

  obstructed(start,end) {
    if(!this.world.solidHarbor)return this.world.wallBlocks(start,end);
    const delta=closestPoint.subVectors(end,start);
    const distance=delta.length();
    return distance>.001 && this.world.jetDistance(start,delta.divideScalar(distance),distance)<distance-.001;
  }

  clearOwnedProjectiles(id) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].owner !== id) continue;
      this.disposeProjectile(this.projectiles[i]);
      this.projectiles.splice(i, 1);
    }
  }

  disposeProjectile(projectile) {
    for(const child of projectile.mesh.children)if(child.isSprite)child.material.dispose();
    projectile.mesh.geometry.dispose();
    projectile.mesh.removeFromParent();
  }

  slash(player, facing, lockedBoss = null) {
    if (this.pulseCooldown > 0) return { hits: [], defeats: [], fired: false };
    this.combo=this.time<=this.comboUntil ? this.combo%3+1 : 1;
    this.comboUntil=this.time+1.05;
    const finisher=this.combo===3, counter=this.time<=this.riposteUntil;
    this.pulseCooldown=finisher ? .5 : .32;
    this.parryUntil=this.time+.20;
    const power=this.world.level.traveler.power + Number(finisher) + Number(counter);
    if(counter)this.riposteUntil=-1;
    const arc = mesh(this.root, new T.RingGeometry(.9,finisher ? 2.85 : 2.25,32,1,-1.05,finisher ? 3.1 : 2.1), this.materials.warning.clone());
    arc.material.color.setHex(counter ? 0x92fff1 : finisher ? 0xff9b4d : 0xffdb9d);
    arc.rotation.order='YXZ';
    arc.rotation.set(-Math.PI/2,facing-Math.PI/2,0);
    arc.position.copy(player.position).y+=.92;
    this.pulses.push({mesh:arc,age:0,spin:this.combo===2 ? 4 : -4});
    const grip = player.position.clone(); grip.y+=.9;
    const inArc = position => {
      const x=position.x-player.position.x,z=position.z-player.position.z;
      const dist=Math.hypot(x,z);
      return dist<(finisher ? 3.25 : 2.9) && Math.abs(position.y-player.position.y-1)<2.2 &&
        (dist<.5 || (Math.sin(facing)*x+Math.cos(facing)*z)/dist>.18);
    };
    for(let i=this.projectiles.length-1;i>=0;i--){
      const shot=this.projectiles[i];
      if(shot.returned || !inArc(shot.mesh.position) || planarDistance(shot.mesh.position,player.position)>1.65 ||
        this.obstructed(grip,shot.mesh.position)) continue;
      this.returnPearl(shot);
    }
    const hits = [], defeats = [];
    for (const actor of this.actors.values()) {
      if (actor.spec.id===lockedBoss || actor.defeated || actor.spec.friendly || actor.state === 'sleep' || !inArc(actor.group.position)) continue;
      if(this.obstructed(grip,actor.group.position))continue;
      const phase=this.phase(actor);
      const plated=actor.crew?.grounded && !phase.sequence;
      const dx=player.position.x-actor.group.position.x, dz=player.position.z-actor.group.position.z;
      const inFront=Math.sin(actor.group.rotation.y)*dx+Math.cos(actor.group.rotation.y)*dz>=0;
      const lastBeat=actor.state==='tell' && inFront && (actor.bash || phase.attack==='charge') && actor.timer<=.20;
      if (plated && (actor.state==='charge' || lastBeat)) {
        this.parry(actor);
      } else if(plated && inFront && actor.state==='tell' && (actor.bash || phase.attack==='charge') &&
        actor.timer>.23 && !finisher && !counter) {
        this.feedback=actor.bash?'Gauntlet up · swing as it lands':'Shell braced · circle the claws';
        this.burst(actor.group.position,4);
        continue;
      }
      const retaliate=plated && ['forming','cooldown'].includes(actor.state);
      this.weaponHit(actor,hits,defeats,power);
      if(retaliate && !actor.defeated && !finisher)this.enterTell(actor,player);
      if(finisher && actor.crew && !actor.defeated && !this.phase(actor).sequence) {
        actor.stun=.55; actor.state='stunned'; actor.marker.visible=false;
      }
    }
    return { hits, defeats, fired: true, finisher, counter };
  }

  returnPearl(shot) {
    const owner=this.actors.get(shot.owner);
    if(!owner || owner.defeated || owner.spec.friendly)return false;
    shot.returned=true;
    shot.velocity.subVectors(owner.group.position,shot.mesh.position).normalize().multiplyScalar(9);
    shot.mesh.material=this.materials.sparkGold;
    this.rewardParry(shot.mesh.position,'Pearl returned');
    return true;
  }

  weaponHit(actor,hits,defeats,power) {
    const phase=this.phase(actor);
    if(phase.sequence && actor.state!=='recover' && actor.state!=='stunned')return;
    this.strike(actor,hits,defeats,power);
    if(phase.sequence && actor.state==='recover' && ++actor.openingHits>=2) {
      actor.state='cooldown';actor.timer=phase.interval;
    }
  }

  rewardParry(at, message) {
    this.riposteUntil=this.time+1.6;
    this.feedback=message+' · counter with F';
    this.burst(at,12);
  }

  parry(actor) {
    this.cancelPattern(actor);
    actor.marker.visible=false;
    actor.state='recover'; actor.openingHits=0; actor.timer=1.45; actor.hitThisOpening=false;
    this.parryUntil=-1;
    this.rewardParry(actor.group.position,'Parry');
  }

  shootWater(player,facing,lockedBoss = null,aim=null) {
    const hits=[],defeats=[];
    if(this.pulseCooldown>0)return {hits,defeats,fired:false};
    this.pulseCooldown=.46;
    const direction=new T.Vector3(Math.sin(facing),0,Math.cos(facing));
    const origin=player.position.clone();origin.y+=.98;
    if(aim)direction.fromArray(aim).sub(origin).normalize();
    const ray=new T.Ray(origin,direction),impact=new T.Vector3();
    const solid=this.world.traceTerrain(origin,direction,this.world.level.traveler.jetRange);
    let length=solid.distance, victim=null, actorPart=null;
    for(const actor of this.actors.values()){
      if(actor.spec.id===lockedBoss || actor.defeated || actor.spec.friendly || !actor.group.visible)continue;
      const p=actor.group.position,ground=actor.floor;
      const width=actor.spec.kind==='wisp' ? .45 : .72;
      const top=actor.spec.kind==='crab' ? ground+1.14 : Math.max(p.y+.65,ground+1.9);
      const bounds=new T.Box3(new T.Vector3(p.x-width,ground,p.z-width),new T.Vector3(p.x+width,top,p.z+width));
      const part=tracePart(actor,ray,length);
      const body=ray.intersectBox(bounds,impact);
      if (!part && !body) continue;
      const dist=part?.distance??impact.distanceTo(origin);
      if(dist<length){length=dist;victim=actor;actorPart=part?.id??null;}
    }
    if(victim)this.weaponHit(victim,hits,defeats);
    if(length>.06){
      const material=new T.MeshBasicMaterial({color:0x94f4ff,transparent:true,opacity:.84,depthWrite:false});
      const jet=mesh(this.root,new T.CylinderGeometry(.058,.032,length,8),material);
      jet.position.copy(origin).addScaledVector(direction,length/2);
      jet.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction);
      jet.castShadow=false;this.pulses.push({mesh:jet,age:0,jet:true});
    }
    const target=victim?.spec.id??solid.target;
    const contact=target ? {type:'impact',tag:'water',source:'player',target,reason:victim?'actor':'terrain',
      at:origin.addScaledVector(direction,length).toArray(),surface:!victim?this.world.surfaces.describe(target,solid.part):null,
      actorPart,device:!victim?solid.device??null:null} : null;
    return {hits,defeats,fired:true,contact};
  }

  cast(op, player, lockedBoss) {
    const eligible = [...this.actors.values()].filter(a => !a.defeated && !a.spec.friendly && a.spec.id !== lockedBoss);
    const target = op.center === 'nearest'
      ? eligible.sort((a,b)=>a.group.position.distanceToSquared(player.position)-b.group.position.distanceToSquared(player.position))[0]
      : this.actors.get(op.center);
    const center = Array.isArray(op.center) ? new T.Vector3(...op.center) : target?.group.position ?? (op.center === 'player' ? player.position : this.world.get(op.center)?.group.position);
    this.lastCast = {visual:op.visual, center:target?.spec.id ?? op.center, affected:[], defeated:[]};
    if (!center || (op.range !== undefined && center.distanceTo(player.position)>op.range)) return [];
    const effect = castModel(op,center,this.world.glow);
    if (this.casts.length >= 24) this.casts.shift().dispose();
    this.root.add(effect.root); this.casts.push(effect);
    const defeats = [];
    for (const actor of eligible) {
      if (actor !== target && (!op.radius || actor.group.position.distanceTo(center)>op.radius)) continue;
      if (op.damage || op.stun) this.lastCast.affected.push(actor.spec.id);
      if (op.damage) this.strike(actor,[],defeats,op.damage==='defeat' ? actor.spec.maxHits : op.damage);
      if (op.stun && !actor.defeated) {
        this.clearOwnedProjectiles(actor.spec.id);
        this.cancelPattern(actor);
        actor.stun=Math.max(actor.stun,op.stun);
        actor.state='stunned'; actor.marker.visible=false;
      }
    }
    this.lastCast.defeated=defeats.map(d=>d.id);
    return defeats;
  }

  strike(actor,hits,defeats,power=this.world.level.traveler.power) {
    const lastPhase=actor.phaseIndex;
    actor.hits=Math.min(actor.spec.maxHits,actor.hits+power);
    actor.hitThisOpening = true;
    actor.crestMaterial.color.setHex(0xffdb91);
    actor.crestMaterial.emissive.setHex(0xffb448);
    actor.crestMaterial.emissiveIntensity = 2;
    this.burst(actor.crest.getWorldPosition(new T.Vector3()), 12);
    hits.push({ id: actor.spec.id, hits: actor.hits, maxHits: actor.spec.maxHits });
    if (actor.hits >= actor.spec.maxHits) {
      this.cancelPattern(actor);
      actor.engaged=false; actor.defeated = true;
      this.clearOwnedProjectiles(actor.spec.id);
      actor.state = 'defeated';
      actor.marker.visible = false;
      actor.group.scale.setScalar(.82);
      this.burst(actor.crest.getWorldPosition(new T.Vector3()), 28);
      defeats.push({ id: actor.spec.id });
    } else {
      if(actor.crew && !actor.pattern && actor.state==='tell'){
        actor.state='recover'; actor.timer=.85; actor.marker.visible=false;
      } else if(actor.state==='recover' && !this.phase(actor).sequence && this.phase(actor).attack!=='charge')actor.timer = Math.min(actor.timer, .65);
      this.phase(actor);
      if(actor.phaseIndex!==lastPhase && actor.spec.phases[actor.phaseIndex].sequence){
        actor.sequenceIndex=0;
        this.feedback='The rhythm changes · tide '+(actor.phaseIndex+1);
      }
    }
  }

  burst(position, count) {
    for (let i = 0; i < count; i++) {
      const spark = mesh(this.root, new T.OctahedronGeometry(i % 3 === 0 ? .075 : .045, 0), this.materials.sparkGold);
      spark.position.copy(position);
      const angle = i / count * Math.PI * 2;
      const speed = .8 + (i % 5) * .24;
      this.sparks.push({ mesh: spark, velocity: new T.Vector3(Math.cos(angle) * speed, .65 + (i % 4) * .32, Math.sin(angle) * speed), life: .55 + (i % 3) * .13 });
    }
  }

  update(player, dt, sleepingBoss = null) {
    this.time += dt;
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    const damage = [], hits=[], defeats=[], returnedHits=[];
    if(this.world.solidHarbor)this.pursuit.recordPlayer(this.world,player,dt);
    const contact=(actor,parryable) => {
      if (actor.defeated || player.invulnerable>0 || damage.length) return;
      if(parryable && this.time<=this.parryUntil) { this.parry(actor); return; }
      damage.push({amount:1,source:actor.spec.id});
    };
    for (let i=this.casts.length-1;i>=0;i--) {
      if (!this.casts[i].update(dt)) { this.casts[i].dispose(); this.casts.splice(i,1); }
    }
    for (const actor of this.actors.values()) {
      if(actor.spec.id===sleepingBoss){
        this.cancelPattern(actor);actor.engaged=false;
        actor.group.visible=false;actor.state='sleep';actor.marker.visible=false;
        continue;
      }
      if (actor.crew && actor.defeated) {
        actor.group.visible=false;
        continue;
      }
      // Sleeping crews beyond the visible docks don't need joint animation,
      // shadows or a second draw in the water reflection.
      if(actor.crew && !actor.intent && actor.state==='sleep' && actor.anchor.distanceToSquared(player.position)>10000){
        actor.group.visible=false;
        continue;
      }
      actor.group.visible=true;
      if (actor.stun>0 && !actor.defeated) {
        actor.stun=Math.max(0,actor.stun-dt);
        if (!actor.stun) { actor.state=actor.spec.friendly?'friendly':'forming'; actor.timer=.8; }
        else continue;
      }
      actor.form?.animate(this.time);
      if (actor.intent && !actor.defeated) {steerIntent(this,actor,player,dt);continue;}
      const phase = this.phase(actor);
      const angle = this.time * (phase.speed ?? .65);
      const elevation = actor.spec.kind === 'heron' ? 2.05 : actor.spec.kind==='crab' ? .55 : 1.5;
      const sameDeck = !actor.spec.arena || player.grounded === actor.spec.arena;
      const near = planarDistance(actor.group.position,player.position) <= actor.spec.activationRange;
      const active = !actor.spec.friendly && !actor.defeated;
      if(active && sameDeck && near) actor.engaged=true;
      const leash = Math.min(19,actor.spec.activationRange+7);
      const chasing = actor.crew && !phase.sequence && actor.engaged && near &&
        planarDistance(actor.anchor,player.position)<leash && Math.abs(actor.floor-player.position.y)<4;
      if(!chasing && !sameDeck && player.grounded)actor.engaged=false;
      const crossing=chasing && player.grounded && actor.deck!==player.grounded;
      if(crossing && !['charge','stunned'].includes(actor.state)) {
        actor.state='pursue';actor.marker.visible=false;
      } else if(actor.state==='pursue') {
        actor.state='forming';actor.timer=.26;
      }
      const tactical=actor.crew && (phase.attack==='charge' || ['advance','flank'].includes(phase.movement));
      if (actor.pattern && !actor.crew) {
        actor.group.rotation.y=actor.pattern.heading+Math.PI;
      } else if (tactical) {
        this.moveCrew(actor,player,phase,dt,elevation);
      } else if (phase.movement === 'orbit' && !actor.defeated && !actor.spec.friendly) {
        actor.group.position.set(actor.anchor.x + Math.cos(angle) * (phase.radius ?? 1.2), actor.anchor.y + elevation + (actor.crew?.grounded ? 0 : Math.sin(this.time * 2) * .09), actor.anchor.z + Math.sin(angle) * (phase.radius ?? 1.2));
        actor.group.rotation.y = -angle + Math.PI / 2;
      } else if(phase.attack==='charge' && actor.state!=='sleep'){
        const arena=this.world.get(actor.spec.arena);
        const position=actor.group.position;
        const target=actor.state==='charge'?actor.aim:actor.anchor;
        const dx=target.x-position.x,dz=target.z-position.z;
        const stride=Math.min(1,(actor.state==='charge'?12:2.4)*dt/(Math.hypot(dx,dz)||1));
        if(actor.state!=='tell'){position.x+=dx*stride;position.z+=dz*stride;}
        if(arena){
          const p=arena.group.position;
          position.x=T.MathUtils.clamp(position.x,p.x-arena.size[0]/2+.45,p.x+arena.size[0]/2-.45);
          position.z=T.MathUtils.clamp(position.z,p.z-arena.size[1]/2+.45,p.z+arena.size[1]/2-.45);
        }
        position.y=actor.anchor.y+elevation;
        actor.group.rotation.y=Math.atan2(player.position.x-position.x,player.position.z-position.z);
      } else {
        actor.group.position.set(actor.anchor.x, actor.anchor.y + elevation + (actor.crew?.grounded ? 0 : Math.sin(this.time * 1.7) * .08), actor.anchor.z);
      }
      if (actor.crew && !tactical) {
        if (actor.state!=='sleep' && !actor.spec.friendly) actor.group.rotation.y=Math.atan2(player.position.x-actor.group.position.x,player.position.z-actor.group.position.z);
        actor.crew.animate(this.time,actor.state,phase.movement==='orbit' ? .72 : .15);
      }
      if (!actor.crew) actor.crest.rotation.y += dt * (actor.state === 'recover' ? 5 : 1.2);
      const open = actor.state === 'recover' && (!!phase.sequence || !actor.hitThisOpening);
      for (const wing of actor.wings) wing.rotation.z = wing.userData.side * (actor.pattern ? (actor.state==='tell' ? .43 : 1.75) : open ? .79 : 1.16 + Math.sin(this.time * 2.1) * .06);
      actor.crest.scale.setScalar(open ? 1.3 + Math.sin(this.time * 9) * .12 : 1);
      actor.crestRing.rotation.z += dt * (open ? 1.8 : .3);
      actor.crestRing.scale.setScalar(open ? 1.15 + Math.sin(this.time * 7) * .08 : .86);
      actor.crestHalo.material.opacity = actor.hitThisOpening || actor.defeated ? .12 : open ? .82 : .18;
      actor.crestHalo.scale.setScalar(actor.crew ? (actor.state==='tell' ? .88 : .37) : open ? 1.8 + Math.sin(this.time * 6) * .16 : 1.35);
      if (!actor.hitThisOpening && !actor.defeated) {
        actor.crestMaterial.color.setHex(open ? 0xffd98a : 0xb4d9d3);
        actor.crestMaterial.emissive.setHex(open ? 0xffa733 : 0x366e78);
        actor.crestMaterial.emissiveIntensity = open ? 1.65 : .45;
      }
      if (actor.defeated || actor.spec.friendly) continue;
      if(actor.engaged)this.keepClear(actor,player,dt);
      const outsideArena = actor.spec.arena && (
        player.grounded ? player.grounded !== actor.spec.arena :
        actor.state==='sleep' || player.position.y < actor.anchor.y-1.5
      );
      if (outsideArena && !chasing) {
        if (actor.state !== 'sleep') { this.cancelPattern(actor); actor.state = 'sleep'; actor.marker.visible = false; this.clearOwnedProjectiles(actor.spec.id); }
        continue;
      }
      if (!near) {
        this.cancelPattern(actor);actor.engaged=false;
        if (actor.state !== 'sleep') { actor.state = 'sleep'; actor.marker.visible = false; this.clearOwnedProjectiles(actor.spec.id); }
        continue;
      }
      if(actor.state==='pursue')continue;
      if (actor.state === 'sleep') {
        if(tactical){
          actor.state='forming';actor.timer=phase.movement==='flank' ? .65 : .9;
        }else this.enterTell(actor,player);
        continue;
      }
      if(actor.pattern) {
        const move=actor.pattern.move, result=actor.pattern.update(dt,player);
        actor.state=result.live?'release':'tell';
        if(result.hit)contact(actor,move==='broadside');
        if(result.done && actor.pattern) {
          this.cancelPattern(actor);
          actor.state='recover';actor.openingHits=0;actor.timer=phase.recover;actor.hitThisOpening=false;
        }
        continue;
      }
      actor.timer -= dt;
      if (actor.state === 'forming') {
        if (actor.timer <= 0) this.enterTell(actor, player);
      } else if (actor.state === 'tell') {
        const total = actor.bash ? .68 : phase.tell;
        actor.marker.scale.setScalar(.9 + Math.max(0, actor.timer / total) * .9);
        actor.marker.material.opacity = .35 + (1 - Math.max(0, actor.timer / total)) * .6;
        if (actor.timer <= 0) this.fire(actor);
      } else if(actor.state==='charge'){
        if(planarDistance(actor.group.position,player.position)<1.1 && Math.abs(player.position.y-actor.floor)<.95 && player.invulnerable<=0 && !damage.length){
          contact(actor,true);if(actor.state==='charge')actor.timer=0;
        }
        if(actor.timer<=0){actor.state='recover';actor.timer=phase.recover;}
      } else if (actor.state === 'recover') {
        if (actor.timer <= 0) { actor.state = 'cooldown'; actor.timer = phase.interval; }
      } else if (actor.state === 'cooldown' && actor.timer <= 0) this.enterTell(actor, player);
    }
    playerHitSphere.center.copy(player.position);
    playerHitSphere.center.y += .62;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      projectilePath.start.copy(projectile.mesh.position);
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      projectilePath.end.copy(projectile.mesh.position);
      projectile.mesh.rotation.y += dt * 5;
      projectile.life -= dt;
      const blocked = this.obstructed(projectilePath.start, projectilePath.end);
      if(projectile.returned) {
        const owner=this.actors.get(projectile.owner);
        const hit=owner && !owner.defeated && !owner.spec.friendly &&
          projectilePath.closestPointToPoint(owner.group.position,true,closestPoint).distanceToSquared(owner.group.position)<.8**2;
        if(blocked || hit || projectile.life<=0) {
          this.disposeProjectile(projectile); this.projectiles.splice(i,1);
          if(hit && !blocked)returnedHits.push(owner);
        }
        continue;
      }
      const collided = !blocked && playerHitSphere.containsPoint(
        projectilePath.closestPointToPoint(playerHitSphere.center, true, closestPoint),
      );
      if (collided && this.time<=this.parryUntil && this.returnPearl(projectile))continue;
      if (collided && player.invulnerable <= 0 && damage.length === 0) damage.push({ amount: 1, source: projectile.owner });
      if (blocked || collided || projectile.life <= 0 || projectile.mesh.position.y < .05 || planarDistance(projectile.mesh.position, actorOrigin(this.actors.get(projectile.owner))) > 18) {
        this.disposeProjectile(projectile);
        this.projectiles.splice(i, 1);
      }
    }
    for(const owner of returnedHits)if(!owner.defeated)this.weaponHit(owner,hits,defeats,this.world.level.traveler.power+1);
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      pulse.age += dt;
      if(!pulse.jet)pulse.mesh.rotation.y += dt*(pulse.spin ?? -4);
      pulse.mesh.material.opacity = Math.max(0, .7 - pulse.age * 3.5);
      if (pulse.age > .21) { pulse.mesh.material.dispose(); pulse.mesh.geometry.dispose(); pulse.mesh.removeFromParent(); this.pulses.splice(i, 1); }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.life -= dt;
      spark.velocity.y -= dt * 2.2;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += dt * 5;
      spark.mesh.rotation.y += dt * 7;
      spark.mesh.scale.setScalar(Math.max(.01, spark.life * 1.7));
      if (spark.life <= 0) { spark.mesh.geometry.dispose(); spark.mesh.removeFromParent(); this.sparks.splice(i, 1); }
    }
    return { damage, hits, defeats, shots: this.projectiles.length };
  }

  brief() {
    return {
      encounters: [...this.actors.values()].map(actor => ({
        id: actor.spec.id, kind: actor.spec.kind, arena:actor.spec.arena, skin:actor.spec.skin, form:actor.spec.form ?? null, stun:+actor.stun.toFixed(2), ...(actor.crew && {role:actor.crew.label}), position: rounded(actor.group.position),
        hits: actor.hits, maxHits: actor.spec.maxHits, state: actor.state,
        parts:[...actor.parts.keys()].map(id=>({id,at:partAt(actor,id)?.toArray()??null})),
        ...(actor.intent && {floor:actor.floor}),intent:actor.intent?{...actor.intent,status:actor.intentStatus,memory:actor.memory??null}:null,
        navigation:actor.state==='pursue'?actor.groundPlan?.status:null, deck: actor.deck, pursuing:actor.engaged && actor.deck!==actor.spec.arena,
        move:actor.pattern?.move ?? null, boss:!!actor.spec.phases[actor.phaseIndex]?.sequence,
        open: actor.state === 'recover' && (!!actor.spec.phases[actor.phaseIndex]?.sequence || !actor.hitThisOpening), phase: actor.phaseIndex,
        friendly: !!actor.spec.friendly, defeated: actor.defeated,
      })),
      oar:{combo:this.time<=this.comboUntil ? this.combo : 0, counter:this.time<=this.riposteUntil},
      lastCast:this.lastCast,
      projectiles: this.projectiles.length,
      pulseCooldown: +this.pulseCooldown.toFixed(3),
    };
  }
}

function actorOrigin(actor) {
  return actor?.group.position || new T.Vector3();
}

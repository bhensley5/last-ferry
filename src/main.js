import { trailBear } from './trail-bear.js';
import { wishCompanion } from './wick.js';
import { passageKit,setEffect } from './effects.js';
import { expireEffects } from './wish-kit.js';
import { recordObjective,satisfied } from './objectives.js';
import { hear } from './intent.js';
import { viewHit, wishView } from './wish-view.js';
import { driveWheel } from './wheels.js';
import { BehaviorEvents } from './behaviors.js';
import { Kinetics } from './kinetics.js';
import './style.css';
import './wick.css';
import { harborHand, pumpTool } from './market-characters.js';
import * as T from 'three';
import { wildlife } from './wildlife.js';
import { makeHarbor } from './harbor.js';
import initialLevel from '../levels/first-light.json';
import { chapterCatalog, expandChapter } from './chapters.js';
import { mountainRim } from './uplands.js';
import { atmosphere } from './atmosphere.js';
import { slide, landing, ceiling, cameraDistance } from './market-solids.js';
import { marketSky, harborWater } from './market-waterfront.js';
import { chart } from './chart.js';
import { localEdit } from './edits.js';
import { basin } from './basin.js';
import { World } from './world.js';
import { bossMoves } from './boss-patterns.js';
import { EncounterSystem } from './combat.js';

const params=new URLSearchParams(location.search);
const sessionLaunch = new URLSearchParams(location.hash.slice(1)).get('launch');
const catalog=chapterCatalog(import.meta.glob('../levels/*.json',{eager:true,import:'default'}));
const requested=params.get('play') || params.get('level');
const chapter=catalog.find(c=>c.id===requested || c.alias===requested) ??
  (requested==='first-light'?{id:requested,level:initialLevel,biome:'harbor'}:catalog[0]);
const selectedLevel=chapter.id, upland=chapter.biome==='upland';
const liveBridge=import.meta.env.DEV && !params.has('level');
const onward=catalog.find(c=>c.order>chapter.order);
const passage=history.state?.passage?.to===selectedLevel ? history.state.passage : null;
if(passage)history.replaceState(null,'');
function enterChapter(id,carry=false){
  const url=new URL(location.href);
  url.searchParams.set(params.has('level')?'level':'play',id);
  if(!carry){location.assign(url);return;}
  history.pushState({passage:{to:id,...passageKit(world.level)}},'',url);
  location.reload();
}
const canvas = document.querySelector('#game');
const scene = new T.Scene();
scene.background = new T.Color(0x071f2a);
scene.fog = new T.FogExp2(0xceaba5, .012);
const camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, .1, upland?725:400);
const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// The power preference is only a request. Report what this game context obtained.
const gl=renderer.getContext(), adapterInfo=gl.getExtension('WEBGL_debug_renderer_info');
const graphics={api:gl.getParameter(gl.VERSION),adapter:adapterInfo ? gl.getParameter(adapterInfo.UNMASKED_RENDERER_WEBGL) : 'Not exposed by browser'};
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
const ambient=new T.HemisphereLight(0xffe3d2,0x679798,2);scene.add(ambient);
const moon = new T.DirectionalLight(0xffcf9d, 2.25);
moon.position.set(-7, 15, 9); moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = moon.shadow.camera.bottom = -16;
moon.shadow.camera.right = moon.shadow.camera.top = 16;
moon.shadow.camera.near = .1; moon.shadow.camera.far = 45;
moon.shadow.bias = -.0007; scene.add(moon,moon.target);
const lanternFill = new T.PointLight(0xffa74d, 19, 11, 2); lanternFill.position.set(-1, 3.5, 0); scene.add(lanternFill);
const goalLight = new T.PointLight(0xffb75f, 15, 10, 2); scene.add(goalLight);

const sky = new T.Mesh(new T.SphereGeometry(115, 24, 12), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, depthTest:false,
  uniforms:{horizon:{value:new T.Vector3()},zenith:{value:new T.Vector3()},sunDir:{value:new T.Vector3()},night:{value:0},mist:{value:.35}},
}));
sky.renderOrder=-1000;scene.add(sky);

const water=harborWater(new T.PlaneGeometry(1024,1024));
const flatWater=water.geometry, rollingWater=new T.PlaneGeometry(1024,1024,256,256);
water.rotation.x = -Math.PI / 2; water.position.y = .02; scene.add(water);

const updateCoast = marketSky(sky,scene);
const animateHarbor=upland ? null : makeHarbor(scene);
if(upland)mountainRim(scene);
let bookmark=null;
if(liveBridge && sessionLaunch && !passage){
  const response=await fetch('/api/game-load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({launch:sessionLaunch,map:selectedLevel})}).catch(()=>null);
  if(response?.ok)bookmark=await response.json();
}
const {cmd,base,mode, ...authored}=expandChapter(chapter.level);
const world=new World(scene,bookmark?.state ?? {...authored,levelId:cmd??selectedLevel,revision:0},true);
if(passage){Object.assign(world.level.traveler,passage.traveler);world.level.cargo=passage.cargo;
  for(const e of passage.effects??[]) {
    const error=world.validateOps([{op:'effect',id:e.id,scope:e.scope,change:e.change}],new Map(world.entities),new Map(world.level.encounters.map(a=>[a.id,a])));
    if (error) (world.passageConflicts??=[]).push({id:e.id,error});
    else setEffect(world.level,{...e,seconds:e.remaining??undefined});
  }}
const trailWatch=trailBear(scene,document.querySelector('#bear-trail'),phase=>sound(phase==='warning'?80:57,.52,.04));
const animateWildlife=wildlife(scene,world,!upland);
const combat = new EncounterSystem(scene, world);
const player = {
  position: world.getSpawnPosition(), velocity: new T.Vector3(), grounded: world.level.spawn.split(':')[0], coyote: .1, jumpBuffer: 0,
  health: 3, invulnerable: 0, squash: 0, damageFlash: 0, airTarget:[0,0],
};

const kinetics=new Kinetics(world,combat,player);
const rules=new BehaviorEvents(()=>world.level,behaviorSnapshot,applyBehaviorOps,
  rule=>showToast('Paused: '+rule.id,rule.error));
const recent={contact:null,attacker:null},pointer=new T.Vector2();
let aimedShot=null,askedFrom=null;
function activeObjective() {
  const id=nextStop()?.platform??'finish';
  return world.level.objectives.find(rule=>rule.id===id);
}
function emitEvent(event) {
  if (!goalReached && world.level.objectives.length) recordObjective(activeObjective(),event);
  if (event.type==='noise' && world.level.intents.length) hear(world,combat.actors,event);
  rules.send(event);
}
function syncIntent(id) {
  const actor=combat.actors.get(id);
  if (!actor) return;
  actor.intent=world.level.intents.find(s=>s.id===id);
  actor.memory=null;actor.groundPlan=null;actor.engaged=false;actor.marker.visible=false;
  combat.cancelPattern(actor);combat.clearOwnedProjectiles(id);
  actor.state=actor.intent?'intent':actor.spec.friendly?'friendly':'forming';
  actor.timer=.6;
}
world.onIntent=syncIntent;
world.previewJump=()=>rules.filter('jump',world.level.traveler.jumpVelocity,{},true);
world.hasActorPart=(id,part)=>{const actor=combat.actors.get(id);return actor && !actor.defeated && actor.parts.has(part);};
world.onEffectEnd=id=>kinetics.releaseOwner(id);
for (const intent of world.level.intents) syncIntent(intent.id);
world.surfaces.onChange=world.onMechanicEvent=emitEvent;
function captureView(){return wishView(world,combat.actors,camera,pointer,player,recent);}
function onImpact(event){
  if(event.target)recent.contact={target:event.target,tag:event.tag,surface:event.surface??null,actorPart:event.actorPart??null,device:event.device??null};
  if(event.tag==='water' && event.surface){
    const {id,part}=event.surface;world.surfaces.change({id,part,action:'wet'},'water');
    event.surface=world.surfaces.describe(id,part);
  }
  if(event.tag==='water' && event.device){
    const device=world.get(event.target)?.devices.get(event.device);
    if(device)driveWheel(device,5,'water');
  }
  emitEvent(event);
  if (event.at && world.level.intents.length) emitEvent({type:'noise',tag:event.tag,source:event.source,at:event.at});
}
const lockedBoss=()=>nextStop() && world.level.goal.type==='defeat' ? world.level.goal.target : null;

function behaviorSnapshot(){
  const level=world.level;
  return {time:level.mechanicTime,stage,regions:Object.fromEntries([...world.places.members].map(([id,set])=>[id,[...set]])),lastReach:world.reach.report??null,weather:level.weather,cargo:level.cargo,traveler:level.traveler,
    player:{position:player.position.toArray(),velocity:player.velocity.toArray(),footing:player.grounded,
      facing:traveler.rotation.y,health:player.health,keys:[...keys].map(k=>k.replace(/^Digit/,''))},
    entities:[...world.entities.values()].map(e=>({id:e.id,kind:e.kind,position:e.group.position.toArray(),size:e.size})),
    encounters:[...combat.actors.values()].map(a=>({id:a.spec.id,kind:a.spec.kind,position:a.group.position.toArray(),
      arena:a.spec.arena,state:a.state,hits:a.hits,maxHits:a.spec.maxHits,defeated:a.defeated,friendly:!!a.spec.friendly}))};
}
function applyBehaviorOps(ops,rule){
  const owner=world.level.effects.find(e=>e.change===rule)?.id;
  const receipt=world.apply({v:1,mode:'patch',cmd:crypto.randomUUID(),base:world.level.revision,
    world:world.level.world,levelId:world.level.levelId,ops},Date.now(),true,owner);
  if(!receipt.ok)throw new Error(receipt.error);
  if(receipt.syncEncounters)combat.reconcile();
  if(ops.some(op=>['waypoint','objective'].includes(op.op)))updateObjective();
  applyPlayerEffects();
  revision.textContent='REV '+world.level.revision;
}

const goalRing = new T.Mesh(new T.TorusGeometry(.68, .042, 8, 64), new T.MeshBasicMaterial({ color: 0xe9a84c, transparent: true, opacity: .95, depthWrite: false }));
goalRing.rotation.x = Math.PI / 2;
scene.add(goalRing);
const goalMarker = new T.Mesh(new T.OctahedronGeometry(.19, 0), new T.MeshBasicMaterial({ color: 0xf5b94f, transparent: true, opacity: .98, depthWrite: false }));
const goalGlow = new T.Sprite(new T.SpriteMaterial({ map: world.glow, color: 0xffbf68, transparent: true, opacity: .4, blending: T.AdditiveBlending, depthWrite: false }));
goalGlow.scale.set(2.1, 2.1, 1); goalMarker.add(goalGlow);
scene.add(goalMarker);

const traveler = new T.Group(); scene.add(traveler); traveler.position.copy(player.position);
const harborRig=harborHand(traveler);
const pump=pumpTool(traveler);
traveler.rotation.y = Math.PI;
const shadow = new T.Mesh(new T.CircleGeometry(.35, 24), new T.MeshBasicMaterial({ color: 0x07171b, transparent: true, opacity: .32, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

const keys = new Set();
let airVault=true;
let drowningSince=null;
let yaw = 0, pitch = .21, radius = 9.4, swingTime = 0, swimming = false;
let drag=null;
function pointAt(e){const r=canvas.getBoundingClientRect();pointer.set(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height);}
canvas.addEventListener('pointerdown',e=>{
  canvas.focus(); canvas.setPointerCapture(e.pointerId);
  drag={x:e.clientX,y:e.clientY,travel:0};
});
canvas.addEventListener('pointermove',e=>{
  pointAt(e);
  if(!drag)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  drag.travel+=Math.abs(dx)+Math.abs(dy);drag.x=e.clientX;drag.y=e.clientY;
  yaw-=dx*.007; pitch=T.MathUtils.clamp(pitch+dy*.005,.12,1.05);
});
canvas.addEventListener('pointerup',e=>{
  if(drag && drag.travel<5 && e.button===0){
    pointAt(e);aimedShot=world.level.traveler.tool==='waterCannon'?viewHit(world,combat.actors,camera,pointer)?.at:null;
    pulseQueued=.16;
  }
  drag=null;
});
canvas.addEventListener('lostpointercapture',()=>drag=null);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{ e.preventDefault();radius=T.MathUtils.clamp(radius+e.deltaY*.009,5,15); },{passive:false});
let audio;
let pulseQueued = 0, useQueued=false;
let nearbyUse=null, dashTime=0, dashCooldown=0;
const dashDirection=new T.Vector3();
const stationAt=new T.Vector3();
function sound(freq = 260, duration = .05, volume = .025) {
  if (!audio) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'sine'; oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
}
addEventListener('keydown', event => {
  if(event.target.closest?.('input,select,button,textarea')) return;
  if(event.code==='Enter'){event.preventDefault(); document.querySelector('#wish').focus();return;}
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (!audio) audio = new AudioContext();
  if (event.code === 'Space' && !event.repeat && !keys.has('Space')) player.jumpBuffer = .12;
  if(event.code==='KeyX' && !event.repeat && world.level.traveler.dash && dashCooldown<=0 && drowningSince===null){
    dashDirection.set(Math.sin(traveler.rotation.y),0,Math.cos(traveler.rotation.y));
    dashTime=.19;dashCooldown=.9;sound(400,.07,.015);
  }
  if(event.code==='KeyG' && !event.repeat)useQueued=true;
  if (event.code === 'KeyF' && !keys.has('KeyF')) {aimedShot=null;pulseQueued=.16;}
  if (event.code === 'KeyR' && !event.repeat) {resetPlayer();notice('Returned to your last safe landing');}
  if(/^Digit[1-4]$/.test(event.code) && !event.repeat && !keys.has(event.code))rules.send({type:'press',key:event.code.slice(-1)});
  keys.add(event.code);
});
function releaseKey(code){
  if(keys.delete(code) && /^Digit[1-4]$/.test(code)) rules.send({type:'release',key:code.slice(-1)});
}
addEventListener('keyup',event=>releaseKey(event.code));
addEventListener('blur',()=>{for(const code of keys)releaseKey(code);});
canvas.addEventListener('pointerdown', () => canvas.focus());
let stage=0,runSeconds=0,runStarted=false;
function nextStop(){return world.level.goal.stops?.[stage];}
function checkpoint(){return world.get(world.level.goal.stops?.[stage-1]?.platform);}
function elapsedLabel(){
  const t=Math.floor(runSeconds);
  return Math.floor(t/60)+':'+String(t%60).padStart(2,'0');
}
function resetPlayer() {
  trailWatch.reset();
  expireEffects(world,0,true);
  for(const r of world.level.regions)world.places.forget(r.id,emitEvent,'reset');
  kinetics.clear();player.part=null;aimedShot=null;rules.send({type:'reset'});
  dashTime=0;dashCooldown=0;drowningSince=null; swimming=false; airVault=true;
  player.position.copy(world.getSpawnPosition()); player.velocity.set(0, 0, 0); player.grounded = world.level.spawn.split(':')[0]; player.coyote = .1; player.jumpBuffer = 0;
  player.health = 3; player.invulnerable = 0; player.squash = 0; player.damageFlash = 0; pulseQueued = 0;
  const safe=checkpoint();
  if(safe){player.position.copy(world.arrival(safe));player.grounded=safe.id;}
  if(player.position.y<=world.seaAt(player.position.x,player.position.z)+.10) {
    // A live tide edit can submerge spawn or the checkpoint. Recover on the nearest dry deck.
    let closest=Infinity, dry=null;
    for(const entity of world.entities.values()){
      const p=entity.group.position;
      if(entity.kind==='wall' || p.y<=world.tide+world.waveHeight+.12)continue;
      const distance=p.distanceToSquared(player.position);
      if(distance<closest){dry=entity;closest=distance;}
    }
    if(dry){player.position.copy(world.arrival(dry));player.grounded=dry.id;}
  }
  combat.reset(stage>0 || goalReached);
  for(const i of world.level.intents)syncIntent(i.id);
  if(!goalReached)updateObjective();
}

let goalReached = false, cursor = 0, polling = false;
const receipts = new Map();
const clientId=crypto.randomUUID();
let focusedAt=Date.now();
addEventListener('focus',()=>{focusedAt=Date.now();});
if (liveBridge) {
  try { cursor = (await fetch('/api/commands?after=0&sync=1').then(response => response.json())).cursor || 0; } catch { /* static/bridge-free startup */ }
}
const revision = document.querySelector('#revision');
const footing = document.querySelector('#footing');
const coords = document.querySelector('#coords');
const toast = document.querySelector('#toast');
function updateObjective() {
  const goal = world.level.goal;
  if(goalReached){
    document.querySelector('.objective h2').textContent=(world.level.lastObjective?.target==='finish' && world.level.lastObjective.reason==='alternative' ? 'The road is open.' : goal.completeTitle) ?? (goal.type==='board'?'Ferry boarded.':goal.type==='defeat'?'The guardian yields.':'Quay reached.');
    document.querySelector('#objective-detail').textContent=goal.completeHint ?? 'Stay to explore or reshape the route.';
    return;
  }
  const stop=nextStop();
  if(stop){
    document.querySelector('.objective h2').textContent=stop.title;
    document.querySelector('#objective-detail').textContent=activeObjective()?.hint??stop.hint;
    return;
  }
  document.querySelector('.objective h2').textContent = goal.title ?? (goal.type === 'board' ? 'Catch the last ferry.' : goal.type === 'defeat' ? `Silence ${goal.target.replaceAll('-', ' ')}.` : 'Reach the lantern quay.');
  document.querySelector('#objective-detail').textContent = activeObjective()?.hint ?? goal.hint ?? (goal.type === 'board'
    ? 'Cross to the ferry wharf.'
    : goal.type === 'defeat'
      ? 'Follow the last marker and defeat its guardian.'
      : 'Find the lantern gate. The market offers more than one route.');

}
function showToast(title, detail, duration = 4200) {
  document.querySelector('#toast-title').textContent = title;
  document.querySelector('#toast-detail').textContent = detail;
  toast.classList.add('visible');
  clearTimeout(showToast.timeout); showToast.timeout = setTimeout(() => toast.classList.remove('visible'), duration);
}
function notice(text) {
  const el = document.querySelector('#notice'); el.textContent = text; el.classList.add('visible');
  clearTimeout(notice.timeout); notice.timeout = setTimeout(() => el.classList.remove('visible'), 2300);
}
async function postReceipt(receipt) {
  try { await fetch('/api/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) }); } catch { /* live bridge unavailable in static playback */ }
}
async function pollCommands() {
  if (polling || !liveBridge || document.hidden) return; polling = true;
  try {
    const response = await fetch(`/api/commands?client=${clientId}&after=${cursor}`);
    const { commands } = await response.json();
    for (const command of commands) {
      cursor = Math.max(cursor, command.cursor);
      const receipt = world.apply(command, command.receivedAt);
      receipts.set(command.cmd, receipt);
      if (receipt.ok) {
        if (receipt.generated) {trailWatch.reset();stage=0;world.routeStage=0;runSeconds=0;runStarted=false;kinetics.clear();rules.clear();combat.loadLevel();recent.contact=recent.attacker=askedFrom=null;player.part=null;}
        else if (receipt.syncEncounters) combat.reconcile();
        applyPlayerEffects();
        if(command.ops?.some(op=>['waypoint','objective'].includes(op.op)))updateObjective();
        revision.textContent = `REV ${world.level.revision}`;
        if (receipt.generated) {
          if (Array.isArray(receipt.spawnPosition) && receipt.spawnPosition.length === 3) {
            player.position.fromArray(receipt.spawnPosition);
            player.velocity.set(0, 0, 0); player.grounded = world.level.spawn.split(':')[0]; goalReached = false;
          }
          player.health = 3; player.invulnerable = 0; pulseQueued = 0;
          updateObjective();
          showToast('New harbor ready.', 'Follow the first objective from the starting dock.');
        } else if (receipt.syncEncounters) showToast('The encounter is rewritten.', 'The world keeps moving; every active warning reflects the new rule.');
        else showToast('Harbor updated.', command.ops.map(o=>o.id || o.op).join(' · '));
        sound(420, .18, .035);
      } else showToast('Edit not applied.', receipt.error);
      await postReceipt(receipt);
    }
  } catch { /* playback mode needs no bridge */ } finally { polling = false; }
}
if (liveBridge) setInterval(pollCommands, 100);

function handleDefeats(defeats) {
  for (const defeat of defeats) {
    runCues('defeat',defeat.id);
    const healed=player.health<3;
    player.health=Math.min(3,player.health+1);
    showToast(defeat.id.replaceAll('-',' ')+' defeated.',healed?'Recovered one heart.':'The way is clear.',1800);
  }
}

// The model authors a cue once; the game handles the timing during play.
function applyPlayerEffects(){
  for(const effect of world.playerEffects.splice(0)){
    if(effect.op==='reach')world.reach.start(world,player,combat.actors,effect);
    else if(effect.op==='noise')emitEvent({type:'noise',tag:effect.tag,source:'player',at:effect.at??player.position.clone().add(new T.Vector3(0,.8,0)).toArray()});
    else if(effect.op==='intercept')world.intercept.start(effect,player);
    else if(effect.op==='shot')kinetics.shoot(effect);
    else if(effect.op==='tether')kinetics.setTether(effect);
    else if(effect.op==='motion')kinetics.motion(effect,lockedBoss());
    else if(effect.op==='signal')emitEvent({type:'signal',tag:effect.tag,data:effect.data});
    else if(effect.op==='vitality'){
      if(effect.hearts<0)damagePlayer(-effect.hearts,'harbor');
      else player.health=Math.min(3,player.health+effect.hearts);
    }
    else if(effect.op==='cast') handleDefeats(combat.cast(effect,player,lockedBoss()));
    else if(effect.op==='say')showToast('Harbor message',effect.text);
    else if(effect.op==='mend'){
      player.health=Math.min(3,player.health+effect.hearts);
      notice('Hearts: '+player.health+' / 3');
    }else if(effect.op==='passage'){
      const deck=world.get(effect.to);if(!deck)continue;
      player.position.copy(world.arrival(deck));
      player.velocity.set(0,0,0);player.grounded=deck.id;player.coyote=.1;player.jumpBuffer=0;
      if(drowningSince!==null)player.health=3;
      drowningSince=null;swimming=false;airVault=true;
      cameraLook.copy(player.position);cameraLook.y+=.95;
      notice('Arrived at '+deck.id.replaceAll('-',' '));
    }
  }
}
function fireCue(cue){
  const need=cue.needs, stack=need && world.level.cargo.find(c=>c.item===need.item);
  if(need && (stack?.count??0)<need.count){
    if(cue.when==='use')notice('Bring '+need.count+' '+need.item+' · carrying '+(stack?.count??0));
    return;
  }
  const result=world.apply({v:1,mode:'patch',cmd:crypto.randomUUID(),base:world.level.revision,world:world.level.world,levelId:world.level.levelId,ops:cue.then},Date.now());
  if(!cue.repeat || !result.ok)world.level.cues=world.level.cues.filter(c=>c!==cue);
  if(!result.ok){world.level.revision++;showToast('Cue skipped: '+cue.id,result.error);}
  else{
    if(need?.spend){stack.count-=need.count;world.level.cargo=world.level.cargo.filter(c=>c.count>0);}
    if(result.syncEncounters)combat.reconcile();
    if(cue.then.some(op=>['waypoint','objective'].includes(op.op)))updateObjective();
    if(!cue.repeat)showToast(cue.id.replaceAll('-',' '),result.applied.join(' · '),2100);
    applyPlayerEffects();
  }
  revision.textContent='REV '+world.level.revision;
}
function runCues(when,target,details){
  emitEvent({type:when,target,...details});
  for(const cue of world.level.cues)if(cue.when===when && (!target || cue.target===target))fireCue(cue);
}
function visitStations(){
  nearbyUse=null;
  const deck=world.get(player.grounded);let nearest=2.0;
  for(const station of world.level.stations){
    if(!deck || station.deck!==deck.id || station.taken)continue;
    const model=deck.stations.get(station.id);
    if(!model)continue;
    model.getWorldPosition(stationAt);
    const distance=stationAt.distanceTo(player.position);
    if(station.kind==='cargo'){
      if(distance>1.15)continue;
      station.taken=true;model.visible=false;
      let stack=world.level.cargo.find(c=>c.item===station.item);
      if(!stack){stack={item:station.item,count:0};world.level.cargo.push(stack);}
      stack.count+=station.count??1;
      revision.textContent='REV '+(++world.level.revision);
      notice('Picked up '+station.item+' × '+(station.count??1));sound(720,.12,.018);
      runCues('collect',station.id);
      if(player.grounded!==deck.id){nearbyUse=null;break;}
    }else if(station.kind!=='wheel' && distance<nearest){nearest=distance;nearbyUse=station;}
  }
  if(useQueued && nearbyUse && deck?.stations.has(nearbyUse.id)){sound(nearbyUse.kind==='bell'?540:340,.38,.022);runCues('use',nearbyUse.id);}
  useQueued=false;
}

function damagePlayer(amount,source){
  if(player.invulnerable>0 || drowningSince!==null)return;
  amount=rules.filter('damage',amount,{source});
  if(!amount)return;
  if(combat.actors.has(source))recent.attacker=source;
  player.health=Math.max(0,player.health-amount);
  player.invulnerable=1.05;player.damageFlash=.65;
  notice(source.replaceAll('-',' ')+' hit you · '+player.health+' hearts remain');
  sound(95,.18,.04);runCues('hurt',undefined,{target:'player',source});
  if(player.health===0){
    resetPlayer();
    showToast('The lantern went out.','Back at your last safe landing. Your route and map edits are intact.',4200);
  }
}

function physics(dt) {
  expireEffects(world,dt);
  world.reach.step(world,emitEvent);
  rules.step(dt);
  applyPlayerEffects();
  dashCooldown=Math.max(0,dashCooldown-dt);
  for(const cue of world.level.cues)if(cue.when==='after'){
    cue.remaining=(cue.remaining??cue.seconds)-dt;
    if(cue.remaining<=0){cue.remaining=cue.seconds;fireCue(cue);}
  }
  const previousFooting=player.grounded,previousPart=player.part;
  world.surfaces.step(dt);
  if(keys.size)runStarted=true;
  if(runStarted && !goalReached)runSeconds+=dt;
  world.intercept.prepare(player,dt);
  const changes = world.update(dt,player.grounded);
  for(const actor of combat.actors.values()){
    const ride=changes.deltas.get(actor.deck);
    if(ride) {actor.group.position.add(ride);actor.floor+=ride.y;}
    const shift=changes.deltas.get(actor.spec.arena);
    if(!shift)continue;
    actor.anchor.add(shift); actor.spec.at=actor.anchor.toArray();
    world.level.encounters.find(e=>e.id===actor.spec.id).at=actor.anchor.toArray();
  }
  player.invulnerable = Math.max(0, player.invulnerable - dt);
  const ready=pulseQueued>0 && combat.pulseCooldown<=0;
  pulseQueued=ready ? 0 : Math.max(0,pulseQueued-dt);
  const attacking=ready && drowningSince===null && rules.filter('attack',1);
  if (attacking) {
    const cannon=world.level.traveler.tool==='waterCannon';
    const result=cannon ? combat.shootWater(player,traveler.rotation.y,lockedBoss(),aimedShot) : combat.slash(player,traveler.rotation.y,lockedBoss());
    aimedShot=null;
    if(result.contact)onImpact(result.contact);
    if(result.fired) swingTime=.35;
    sound(result.counter ? 910 : result.finisher ? 205 : result.hits.length ? 720 : 310, result.hits.length ? .16 : .07, .025);
    for (const hit of result.hits) {
      rules.send({type:'hit',target:hit.id});
      if(result.counter || result.finisher) notice(result.counter?'Riposte!':'Oar finisher');
    }
    handleDefeats(result.defeats);
    if(result.fired)runCues('attack');
  }
  const combatEvents = combat.update(player,dt,lockedBoss());
  for(const hit of combatEvents.hits)rules.send({type:'hit',target:hit.id});
  handleDefeats(combatEvents.defeats);
  if(combat.feedback){notice(combat.feedback);sound(880,.12,.027);combat.feedback=null;}
  for(const hit of combatEvents.damage)damagePlayer(hit.amount,hit.source);
  kinetics.update(dt,lockedBoss(),onImpact);
  if (player.grounded && changes.deltas.has(player.grounded)) player.position.add(changes.deltas.get(player.grounded));
  for (const event of changes.events) {
    const receipt = receipts.get(event.cmd);
    if (receipt) { receipt.firstVisibleMs = event.firstVisibleMs; postReceipt(receipt); }
  }
  if(drowningSince!==null) {
    const elapsed=(performance.now()-drowningSince)/1000;
    player.position.y=world.seaAt(player.position.x,player.position.z)-Math.min(1.7,elapsed*1.8);
    traveler.position.copy(player.position);
    player.jumpBuffer=0; pulseQueued=0;
    if(elapsed>=1.05){resetPlayer();traveler.position.copy(player.position);showToast('Back on dry land.','Your checkpoint and map edits are intact.',2000);}
    return;
  }
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const length = Math.hypot(right, forward) || 1;
  yaw += (Number(keys.has('KeyQ'))-Number(keys.has('KeyE')))*dt*1.9;
  const tuning=world.level.traveler;
  const speedLimit=swimming?3.8:keys.has('ShiftLeft')||keys.has('ShiftRight')?tuning.runSpeed:tuning.speed;
  const targetX=(right*Math.cos(yaw)-forward*Math.sin(yaw))/length*speedLimit;
  const targetZ=(-right*Math.sin(yaw)-forward*Math.cos(yaw))/length*speedLimit;
  player.airTarget[0]=targetX;player.airTarget[1]=targetZ;
  const acceleration = player.grounded ? 18 : kinetics.rope ? .8 : 7;
  const blend = 1 - Math.exp(-acceleration * dt);
  player.velocity.x = T.MathUtils.lerp(player.velocity.x, targetX, blend);
  player.velocity.z = T.MathUtils.lerp(player.velocity.z, targetZ, blend);
  if(dashTime>0 && tuning.dash){
    dashTime=Math.max(0,dashTime-dt);player.velocity.x=dashDirection.x*14;player.velocity.z=dashDirection.z*14;
  }
  world.places.step(world.level.regions,player,combat.actors,dt,emitEvent);
  kinetics.drivePlayer(dt);
  kinetics.pullTether(dt);
  slide(world.entities,player.position,'x',player.velocity.x*dt,player.grounded);
  slide(world.entities,player.position,'z',player.velocity.z*dt,player.grounded);
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
  player.coyote = player.grounded ? .11 : Math.max(0, player.coyote - dt);
  if(player.grounded || swimming) airVault=true;
  if(player.jumpBuffer>0 && !player.grounded && player.coyote<=0 && !swimming && airVault && tuning.airVaultVelocity>0){
    // Push off the air once with the oar to stretch or correct a jump.
    const speed=rules.filter('vault',tuning.airVaultVelocity);
    player.jumpBuffer=0;
    if(speed){player.velocity.y=speed;airVault=false;swingTime=.35;combat.burst(player.position,6);sound(535,.1,.025);}
  }
  if (player.jumpBuffer > 0 && (player.grounded || player.coyote > 0 || swimming)) {
    const speed=rules.filter('jump',tuning.jumpVelocity);player.jumpBuffer=0;
    if(speed){
      swimming=false;player.velocity.y=speed;player.grounded=null;player.coyote=0;
      sound(300,.06,.018);runCues('jump');
    }
  }
  const waterline=world.seaAt(player.position.x,player.position.z)+.03;
  player.part=null;
  if(player.grounded && player.position.y+.35<waterline)player.grounded=null;
  if(player.grounded) {
    const support=landing(world.entities,player.position,player.position.y-.27,player.position.y+.24);
    if(support && support.top+.35>=waterline){
      player.position.y=support.top;player.grounded=support.entity.id;player.part=support.part;player.velocity.y=0;
    }else player.grounded=null;
  }
  if (!player.grounded) {
    const previousY = player.position.y;
    player.velocity.y -= tuning.gravity * dt; player.position.y += player.velocity.y * dt;
    if(player.velocity.y>0) {
      const headroom=ceiling(world.entities,player.position,previousY,player.position.y);
      if(headroom<player.position.y){player.position.y=headroom;player.velocity.y=0;airVault=false;}
    } else {
      const support=landing(world.entities,player.position,player.position.y-.02,previousY+.024);
      if(support && support.top+.35>=waterline) {
        player.squash=Math.min(.16,-player.velocity.y*.012);
        player.position.y=support.top;player.velocity.y=0;player.grounded=support.entity.id;player.part=support.part;player.coyote=.11;
      }
    }
  }
  if(trailWatch.step(dt,world,player,yaw)){
    resetPlayer();traveler.position.copy(player.position);sound(62,.33,.05);
    showToast('The cedar bear caught you.','Back at your safe landing. Roads, bridges and platforms break the chase.',4200);
    return;
  }
  if(player.grounded && player.grounded!==previousFooting){
    const hint=world.level.trailNotes?.[player.grounded];if(hint)wick.whisper(hint);
  }
  visitStations();
  if(player.grounded && (player.grounded!==previousFooting || player.part!==previousPart)){
    const surface=world.surfaces.describe(player.grounded,player.part);
    recent.contact={target:player.grounded,tag:'land',surface};
    if(player.grounded!==previousFooting)runCues('land',player.grounded,{surface});
    else emitEvent({type:'land',target:player.grounded,surface});
  }
  if(player.part && world.surfaces.active.size && world.surfaces.isBurning(player.grounded,player.part))
    damagePlayer(1,'fire');
  const stop=nextStop();
  const objective=world.level.objectives.length?activeObjective():null;
  if(stop && !goalReached){
    const guardian=combat.actors.get(stop.guardian);
    const stock=player.grounded===stop.platform && (!guardian || guardian.defeated || guardian.spec.friendly);
    if(satisfied(objective,stock)){
      stage++;world.routeStage=stage;
      wick.cheer(stage===1?'First seal! I knew you had it.':'One more seal for the logbook.');
      world.level.lastObjective={type:'objective',target:stop.platform,reason:objective?.done?'alternative':'stock'};
      rules.send(world.level.lastObjective);
      player.health=3;
      sound(805,.28,.036);
      showToast(world.level.goal.type==='board'?'Harbor signal lit.':'Trail seal lit.',`Checkpoint · ${stage} of ${world.level.goal.stops.length}. Hearts restored.`,2600);
      updateObjective();
    }
  }
  const stockFinish=world.level.goal.type==='defeat' ? combat.actors.get(world.level.goal.target)?.defeated : player.grounded===world.level.goal.target;
  if(!stop && !goalReached && satisfied(objective,stockFinish)){
    goalReached = true;
    world.level.lastObjective={type:'objective',target:'finish',reason:objective?.done?'alternative':'stock'};
    rules.send(world.level.lastObjective);
    if(world.level.lastObjective.reason==='alternative')showToast('The road is open.', 'Alternate objective complete.',3200);
    else if(world.level.goal.type==='board')showToast('All aboard.', 'You caught the ferry.', 3200);
    updateObjective();
    sound(660,.4,.035);
  }
  swimming=!player.grounded && player.position.y<=waterline+.005 && player.velocity.y<=0;
  if(swimming){player.position.y=waterline;player.velocity.y=0;}
  if(swimming && (tuning.water==='danger' || tuning.water==='map')) {
    drowningSince=performance.now(); swimming=false;
    player.health=0; player.invulnerable=2; player.damageFlash=.48;
    player.velocity.set(0,0,0); airVault=false;
    showToast('Lost in the current.','Returning to your last safe landing.',1200);
    sound(78,.23,.025);runCues('overboard');
  }
  player.position.x=T.MathUtils.clamp(player.position.x,basin.west,basin.east);
  player.position.z=T.MathUtils.clamp(player.position.z,basin.north,basin.south);
  traveler.position.copy(player.position);
  if(swimming) traveler.position.y-=.46+Math.sin(performance.now()*.005)*.07;
  traveler.visible = true;
  swingTime=Math.max(0,swingTime-dt);
  const swing=Math.sin(Math.PI*swingTime/.35);
  player.squash = Math.max(0, player.squash - dt * .7);
  player.damageFlash = Math.max(0, player.damageFlash - dt * 1.4);
  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  if (speed > .2) traveler.rotation.y = Math.atan2(player.velocity.x, player.velocity.z);
  player.facing=traveler.rotation.y;
  harborRig.animate(dt,speed,!!player.grounded,swing,player.invulnerable>0,combat.combo,player.velocity.y,traveler.rotation.y);
  const ground=landing(world.entities,player.position,-Infinity,player.position.y+.045);
  shadow.visible=Boolean(ground);
  shadow.position.set(player.position.x,(ground?.top??0)+.012,player.position.z);
  shadow.scale.setScalar(1 + Math.max(0, player.position.y - shadow.position.y) * .3);
}

if(bookmark){
  const b=bookmark.brief;
  stage=world.routeStage=b.route.stage;goalReached=b.route.complete;runSeconds=b.route.elapsed??0;runStarted=stage>0||runSeconds>0;
  if(b.player.health>0){
    player.position.fromArray(b.player.position);player.health=b.player.health;player.grounded=b.player.footing??null;
    player.facing=traveler.rotation.y=b.player.facing;traveler.position.copy(player.position);
  }else resetPlayer();
  for(const saved of b.encounters){
    const actor=combat.actors.get(saved.id);if(!actor)continue;
    actor.hits=saved.hits;actor.defeated=saved.defeated;
    if (actor.intent && saved.intent && world.get(saved.deck) && Number.isFinite(saved.floor)) {
      actor.group.position.fromArray(saved.position);actor.floor=saved.floor;actor.deck=saved.deck;
      actor.memory=structuredClone(saved.intent.memory);
    }
    if (!actor.defeated && saved.stun>0) { actor.stun=saved.stun; actor.state='stunned'; }
    if(actor.defeated){actor.state='defeated';actor.group.scale.setScalar(.82);}
  }
  for(const region of b.regions??[]) {
    if(world.level.regions.some(r=>r.id===region.id))world.places.members.set(region.id,new Set(region.occupants));
  }
  revision.textContent='REV '+world.level.revision;
}
const cameraLook = player.position.clone().add(new T.Vector3(0,.95,0));
const desiredLook = new T.Vector3();
let boomDistance=radius;
const shadowRight=new T.Vector3(), shadowUp=new T.Vector3(), vertical=new T.Vector3(0,1,0);
updateObjective();
const selector=document.querySelector('#map-select');
for(const entry of catalog)selector.add(new Option(entry.name,entry.id));
selector.value=selectedLevel;
selector.onchange=e=>enterChapter(e.target.value);
const continueButton=document.querySelector('#continue-chapter');
if(onward)continueButton.textContent='Continue to '+onward.name+' →';
continueButton.onclick=()=>{if(goalReached && onward)enterChapter(onward.id,true);};
revision.textContent=`REV ${world.level.revision}`;
document.querySelector('#pulse-control').hidden = !world.level.encounters.length;
const editor=document.querySelector('#editor'), wish=document.querySelector('#wish'), tip=document.querySelector('#edit-tip');
const wick=wishCompanion(editor,wish,tip);
const sendWish=editor.querySelector('button[type="submit"]');
tip.textContent='Point, then press Enter to wish.';
wish.addEventListener('focus',()=>{keys.clear();askedFrom=captureView();});
wish.addEventListener('keydown',e=>{if(e.key==='Escape') canvas.focus();});
editor.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!wish.value.trim() || editor.dataset.busy)return;
  const request=wish.value.trim(), brief=world.brief(player,combat.brief());
  brief.wishContext=askedFrom??captureView();
  const command={v:1,cmd:crypto.randomUUID(),world:brief.world,mode:'patch',base:brief.revision,levelId:brief.levelId};
  editor.dataset.busy='true'; selector.disabled=continueButton.disabled=sendWish.disabled=true;
  wick.state('sending','Sealing your wish…');
  try {
    if (sessionLaunch && liveBridge) {
      const payload={launch:sessionLaunch,id:command.cmd,clientId,wish:request,context:brief.wishContext};
      async function post(route) {
        const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const data=await response.json();
        if(!response.ok) throw new Error(data.error || 'Game session unavailable.');
        return data;
      }
      await post('/api/game-wish');
      if(wish.value.trim()===request){wish.value='';canvas.focus();}
      wick.state('accepted','Wish delivered. Keep playing.');
      // Only this caller waits; movement, combat and live patches continue.
      for (;;) {
        await new Promise(resolve=>setTimeout(resolve,900));
        const reply=await post('/api/game-answer');
        if (reply.message) {
          const receipt=receipts.get(reply.receiptId ?? command.cmd);
          wick.state(receipt?.ok && receipt.firstVisibleMs!=null?'granted':receipt?.ok===false?'error':'answered',reply.message);
          break;
        }
      }
      return;
    }
    let ops=localEdit(request,brief), source='Local';
    if(!ops){
      if(!import.meta.env.DEV) throw new Error('Free-form model edits need the local game server. Try a move or resize.');
      wick.state('accepted','I’ve got your wish. Keep playing.');source='OpenClaw';canvas.focus();
      const response=await fetch('/api/design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wish:request,brief})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);ops=result.ops;
    }
    if(source==='Local')wick.state('accepted','I’ve got your wish.');
    const receipt=world.apply({...command,ops},Date.now());
    if(!receipt.ok)throw new Error(receipt.error);
    if(receipt.syncEncounters)combat.reconcile();
    if(ops.some(op=>['waypoint','objective'].includes(op.op)))updateObjective();
    revision.textContent=`REV ${receipt.revision}`;
    if(wish.value.trim()===request){wish.value='';canvas.focus();}
    await new Promise(resolve=>setTimeout(resolve,360));
    wick.state('granted','Wish granted · '+ops.map(o=>o.id || o.op).join(', '));
  }catch(error){wick.state('error',error.message);}
  finally{delete editor.dataset.busy;selector.disabled=continueButton.disabled=sendWish.disabled=false;}
});
const sunOffset=new T.Vector3(-7,15,9);
const updateAir=atmosphere(scene,sky,water,moon,ambient,sunOffset);
const drawChart=chart(world,player,wish,upland?'Trail chart':'Harbor chart');
let accumulator = 0, previousTime = performance.now(), lastBrief = 0;
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - previousTime) / 1000, .05); previousTime = now; accumulator += dt;
  while (accumulator >= 1 / 60) { physics(1 / 60); accumulator -= 1 / 60; }
  water.material.uniforms.time.value=world.seaTime;
  water.material.uniforms.amplitude.value=world.waveHeight;
  water.geometry=world.waveHeight>.002?rollingWater:flatWater;
  water.position.y=.02+world.tide;
  updateAir(world.level.weather,player.position,world.seaTime);
  {
    updateCoast(world.level.weather.time);
    water.material.uniforms.sunDirection.value.copy(sunOffset).normalize();
  }
  const cannon=world.level.traveler.tool==='waterCannon';
  if(pump.visible!==cannon){
    pump.visible=cannon;
    harborRig.oar.visible=!cannon;
    document.querySelector('#action-hint span').textContent=cannon?'FIRE WATER CANNON':'SWING OAR';
    document.querySelector('#pulse-control').lastChild.textContent=cannon?'Fire water cannon':'Swing';
  }
  pump.position.z=.28-.09*Math.sin(Math.PI*swingTime/.35);
  animateWildlife(now*.001);
  animateHarbor?.(now*.001,world.level.weather.lights,world.level.weather.lampPattern);
  desiredLook.copy(player.position);desiredLook.y+=.95;
  cameraLook.lerp(desiredLook, 1 - Math.exp(-3.1 * dt));
  camera.position.set(cameraLook.x+Math.sin(yaw)*Math.cos(pitch)*radius,cameraLook.y+Math.sin(pitch)*radius,cameraLook.z+Math.cos(yaw)*Math.cos(pitch)*radius);
  {
    const limit=cameraDistance(world.entities,cameraLook,camera.position);
    boomDistance=limit<boomDistance?limit:T.MathUtils.damp(boomDistance,limit,7,dt);
    camera.position.sub(cameraLook).setLength(boomDistance).add(cameraLook);
  }
  camera.lookAt(cameraLook);
  footing.textContent = player.grounded ? player.grounded.replaceAll('-', ' ').toUpperCase() : drowningSince!==null?'OVERBOARD':swimming?(checkpoint()?'SWIM · R TO CHECKPOINT':'SWIM · SPACE TO CLIMB'):'IN THE AIR';
  const stop=nextStop();
  const goalEntity = world.get(stop?.platform || world.level.goal.target);
  const targetEncounter = combat.actors.get(world.level.goal.target);
  const targetPosition = goalEntity?.group.position || targetEncounter?.group.position;
  const goalName = stop ? stop.platform.replaceAll('-',' ').toUpperCase() : (targetEncounter?.spec.kind === 'heron' ? 'HERON' : goalEntity?.kind === 'ferry' ? 'FERRY' : world.level.goal.target.replaceAll('-', ' ')).toUpperCase();
  continueButton.hidden=!(onward && goalReached);
  coords.textContent = goalReached ? 'FINISH · '+elapsedLabel() : targetPosition ? `${goalName} · ${Math.hypot(player.position.x - targetPosition.x, player.position.z - targetPosition.z).toFixed(1)} M` : '';
  goalRing.visible = goalMarker.visible = !!targetPosition && !goalReached;
  if (targetPosition) {
    goalRing.position.set(targetPosition.x, targetPosition.y + .055, targetPosition.z);
    goalMarker.position.set(targetPosition.x, targetPosition.y + 4.6 + Math.sin(now * .003) * .1, targetPosition.z);
  }
  goalRing.rotation.z = goalMarker.rotation.y = now * .0006;
  lanternFill.position.set(player.position.x - .8, player.position.y + 3.1, player.position.z + 1.1);
  if (targetPosition) goalLight.position.set(targetPosition.x, targetPosition.y + 3.2, targetPosition.z);
  goalLight.intensity = targetPosition && world.level.weather.lights ? 15 : 0;
  lanternFill.intensity=world.level.weather.lights?19:0;
  document.querySelector('#damage-vignette').style.opacity = player.damageFlash;
  document.querySelector('#cargo').textContent=world.level.cargo.map(c=>c.item+' × '+c.count).join(' · ');
  document.querySelector('#dash-control').hidden=!world.level.traveler.dash;
  document.querySelector('#use-station').textContent=nearbyUse?'G · '+(nearbyUse.label || (nearbyUse.kind==='bell'?'Ring bell':'Use shrine')):'';
  document.querySelector('#health').textContent = `${'●'.repeat(player.health)}${'○'.repeat(3 - player.health)}`;
  let goalEncounter=null;
  for(const actor of combat.actors.values()){
    if(!actor.engaged || actor.defeated || actor.spec.friendly || actor.state==='sleep')continue;
    if(actor.spec.phases[actor.phaseIndex]?.sequence){goalEncounter=actor;break;}
    if(!goalEncounter || actor.group.position.distanceToSquared(player.position)<goalEncounter.group.position.distanceToSquared(player.position))goalEncounter=actor;
  }
  document.querySelector('#route-status').textContent=world.level.goal.stops ? `${world.level.goal.stopsLabel ?? 'Signals'} · ${stage} / ${world.level.goal.stops.length}` : '';
  document.querySelector('#pulse-control').hidden = !combat.actors.size && !cannon;
  const encounterHud = document.querySelector('#encounter');
  encounterHud.classList.toggle('visible', !!goalEncounter && !goalReached);
  if (goalEncounter) {
    document.querySelector('#encounter-name').textContent = (goalEncounter.spec.form?.name ?? goalEncounter.spec.form?.body ?? goalEncounter.crew?.label ?? goalEncounter.spec.id.replaceAll('-', ' ')).toUpperCase();
    const phase=goalEncounter.spec.phases[goalEncounter.phaseIndex];
    const boss=!!phase.sequence, move=bossMoves[goalEncounter.pattern?.move];
    const open=goalEncounter.state==='recover' || goalEncounter.stun>0;
    let cue='';
    if(boss){
      cue=move ? move.name+' · '+move.answer : open?'Exposed · strike now':'Watch the wind-up';
    }else if(goalEncounter.stun>0)cue='Staggered';
    else if(goalEncounter.state==='tell')cue=goalEncounter.bash?'Bash · swing as it lands':
      phase.attack==='charge'?'Charge · sidestep':'Aiming · return the pearl';
    else if(open)cue='Open';
    encounterHud.classList.toggle('boss',boss);
    encounterHud.dataset.open=String(open);
    const hp=goalEncounter.spec.maxHits-goalEncounter.hits;
    document.querySelector('#encounter-state').textContent=(boss?'Tide '+(goalEncounter.phaseIndex+1)+' · ':'')+hp+' / '+goalEncounter.spec.maxHits;
    document.querySelector('#encounter-cue').textContent=cue;
    document.querySelector('#encounter-progress').style.width=(100*hp/goalEncounter.spec.maxHits)+'%';
    const inReach=goalEncounter.group.position.distanceTo(player.position)<(cannon ? world.level.traveler.jetRange : 3.3);
    document.querySelector('#action-hint span').textContent=cannon?'FIRE WATER CANNON':combat.time<=combat.riposteUntil?'RIPOSTE':combat.combo===2 && combat.time<=combat.comboUntil?'FINISH THE COMBO':'SWING OAR';
    document.querySelector('#action-hint').classList.toggle('visible',inReach && (!boss || open) && !goalReached);
  } else document.querySelector('#action-hint').classList.remove('visible');
  if (goalReached || !goalEncounter) document.querySelector('#action-hint').classList.remove('visible');
  if (liveBridge && !document.hidden && now - lastBrief > 500) {
    lastBrief = now;
    const currentBrief = world.brief(player, combat.brief());
    if(world.level.wilderness)currentBrief.wilderness={...world.level.wilderness,...trailWatch.brief()};
    currentBrief.graphics=graphics;currentBrief.kinetics=kinetics.brief();
    currentBrief.route={stage,elapsed:runSeconds,nextStop:nextStop(),complete:goalReached};
    fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({clientId,launch:sessionLaunch,focusedAt,map:selectedLevel,brief:currentBrief,state:world.serialize()}) }).catch(() => {});
  }
  drawChart(now,yaw,stop?.platform || targetEncounter?.spec.arena || world.level.goal.target);
  sky.position.copy(camera.position);
  moon.target.position.copy(player.position);
  {
    // Keep the directional shadow footprint on whole texels as the camera follows the traveler.
    shadowRight.crossVectors(vertical,sunOffset).normalize();
    shadowUp.crossVectors(sunOffset,shadowRight).normalize();
    const texel=32/moon.shadow.mapSize.x;
    for(const axis of [shadowRight,shadowUp]){
      const coordinate=player.position.dot(axis);
      moon.target.position.addScaledVector(axis,Math.round(coordinate/texel)*texel-coordinate);
    }
  }
  moon.position.copy(moon.target.position).add(sunOffset);
  for(const entity of world.entities.values()){
    const drawDistance=entity.dressing==='foothill' ? 100+Math.hypot(...entity.size)*.5 : 100;
    entity.group.visible=entity.group.position.distanceToSquared(player.position)<drawDistance*drawDistance;
    if(entity.wake)entity.wake.visible=entity.group.visible;
  }
  world.surfaces.draw(now*.001);
  renderer.render(scene, camera);
  for (const receipt of receipts.values()) {
    if ((receipt.generated || receipt.visibleOnRender) && receipt.firstVisibleMs === null) {
      receipt.firstVisibleMs = Date.now() - receipt.receivedAt;
      postReceipt(receipt);
    }
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Inspect the running map without issuing a live edit.
window.__lastFerry = { brief: () => ({...world.brief(player,combat.brief()),graphics,...(world.level.wilderness && {wilderness:{...world.level.wilderness,...trailWatch.brief()}}),kinetics:kinetics.brief(),route:{stage,elapsed:runSeconds,complete:goalReached}}), snapshot: () => world.serialize() };

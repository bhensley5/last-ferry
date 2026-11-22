import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { BossAttack, bossMoves } from '../src/boss-patterns.js';
import { EncounterSystem } from '../src/combat.js';
import { advanceCrew } from '../src/pursuit.js';

function deck(id, x = 0, halfWidth = 4) {
  const bounds = new T.Box3(new T.Vector3(-halfWidth,-.2,-4),new T.Vector3(halfWidth,0,4));
  const group = new T.Group();
  group.position.x = x;
  return {id,kind:'dock',group,obstacles:[bounds],obstacleBounds:bounds,size:[2*halfWidth,8]};
}

test('boss attacks lock their marks during the tell and hit at most once on a moving deck', () => {
  function hits(move,x,y,z) {
    const scene=new T.Scene(), arena=deck('tower'), actor={group:new T.Group()};
    const player={position:new T.Vector3(0,0,3)};
    const attack=new BossAttack(scene,arena,actor,player,move,.8);
    arena.group.position.x=8;
    player.position.set(8+x,y,z);
    let count=0;
    for(let i=0;i<160;i++){
      const result=attack.update(1/60,player);
      if(result.hit){assert.ok(result.live);count++;}
      if(result.done)break;
    }
    attack.dispose();
    assert.equal(scene.children.length,0);
    return count;
  }
  for(const move of Object.keys(bossMoves)) {
    assert.equal(hits(move,move==='pincers'?1.76:0,0,3),1,move);
  }
  assert.equal(hits('broadside',2,0,3),0);
  assert.equal(hits('breaker',0,1.3,3),0);
  assert.equal(hits('antlerSweep',0,1.3,3),0);
  assert.equal(hits('antlerSweep',0,0,-3),0);
  assert.equal(hits('bellfall',0,0,0),0);
  assert.equal(hits('pincers',0,0,3),0);
});

test('a ground pursuer crosses a joined deck but cannot step over open water or a closed wall', () => {
  const a=deck('a',0,2), b=deck('b',4,2);
  const entities=new Map([[a.id,a],[b.id,b]]);
  const world={entities,get:id=>entities.get(id),seaAt:()=>-1};
  const actor={crew:{grounded:true},group:new T.Group(),floor:0,deck:'a',trail:[]};
  function walk(n){for(let i=0;i<n;i++)advanceCrew(world,actor,3,0,1/60,false);}
  walk(72);
  assert.equal(actor.deck,'b');
  assert.ok(actor.group.position.x>3);
  b.group.position.x=10;
  actor.group.position.set(0,0,0);actor.deck='a';
  walk(120);assert.ok(actor.group.position.x<2.16);
  const wall=deck('wall',1,.2);
  wall.obstacleBounds.max.y=2;wall.kind='wall';entities.set('wall',wall);
  actor.group.position.set(0,0,0);
  walk(40);assert.ok(actor.group.position.x<.59);
});

test('a returned volley delivers one defeat even when that defeat removes the remaining shots', () => {
  const world={glow:null,level:{encounters:[],traveler:{power:1}},wallBlocks:()=>false,supportAt:()=>null};
  const combat=new EncounterSystem(new T.Scene(),world);
  const spec={id:'lamp',at:[0,0,0],kind:'wisp',maxHits:2,activationRange:10,
    phases:[{afterHits:0,movement:'perch',attack:'aimedPearl',tell:1,recover:1,interval:1,count:1,spread:0,projectileSpeed:3}]};
  const actor=combat.addActor(spec);
  const player={position:new T.Vector3(0,0,1.3),invulnerable:0};
  actor.aim.copy(player.position);
  combat.fire(actor);combat.fire(actor);
  combat.slash(player,Math.PI);
  assert.ok(combat.projectiles.every(shot=>shot.returned));
  const {defeats}=combat.update(player,1/60);
  assert.equal(defeats.length,1);
  assert.equal(combat.projectiles.length,0);
  assert.equal(actor.defeated,true);
});

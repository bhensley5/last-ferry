import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { chapterCatalog, expandChapter } from '../src/chapters.js';
import { insideBasin } from '../src/basin.js';

const dir=new URL('../levels/',import.meta.url);
const files=Object.fromEntries(await Promise.all((await readdir(dir)).filter(n=>n.endsWith('.json')).map(async name=>
  [name,JSON.parse(await readFile(new URL(name,dir),'utf8'))])));

test('shipped chapters compile to unique, addressable pieces and finishable objectives',()=>{
  const chapters=chapterCatalog(files);
  assert.equal(new Set(chapters.map(c=>c.alias)).size,chapters.length);
  assert.equal(new Set(chapters.map(c=>c.order)).size,chapters.length);
  for(const {level} of chapters){
    const map=expandChapter(level),pieces=new Set(map.entities.map(e=>e.id)),actors=new Set(map.encounters.map(e=>e.id));
    assert.ok(pieces.size<=128 && actors.size<=32);
    assert.equal(pieces.size,map.entities.length);
    assert.equal(actors.size,map.encounters.length);
    assert.ok(pieces.has(map.spawn.split(':')[0]));
    for(const actor of map.encounters){assert.ok(!pieces.has(actor.id));if(actor.arena)assert.ok(pieces.has(actor.arena));}
    for(const stop of map.goal.stops??[]){assert.ok(pieces.has(stop.platform));if(stop.guardian)assert.ok(actors.has(stop.guardian));}
    assert.ok((map.goal.type==='defeat'?actors:pieces).has(map.goal.target));
    if(level.trail)for(const e of map.entities){assert.ok(insideBasin(e.at));assert.ok(e.size.every(n=>n>0 && n<=96));}
  }
});

test('an uphill bend, a boarding lift and a cut in the valley use ordinary world pieces',()=>{
  const site=(id,at,approach)=>({id,at,size:[8,8],dressing:'teaTerrace',approach});
  const source={foothills:{width:40,columns:[0],bands:[{north:-10,south:10,height:1,cut:[-4,3]}]},
    trail:[site('a',[0,1,0]),site('b',[0,5,-32]),site('c',[40,5,-32],{ride:'skyBarge'})]};
  const {entities}=expandChapter(source);
  const path=entities.find(e=>e.id==='b-path-1');
  assert.deepEqual([path.at,path.size,path.grade,path.axis],[[0,1,-16],[5.6,24],-4,2]);
  const lift=entities.find(e=>e.id==='c-lift');
  assert.equal(lift.depart,'board');assert.equal(lift.trip,'loop');assert.ok(lift.path[1][0]>lift.path[0][0]);
  assert.ok(entities.filter(e=>e.dressing==='foothill').every(e=>Math.abs(e.at[0])>e.size[0]/2));
  assert.deepEqual(expandChapter(source).entities,entities);
});

test('optional trails rejoin the stock route without changing its pieces, guardians or seal order',()=>{
  const pass=files['ember-pass.json'], stock=expandChapter({...pass,branches:[]}), full=expandChapter(pass);
  const plain=full.entities.filter(e=>!e.routeName).map(({trailExits,...e})=>e);
  assert.deepEqual(plain,stock.entities);
  assert.deepEqual(full.goal,stock.goal);
  const sites=new Set(stock.entities.map(e=>e.id));
  for(const branch of pass.branches){
    assert.ok(sites.has(branch.from) && sites.has(branch.to));
    assert.ok(full.entities.find(e=>e.id===branch.from).trailExits.length>=2);
    const pieces=full.entities.filter(e=>e.routeName===branch.name);
    assert.ok(pieces.some(e=>e.id===branch.via[0].id));
    assert.ok(pieces.at(-1).id.startsWith(branch.id+'-return'));
    assert.ok(pieces.every(e=>e.routeColor===branch.color));
  }
  const bridge=full.entities.find(e=>e.id==='moon-bridge'), bank=full.entities.find(e=>e.id==='western-chain');
  assert.equal(bridge.at[1]-bank.at[1],7);
  assert.ok(full.entities.some(e=>e.dressing==='lotusStone' && e.id.includes('-stone-')));
});

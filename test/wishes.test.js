import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { collectSolids, fitSolids, landing, traceSolid } from '../src/market-solids.js';
import { surface, SurfaceSystem } from '../src/surfaces.js';
import { findGroundRoute } from '../src/ground-route.js';
import { Interceptor } from '../src/intercept.js';
import { driveWheel, rotor, stepWheels } from '../src/wheels.js';

function fixture(){
  const world={entities:new Map(),level:{traveler:{gravity:17},weather:{rain:0,wind:0}},transitions:[],seaAt:()=>0,get(id){return this.entities.get(id);}};
  function deck(id,x,y,z,width=3,depth=3){
    const group=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(width,.2,depth));
    mesh.position.y=-.1;group.add(surface(mesh,'floor','wood'));group.position.set(x,y,z);
    const e={id,group,kind:'dock',size:[width,depth],built:true,localSolids:collectSolids(group)};
    fitSolids(e);world.entities.set(id,e);return e;
  }
  return {world,deck};
}
test('a named part stays the same in view, shots, and foot contacts after turning and scaling',()=>{
  const {world,deck}=fixture(),e=deck('ride',12,3,4);
  const cloth=new T.Mesh(new T.BoxGeometry(1,.2,2));cloth.position.set(1,1,0);
  e.group.add(surface(cloth,'awning','cloth'));e.localSolids=collectSolids(e.group);
  e.group.rotation.y=Math.PI/2;e.group.scale.x=2;fitSolids(e);
  const origin=new T.Vector3(12,6,2);
  const hit=traceSolid(world.entities,origin,new T.Vector3(0,-1,0),5);
  assert.equal(hit.part,'awning-1');assert.equal(hit.target,e.id);
  assert.equal(landing(world.entities,origin,3.9,4.2).part,hit.part);
});
test('surface transitions are local, observable, rain-aware and retain remaining time when restored',()=>{
  const {world,deck}=fixture();deck('open',0,3,0);deck('sheltered',5,3,0);deck('roof',5,5,0);
  const s=new SurfaceSystem(world),events=[];s.onChange=e=>events.push(e);
  const act=(id,action)=>s.change({id,part:'floor-1',action,seconds:3});
  act('sheltered','ignite');act('open','ignite');world.level.weather.rain=.8;s.step(.6);
  assert.equal(s.describe('open','floor-1').state,'wet');assert.equal(s.describe('sheltered','floor-1').state,'burning');
  assert.equal(act('open','ignite').reason,'still wet');assert.equal(events.length,3);
  assert.deepEqual([events.at(-1).target,events.at(-1).surface.part,events.at(-1).state],['open','floor-1','wet']);
  const resume=new SurfaceSystem(world);resume.restore([...s.active.values()]);
  assert.equal(resume.describe('open','floor-1').state,'wet');resume.step(9);assert.equal(resume.active.size,0);
  s.forget('open');assert.equal(s.active.size,1);
});
test('a powered wheel reports completed travel, not a hit or passive wind',()=>{
  const d=rotor('mill:east',new T.Group(),true),deck={devices:new Map([[d.id,d]])},events=[];
  const world={level:{weather:{wind:1}},onMechanicEvent:e=>events.push(e)};
  for(let i=0;i<180;i++)stepWheels(deck,world,1/60);
  assert.equal(events.length,0);driveWheel(d,-5,'jet');
  for(let i=0;i<180;i++)stepWheels(deck,world,1/60);
  assert.deepEqual(events,[{type:'turn',target:d.id,source:'jet',steps:-1}]);
});
test('without its bridge a local walk needs real alternate footing',()=>{
  const {world,deck}=fixture();
  for(const [id,x,z] of [['a',0,0],['b',3,0],['c',6,0],['side-a',0,3],['side-b',3,3],['side-c',6,3]])deck(id,x,3,z);
  function route(){
    const iter=findGroundRoute(world,new T.Vector3(0,3,0),new T.Vector3(6,3,0));
    let r=iter.next();while(!r.done)r=iter.next();return r.value;
  }
  assert.ok(route().every(p=>p.z===0));world.entities.delete('b');
  assert.ok(route().some(p=>landing(world.entities,p,2.9,3.1)?.entity.id==='side-b'));world.entities.delete('side-b');assert.deepEqual(route(),[]);
});
test('interception refuses a blocked carrier and distinguishes dispatch from a physical catch',()=>{
  const {world,deck}=fixture(),ride=deck('ride',-3,3,0,2,2),guard=deck('screen',-1.5,3,0,1,3);
  const request=new Interceptor(world),p={position:new T.Vector3(1,7,0),velocity:new T.Vector3(1,-2,0),grounded:null};
  request.start({id:ride.id,speed:14},p);assert.equal(request.last.reason,'unavailable');
  world.entities.delete(guard.id);request.start({id:ride.id,speed:14},p);assert.equal(request.last.reason,'arranged');
  assert.ok(request.last.at[0]>p.position.x);const before=p.position.clone();request.move(ride,.1);
  assert.ok(ride.group.position.x>-3);assert.ok(p.position.equals(before));p.grounded=ride.id;
  request.prepare(p,.016);assert.equal(request.last.reason,'caught');
  p.grounded=null;request.prepare(p,.016);request.move(ride,1);assert.equal(ride.group.position.x,-3);
});

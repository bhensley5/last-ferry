import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { Kinetics } from '../src/kinetics.js';

function harbor() {
  const deck = { id: 'skiff', kind: 'dock', size: [4, 3], group: new T.Group() };
  deck.group.position.set(0, 6, 0);
  const world = {
    scene: new T.Scene(),
    entities: new Map([['skiff', deck]]),
    seaAt: () => 0,
    get(id) {
      return this.entities.get(id);
    },
  };
  const player = { position: new T.Vector3(0, 1, 0), velocity: new T.Vector3(), facing: 0 };
  return { deck, player, sim: new Kinetics(world, { actors: new Map() }, player) };
}

test('fast shots hit a thin deck and report its surface for chaining', () => {
  const { sim } = harbor(),
    contacts = [];
  sim.shoot({ tag: 'hook', aim: [0, 7, 0], speed: 35, hits: 'terrain' });
  for (let i = 0; i < 30; i++) sim.update(1 / 60, null, (e) => contacts.push(e));
  assert.equal(contacts.length, 1);
  const hit = contacts[0];
  assert.deepEqual([hit.target, hit.reason], ['skiff', 'terrain']);
  assert.deepEqual(hit.normal, [0, -1, 0]);
  assert.ok(Math.abs(hit.offset[1] + 0.2) < 1e-6);
  assert.equal(sim.shots.length, 0);
});

test('a taut tether follows its deck and releasing it preserves momentum', () => {
  const { sim, player, deck } = harbor();
  sim.setTether({ anchor: 'skiff', offset: [0, -0.2, 0], length: 1 });
  deck.group.position.x = 1;
  sim.pullTether(1 / 60);
  assert.ok(player.velocity.x > 0 && player.velocity.y > 0);
  const momentum = player.velocity.clone();
  sim.setTether({ remove: true });
  sim.pullTether(1 / 60);
  assert.ok(player.velocity.equals(momentum));
  assert.equal(sim.brief().tether, null);
});

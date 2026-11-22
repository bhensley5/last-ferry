import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Vector3, Ray } from 'three';
import { validators } from '../src/wish-validator.js';
import { restoreDefinitions } from '../src/wish-kit.js';
import { Places } from '../src/places.js';
import { recordObjective, satisfied } from '../src/objectives.js';
import { baseEdit, initEffects, setEffect, passageKit, activeRules } from '../src/effects.js';
import { tracePart, addPart, partAt } from '../src/actor-parts.js';
import { BehaviorEvents, runBehavior } from '../src/behaviors.js';

test('the published recipes conform to the same contracts used by live patches', () => {
  const text = readFileSync(
    new URL('../skills/last-ferry/references/recipes.md', import.meta.url),
    'utf8',
  );
  for (const block of text.matchAll(/```json\n([\s\S]*?)\n```/g)) {
    for (const op of JSON.parse(block[1])) {
      if (validators[op.op]) assert.ok(validators[op.op](op), JSON.stringify(validators[op.op].errors));
    }
  }
  assert.equal(validators.region({ op: 'region', id: 'plate', at: [0, 0, 0], size: [1, 0, 1] }), false);
  assert.equal(validators.intent({ op: 'intent', id: 'guard', mode: 'investigate' }), false);
  assert.equal(validators.effect({ op: 'effect', id: 'fog', remove: true, scope: 'life' }), false);
  assert.equal(validators.reach({ op: 'reach', id: 'jump', to: 'roof', teleport: true }), false);
});
test('a region follows rotation and translation; re-entry and deletion have one edge each', () => {
  const anchor = { group: new Group() };
  anchor.group.rotation.y = Math.PI / 2;
  const places = new Places({ get: () => anchor }),
    player = { position: new Vector3(0, 0, -2), velocity: new Vector3() },
    events = [];
  const box = { id: 'plate', deck: 'ride', size: [1, 1, 1], at: [2, 0, 0] };
  const tick = () => places.step([box], player, new Map(), 1 / 60, (e) => events.push(e));
  tick();
  tick();
  anchor.group.position.y += 4;
  player.position.y += 4;
  tick();
  player.position.x += 2;
  tick();
  player.position.x -= 2;
  tick();
  places.forget('plate', (e) => events.push(e));
  assert.deepEqual(
    events.map((e) => [e.type, e.source]),
    ['enter', 'leave', 'enter', 'leave'].map((t) => [t, 'player']),
  );
});
test('ordered progress resumes from JSON without skipping a step or issuing a second completion', () => {
  let rule = {
    mode: 'order',
    includeStock: false,
    tests: [
      { type: 'use', target: 'one' },
      { type: 'use', target: 'two' },
    ],
  };
  recordObjective(rule, { type: 'use', target: 'two' });
  assert.equal(satisfied(rule, true), false);
  recordObjective(rule, { type: 'use', target: 'one' });
  rule = JSON.parse(JSON.stringify(rule));
  recordObjective(rule, { type: 'use', target: 'one' });
  assert.equal(rule.done, false);
  recordObjective(rule, { type: 'use', target: 'two' });
  recordObjective(rule, { type: 'use', target: 'two' });
  assert.equal(satisfied(rule, false), true);
  assert.deepEqual(rule.seen, [0, 1]);
  const any = {
    mode: 'any',
    tests: [
      { type: 'signal', tag: 'paid' },
      { type: 'defeat', target: 'keeper' },
    ],
  };
  recordObjective(any, { type: 'use', target: 'till' });
  assert.equal(satisfied(any, false), false);
  assert.equal(satisfied(any, true), true);
  recordObjective(any, { type: 'signal', tag: 'paid' });
  assert.equal(any.done, true);
});
test('removing layers out of order preserves regular edits, remaining layers and portable rule state', () => {
  const level = { behaviors: [], weather: { fog: 0.1, wind: 0 }, traveler: { power: 1 }, cargo: [] };
  initEffects(level);
  for (const [id, value] of [
    ['low', 0.3],
    ['high', 0.6],
  ])
    setEffect(level, { id, scope: 'chapter', change: { op: 'weather', fog: value } });
  baseEdit(level, { op: 'weather', fog: 0.25, wind: 1 });
  setEffect(level, { id: 'low', remove: true });
  assert.equal(level.weather.fog, 0.6);
  setEffect(level, { id: 'high', remove: true });
  assert.deepEqual(level.weather, { fog: 0.25, wind: 1 });
  setEffect(level, { id: 'strength', scope: 'life', change: { op: 'traveler', power: 3 } });
  setEffect(level, {
    id: 'pearl',
    scope: 'journey',
    change: { op: 'behavior', id: 'pearl', on: ['signal'], code: 'state.n=(state.n??0)+1;' },
  });
  const rules = new BehaviorEvents(
    () => level,
    () => ({}),
    () => {},
    assert.fail,
  );
  level.mechanicTime = 0;
  rules.send({ type: 'signal' });
  rules.step(0.01);
  const carry = passageKit(level);
  assert.equal(carry.traveler.power, 1);
  assert.equal(carry.effects.length, 1);
  assert.equal(carry.effects[0].change.state.n, 1);
  assert.equal(activeRules(level).length, 1);
  rules.send({ type: 'signal' });
  setEffect(level, { id: 'pearl', remove: true });
  rules.step(0.01);
  assert.equal(activeRules(level).length, 0);
});
test('a named rear joint is directional, survives a hidden costume and disappears on defeat', () => {
  const actor = { group: new Group(), parts: new Map() };
  const joint = new Group();
  actor.group.add(joint);
  joint.position.z = -0.5;
  addPart(actor.parts, 'tank', joint, 0.2, true);
  const ray = (z, d) => new Ray(new Vector3(0, 0, z), new Vector3(0, 0, d));
  assert.equal(tracePart(actor, ray(-2, 1), 3).id, 'tank');
  assert.equal(tracePart(actor, ray(2, -1), 3), null);
  joint.visible = false;
  actor.group.rotation.y = Math.PI;
  assert.equal(tracePart(actor, ray(2, -1), 3).id, 'tank');
  assert.ok(partAt(actor, 'tank').z > 0.49);
  actor.defeated = true;
  assert.equal(partAt(actor, 'tank'), undefined);
});
test('effect wrappers do not let behaviors install another behavior', () => {
  const rule = {
    state: {},
    code: `emit({op:'effect',id:'another',scope:'life',change:{op:'behavior'}})`,
  };
  assert.throws(() => runBehavior(rule, { type: 'signal' }, {}), /emitted operations/);
});

test('a reach preview observes current jump rules without consuming a charge or firing resolved', () => {
  const level = {
    mechanicTime: 4,
    behaviors: [
      {
        id: 'boost',
        on: ['before', 'resolved'],
        state: { charges: 1 },
        code: "if(event.type==='before'&&event.action==='jump'&&state.charges){state.charges--;return 13;}",
      },
    ],
  };
  const events = new BehaviorEvents(
    () => level,
    () => ({}),
    () => {},
    assert.fail,
  );
  assert.equal(events.filter('jump', 7, {}, true), 13);
  assert.equal(level.behaviors[0].state.charges, 1);
  assert.equal(events.queue.length, 0);
  assert.equal(events.filter('jump', 7), 13);
  assert.equal(level.behaviors[0].state.charges, 0);
});

test('authored and saved chapters restore the same wish settings without baking overlays into their base', () => {
  const level = {
    weather: { fog: 0.2 },
    traveler: { power: 1 },
    behaviors: [],
    encounters: [],
    goal: { stops: [] },
    effects: [{ id: 'mist', scope: 'chapter', change: { op: 'weather', fog: 0.9 }, seconds: 5 }],
    objectives: [
      {
        id: 'finish',
        mode: 'order',
        tests: [
          { type: 'signal', tag: 'a' },
          { type: 'signal', tag: 'b' },
        ],
      },
    ],
  };
  restoreDefinitions(level, level, new Map(), true, () => null);
  assert.equal(level.weather.fog, 0.9);
  assert.equal(level.effects[0].remaining, 5);
  recordObjective(level.objectives[0], { type: 'signal', tag: 'a' });
  const save = structuredClone(level);
  save.effects[0].remaining = 0.025;
  const next = {
    weather: { ...save.weather },
    traveler: { power: 1 },
    behaviors: [],
    encounters: [],
    goal: save.goal,
  };
  restoreDefinitions(next, save, new Map(), true, () => null);
  assert.deepEqual(next.objectives[0].seen, [0]);
  assert.equal(next.effects[0].remaining, 0.025);
  setEffect(next, { id: 'mist', remove: true });
  assert.equal(next.weather.fog, 0.2);
});

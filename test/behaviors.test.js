import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorEvents, behaviorError, runBehavior } from '../src/behaviors.js';

function harness(rules, apply = () => {}) {
  const level = { behaviors: rules, mechanicTime: 0 };
  return new BehaviorEvents(
    () => level,
    () => ({ time: level.mechanicTime }),
    apply,
    () => {},
  );
}

test('a two-charge shield changes the incoming hit, not subsequent health', () => {
  const rule = {
    id: 'shield',
    on: ['before'],
    state: { charges: 2 },
    code: "if(event.action==='damage' && state.charges){state.charges--;return 0;}",
  };
  assert.equal(behaviorError(rule), null);
  const events = harness([rule]);
  assert.deepEqual(
    [1, 2, 3].map(() => events.filter('damage', 1)),
    [0, 0, 1],
  );
  assert.equal(rule.state.charges, 0);
});

test('a failed patch cannot spend a charge; another rule still runs', () => {
  const bad = {
    id: 'bad',
    on: ['press'],
    state: { charges: 2 },
    code: "state.charges--;emit({op:'unknown'});",
  };
  const good = { id: 'counter', on: ['press'], state: {}, code: 'state.count=(state.count??0)+1;' };
  const events = harness([bad, good], () => {
    throw Error('unknown operation');
  });
  events.send({ type: 'press', key: '1' });
  events.step(0.02);
  events.step(0.02);
  assert.match(bad.error, /unknown operation/);
  assert.equal(bad.state.charges, 2);
  assert.equal(good.state.count, 1);
});

test('logic preflight uses the same budget and before contract as the game', () => {
  const run = (code) =>
    runBehavior({ code, state: {} }, { type: 'before', action: 'attack', value: 1 }, {});
  assert.throws(() => run('return 2'), /Invalid before response/);
  assert.throws(() => run("emit({op:'mend',hearts:1});"), /Invalid before response/);
  assert.throws(() => run('while(true){}'), /budget|interrupted/i);
  assert.equal(run('return 0').value, 0);
});

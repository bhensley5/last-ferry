import { named } from './places.js';

export function objectiveError(op, level, stage) {
  const index = level.goal.stops?.findIndex((stop) => stop.platform === op.id) ?? -1;
  if (op.id !== 'finish' && (index < stage || index < 0))
    return 'Choose an upcoming checkpoint platform or finish.';
  if (op.remove === true) return;
  for (const test of op.tests) {
    if (test.type === 'signal' && !named(test.tag)) return 'A signal objective needs its tag.';
  }
}
export function recordObjective(rule, event) {
  if (!rule || rule.done || (event.type === 'leave' && event.reason)) return;
  const matches = (test) =>
    Object.entries(test).every(
      ([key, value]) =>
        (key === 'part' ? (event.actorPart ?? event.surface?.part) : event[key]) === value,
    );
  const seen = (rule.seen ??= []);
  if (rule.mode === 'order') {
    if (matches(rule.tests[seen.length])) seen.push(seen.length);
  } else {
    rule.tests.forEach((test, i) => {
      if (!seen.includes(i) && matches(test)) seen.push(i);
    });
  }
  rule.done = rule.mode === 'any' ? seen.length > 0 : seen.length === rule.tests.length;
}
export function satisfied(rule, stock) {
  return rule ? rule.done || (rule.includeStock !== false && stock) : stock;
}

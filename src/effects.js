// Keep a base value and apply named overrides oldest to newest. Removing one
// never rewinds the traveler, cargo, or another wish that owns the same field.
export function initEffects(level) {
  level.effects ??= [];
  level.effectBase ??= { weather: {}, traveler: {} };
}
function values(op) {
  const fields = { ...op };
  delete fields.op;
  if (op.op === 'weather' && fields.time !== undefined && fields.lights === undefined)
    fields.lights = ['night', 'sunset'].includes(fields.time);
  return fields;
}
export function baseEdit(level, op) {
  const group = op.op,
    base = level.effectBase[group];
  for (const [key, value] of Object.entries(values(op))) {
    if (Object.hasOwn(base, key)) base[key] = value;
    else level[group][key] = value;
  }
}
function refresh(level) {
  for (const group of ['weather', 'traveler']) {
    const base = level.effectBase[group],
      next = { ...base },
      used = new Set();
    for (const effect of level.effects)
      if (effect.change.op === group) {
        for (const [key, value] of Object.entries(values(effect.change))) {
          if (!Object.hasOwn(base, key)) base[key] = level[group][key];
          next[key] = value;
          used.add(key);
        }
      }
    Object.assign(level[group], next);
    for (const key of Object.keys(base)) if (!used.has(key)) delete base[key];
  }
}
export function setEffect(level, op) {
  level.effects = level.effects.filter((e) => e.id !== op.id);
  if (!op.remove)
    level.effects.push({
      id: op.id,
      scope: op.scope,
      change: structuredClone(op.change),
      remaining: op.seconds ?? null,
    });
  if (!op.remove && op.change.op === 'behavior') level.effects.at(-1).change.state ??= {};
  refresh(level);
}
export function activeRules(level) {
  if (!level.effects?.length) return level.behaviors;
  return level.behaviors.concat(
    level.effects.filter((e) => e.change.op === 'behavior').map((e) => e.change),
  );
}
export function passageKit(level) {
  return {
    traveler: { ...level.traveler, ...level.effectBase.traveler },
    cargo: level.cargo,
    effects: level.effects.filter((e) => e.scope === 'journey'),
  };
}

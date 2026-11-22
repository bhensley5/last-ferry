// Public Draft 7 operation contracts. Vite compiles these exact shapes to browser validators.
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,48}$' };
const string = { type: 'string', pattern: '^[\\s\\S]{1,96}$' };
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const vector = (items) => ({ type: 'array', minItems: 3, maxItems: 3, items });
const xyz = vector({ type: 'number' });
const object = (properties, required) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const events = [
  'land',
  'defeat',
  'collect',
  'use',
  'enter',
  'leave',
  'surface',
  'turn',
  'signal',
  'impact',
];
const event = object(
  { type: { enum: events }, target: string, source: string, tag: string, part: string, state: string },
  ['type'],
);
const setting = {
  type: 'object',
  properties: { op: { enum: ['weather', 'traveler', 'behavior'] } },
  required: ['op'],
};
const specs = [
  [
    'region',
    'Track feet entering/leaving a box. Occupants are live IDs; force accelerates the traveler in world axes while inside.',
    {
      at: { ...xyz, description: 'Center: world XYZ, or local XYZ when deck is supplied.' },
      size: { ...vector(number(0.05, 96)), description: 'Full width, height, depth in meters.' },
      deck: { ...string, description: 'Anchor to this deck, including its turns, scale and movement.' },
      watch: { enum: ['player', 'actors', 'both'], default: 'player' },
      force: {
        ...vector(number(-40, 40)),
        description: 'Optional acceleration [east,up,south] in m/s².',
      },
    },
    ['at', 'size'],
    'regions[].occupants; enter/leave target=region, source=occupant',
  ],
  [
    'reach',
    'Probe a local walk or one straight running jump from live footing. Static geometry only: no dash, vault, force volumes, timed rides or whole-chapter routing.',
    {
      who: { ...string, default: 'player', description: 'player or grounded crew ID; crew only walk.' },
      to: {
        anyOf: [string, xyz],
        description: 'Deck center or target feet XYZ (use XYZ for roofs). Within 32 m horizontally.',
      },
      show: {
        type: 'boolean',
        default: false,
        description: 'Mark takeoff with an amber triangle and landing with a mint ring for 12 seconds.',
      },
    },
    ['to'],
    'lastReach with matching id: searching → reachable (mode, path or takeoff/landing) or unproven (reason). One query at a time.',
  ],
  [
    'objective',
    'Unlock an upcoming checkpoint or finish with observed events. Only the current stage listens; each stage is earned once.',
    {
      mode: { enum: ['any', 'all', 'order'] },
      tests: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: event,
        description:
          'Exact event filters. For signal supply tag. part matches an actor part or surface key. For surface, target=deck ID and state=new state.',
      },
      includeStock: {
        type: 'boolean',
        default: true,
        description: 'Also accept the authored solution. False replaces it.',
      },
      hint: { type: 'string', pattern: '^[\\s\\S]{1,200}$' },
    },
    ['mode', 'tests'],
    'objectives[].seen (zero-based), lastObjective {target,reason:stock|alternative}, route.stage/complete. ID=checkpoint platform or finish.',
  ],
  [
    'intent',
    'Direct an ordinary ground actor instead of running its usual combat. Guide waits for the player; investigate goes to the last audible position.',
    {
      mode: { enum: ['guide', 'investigate'] },
      to: { ...string, description: 'guide: destination deck.' },
      wait: {
        ...number(1, 24),
        default: 6,
        description: 'guide: wait beyond this player distance in meters.',
      },
      tag: { ...id, description: 'investigate: noise tag to hear.' },
      range: {
        ...number(1, 32),
        default: 12,
        description: 'Hearing radius in meters; solid obstructions block sound.',
      },
      memory: {
        ...number(1, 60),
        default: 6,
        description: 'Remember a noise for this many game seconds.',
      },
      speed: { ...number(0.2, 6), default: 2.3 },
    },
    ['mode'],
    'encounters[].intent.status and .memory. ID=ground crew; remove restores normal AI.',
  ],
  [
    'noise',
    'Emit a sound stimulus for listening actors; no visual or audible clip is implied.',
    {
      tag: id,
      at: {
        ...xyz,
        description:
          'World XYZ; defaults to traveler ear height. Projectile impacts also broadcast their tag at contact.',
      },
    },
    ['tag'],
    'encounters[].intent.memory contains the audible position and remaining game seconds.',
  ],
  [
    'effect',
    'Own one weather/traveler override or behavior by ID. Later layers win; removing a layer reveals remaining layers or the latest base edit.',
    {
      scope: {
        enum: ['life', 'chapter', 'journey'],
        description:
          'Life ends at respawn; chapter ends at departure; journey carries via Continue. Weather cannot travel.',
      },
      seconds: { ...number(0.1, 3600), description: 'Optional game-time expiry.' },
      change: {
        ...setting,
        description:
          'An ordinary weather, traveler or behavior op with its normal fields. A behavior must share the effect ID.',
      },
    },
    ['scope', 'change'],
    'effects (remaining/owner ID), effective weather/traveler, behaviors[].state. Active shots, drives and rope do not travel.',
  ],
];
export const wishContracts = Object.fromEntries(
  specs.map(([op, description, fields, required, result]) => {
    const named = op !== 'noise';
    const properties = { op: { const: op }, ...(named && { id }), ...fields };
    const removable = !['noise', 'reach'].includes(op);
    if (removable) properties.remove = { type: 'boolean' };
    const schema = object(properties, ['op', ...(named ? ['id'] : [])]);
    if (removable) {
      schema.if = { properties: { remove: { const: true } }, required: ['remove'] };
      schema.then = { maxProperties: 3 };
      schema.else = { required };
    } else schema.required.push(...required);
    if (op === 'intent')
      schema.else.allOf = [
        {
          if: { properties: { mode: { const: 'guide' } } },
          then: { required: ['to'] },
          else: { required: ['tag'] },
        },
      ];
    return [op, { op, description, schema, result }];
  }),
);

# The Night Market dock

These are the four live patches behind the three-wish walkthrough. Use them on request, not as launch defaults. Apply one block at a time, through the normal wish/receipt/answer loop. The coordinates below are for this particular dock; elsewhere, use the requesting tab’s geometry and target.

## Set up the demo dock

On a fresh Night Market, build two landings out over the water and put a raised bridge between them. Use a new bridge rather than taking the one from the pottery route. Bring the existing tea-house diver to the edge; he stays put until the player approaches. If the scene already exists, inspect its pieces instead of building duplicate IDs.

```json
[
  {"op":"build","id":"demo-lookout","kind":"platform","at":[0,1.2,16],"size":[9,9]},
  {"op":"build","id":"demo-quay","kind":"lanternGate","at":[0,1.2,32],"size":[8,8]},
  {"op":"build","id":"demo-bridge","kind":"bridge","at":[0,5.3,24.25],"size":[3.9,8.35]},
  {"op":"setEncounter","id":"tea-diver","patch":{"arena":"demo-lookout","at":[-3,1.2,14],"friendly":false,"activationRange":1,"phases":[{"afterHits":0,"movement":"perch","attack":"aimedPearl","count":1,"spread":0.25,"projectileSpeed":3.2,"tell":0.95,"recover":1.65,"interval":0.8}]}},
  {"op":"weather","time":"sunset","wind":0,"fog":0.12,"rain":0,"lights":true,"waves":0.1},
  {"op":"passage","to":"demo-lookout"}
]
```

Check the traveler is standing on `demo-lookout`. Tell the player to face the diver near the corner, point at him, and open the parchment. The lantern gate marks the other end of the crossing.

## Turn him into an octopus. Throw him into the water.

Keep the same actor throughout. The game’s ordinary enemy shove is horizontal and constrained to its arena. Here, a small off-camera moving platform acts as a guide: the diver keeps his offset from it, so two timed moves carry the octopus up, over the edge, and down through the water. Keeping the guide away from the splash leaves the water clear. The splash marks water entry; once submerged, the diver leaves the encounter and the temporary guide is removed.

```json
[
  {"op":"build","id":"throw-guide","kind":"platform","at":[84,10,70],"size":[0.4,0.4]},
  {"op":"setEncounter","id":"tea-diver","patch":{"arena":"throw-guide","at":[-3,1.2,14],"friendly":true,"form":{"body":"octopus","name":"Octopus","color":"#a64aaa"}}},
  {"op":"cue","id":"over-the-rail","when":"after","seconds":1.03,"then":[{"op":"move","id":"throw-guide","to":[82,12.05,70],"duration":0.54}]},
  {"op":"cue","id":"into-the-water","when":"after","seconds":1.56,"then":[{"op":"move","id":"throw-guide","to":[79.05,6.25,70],"duration":0.69}]},
  {"op":"cue","id":"water-entry","when":"after","seconds":2.05,"then":[
    {"op":"cast","visual":"spray","center":[-7.75,0.1,14],"radius":1.55,"color":"#baf5fa","spray":{"count":90,"velocity":[0,3.7,0],"gravity":-8.8,"spread":2.2,"seconds":1.05,"size":0.26}},
    {"op":"cast","visual":"ripple","center":[-7.75,0.1,14],"radius":1.85,"color":"#a9e8e1"}
  ]},
  {"op":"cue","id":"swim-away","when":"after","seconds":2.9,"then":[{"op":"removeEncounter","id":"tea-diver"},{"op":"removePiece","id":"throw-guide"}]}
]
```

Verify `tea-diver.form.body` is `octopus`, then check the actor has cleared the west edge (x < −4.5) and gone below the water. After the swim-away cue, the diver and guide are no longer in the brief. For a reskin alone, use **only** the form field: no guide, relocation, or allegiance change.

## Lower the bridge so I can cross.

```json
[
  {"op":"move","id":"demo-bridge","to":[0,1.2,24.25],"duration":1.45}
]
```

The lookout ends at z=20.5 and the quay begins at z=28. The lowered deck overlaps both, so the traveler can walk south onto the bridge and off at the lantern gate. The patch proves the bridge moved; the player’s footing proves the crossing.

## Bring a midnight storm. Light the lanterns.

```json
[
  {"op":"weather","time":"night","rain":1,"wind":0.78,"waves":0.48,"fog":0.18,"lights":true}
]
```

Check the weather object in the live brief. From the quay, turn back toward the market for a clear before-and-after view. These wishes are independent once the dock exists; a model delay on one doesn't require restarting the chapter.

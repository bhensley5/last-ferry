# Live recipes

Substitute IDs from the requesting tab. Each block is a patch array.

**A plate on a ferry that controls a light.** Physical occupancy, not a timer. Watch both kinds of occupant; when one leaves, the others still count.

```json
[
  {"op":"region","id":"gangway","deck":"FERRY","at":[0,0.5,0],"size":[2,1.5,2],"watch":"both"},
  {"op":"behavior","id":"occupied-lamp","on":["enter","leave"],"code":"if(event.target==='gangway')emit({op:'lantern',id:'PIER',index:1,on:(game.regions.gangway??[]).length>0});"}
]
```

**Pay or fight.** Install an existing bell’s paid interaction as an alternate checkpoint solution. The original route stays available. Objective credit does not move a physical bridge: if the request is to lower one, put a `move` for the actual bridge in the paid cue’s `then`. For a peaceful boss ending, target `finish` and react to `objective` with `reason==='alternative'` to turn the living boss friendly.

```json
[
  {"op":"cue","id":"fare","when":"use","target":"BELL","needs":{"item":"tea","count":2,"spend":true},"then":[{"op":"signal","tag":"fare-paid"}]},
  {"op":"objective","id":"CHECKPOINT","mode":"any","tests":[{"type":"signal","tag":"fare-paid"}],"hint":"Pay the fare or face the keeper."}
]
```

**A portable grapple with a disposable rope.** Use a free key. An actor impact can supply an animated `actorPart`; a terrain impact supplies a deck-relative offset. Release ignores a late shot. Do not carry literal harbor IDs into another chapter.

```json
[
  {"op":"effect","id":"hook","scope":"journey","change":{"op":"behavior","id":"hook","on":["press","release","impact","reset"],"state":{"held":false},"code":"if(event.type==='reset'){state.held=false;return;} if(event.key==='1'){state.held=event.type==='press'; if(!state.held){emit({op:'tether',remove:true});return;} emit({op:'shot',aim:'forward',speed:24,tag:'hook'});} if(event.type==='impact' && event.tag==='hook' && state.held && event.target){const joint=event.actorPart?{part:event.actorPart}:{offset:event.offset};emit({op:'tether',anchor:event.target,...joint,length:3});}"}}
]
```

Other compositions: subscribe to `land` and match both surface keys plus wet state before emitting a bounce; use `before` on damage and return zero to spend a shield charge without losing a heart; count distinct targets in behavior state; reflect a shot using `impact.normal`; bind wheel `turn` to a bridge or objective. Inspect **world schema behavior**, **shot**, **tether**, or **cast** for payloads and bounds.

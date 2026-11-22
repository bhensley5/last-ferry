---
name: last-ferry
description: Launch Last Ferry in OpenClaw and grant in-game wishes. Use for live edits to creatures, routes, weather, abilities, encounters, and objectives.
---

# Last Ferry

You are Wick’s hands in the world. The browser runs the game; the session that opens it handles the wishes. Use the live command line rather than editing source or starting another model. Below, `world` means `node tools/world.mjs` from the checkout on the player’s computer.

## Open the connection

1. If dependencies are missing, run `npm ci`. Run `world start market --session` for Night Market or `world start pass --session` for Ember Pass. `world help` lists shipped aliases. Keep the returned **launch** and exact **URL** together.
2. Before handing over the link, run `world listen LAUNCH` in this session’s **managed background shell** with completion notifications enabled (OpenClaw Gateway: `gateway_exec`, checkout as working directory, `yieldMs: 100`, `timeoutSeconds: 0`). Let it yield; a shell ending in `&` cannot wake this chat. Arm one listener per launch.
3. Give the player the returned link **including its fragment**. Do not wait for a browser brief before giving the link: there is no game tab yet. If managed delivery is unavailable, say so and take wishes directly in chat using the intended live tab.

## Handle one wish

1. **Identify the request.** A listener returns `launch`, `id`, `clientId`, `wish`, and frozen `context`. Read `world status LAUNCH ID`. Already answered? Re-arm without applying it again. If recovering an interrupted turn, also check `world receipt ID`: if the change already rendered, verify it and send the missing answer, not another patch.
2. **Identify the target.** For “him,” “this,” or “here,” start with the frozen `aim.id`, `aim.actorPart`, `underfoot`, `lastAttacker`, or `lastContact`. A nearby list is not a sightline. Read `world brief CLIENT_ID` for live positions, footing, and the current `editRef`. If this tab is stale, ask the player to focus it; don’t switch to another tab. Direct chat has no frozen parchment aim: use an explicit target or clarify an ambiguous one. With only one game, `world brief` suffices.
3. **Choose the smallest change that delivers the whole wish.** Run `world schema OP CLIENT_ID` for accepted fields, or `world schema all CLIENT_ID` to discover operations. Coordinates are meters: **east, up, south**. Preserve unrelated settings. Compound wishes often need two mechanisms: a reskin changes appearance, not attacks or movement.
4. **Apply, then check.** Send 1–16 ordered operations as a JSON array to `world patch EDIT_REF - ID` on stdin. Omit the wish ID for a direct chat edit. Inspect the receipt and a fresh brief. A numeric `firstVisibleMs` proves a frame rendered, **not** that an actor landed or a player crossed. If the patch times out, inspect its receipt rather than replaying it. Only after a confirmed stale rejection, recompute from a fresh brief and use `ID-retry-1` as the command ID (then `ID-retry-2` for a second confirmed stale rejection). On recovery, inspect those receipts before creating another attempt.
5. **Close the loop.** `world answer LAUNCH ID 'short in-world result'` writes back to the parchment. If a retry succeeded, use `world answer LAUNCH ID --receipt ID-retry-1 'result'` with the successful command ID so Wick uses its receipt. Describe what changed, or what the player must do next. If the exact request can’t be expressed, say what is missing and offer the nearest playable alternative. Re-arm `world listen LAUNCH` after answering; wishes queue between listeners. For direct chat, reply in chat and leave any existing listener alone. On a request to stop, do not re-arm.

## Pick a mechanism

| The player wants… | Start here | Evidence that matters |
| --- | --- | --- |
| A crossing, moving ride, or rescue | `build`, `move`, `resize`, `shuttle`; `reach` for a route, `intercept` for a falling player | Deck edges meet. A catch is `lastIntercept.reason: caught`, not just a dispatched skiff. |
| A different creature or fight | `setEncounter` by ID; `form` for appearance, `phases` for attacks, `cast` for effects | Same actor and intended form; actual spell targets in `lastCast.affected`. Ordinary enemy `motion` stays horizontal. |
| Weather, materials, or a particular hit | `weather`, `lantern`, `surface`, `shot`, `tether` | Inspect the requested weather fields, surface reaction, impact part, or attached rope. |
| An ability or a rule that reacts later | `region` detects occupancy; `cue` charges or triggers; `behavior` branches on events; `effect` scopes it to life, chapter, or journey | Check rule state and a real trigger. Say “armed” if player input is still needed. |
| A guide, alternate objective, or paid ending | `intent` steers ground actors; `objective` adds any/all/ordered events to an upcoming checkpoint or finish | Check actual footing, `seen`, and stage. A paid cue’s signal proves payment; merely using the bell does not. |

For the video’s **“set up the demo dock”** request or any of its three tricks, use the [Night Market scene](references/night-market.md). For new abilities, fares, or reactive scenery, adapt the [live recipes](references/recipes.md). They are examples, not a phrase list. Test a new behavior offline with `world rehearse` (JSON on stdin: `behavior`, `game`, `events`); the rehearsal checks logic, not collisions.

## Keep or stop a run

On a save request, run `world bookmark LAUNCH CLIENT_ID` and keep the original link. A snapshot exports a layout, not a playable bookmark. **Continue** enters a new chapter with a new client under the same launch; never retarget a pending wish from the previous chapter. On stop, end only this launch’s listener and close its tab. Leave a shared server alone if other games use it.

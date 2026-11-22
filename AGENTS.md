# Last Ferry

For “start the game,” a wish from Wick, or a change to a running chapter, use the [Last Ferry skill](skills/last-ferry/SKILL.md) from this checkout. The session that opens the game handles its wishes. Use the live edit protocol for supported changes; a player wish does not require a source change or a second model.

For development, keep both chapters on the same update loop and edit protocol. Put chapter-specific geometry, routes, and encounters in [levels/](levels/); give interactive pieces stable IDs and expose their editable fields in the live brief. Preserve the no-wish route. See the [README](README.md) for setup and controls; run `npm test` and `npm run build` before shipping game changes.

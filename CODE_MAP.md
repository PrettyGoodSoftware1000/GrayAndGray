# Egg — code map

The game is split into ordered classic `<script>` files that share **one global scope**
(no modules/imports). They are concatenated in order at runtime, so **load order matters**
and `main.js` must load LAST. Load order is set in `index.html`.

| Load # | File          | Owns                                                                                 |
|-------:|---------------|--------------------------------------------------------------------------------------|
| 1 | `config.js`    | Version, world dims, `PIXELS_PER_METER`/`m2px`, ALL tunable constants, mutable combat stats, DOM element refs, core global state (`world`, `creature`, `camera`, `zoom`, `keys`, `images`, `variations`, flags). |
| 2 | `engine.js`    | Canvas resize / zoom / pan / mouse input (drag + fireball charge), sprite + image-variation + creature loading, HUD hearts/stamina render, grass. |
| 3 | `world.js`     | World generation, `normalizeWorld`, fog of war, water layer, pause/ruler, save/load (`loadGame`, `placeCreatureInVillage`, `resetCreatureRuntime`). |
| 4 | `input.js`     | Voice (`CreatureVoice.txt`) + canned loading, keyboard input, `handleControl` (name/voice/stop/change-creature), camera movement, stamina/run, `cancelAll`. |
| 5 | `entities.js`  | All per-frame updates: villagers, reproduction, hut growth, Not-Commanded state, `updateCreature`, projectiles, ashes, well spawn, goblins, ogres, goblin huts/raids, combat helpers, attack/eat/guard/goto campaigns, villager interaction. |
| 6 | `actions.js`   | Burn / grow / spread-huts actions, burn campaign, `nextCropCell` crop field. |
| 7 | `render.js`    | All `draw*` functions, depth-sorted `renderScene`, the `draw()` rAF loop. |
| 8 | `commands.js`  | Gemini API (`callGemini`), canned/rerun matching, `processCommand`, AI-command log, chat writers (`updateLog`/`playerSays`/`creatureSays`/`narratorSays`). |
| 9 | `ui.js`        | Regenerate / New Game, file save/load, villager dialog, API-keys modal, spell bar + fireball cast/explosion, Tree of Knowledge, `loadStats`. |
| 10 | `main.js`     | The `init()` IIFE (boot sequence) — **must be last**. |

Data/content files (no code; tune without touching `.js`):
`stats_and_shit.txt` (combat values), `canned.txt` (no-API command phrasings),
`CreatureVoice.txt` (personalities + canned responses), `creatures.txt` (creature image manifest).

## Editing notes
- Everything is a shared global. A `function` is callable from any file (hoisted) once all
  scripts load. **Top-level code that runs immediately** (event registrations, `forEach` loads,
  the init IIFE) may only reference things already defined in an earlier-loaded file or the same file.
- To regenerate the single-file build (if ever needed):
  `cat config.js engine.js world.js input.js entities.js actions.js render.js commands.js ui.js main.js > game.js`

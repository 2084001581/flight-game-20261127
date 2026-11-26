# Sky Courier — Island Run

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=flight-game-20261127)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/2084001581/flight-game-20261127/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=flight-game-20261127)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/2084001581/flight-game-20261127/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=flight-game-20261127)

An original flight game for make.fun's **“Make the best flight game”** bounty
([bounty](https://make.fun/bounty/best-flight-game-20261126-0057)): fly the mail
plane SKY-27 over a hand-built island archipelago, thread the gold rings, mind
your fuel and throttle, and bring her home to the strip. Static files, no build
step, no network request — open `game/index.html` in desktop Chrome and fly.

## How to fly

| Input | Does |
| --- | --- |
| ↑ / ↓ or W / S | Climb / descend |
| ← / → or A / D | Bank left / right — bank turns the heading |
| Shift / Ctrl | Throttle up / down |
| Mouse | Lean the stick toward the pointer |
| C | Chase view / cockpit view |
| P | Pause · M mute · R restart |

Three sorties on the title screen (click or press 1 / 2 / 3):

- **Island Run** — 6 rings around the island, then land on the strip heading west.
- **Ring Rush** — 12 rings against a 6-minute clock; each ring tops the fuel tank up, so keep hitting them to keep flying.
- **Free Flight** — no rings, just fly the island and land clean.

Flying rewards discipline: climbing bleeds speed, a hard bank at low speed
stalls the wing, and fuel burns with the throttle — an empty tank means
gliding home. A gentle touchdown on the centreline scores more than a
hard one, and landing early still counts, for less.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080. To hand the game in the way the grader runs it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Files

- `game/index.html` — the page; everything else loads from `game/`.
- `game/src/config.js` — tuning: speeds, fuel burn, ring size, camera.
- `game/src/rng.js` — seeded random and small math helpers.
- `game/src/terrain.js` — the island: heightfield, trees, clouds, village, tower.
- `game/src/flight.js` — the flight model and the sortie state machine.
- `game/src/missions.js` — the ring courses and the autopilot that flies them.
- `game/src/input.js` — keyboard and mouse: the stick and the throttle lever.
- `game/src/audio.js` — sound synthesised live with WebAudio (engine, wind, chimes).
- `game/src/render.js` — the pseudo-3D renderer, the plane, the cockpit, the HUD.
- `game/src/shots.js` — the deterministic screenshot scenes (`?shot=start|play|cockpit|end`).
- `game/src/main.js` — the game loop, screens and the debug handle.
- `main.ts` — the hand-in program: self-checks the entry, copies the game and
  screenshots, writes `dossier.json`.
- `serve.ts` — a tiny static server for local play-testing.
- `vendor/makefun-game.ts` — the kit's dossier library, copied unchanged.
- `shots.json` — the four screenshot scenes and their file names.
- `LICENSE` — MIT.

## Screenshots

Four real renders of the game's own code in headless Chrome at 1280×800:
the title over the strip, a ring pass in chase view, the cockpit over the
island, and the landed results panel.

<sub>Entered on [make.fun](https://make.fun/?ref=rapid-meteor-47-4565&utm_source=github&utm_medium=readme&utm_campaign=flight-game-20261127) · AI agents build software for cash rewards</sub>

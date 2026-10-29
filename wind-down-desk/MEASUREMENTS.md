# Measurements

Every number below was measured in Meta's Immersive Web Emulator (IWER, Quest 3 profile), headless, on a MacBook Air shared with other work. No Quest was available: these are not on-device frame rates. Each line gives the command that reproduces it and the raw file it came from (in `artifacts/solidite-29oct/`). Lines marked **live** ran against https://wind-down-desk.onrender.com itself, in the emulated preview built into the production build (`?preview=1`).

Setup (from `wind-down-desk/`): `npm ci`. Local emulator lines also need `npx @iwsdk/cli dev up --headless --ai-mode agent --allow-browser-automation`; live lines only need Playwright's Chromium (`npx playwright install chromium`). The scripts wait on the app's own clock, so a slow machine takes longer but does not fail.

| What | Result | Reproduce | Raw file |
|---|---|---|---|
| Draw calls per eye | 16–21 per eye in every ritual, the journal, the volumes and the night (headset estimate, budget 25) | `npm run parcours` | `parcours-denied.txt` |
| Triangles | 72k–97k at the peak of each state, always under 100k | `npm run parcours` | `parcours-denied.txt` |
| Script time per frame, CPU throttled ×4 / ×6 | p95 5.7–9.6 ms (72 Hz budget: 13.9 ms) | `sh tools/solidite-29oct/perf.sh` (refuses to run if the 1-min load is ≥ 3) | `perf.json` |
| Cold start, production build | XR session 2.6 s after the first touch (first visit, fast network); lamp lit 0.9 s after the touch on a second visit | `PORT=8795 WDD_SERVE_DIST=1 node server/index.ts &` then `node tools/solidite-29oct/cold-start.mjs http://127.0.0.1:8795` | `cold-start.json` |
| Hands-only evening, microphone refused | Every ritual and the night, no block: 45 real fingertip touches, 4 pinches, 0 misses | `npm run parcours` | `parcours-denied.txt` |
| Hands-only evening, microphone allowed but silent | Same path, no block | `MIC=listening npm run parcours` | `parcours-listening.txt` |
| Hands-only, **live** | Arrival, words touched, stones pinched into the three bowls, plan kept; then Good night → "Stay with me" → the fade → "Lights out" ends the session by itself: 5 fingertip touches, 0 misses, no paid server call | `node tools/solidite-29oct/prod-run.mjs parcours https://wind-down-desk.onrender.com` and `… part5 …` | `prod-29oct/part5-gpu.json` |
| Bus-stop path, **live** | First evening: the example stone, two words touched, two stones pinched into bowls, Good night, the stars rise, the session ends by itself: 33 s from entering XR (two runs: 33.5 s, 32.8 s, of which ≈ 8 s is the script waiting for an arrival question a first evening does not ask), page load to XR 3.7–4.1 s. Script pace: a person reading the captions takes longer | `node tools/solidite-29oct/prod-run.mjs busstop https://wind-down-desk.onrender.com` | `bus-stop-prod-29oct.json` |
| Long session | 12 evenings on one page (never reloaded), no block; textures, geometries and shader programs flat (53 / 64 / 35) | `sh tools/solidite-29oct/long.sh` | `long-final.jsonl` |
| Memory without instrumentation | +1.4 MB per evening after GC, mostly the test tool's own injected contexts (≈ 0.3 MB each) | `sh tools/solidite-29oct/sans-instrument.sh` | `sans-instrument.json` |
| Unknown rooms (5 cases) | In all five, a stone is pinched into a bowl within seated reach. Coffee table 65 cm under the eyes: the desk floats at a comfortable height · table 24 cm under the eyes: on the table · table 19 cm under the eyes: refused, floats · no scene data: on the table by hit test, no wall (Keep falls back), the night sky becomes a dome · every permission refused: floats, dome | `sh tools/solidite-29oct/rooms.sh <low\|high\|tooHigh\|blind\|denied>` | `rooms-*.json` |
| Pause and resume | Meta button and hidden page freeze the evening's clock and suspend sound; lost hands, leaving XR mid-evening and coming back: the evening goes on | `sh tools/solidite-29oct/pause.sh` | `pause.json` |
| One 66° × 62° view (Meta VR Glasses field of view), **live** | With the caption, chips, lamp and bowls, from eyes 40 / 48 / 56 cm above the table: ritual menu 58° × 28°, volumes 58° × 41°, Keep's three lights 58° × 27° (no wall in the emulator: the room fallback), journal 58° × 26°. The night: 14 stars of six evenings span 41° × 48° when you look up 70° (a dome; a real ceiling still needs a headset) | `node tools/solidite-29oct/prod-run.mjs fov https://wind-down-desk.onrender.com` | `prod-29oct/fov-recent.json` |
| Automated tests | 299 passing | `npm run check` | — |

## Not proven without a headset

- Real frame rates and thermals on Quest 3 / 3S (the emulator measures script time and draw calls, not the GPU).
- Hand tracking in a dim room, and fists for Squeeze in low light.
- Real scene understanding: tables, walls and ceilings of real rooms (the five rooms above are emulated).
- The microphone and speech recognition in the Quest Browser.
- Passthrough: on screen, the emulator shows a dark place or a room photograph instead of your room.

#!/bin/sh
# Full-resolution stills of each v6 ritual phase, framed like the Astra concepts (meta-vr/concept-rituels/).
# Prerequisite: the emulator is running (npx @iwsdk/cli dev up ...). Output: artifacts/1xx-*-v6.png
set -eu
CLI=node_modules/.bin/iwsdk
js() { WDD_JS="$1" $CLI browser run tools/wdd-eval.mjs --timeout 100000 >/dev/null; }
shot() { $CLI browser screenshot --output-file "artifacts/$1-v6.png" >/dev/null; echo "artifacts/$1-v6.png"; }
HANDS='const H = window.IWER_DEVICE.hands; const put = (s, x, y, z) => { const p = window.__wdd.deskPoint(x, y, z); H[s].position.set(p.x, p.y, p.z); };'
sh tools/stage.sh 54 30 >/dev/null 2>&1
js "window.__wdd.film.history(21); $HANDS put('left', -0.52, 0, 0.56); put('right', 0.52, 0, 0.56); window.__wdd.arrive(); return 1"
sleep 3
shot 100-evening-proposal
# Breathe: open hands either side of the moon.
js "$HANDS put('left', -0.22, 0.04, 0.06); put('right', 0.22, 0.04, 0.06); window.__wdd.ritual('breathe'); return 1"
sleep 9.6
shot 101-breathe-in
sleep 4.4
shot 102-breathe-out
sleep 26.5
shot 103-breathe-out-three-pearls
js "await window.__wdd.say(\"That's enough.\"); return 1"
sleep 8
# Release: the heavy thing, the stone, held over the water, sinking, gone.
js "$HANDS put('left', -0.52, 0, 0.56); put('right', 0.52, 0, 0.56); window.__wdd.ritual('release'); await new Promise(r=>setTimeout(r,2400)); await window.__wdd.say(\"I can't stop thinking about the meeting with Paul tomorrow.\"); return 1"
sleep 2.6
shot 104-release-stone
js "const H = window.IWER_DEVICE.hands.right; const s = window.__wdd.weightWorld(); const w = window.__wdd.waterWorld(0.085);
const go = async (a, b, n) => { for (let i = 1; i <= n; i++) { const k = i / n; H.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * 0.06, a.z + (b.z - a.z) * k); await new Promise(r => setTimeout(r, 33)); } };
const r = H.position; const start = { x: r.x, y: r.y, z: r.z };
await go(start, { x: s.x, y: s.y + 0.012, z: s.z }, 25); H.updatePinchValue(1); await new Promise(r => setTimeout(r, 350));
await go({ x: s.x, y: s.y + 0.012, z: s.z }, { x: w.x + 0.03, y: w.y, z: w.z + 0.035 }, 40); return 1"
sleep 1
shot 105-release-hold
js "window.IWER_DEVICE.hands.right.updatePinchValue(0); const p = window.__wdd.deskPoint(0.52, 0, 0.56); setTimeout(() => window.IWER_DEVICE.hands.right.position.set(p.x, p.y, p.z), 250); return 1"
sleep 1.2
shot 106-release-sinking
sleep 1.4
shot 107-release-words-of-light
sleep 2.6
shot 108-release-gone

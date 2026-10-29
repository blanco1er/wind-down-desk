// 29 Oct: the 7th-evening arrival (the milestone's sentence + the sky in the globe), sampled every 250 ms:
// does the globe cover the caption's pill? Stills of the worst moment. FOV from env (54 seated film, 72 "high").
//   sh tools/stage.sh 54 30 && FOV=54 npx @iwsdk/cli browser run tools/film-v9/check-sky.mjs --timeout 60000
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installOverlap } from './overlap.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const fov = Number(process.env.FOV ?? 54);
  const out = join(workspaceRoot, 'artifacts', `v9-check-sky${process.env.TAG ?? ''}`);
  mkdirSync(out, { recursive: true });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await installOverlap(f);
  await f.evaluate((d) => { window.__wdd.film.history(Number(d.h)); window.__wdd.film.fov(d.d); window.__wdd.arrive(); }, { d: fov, h: process.env.HIST ?? 7 });
  const samples = [];
  let shot = 0;
  for (let i = 0; i < 96; i++) {
    await wait(250);
    const o = await f.evaluate(() => ({ ...window.__v9overlap(), sky: window.__wdd.debug().visuals.skyShown }));
    samples.push({ t: i * 0.25, ...o });
    if (o.sky && o.capOn && shot < 3 && i % 8 === 0 && last) writeFileSync(join(out, `fov${fov}-${shot++}.jpg`), Buffer.from(last, 'base64'));
  }
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(out, `fov${fov}.json`), JSON.stringify(samples, null, 1));
  const withSky = samples.filter((s) => s.sky && s.capOn);
  return { fov, samplesWithSkyAndCaption: withSky.length, covered: samples.filter((s) => s.covered).length, cut: samples.filter((s) => s.cut).length, texts: [...new Set(withSky.map((s) => s.text))], example: withSky[Math.floor(withSky.length / 2)] };
}

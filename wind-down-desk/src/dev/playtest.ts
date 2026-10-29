/**
 * Play-test console (dev only): a small French panel over the emulator view so the owner can play the whole evening
 * on a Mac without a headset or a speech-to-text key.
 * - Loaded only by `npm run playtest` (VITE_WDD_PLAYTEST=1, dynamic import behind import.meta.env.DEV) and only
 *   when the IWER emulator is present: never in `dist/`, never on a Quest.
 * - "Dire" sends a sentence through the app's own speech handler (`__wdd.say`), the exact path of a transcribed
 *   microphone clip. "Micro" uses the browser's speech recognition where it exists (Chrome, Safari with Dictation on).
 * - With player mode (src/dev/player.ts), stones are picked and dropped with the mouse; the "Main automatique"
 *   buttons move the emulated right hand the same way (real IWSDK pinch-grab path).
 */
import type { PlayerApi } from './player.ts';

type V3 = { x: number; y: number; z: number };
interface Wdd {
  say(text: string): Promise<unknown>;
  evening(): { mode: string; proposal: { ritual: string } | null; weight: unknown };
  arrive(): void;
  state(): { phase: string; tokens: Array<{ id: string; text: string; bin: string | null; released: boolean }> };
  stoneWorld(id: string): V3 | null;
  binWorld(bin: string): V3 | null;
  deskPoint(x: number, y: number, z: number): V3 | null;
  weightWorld(): V3 | null;
  waterWorld(up?: number): V3 | null;
  film?: { history(n: number): unknown; hide(h?: boolean): void };
}
interface Hand {
  position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number };
  updatePinchValue(v: number): void;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start(): void;
  stop(): void;
}
type SR = new () => Recognition;

const w = window as unknown as {
  __wdd?: Wdd;
  IWER_DEVICE?: { hands: { left: Hand; right: Hand }; activeSession?: unknown };
  SpeechRecognition?: SR;
  webkitSpeechRecognition?: SR;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HELP_KEY = 'wind-down-desk.playtest.help.v1';
const PANEL_KEY = 'wind-down-desk.playtest.panel.v1';
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      // private window: the panel just forgets
    }
  },
};

const PHRASES: Array<[string, string[]]> = [
  ['Vider sa tête', [
    "I still haven't replied to the landlord. I need to book the dentist. The slides for Monday aren't done.",
    "That's it.", 'Dentist, tomorrow.', 'Slides, later.', 'Let go of that.', 'Undo.', 'Keep it.', 'Make it lighter.', 'Sort them for me.',
  ]],
  ['Rituels', ['Yes.', 'Not now.', 'Unload.', 'Breathe.', 'Release.', 'Rituals.', "That's enough.", 'Longer.', 'Let it go.', 'Good night.']],
  ['Ce que la lampe entend', ["I'm so wired tonight, I can't relax.", 'The meeting with Paul tomorrow. I keep replaying it.']],
  ['Lieux', ['Take me to the lake.', 'Go to the garden.', 'Show me the stars.', 'Back to my room.', 'Full immersion.', 'Keep my table.', 'Places.']],
  ['Son', ['Sound off.', 'Sound on.', 'Move the desk.']],
];

const MIC = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

async function glide(hand: Hand, to: V3, ms: number, lift = 0): Promise<void> {
  const from = { x: hand.position.x, y: hand.position.y, z: hand.position.z };
  const t0 = performance.now();
  for (;;) {
    const k = Math.min(1, (performance.now() - t0) / ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    hand.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * lift, from.z + (to.z - from.z) * e);
    if (k >= 1) return;
    await new Promise((r) => requestAnimationFrame(r));
  }
}

async function carry(hand: Hand, from: V3, to: V3, rest: V3, holdMs = 200): Promise<void> {
  await glide(hand, { x: from.x, y: from.y + 0.06, z: from.z }, 650, 0.04);
  await glide(hand, { x: from.x, y: from.y + 0.01, z: from.z }, 280);
  hand.updatePinchValue(1);
  await wait(300);
  await glide(hand, to, 1100, 0.09);
  await wait(holdMs);
  hand.updatePinchValue(0);
  await wait(350);
  await glide(hand, rest, 700, 0.06);
}

const RITUAL_FR: Record<string, string> = { unload: 'vider ta tête (Unload)', breathe: 'respirer une minute (Breathe)', release: 'laisser couler une pierre lourde (Release)', sleep: 'dormir (Good night)' };
const DUMP = "I still haven't replied to the landlord. I need to book the dentist. The slides for Monday aren't done.";

/** What to do now, in plain words, and the one or two replies that move the evening forward (never a dead end). */
export function nextStep(
  mode: string,
  phase: string,
  proposal: string | null,
  tokens: Array<{ bin: string | null; released: boolean }>,
  weight: boolean,
  quiet = false,
): { text: string; replies: string[] } {
  if (proposal != null) {
    return { text: `La lampe propose de ${RITUAL_FR[proposal] ?? proposal}.${quiet ? ' Touche Yes ou Not now sous la question.' : ''}`, replies: ['Yes.', 'Not now.'] };
  }
  const unsorted = tokens.filter((t) => t.bin == null && !t.released).length;
  switch (mode) {
    case 'arrive':
      return { text: 'La lampe s’allume…', replies: [] };
    case 'choose':
      return { text: 'Choisis un rituel, ou dis ce qui te préoccupe.', replies: ['Unload.', 'Breathe.', 'Release.', 'Good night.'] };
    case 'unload':
      if (phase === 'plan') return { text: 'Voici le plan de demain : garde-le ou allège-le.', replies: ['Keep it.', 'Make it lighter.'] };
      if (tokens.length === 0) {
        return quiet
          ? { text: 'Touche un mot au-dessus du plateau (Work, Money…), ou « Write… » pour l’écrire.', replies: [] }
          : { text: 'Tape ce qui te préoccupe (en anglais), puis Entrée.', replies: [DUMP] };
      }
      if (unsorted > 0) return { text: 'Clique une pierre, puis un bol : Tomorrow, Later ou Let go.', replies: phase === 'dump' ? ["That's it."] : ['Sort them for me.'] };
      return { text: 'Tout est trié.', replies: ['Good night.'] };
    case 'release':
      return weight
        ? { text: 'Clique la pierre noire, puis le bol d’eau.', replies: ['Let it go.'] }
        : quiet
          ? { text: 'Touche une des pierres de ce soir au-dessus du plateau, ou « Write… ».', replies: [] }
          : { text: 'Dis ce qui pèse encore (en anglais).', replies: ['The meeting with Paul tomorrow. I keep replaying it.'] };
    case 'breathe':
      return { text: 'Respire avec la lune.', replies: ["That's enough.", 'Longer.'] };
    case 'night':
      return { text: 'Bonne nuit. La soirée est finie.', replies: [] };
    case 'morning':
      return { text: 'Le plan du matin est sur le plateau.', replies: ['Rituals.'] };
    default:
      return { text: '', replies: [] };
  }
}

const readQuiet = () => {
  try {
    return localStorage.getItem('wdd.style') === 'quiet';
  } catch {
    return false;
  }
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function mountPlaytest(player: PlayerApi | null = null): void {
  const d = w.__wdd;
  const iwer = w.IWER_DEVICE;
  if (d == null || iwer == null || document.getElementById('wdd-playtest') != null) return;
  const switchUrl = (() => {
    const u = new URL(location.href);
    if (player != null) u.searchParams.set('dev', '1');
    else u.searchParams.delete('dev');
    return u.toString();
  })();
  const root = document.createElement('div');
  root.id = 'wdd-playtest';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Play-test');
  root.innerHTML = `
    <style>
      #wdd-playtest{position:fixed;left:16px;top:16px;z-index:99999;width:min(340px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;
        font:500 13px/1.4 "General Sans",-apple-system,system-ui,sans-serif;color:#fbf6ee;background:rgba(28,23,19,.74);
        -webkit-backdrop-filter:blur(22px) saturate(1.3);backdrop-filter:blur(22px) saturate(1.3);
        border:1px solid rgba(255,240,220,.12);border-radius:22px;padding:14px;box-shadow:inset 0 1px 0 rgba(255,250,240,.12),0 18px 50px rgba(0,0,0,.4);
        scrollbar-width:thin;box-sizing:border-box}
      #wdd-playtest *{box-sizing:border-box}
      #wdd-playtest .top{display:flex;align-items:center;gap:8px;margin-bottom:12px}
      #wdd-playtest .title{flex:1;font-size:15px;font-weight:700;letter-spacing:-.01em}
      #wdd-playtest button{font:inherit;color:#fbf6ee;background:rgba(255,244,230,.09);border:1px solid rgba(255,244,230,.14);border-radius:999px;
        padding:6px 11px;margin:0 5px 6px 0;cursor:pointer;min-height:30px;transition:background .15s}
      #wdd-playtest button:hover{background:rgba(242,179,107,.24)}
      #wdd-playtest button:active{transform:scale(.96);background:rgba(242,179,107,.36)}
      #wdd-playtest.away{display:none}
      #wdd-playtest .more{border-top:1px solid rgba(255,244,230,.09);margin-top:10px;padding-top:10px}
      #wdd-playtest .more button{font-size:12px;min-height:28px;padding:4px 10px}
      #wdd-playtest .more p{margin:4px 0 6px;font-size:11.5px;color:rgba(255,240,220,.55)}
      #wdd-playtest button:focus-visible,#wdd-playtest input:focus-visible,#wdd-playtest summary:focus-visible{outline:2px solid #f2b36b;outline-offset:2px}
      #wdd-playtest .top button{margin:0}
      #wdd-playtest .row{display:flex;gap:6px;align-items:center}
      #wdd-playtest input{flex:1;min-width:0;font:inherit;font-size:14px;color:#fbf6ee;background:rgba(0,0,0,.28);border:1px solid rgba(255,244,230,.18);
        border-radius:14px;padding:9px 12px;min-height:38px}
      #wdd-playtest input::placeholder{color:rgba(255,240,220,.45)}
      #wdd-playtest .row button{margin:0;min-height:38px}
      #wdd-playtest .main{background:#f2b36b;color:#2a1c10;border-color:#f2b36b;font-weight:700}
      #wdd-playtest .main:hover{background:#f6c387}
      #wdd-playtest .mic{display:inline-flex;align-items:center;justify-content:center;width:38px;padding:0}
      #wdd-playtest .mic.on{background:rgba(242,179,107,.4);border-color:#f2b36b}
      #wdd-playtest .next{margin:10px 0 2px;padding:10px 12px 4px;border-radius:14px;background:rgba(242,179,107,.1);border:1px solid rgba(242,179,107,.22)}
      #wdd-playtest .next[hidden]{display:none}
      #wdd-playtest .next p{margin:0 0 8px;font-size:13.5px;font-weight:600;color:#fbf6ee}
      #wdd-playtest .next .replies button:first-child{background:#f2b36b;color:#2a1c10;border-color:#f2b36b;font-weight:700}
      #wdd-playtest .log{color:rgba(255,240,220,.72);font-size:12.5px;min-height:18px;margin:8px 2px 2px}
      #wdd-playtest .help{background:rgba(255,244,230,.07);border:1px solid rgba(255,244,230,.1);border-radius:16px;padding:12px 12px 6px;margin-bottom:12px}
      #wdd-playtest .help h2{font-size:14px;font-weight:700;margin:0 0 8px}
      #wdd-playtest .help ol{margin:0 0 8px;padding-left:20px}
      #wdd-playtest .help li{margin:0 0 6px}
      #wdd-playtest .help li b{color:#f6c387;font-weight:700}
      #wdd-playtest .help p{margin:0 0 10px;color:rgba(255,240,220,.62);font-size:12px}
      #wdd-playtest details{border-top:1px solid rgba(255,244,230,.09);padding-top:8px;margin-top:8px}
      #wdd-playtest summary{cursor:pointer;font-weight:600;color:rgba(255,240,220,.85);list-style:none;padding:2px 0 6px}
      #wdd-playtest summary::-webkit-details-marker{display:none}
      #wdd-playtest summary::after{content:'';display:inline-block;width:6px;height:6px;margin-left:8px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .15s}
      #wdd-playtest details[open] summary::after{transform:translateY(1px) rotate(-135deg)}
      #wdd-playtest h3{font-size:11.5px;font-weight:600;color:rgba(255,240,220,.55);margin:6px 0 5px}
      #wdd-playtest a{color:rgba(255,240,220,.6);font-size:12px}
      #wdd-playtest.quiet .row,#wdd-playtest.quiet .log,#wdd-playtest.quiet details,#wdd-playtest.quiet .talk-only{display:none}
      #wdd-playtest:not(.quiet) .quiet-only{display:none}
      #wdd-playtest.quiet.writing .row{display:flex}
      #wdd-playtest.min{width:auto}
      #wdd-playtest.min .body{display:none}
      #wdd-playtest.min .top{margin:0}
      #wdd-hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99998;pointer-events:none;
        font:500 13px/1.3 "General Sans",-apple-system,system-ui,sans-serif;color:rgba(255,248,238,.92);background:rgba(28,23,19,.62);
        -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid rgba(255,240,220,.12);border-radius:999px;padding:9px 16px;
        white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis;transition:opacity .4s;opacity:0}
      #wdd-hint.show{opacity:1}
      #wdd-toast{position:fixed;left:50%;bottom:62px;transform:translateX(-50%);z-index:99998;pointer-events:none;
        font:600 14px/1.35 "General Sans",-apple-system,system-ui,sans-serif;color:#2a1c10;background:#f2b36b;border-radius:16px;padding:9px 16px;
        max-width:min(560px,calc(100vw - 32px));text-align:center;opacity:0;transition:opacity .25s}
      #wdd-toast.show{opacity:1}
      @media (prefers-reduced-motion: reduce){#wdd-hint,#wdd-toast,#wdd-playtest button{transition:none}}
    </style>
    <div class="top">
      <div class="title">Wind-Down Desk</div>
      <button data-act="help" aria-label="Comment jouer">Aide</button>
      <button data-act="min" aria-expanded="true">Réduire</button>
    </div>
    <div class="body">
      <section class="help" id="wdd-help" hidden>
        <h2>Comment jouer</h2>
        <ol>
          <li class="talk-only"><b>Parle ou tape</b> ce qui te préoccupe (en anglais), puis Entrée.</li>
          <li class="quiet-only"><b>Touche un mot</b> au-dessus du plateau (Work, Money…) ou <b>Write…</b> pour l’écrire.</li>
          <li><b>Clique une pierre</b>, puis <b>un bol</b> : Tomorrow, Later ou Let go. Tu peux aussi la glisser.</li>
          <li>Essaie <b>Release</b>, <b>Breathe</b> et <b>les lieux</b> (boutons en verre<span class="talk-only">, ou phrases ci-dessous</span>).</li>
          <li><span class="talk-only">Dis</span><span class="quiet-only">Touche</span> <b>« Good night »</b> pour finir la soirée.</li>
        </ol>
        <p>${player != null ? 'Glisser pour regarder autour · Molette pour zoomer · R pour recentrer. Clavier : 1, 2, 3 pour trier la pierre suivante, Échap pour la reposer, Espace pour parler. Le bouton Sound coupe tout le son (les sous-titres restent) ; « sound on » le remet.' : 'Mode développeur : l’émulateur IWER est affiché tel quel.'}</p>
        <button class="main" data-act="help-ok">C’est parti</button>
        <div class="more">
          <button data-act="style"></button>
          <button data-act="arrive">Rejouer l’arrivée</button><button data-act="history">3 semaines d’historique</button><button data-act="reset">Remettre à zéro</button>
          <p id="wdd-about"></p>
          <a href="${esc(switchUrl)}">${player != null ? 'Outils de développeur' : 'Revenir au mode joueur'}</a>
        </div>
      </section>
      <div class="row">
        <input id="wdd-say" placeholder="Parle ou tape ce qui te préoccupe…" aria-label="Phrase à dire (en anglais)" autocomplete="off" />
        <button class="main" data-act="say">Dire</button>
        <button class="mic" data-act="dictate" aria-label="Dicter au micro" title="Dicter au micro (Espace)">${MIC}</button>
      </div>
      <div class="log" id="wdd-log" aria-live="polite">Les phrases sont en anglais, comme sur le casque.</div>
      <div class="next" id="wdd-next" aria-live="polite"><p></p><div class="replies"></div></div>
      <details>
        <summary>Phrases prêtes</summary>
        ${PHRASES.map(([title, list]) => `<h3>${title}</h3>${list.map((p) => `<button data-say="${esc(p)}" title="${esc(p)}">${esc(p.length > 40 ? p.slice(0, 38) + '…' : p)}</button>`).join('')}`).join('')}
      </details>
      ${player != null ? '' : `<details>
        <summary>Main automatique</summary>
        <button data-hand="tomorrow">Pierre suivante → Tomorrow</button><button data-hand="later">→ Later</button><button data-hand="let-go">→ Let go</button>
        <button data-hand="sink">Release : la pierre au-dessus de l’eau</button>
      </details>`}
    </div>`;
  document.body.appendChild(root);
  const hint = document.createElement('div');
  hint.id = 'wdd-hint';
  hint.textContent = 'Glisser pour regarder autour · Molette pour zoomer · R pour recentrer';
  const toast = document.createElement('div');
  toast.id = 'wdd-toast';
  toast.setAttribute('aria-live', 'polite');
  if (player != null) document.body.append(hint, toast);

  const input = root.querySelector('#wdd-say') as HTMLInputElement;
  const log = root.querySelector('#wdd-log') as HTMLElement;
  const help = root.querySelector('#wdd-help') as HTMLElement;
  const micBtn = root.querySelector('[data-act="dictate"]') as HTMLButtonElement;
  const minBtn = root.querySelector('[data-act="min"]') as HTMLButtonElement;
  help.hidden = store.get(HELP_KEY) === 'seen';
  const about = root.querySelector('#wdd-about') as HTMLElement;
  const syncAbout = () => (about.textContent = document.getElementById('status')?.textContent ?? '');

  const syncInset = () => player?.setLeftInset(root.getBoundingClientRect().right + 8);
  const setMin = (min: boolean) => {
    root.classList.toggle('min', min);
    minBtn.textContent = min ? 'Ouvrir' : 'Réduire';
    minBtn.setAttribute('aria-expanded', String(!min));
    store.set(PANEL_KEY, min ? 'min' : 'open');
    syncInset();
  };
  setMin(store.get(PANEL_KEY) === 'min');
  new ResizeObserver(syncInset).observe(root);
  window.addEventListener('resize', syncInset);

  // "Write…" touched in the scene: this panel's field takes it (the scene's own field is for a headset).
  window.addEventListener('wdd:write', (e) => {
    const detail = (e as CustomEvent<{ prompt: string }>).detail;
    e.preventDefault();
    if (root.classList.contains('min')) setMin(false);
    // Quiet evening: the field appears only for this "Write…", then hides again.
    root.classList.add('writing');
    input.placeholder = `${detail.prompt} (en anglais)`;
    input.focus();
    log.textContent = 'Écris, puis Entrée.';
  });
  const styleBtn = root.querySelector('[data-act="style"]') as HTMLButtonElement;
  const syncStyle = () => {
    const quiet = readQuiet();
    styleBtn.textContent = quiet ? 'Soirée silencieuse (sans micro) · passer en « parler »' : 'Soirée avec la voix · passer en « silencieuse »';
    // Quiet evening: no field, no « Dire », no microphone in the panel (only the next step, Aide, Réduire).
    root.classList.toggle('quiet', quiet);
  };
  window.addEventListener('storage', syncStyle);
  window.setInterval(syncStyle, 1000);
  syncStyle();

  // The next step, refreshed from the evening's own state: one primary reply, at most a few.
  const nextBox = root.querySelector('#wdd-next') as HTMLElement;
  const nextText = nextBox.querySelector('p') as HTMLElement;
  const nextReplies = nextBox.querySelector('.replies') as HTMLElement;
  let nextKey = '';
  const refreshNext = () => {
    let step: { text: string; replies: string[] };
    try {
      const e = d.evening();
      const s = d.state();
      step = nextStep(e.mode, s.phase, e.proposal?.ritual ?? null, s.tokens, e.weight != null, readQuiet());
    } catch {
      step = { text: '', replies: [] };
    }
    if (player?.holding != null) step = { text: 'Clique un bol pour poser la pierre (Échap pour la reposer).', replies: [] };
    const key = `${step.text}|${step.replies.join('|')}`;
    if (key === nextKey) return;
    nextKey = key;
    nextBox.hidden = step.text.length === 0;
    nextText.textContent = step.text;
    nextReplies.innerHTML = step.replies
      .map((p) => `<button data-say="${esc(p)}" title="${esc(p)}">${esc(p.length > 34 ? p.slice(0, 32) + '…' : p)}</button>`)
      .join('');
  };
  window.setInterval(refreshNext, 400);
  refreshNext();

  let toastTimer = 0;
  if (player != null) {
    player.onStatus = (text) => {
      window.clearTimeout(toastTimer);
      toast.textContent = text;
      toast.classList.toggle('show', text.length > 0);
      if (text.length > 0 && player.holding == null) toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
    };
    player.onLamp = () => dictate();
    // Progressive disclosure: nothing but the tray and the landing bar before the evening starts; the camera hint
    // shows for the first seconds of the evening (and again with Aide).
    let since = -1;
    const tick = () => {
      const on = iwer.activeSession != null;
      root.classList.toggle('away', !on);
      if (on && since < 0) {
        since = performance.now();
        syncInset();
      }
      if (!on) since = -1;
      hint.classList.toggle('show', on && (performance.now() - since < 14000 || !help.hidden));
    };
    window.setInterval(tick, 400);
    tick();
  }

  const say = (text: string) => {
    const t = text.trim();
    if (t.length === 0) return;
    log.textContent = `« ${t} » · la lampe écoute…`;
    void Promise.resolve(d.say(t))
      .then(() => {
        if (log.textContent?.startsWith(`« ${t} »`)) log.textContent = `« ${t} »`;
      })
      .catch(() => (log.textContent = `« ${t} » n’a pas été compris. Essaie une phrase prête.`));
  };
  const right = iwer.hands.right;
  const rest = () => d.deskPoint(0.2, 0.02, 0.5) ?? { x: right.position.x, y: right.position.y, z: right.position.z };
  let busy = false;
  const handTo = async (bin: string) => {
    if (busy || player?.busy || player?.holding != null) return;
    const next = d.state().tokens.find((t) => t.bin == null && !t.released);
    if (next == null) return void (log.textContent = 'Aucune pierre à trier.');
    const from = d.stoneWorld(next.id);
    const to = d.binWorld(bin);
    if (from == null || to == null) return;
    busy = true;
    log.textContent = `Main : « ${next.text} » → ${bin}`;
    await carry(right, from, { x: to.x, y: to.y + 0.03, z: to.z }, rest());
    busy = false;
  };
  const sink = async () => {
    if (busy || player?.busy || player?.holding != null) return;
    const s = d.weightWorld();
    const wtr = d.waterWorld(0.085);
    if (s == null || wtr == null) return void (log.textContent = 'Pas de pierre de Release (dis « Release. »).');
    busy = true;
    log.textContent = 'Main : la pierre au-dessus de l’eau…';
    await carry(right, { ...s, y: s.y + 0.002 }, { x: wtr.x + 0.03, y: wtr.y, z: wtr.z + 0.035 }, rest(), 1600);
    busy = false;
  };

  // Dictation: the browser's own speech recognition (Chrome; Safari when Dictation is on in macOS settings).
  let rec: Recognition | null = null;
  const dictate = () => {
    if (rec != null) {
      rec.stop();
      return;
    }
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Rec == null) {
      log.textContent = 'Ce navigateur n’a pas la dictée : tape la phrase.';
      input.focus();
      return;
    }
    const r = new Rec();
    r.lang = 'en-US';
    r.interimResults = false;
    r.onresult = (e) => say(e.results[0][0].transcript);
    r.onerror = (e) => {
      const why: Record<string, string> = {
        'not-allowed': 'micro refusé par le navigateur',
        'service-not-allowed': 'dictée désactivée dans les réglages du Mac (Clavier › Dictée)',
        'no-speech': 'rien entendu',
        network: 'service de dictée injoignable',
        'audio-capture': 'aucun micro trouvé',
      };
      log.textContent = `Dictée indisponible (${why[e.error] ?? e.error}) : tape la phrase.`;
    };
    r.onend = () => {
      rec = null;
      micBtn.classList.remove('on');
    };
    try {
      r.start();
      rec = r;
      micBtn.classList.add('on');
      log.textContent = 'J’écoute… parle en anglais.';
    } catch {
      log.textContent = 'Dictée indisponible : tape la phrase.';
    }
  };

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b == null) return;
    if (b.dataset.say != null) return say(b.dataset.say);
    if (b.dataset.hand != null) return void (b.dataset.hand === 'sink' ? sink() : handTo(b.dataset.hand));
    switch (b.dataset.act) {
      case 'say':
        say(input.value);
        input.value = '';
        break;
      case 'min':
        setMin(!root.classList.contains('min'));
        break;
      case 'help':
        if (root.classList.contains('min')) setMin(false);
        syncAbout();
        help.hidden = !help.hidden;
        break;
      case 'help-ok':
        help.hidden = true;
        store.set(HELP_KEY, 'seen');
        input.focus();
        break;
      case 'style': {
        const quiet = !readQuiet();
        try {
          localStorage.setItem('wdd.style', quiet ? 'quiet' : 'talk');
        } catch {
          // private window
        }
        (w.__wdd as unknown as { style?: (s: string) => void }).style?.(quiet ? 'quiet' : 'talk');
        syncStyle();
        break;
      }
      case 'arrive':
        d.arrive();
        break;
      case 'history':
        d.film?.history(21);
        d.arrive();
        break;
      case 'reset':
        try {
          localStorage.removeItem('wind-down-desk.memory.v1');
          localStorage.removeItem(HELP_KEY);
        } catch {
          // nothing stored
        }
        location.reload();
        break;
      case 'dictate':
        dictate();
        break;
    }
  });
  // Keys typed in the panel never reach the emulator or the player camera.
  root.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      say(input.value);
      input.value = '';
      root.classList.remove('writing');
    } else if (e.key === 'Escape') {
      input.blur();
    }
  });
  input.addEventListener('blur', () => window.setTimeout(() => root.classList.remove('writing'), 150));
  // T or Entrée: write; Espace: dictate; H: help (outside the text field).
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t != null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || iwer.activeSession == null) return;
    if (e.key === 't' || e.key === 'T' || e.key === 'Enter') {
      e.preventDefault();
      if (root.classList.contains('min')) setMin(false);
      input.focus();
    } else if (e.key === ' ') {
      e.preventDefault();
      dictate();
    } else if (e.key === 'h' || e.key === 'H') {
      if (root.classList.contains('min')) setMin(false);
      help.hidden = !help.hidden;
    }
  });
}

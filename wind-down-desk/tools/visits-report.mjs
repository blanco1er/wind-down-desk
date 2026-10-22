// Rapport des visites de la démo hébergée, en français, pour le propriétaire seulement.
//   node tools/visits-report.mjs https://<service>.onrender.com [--depuis AAAA-MM-JJ] [--tout] [--detail] [--sauver]
//   node tools/visits-report.mjs --fichier visits/2026-11-25.json [...]        (relire des sauvegardes)
// Le jeton (WDD_VISITS_TOKEN) est lu dans le trousseau macOS (zsh tools/visits-token.sh) ou dans la variable
// d'environnement du même nom ; il n'est jamais affiché. --sauver range ce qui a été lu dans visits/ (le disque de
// Render Starter est effacé à chaque redémarrage : sauvegarder régulièrement pendant le jugement, du 23 nov. au 9 déc.).
// --tout inclut les visites marquées « internes » (vos appareils : page ouverte une fois avec ?internal=1).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = args.flatMap((a, i) => (args[i - 1] === '--fichier' ? [a] : []));
const site = args.find((a) => /^https?:\/\//u.test(a));
const since = value('--depuis');

function token() {
  if (process.env.WDD_VISITS_TOKEN) return process.env.WDD_VISITS_TOKEN;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'wind-down-desk-visits', '-a', 'wind-down-desk', '-w'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

let events = [];
let usage = null;
for (const f of files) events.push(...JSON.parse(readFileSync(f, 'utf8')).events);
if (site != null) {
  const t = token();
  if (!t) {
    console.error('Aucun jeton : lancez « zsh tools/visits-token.sh » puis collez-le dans Render (WDD_VISITS_TOKEN).');
    process.exit(1);
  }
  const url = new URL('/api/visits/export', site);
  if (since) url.searchParams.set('since', `${since}T00:00:00.000Z`);
  const res = await fetch(url, { headers: { authorization: `Bearer ${t}` } });
  if (res.status === 404) {
    console.error('Le journal n’est pas ouvert sur ce serveur (WDD_VISITS_TOKEN absent dans Render).');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Le serveur a répondu ${res.status}${res.status === 401 ? ' (jeton différent de celui de Render)' : ''}.`);
    process.exit(1);
  }
  const body = await res.json();
  events.push(...body.events);
  usage = body.usage;
  if (flag('--sauver')) {
    mkdirSync('visits', { recursive: true });
    const name = join('visits', `${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
    writeFileSync(name, JSON.stringify(body, null, 2), { mode: 0o600 });
    console.log(`Sauvegardé : ${name}`);
  }
}
// Doublons (plusieurs sauvegardes qui se recouvrent).
const seen = new Set();
events = events.filter((e) => {
  const k = `${e.t}|${e.v}|${e.e}|${JSON.stringify(e.d ?? {})}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const all = events.length;
if (!flag('--tout')) events = events.filter((e) => !e.internal);
if (since) events = events.filter((e) => e.t >= since);
events.sort((a, b) => a.t.localeCompare(b.t));

const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });
const count = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const people = new Map();
for (const e of events) {
  const p = people.get(e.v) ?? { first: e.t, last: e.t, dev: e.dev, br: e.br, steps: new Set(), ref: '', src: '', secs: 0, list: [] };
  p.last = e.t;
  p.steps.add(e.e + (e.d?.kind ? `:${e.d.kind}` : ''));
  if (e.e === 'page') {
    p.ref ||= e.d?.ref ?? '';
    p.src ||= e.d?.src ?? '';
  }
  if (e.e === 'leave' || e.e === 'goodnight' || e.e === 'xr-exit') p.secs = Math.max(p.secs, Number(e.d?.secs ?? 0));
  p.list.push(e);
  people.set(e.v, p);
}

const ppl = [...people.values()];
const has = (p, s) => [...p.steps].some((x) => x === s || x.startsWith(`${s}:`));
const funnel = [
  ['Ont ouvert la page', (p) => has(p, 'page')],
  ['Sont entrés en XR (casque ou émulateur)', (p) => has(p, 'xr-enter')],
  ['Ont vu le bureau posé', (p) => has(p, 'placed')],
  ['Ont commencé un rituel', (p) => has(p, 'ritual-start')],
  ['Ont fini un rituel', (p) => has(p, 'ritual-done')],
  ['Ont dit bonne nuit', (p) => has(p, 'goodnight')],
];
const line = (s = '') => console.log(s);
line(`Wind-Down Desk — visites${since ? ` depuis le ${since}` : ''}${flag('--tout') ? ' (avec vos visites internes)' : ''}`);
line(`${all} événements lus, ${events.length} retenus, ${ppl.length} visiteurs uniques (empreinte anonyme : adresse + navigateur).`);
if (ppl.length === 0) {
  line('Aucune visite pour l’instant.');
} else {
  line();
  line('Par jour (visiteurs uniques) :');
  for (const [day, n] of count(ppl, (p) => p.first.slice(0, 10)).sort((a, b) => a[0].localeCompare(b[0]))) line(`  ${day} : ${n}`);
  line();
  line('Appareils :');
  for (const [d, n] of count(ppl, (p) => (p.dev === 'quest' ? 'casque Meta Quest' : p.dev === 'desktop' ? 'ordinateur' : p.dev === 'mobile' ? 'téléphone' : p.dev))) line(`  ${d} : ${n}`);
  line();
  line('Provenance (site d’origine ou ?ref=) :');
  for (const [s, n] of count(ppl, (p) => p.src || p.ref || 'directe / inconnue')) line(`  ${s} : ${n}`);
  line();
  line('Jusqu’où ils sont allés :');
  for (const [label, ok] of funnel) {
    const n = ppl.filter(ok).length;
    line(`  ${label} : ${n} (${Math.round((n / ppl.length) * 100)} %)`);
  }
  const quest = ppl.filter((p) => p.dev === 'quest');
  line(`  … dont au casque : ${quest.filter((p) => has(p, 'xr-enter')).length} entrés en XR, ${quest.filter((p) => has(p, 'placed')).length} bureau posé`);
  line();
  line('Le bureau :');
  for (const [s, n] of count(events.filter((e) => e.e === 'placed'), (e) => e.d?.source ?? '?')) {
    const fr = { anchor: 'revenu à sa place (ancre persistante)', plane: 'posé sur une table (plans)', mesh: 'posé sur une table (volumes)', hit: 'posé sur une surface (profondeur)', floating: 'flottant (aucune table)' }[s] ?? s;
    line(`  ${fr} : ${n}`);
  }
  const moved = events.filter((e) => e.e === 'moved-desk').length;
  if (moved > 0) line(`  déplacé à la demande : ${moved} fois`);
  line();
  line('Rituels commencés / finis :');
  for (const kind of ['unload', 'breathe', 'release']) {
    const a = events.filter((e) => e.e === 'ritual-start' && e.d?.kind === kind).length;
    const b = events.filter((e) => e.e === 'ritual-done' && e.d?.kind === kind).length;
    line(`  ${kind} : ${a} / ${b}`);
  }
  const places = count(events.filter((e) => e.e === 'place'), (e) => e.d?.id ?? '?');
  if (places.length > 0) line(`Lieux visités : ${places.map(([id, n]) => `${id} (${n})`).join(', ')}`);
  const mic = count(events.filter((e) => e.e === 'mic'), (e) => e.d?.state ?? '?');
  if (mic.length > 0) line(`Micro : ${mic.map(([s, n]) => `${s} (${n})`).join(', ')}`);
  const style = count(events.filter((e) => e.e === 'style'), (e) => e.d?.style ?? '?');
  if (style.length > 0) line(`Soirée : ${style.map(([s, n]) => `${s === 'quiet' ? 'silencieuse' : 'à la voix'} (${n})`).join(', ')}`);
  const secs = ppl.map((p) => p.secs).filter((s) => s > 0).sort((a, b) => a - b);
  if (secs.length > 0) line(`Durée de visite médiane : ${Math.round(secs[Math.floor(secs.length / 2)] / 60)} min (sur ${secs.length} visites mesurées)`);
  const errors = events.filter((e) => e.e === 'client-error').length;
  line(`Erreurs JavaScript dans la page : ${errors}`);
  if (flag('--detail')) {
    line();
    line('Détail par visiteur :');
    for (const [id, p] of people) {
      line(`  ${id} · ${p.dev} · ${p.br} · ${fmt.format(new Date(p.first))} → ${fmt.format(new Date(p.last))}`);
      for (const e of p.list) line(`    ${fmt.format(new Date(e.t))}  ${e.e}${e.d ? ` ${JSON.stringify(e.d)}` : ''}${e.internal ? ' (interne)' : ''}`);
    }
  }
}
if (usage != null) {
  line();
  line(`Consommation du jour (${usage.day}, remise à zéro à 1 h, heure de Paris) : agent ${usage.total.agent}/${usage.limits.total.agent} appels, voix ${usage.total.stt}/${usage.limits.total.stt} clips, ${usage.tokens} jetons de modèle sur ${usage.limits.llmTokens}.`);
}

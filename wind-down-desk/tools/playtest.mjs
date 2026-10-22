// One-command play-test on the Mac (no headset): stops this folder's previous dev server, finds a free port,
// starts the dev server + the IWER emulator in a managed Chrome window, with the play-test console
// (type / dictate sentences, emulated-hand buttons).
//   npm run playtest              (Ctrl+C or `npm run dev:down` to stop)
//   npm run playtest -- --chrome  (skip the managed window, open the page in your own Google Chrome)
//   npm run playtest:open         (re-open the window of a server that is already running)
// A watchdog checks that the managed window really opened; if not after ~30 s it retries once, then opens the
// page in Google Chrome and prints the certificate step in French (local self-signed certificate: no root CA
// is installed, nothing system-wide is changed).
// The window opens because YOU run this command; nothing is published, no account, no paid call
// (the agent runs on the device, simulated, unless DEEPSEEK_API_KEY / LLM_* are set in your shell).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

const args = process.argv.slice(2);
const openOnly = args.includes('--open-only');
const ownChrome = args.includes('--chrome') || process.env.WDD_PLAYTEST_BROWSER === 'chrome';
const READY_WAIT_MS = Number(process.env.WDD_PLAYTEST_READY_MS ?? 30000);
const RECOVER_WAIT_MS = 15000;
const local = 'node_modules/.bin/iwsdk';
const cmd = existsSync(local) ? [local] : ['npx', 'iwsdk'];
const iwsdk = (sub) => spawnSync(cmd[0], [...cmd.slice(1), ...sub], { encoding: 'utf8', timeout: 30000 });

const say = (lines) => console.log(`\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const free = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });

/** Dev server state of THIS project folder only (iwsdk keys it by workspace root). */
export function parseStatus(stdout) {
  try {
    const d = JSON.parse(stdout).data ?? {};
    const st = d.state ?? {};
    return {
      running: Boolean(st.running),
      url: d.runtimeUrls?.local ?? st.session?.localUrl ?? null,
      ready: Boolean(st.browserCommandReady),
      browser: st.session?.browser?.lifecycle?.state ?? st.session?.browser?.status ?? null,
    };
  } catch {
    return { running: false, url: null, ready: false, browser: null };
  }
}
const status = () => parseStatus(iwsdk(['dev', 'status']).stdout ?? '');

function certificateHelp(url) {
  say([
    'Si Chrome affiche « Votre connexion n\'est pas privée » (certificat local de développement, c\'est normal) :',
    '  1. cliquez « Paramètres avancés »,',
    '  2. puis « Continuer vers le site localhost (dangereux) ».',
    '  (Ou tapez simplement  thisisunsafe  au clavier sur cette page d\'avertissement.)',
    `Puis cliquez « Begin ». Adresse : ${url}`,
  ]);
}

function openInChrome(url) {
  const chrome = existsSync('/Applications/Google Chrome.app');
  const r = chrome ? spawnSync('open', ['-a', 'Google Chrome', url]) : spawnSync('open', [url]);
  if (r.status === 0) say([`Page ouverte dans ${chrome ? 'Google Chrome' : 'votre navigateur'} : ${url}`]);
  else say([`Ouvrez vous-même cette adresse dans Google Chrome : ${url}`]);
  certificateHelp(url);
}

/** Wait for the managed window; retry once; fall back to the owner's Chrome. Keeps watching for a closed window. */
async function watchdog(isAlive) {
  const t0 = Date.now();
  let recovered = false;
  let announced = false;
  let fellBack = false;
  let lastUrl = null;
  while (isAlive()) {
    await sleep(announced || fellBack ? 5000 : 2000);
    const s = status();
    if (s.url) lastUrl = s.url;
    if (s.ready) {
      if (!announced) {
        say([`Fenêtre de jeu prête (Chrome géré, émulateur Meta Quest 3) : ${s.url}`, 'Cliquez « Begin ».']);
        announced = true;
      }
      continue;
    }
    if (announced) {
      say([
        'La fenêtre de jeu a été fermée. Le serveur tourne toujours.',
        'Pour la rouvrir :  npm run playtest:open   (dans un autre terminal)',
      ]);
      announced = false;
      fellBack = true;
      continue;
    }
    if (fellBack) continue;
    const waited = Date.now() - t0;
    if (!recovered && waited > READY_WAIT_MS && s.running) {
      say(['La fenêtre de jeu tarde à s\'ouvrir : nouvelle tentative…']);
      iwsdk(['runtime', 'recover']);
      recovered = true;
      continue;
    }
    if (recovered && waited > READY_WAIT_MS + RECOVER_WAIT_MS && (s.url || lastUrl)) {
      say(['La fenêtre gérée ne s\'ouvre pas. Plan B : la même page dans votre Google Chrome.']);
      openInChrome(s.url ?? lastUrl);
      fellBack = true;
    }
  }
}

async function main() {
  if (openOnly) {
    // Re-open the window of an already running server (after closing it by mistake).
    const s = status();
    if (!s.running || !s.url) {
      say(['Aucun serveur de play-test ne tourne dans ce dossier. Lancez :  npm run playtest']);
      process.exit(1);
    }
    if (!ownChrome) {
      iwsdk(['runtime', 'recover']);
      for (let i = 0; i < 8; i++) {
        await sleep(2000);
        if (status().ready) {
          say([`Fenêtre de jeu rouverte : ${s.url}`]);
          process.exit(0);
        }
      }
    }
    openInChrome(s.url);
    process.exit(0);
  }

  // Stop this folder's previous dev server first: it would hold the port and keep a dead managed window
  // (seen 18 Oct: the CLI attached to it and waited forever on "Managed browser command path is not ready").
  if (status().running) {
    say(['Un ancien serveur de play-test tourne dans ce dossier : arrêt…']);
    iwsdk(['dev', 'down']);
    await sleep(800);
  }

  let port = Number(process.env.WDD_PORT ?? 8081);
  while (!(await free(port))) port++;
  const url = `https://localhost:${port}/`;
  say([
    'Wind-Down Desk — play-test',
    `URL : ${url}`,
    ownChrome
      ? 'La page va s\'ouvrir dans votre Google Chrome (émulateur Meta Quest 3, IWER).'
      : 'Une fenêtre Chrome gérée s\'ouvre avec l\'émulateur Meta Quest 3 (IWER). Patientez jusqu\'à 45 s.',
    'Aide : PLAYTEST.md · Arrêt : Ctrl+C (ou npm run dev:down)',
  ]);
  const child = spawn(
    cmd[0],
    [...cmd.slice(1), 'dev', 'restart', ...(ownChrome ? ['--no-open'] : ['--open']), '--foreground'],
    { stdio: 'inherit', env: { ...process.env, WDD_PORT: String(port), VITE_WDD_PLAYTEST: '1' } },
  );
  let alive = true;
  child.on('exit', (code) => {
    alive = false;
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => {
    spawn(cmd[0], [...cmd.slice(1), 'dev', 'down'], { stdio: 'inherit' });
    setTimeout(() => process.exit(0), 1500);
  });

  if (ownChrome) {
    for (let i = 0; i < 40 && alive; i++) {
      await sleep(1000);
      if (status().running) break;
    }
    openInChrome(url);
  } else {
    await watchdog(() => alive);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();

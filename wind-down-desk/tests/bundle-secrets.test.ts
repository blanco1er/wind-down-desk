/**
 * v8: no secret ever reaches the browser. Keys live only in the server's environment (server/config.ts reads
 * DEEPSEEK_API_KEY, LLM_API_KEY, STT_API_KEY); the client calls /api. This scans the BUILT client bundle (dist/,
 * written by `npm run build`; `npm run check` runs this test again right after the build) and the client sources.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

export const KEY_PATTERNS: Array<[string, RegExp]> = [
  ['OpenAI / DeepSeek style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/u],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/u],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/u],
  ['Groq key', /\bgsk_[A-Za-z0-9]{20,}/u],
  ['ElevenLabs / generic 32-hex key assigned to a key name', /(?:xi-api-key|api[_-]?key|apikey)["'\s:=]+["'][A-Za-z0-9_-]{24,}["']/iu],
  ['Bearer token literal', /Bearer\s+[A-Za-z0-9._-]{24,}/u],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
];
/** Server-only variable names: the client must not even mention them (a sign of a key read on the client). */
const SERVER_ONLY = ['DEEPSEEK_API_KEY', 'LLM_API_KEY', 'STT_API_KEY'];

function files(dir: string, exts: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

function scan(paths: string[]): string[] {
  const hits: string[] = [];
  for (const p of paths) {
    const text = readFileSync(p, 'utf8');
    for (const [label, re] of KEY_PATTERNS) if (re.test(text)) hits.push(`${p}: ${label}`);
    for (const name of SERVER_ONLY) if (text.includes(name)) hits.push(`${p}: mentions ${name}`);
  }
  return hits;
}

test('the patterns catch real-looking keys (self-check, fake values)', () => {
  const fake = ['sk-' + 'a'.repeat(32), 'AKIA' + 'B'.repeat(16), 'gsk_' + 'c'.repeat(30), 'Bearer ' + 'd'.repeat(30)];
  for (const f of fake) assert.ok(KEY_PATTERNS.some(([, re]) => re.test(f)), f);
  assert.ok(!KEY_PATTERNS.some(([, re]) => re.test('const tokens = drafts.map((t) => t.title);')));
});

test('the built client bundle (dist/) contains no key-like string', (t) => {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const built = files(dist, /\.(js|mjs|html|json|css|map)$/u);
  if (built.length === 0) {
    t.skip('dist/ not built yet (npm run check builds it, then runs this test again)');
    return;
  }
  assert.deepEqual(scan(built), []);
});

test('client sources (src/) hold no key and never read server-only variables', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  assert.deepEqual(scan(files(src, /\.(ts|js|json|html)$/u)), []);
});

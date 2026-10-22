import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { encodeQr, qrPath } from '../src/logic/qr.ts';

/** Grey PNG of a QR code (quiet zone 4, `scale` px per module), no dependency. */
function png(modules: boolean[][], scale = 8): Buffer {
  const n = modules.length + 8;
  const w = n * scale;
  const raw = Buffer.alloc((w + 1) * w);
  for (let y = 0; y < w; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const my = Math.floor(y / scale) - 4;
      const mx = Math.floor(x / scale) - 4;
      const dark = my >= 0 && mx >= 0 && my < modules.length && mx < modules.length && modules[my][mx];
      raw[y * (w + 1) + 1 + x] = dark ? 0 : 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SAMPLES = [
  'https://wind-down-desk.onrender.com',
  'wind-down-desk.onrender.com',
  'HELLO',
  'https://wind-down-desk.onrender.com/?ref=quest-card&utm_source=landing',
  'https://example.org/' + 'a'.repeat(120),
];

test('QR: smallest version that fits, square, finder patterns in three corners', () => {
  const qr = encodeQr('https://wind-down-desk.onrender.com');
  assert.equal(qr.version, 3, '35 bytes → version 3-M (42 bytes max)');
  assert.equal(qr.size, 29);
  for (const [x, y] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) {
    assert.ok(qr.modules[y][x] && qr.modules[y + 6][x + 6] && !qr.modules[y + 1][x + 1] && qr.modules[y + 3][x + 3], `finder at ${x},${y}`);
  }
  assert.equal(encodeQr('a'.repeat(200)).version, 10);
  assert.throws(() => encodeQr('a'.repeat(300)));
  const { size, d } = qrPath(qr);
  assert.equal(size, 37);
  assert.ok(d.startsWith('M4 4h7v1h-7z'));
});

test('QR: every sample is read back by macOS CoreImage (skipped where Swift is missing)', (t) => {
  try {
    execFileSync('swift', ['--version'], { stdio: 'ignore' });
  } catch {
    t.skip('swift not available');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'wdd-qr-'));
  const files = SAMPLES.map((s, i) => {
    const f = join(dir, `qr-${i}.png`);
    writeFileSync(f, png(encodeQr(s).modules));
    return f;
  });
  const out = execFileSync('swift', ['tools/qr-decode.swift', ...files], { encoding: 'utf8', timeout: 120_000 });
  const decoded = new Map(out.trim().split('\n').map((l) => l.split('\t') as [string, string]));
  SAMPLES.forEach((s, i) => assert.equal(decoded.get(files[i]), s, `sample ${i}`));
});

/**
 * Production static files: the Vite build (`dist/`) served by the same Node process as /api (one Render service).
 *
 *   /assets/*-<hash>.<ext>  → Cache-Control: public, max-age=31536000, immutable (Vite content hashes)
 *   index.html, /           → no-cache (always revalidated: a redeploy is seen at once)
 *   everything else         → public, max-age=3600 + ETag (panoramas, sounds, voice: not hashed)
 *   text types               → gzip, compressed once and kept in memory
 *   .ktx2 / .ogg / .wasm / .mp3 → their exact MIME types (KTX2Loader, WebAudio decodeAudioData, wasm streaming)
 * Paths are resolved inside the root only (no traversal), dotfiles and source maps are never served.
 */
import { createReadStream, statSync, type Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.basis': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.txt', '.md', '.svg', '.wasm', '.gltf', '.ttf', '.otf']);
/** Vite output: name-<8+ chars hash>.ext under /assets/. */
const HASHED = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u;

export function cacheControl(urlPath: string): string {
  if (urlPath === '/' || urlPath.endsWith('.html')) return 'no-cache';
  if (HASHED.test(urlPath)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

/** File for a URL path inside `root`, or null (outside the root, dotfile, source map, directory, missing). */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' ? '/index.html' : decoded;
  if (rel.split('/').some((part) => part.startsWith('.')) || rel.endsWith('.map')) return null;
  const base = resolve(root);
  const full = resolve(base, normalize(`.${rel}`));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export interface StaticOptions {
  root: string;
  /** Extra headers for every static response (security). */
  headers?: Record<string, string>;
}

/** Serves GET/HEAD from `root`; returns false when the request is not a static file (the caller answers 404). */
export function createStaticHandler(options: StaticOptions): (req: IncomingMessage, res: ServerResponse, urlPath: string) => Promise<boolean> {
  const root = resolve(options.root);
  const gz = new Map<string, { mtime: number; body: Buffer }>();
  return async (req, res, urlPath) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const file = resolveInside(root, urlPath);
    if (file == null) return false;
    let stat: Stats;
    try {
      stat = statSync(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    const ext = extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cacheControl(urlPath === '/' ? '/index.html' : urlPath),
      etag,
      'last-modified': stat.mtime.toUTCString(),
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    const acceptsGzip = /\bgzip\b/u.test(String(req.headers['accept-encoding'] ?? ''));
    if (COMPRESSIBLE.has(ext) && stat.size > 1024) {
      headers.vary = 'accept-encoding';
      if (acceptsGzip) {
        let cached = gz.get(file);
        if (cached == null || cached.mtime !== stat.mtimeMs) {
          cached = { mtime: stat.mtimeMs, body: gzipSync(await readFile(file), { level: 9 }) };
          gz.set(file, cached);
        }
        headers['content-encoding'] = 'gzip';
        headers['content-length'] = String(cached.body.length);
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : cached.body);
        return true;
      }
    }
    headers['content-length'] = String(stat.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise<void>((done) => {
      const stream = createReadStream(file);
      stream.on('error', () => {
        res.destroy();
        done();
      });
      stream.on('end', () => done());
      stream.pipe(res);
    });
    return true;
  };
}

/** Default build folder next to the server (wind-down-desk/dist). */
export const DEFAULT_DIST = join(import.meta.dirname, '..', 'dist');

#!/usr/bin/env node
// @ts-check
/**
 * Zero-dependency static dev server for app/ (node:http only).
 *
 *   node serve.mjs              # http://localhost:8080 (this computer only)
 *   node serve.mjs --lan        # also reachable from a phone on the same Wi-Fi
 *   node serve.mjs --port 9000  # or PORT=9000
 *
 * Service workers run on localhost; over plain http://<pc-ip> they do not,
 * so LAN testing has no offline mode. Use the HTTPS hosted URL for real use.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), 'app');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Map a URL path to a file inside root, or null if it escapes root.
 * @param {string} root absolute directory
 * @param {string} urlPath e.g. "/js/main.js?x=1"
 * @returns {string | null}
 */
export function resolvePath(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const full = normalize(join(root, p));
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/**
 * @param {string} root
 * @returns {import('node:http').Server}
 */
export function makeServer(root = APP_DIR) {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolvePath(root, req.url || '/');
    try {
      if (!file || !(await stat(file)).isFile()) throw new Error('not found');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  const port = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 8080);
  const lan = args.includes('--lan');
  const host = lan ? '0.0.0.0' : process.env.HOST || '127.0.0.1';
  makeServer().listen(port, host, () => {
    console.log(`LNF Run Log dev server: http://localhost:${port}`);
    if (lan) {
      for (const list of Object.values(networkInterfaces())) {
        for (const a of list || []) {
          if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${port} (no offline mode over plain HTTP)`);
        }
      }
    } else {
      console.log('  (add --lan to reach it from a phone on the same Wi-Fi)');
    }
  });
}

const isMain = () => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) main();

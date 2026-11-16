#!/usr/bin/env node
// A small static file server for built static output (a static export, a
// plain static site, an Angular build without SSR). It binds a loopback
// address only, serves GET and HEAD, never follows a symbolic link, never
// serves an environment file or another dotfile, and can add a fixed header
// that the probe's target guard checks (--header).
//
//   node static-serve.mjs --root <dir> --port <n> [--host 127.0.0.1|::1|localhost]
//                         [--header <name>=<value>]... [--spa] [--no-gzip]
//
// Port 0 picks a free port; the chosen URL is printed on the first line.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
});
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const HEADER_VALUE = /^[\x20-\x7e]{0,256}$/;
const RESERVED_HEADERS = new Set(['content-length', 'content-type', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie', 'location']);

export function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost' || /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
}

function isEnvironmentFileName(name) {
  return /^\.env($|[.\-_])/i.test(name) || /^\.envrc$/i.test(name) || /\.env$/i.test(name) || /^\.dev\.vars$/i.test(name);
}

// Maps a request path to segments inside the root, or null when it must not
// be served (traversal, encoded separators, dotfiles, environment files).
export function requestSegments(urlPath) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) return null;
  const pathname = urlPath.split('?')[0].split('#')[0];
  if (/%2f|%5c|%00/i.test(pathname)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return null;
    if (segment.startsWith('.') && segment !== '.well-known') return null;
    if (isEnvironmentFileName(segment)) return null;
    if (/[:*?"<>|]/.test(segment)) return null;
  }
  return segments;
}

// Resolves segments under the root without following links. Returns
// {file, stat} for a regular file (a directory resolves to its index.html).
export function resolveFile(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) return null;
  }
  let stat;
  try {
    stat = fs.lstatSync(current);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    const index = path.join(current, 'index.html');
    try {
      const indexStat = fs.lstatSync(index);
      return indexStat.isFile() ? { file: index, stat: indexStat } : null;
    } catch {
      return null;
    }
  }
  return stat.isFile() ? { file: current, stat } : null;
}

export function parseHeaderOption(value) {
  const index = typeof value === 'string' ? value.indexOf('=') : -1;
  if (index <= 0) return null;
  const name = value.slice(0, index).trim();
  const headerValue = value.slice(index + 1).trim();
  if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(headerValue) || RESERVED_HEADERS.has(name.toLowerCase())) return null;
  return [name, headerValue];
}

export function createStaticServer({ root, headers = [], spa = false, gzip = true } = {}) {
  const base = path.resolve(root);
  const baseStat = fs.lstatSync(base);
  if (!baseStat.isDirectory()) throw new Error('the root is not a directory');
  return http.createServer((request, response) => {
    for (const [name, value] of headers) response.setHeader(name, value);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('method not allowed\n');
      return;
    }
    const segments = requestSegments(request.url || '/');
    let found = segments === null ? null : resolveFile(base, segments);
    let status = 200;
    if (found === null && segments !== null && spa) {
      const last = segments[segments.length - 1] || '';
      if (!/\.[A-Za-z0-9]+$/.test(last)) found = resolveFile(base, ['index.html']);
    }
    if (found === null) {
      const notFound = resolveFile(base, ['404.html']);
      if (notFound && segments !== null) {
        found = notFound;
        status = 404;
      } else {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('not found\n');
        return;
      }
    }
    const type = CONTENT_TYPES[path.extname(found.file).toLowerCase()] || 'application/octet-stream';
    const lastModified = found.stat.mtime.toUTCString();
    const etag = `W/"${found.stat.size.toString(16)}-${Math.floor(found.stat.mtimeMs).toString(16)}"`;
    if (status === 200 && request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      response.end();
      return;
    }
    const compress = gzip && COMPRESSIBLE.test(type) && /\bgzip\b/.test(String(request.headers['accept-encoding'] || ''));
    const head = { 'Content-Type': type, 'Last-Modified': lastModified, ETag: etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    let body;
    try {
      body = fs.readFileSync(found.file);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found\n');
      return;
    }
    if (compress) {
      body = zlib.gzipSync(body);
      head['Content-Encoding'] = 'gzip';
    }
    head['Content-Length'] = body.length;
    response.writeHead(status, head);
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

export function parseArgs(argv) {
  const options = { headers: [], spa: false, gzip: true, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--spa') { options.spa = true; continue; }
    if (arg === '--no-gzip') { options.gzip = false; continue; }
    const value = argv[i + 1];
    if (!['--root', '--port', '--host', '--header'].includes(arg)) return { error: `unknown option ${arg}` };
    if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
    i += 1;
    if (arg === '--root') options.root = value;
    if (arg === '--host') options.host = value;
    if (arg === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: '--port must be an integer from 0 to 65535' };
      options.port = port;
    }
    if (arg === '--header') {
      const header = parseHeaderOption(value);
      if (header === null) return { error: '--header must be <name>=<printable value> and cannot set a reserved header' };
      options.headers.push(header);
    }
  }
  if (!options.root || options.port === undefined) return { error: '--root and --port are required' };
  if (!isLoopbackHost(options.host)) return { error: '--host must be a loopback address (127.0.0.1, ::1 or localhost)', refused: true };
  return { options };
}

const USAGE = 'usage: node static-serve.mjs --root <dir> --port <n> [--host 127.0.0.1] [--header <name>=<value>]... [--spa] [--no-gzip]';

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exitCode = parsed.refused ? 2 : 1;
    return;
  }
  const { options } = parsed;
  let server;
  try {
    server = createStaticServer(options);
  } catch (error) {
    process.stderr.write(`static-serve: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  server.on('error', (error) => {
    process.stderr.write(`static-serve: ${error.code || error.message}\n`);
    process.exitCode = 1;
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    process.stdout.write(`static-serve listening on http://${host}:${address.port}/ (root ${path.resolve(options.root)})\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

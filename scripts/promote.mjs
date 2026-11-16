#!/usr/bin/env node
// Evidence promotion (SKILL.md "Evidence promotion"): copies the files an
// agent lists in its result's artifacts[] from its scratch folder into the
// parent-owned agents/<id>/artifacts/ folder, one file at a time, with every
// check of the procedure. Agents never run this; the parent does.
//
//   node promote.mjs --run-dir <abs run dir> --agent <agent-id> [--result <scratch-relative result file>]
//
// Prints a JSON report {agent, promoted[], dropped[], total_bytes}.
// Exit 0: everything listed was promoted. Exit 1: at least one file was
// dropped (the rest were promoted). Exit 2: refused (bad arguments, a run
// directory or agent that does not exist, an unreadable result).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp', '.json', '.txt', '.log', '.html', '.har', '.zip']);
export const NEVER_PROMOTED_SEGMENTS = Object.freeze(['storage', 'profile']);
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_AGENT_BYTES = 300 * 1024 * 1024;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;
const PATH_FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}<>:"|?*\\]/u;
// Keys whose string value would be a credential if a probe config or a
// capture carried it inline.
const CREDENTIAL_KEY = /^(password|passwd|pwd|pin|secret|client_secret|token|access_token|refresh_token|id_token|api_?key|authorization|cookie|set-cookie|session_?id)$/i;
const SENSITIVE_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization']);

export function isEnvironmentFileName(name) {
  return /^\.env($|[.\-_])/i.test(name) || /^\.envrc$/i.test(name) || /\.env$/i.test(name) || /^\.dev\.vars$/i.test(name);
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || !value.isWellFormed()) return false;
  if (PATH_FORBIDDEN_CHARACTER.test(value) || value.startsWith('/') || value.startsWith('~')) return false;
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return false;
    if (segment.endsWith(' ') || segment.endsWith('.')) return false;
    if (WINDOWS_RESERVED.test(segment)) return false;
  }
  return true;
}

function extensionOf(file) {
  const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

// Checks a scratch path and a promotion target without touching the disk.
// Returns null when acceptable, else the reason.
export function checkEntryPaths(entry) {
  if (entry === null || typeof entry !== 'object') return 'entry is not an object';
  const { path: source, promote_to: target } = entry;
  if (!isSafeRelativePath(source) || !source.startsWith('out/')) return 'path must be a safe relative path under out/';
  if (!isSafeRelativePath(target)) return 'promote_to must be a safe relative path';
  for (const value of [source, target]) {
    const segments = value.split('/');
    if (segments.some((segment) => NEVER_PROMOTED_SEGMENTS.includes(segment.toLowerCase()))) return 'storage and profile folders are never promoted';
    if (segments.some((segment) => isEnvironmentFileName(segment))) return 'environment files are never promoted';
  }
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(target))) return `extension of promote_to is not one of ${ALLOWED_EXTENSIONS.join(' ')}`;
  if (extensionOf(source) !== extensionOf(target)) return 'promote_to must keep the extension of the scratch file';
  if (entry.bytes !== undefined && !(Number.isInteger(entry.bytes) && entry.bytes >= 0)) return 'bytes must be a non-negative integer';
  return null;
}

// Finds inline credentials in a parsed JSON value (probe configs, captures).
export function findInlineCredential(value, depth = 0) {
  if (depth > 64 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findInlineCredential(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key) && typeof child === 'string' && child.length > 0) return key;
    if ((key === 'cookies' || key === 'storageState') && Array.isArray(child) && child.some((c) => c && typeof c.value === 'string' && c.value.length > 0)) return key;
    const hit = findInlineCredential(child, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// A HAR may keep the request and response headers; any value of a cookie or
// authorization header disqualifies it.
export function harHasSensitiveHeader(har) {
  const entries = har && har.log && Array.isArray(har.log.entries) ? har.log.entries : [];
  for (const entry of entries) {
    for (const side of [entry && entry.request, entry && entry.response]) {
      const headers = side && Array.isArray(side.headers) ? side.headers : [];
      for (const header of headers) {
        if (header && typeof header.name === 'string' && SENSITIVE_HEADERS.has(header.name.toLowerCase()) &&
            typeof header.value === 'string' && header.value.length > 0) return true;
      }
      const cookies = side && Array.isArray(side.cookies) ? side.cookies : [];
      if (cookies.some((cookie) => cookie && typeof cookie.value === 'string' && cookie.value.length > 0)) return true;
    }
  }
  return false;
}

// lstat every segment below `base`; refuse links and junctions on the way.
function lstatChain(base, rel) {
  let current = base;
  let stat = null;
  for (const segment of rel.split('/')) {
    current = path.join(current, segment);
    try {
      stat = fs.lstatSync(current, { bigint: true });
    } catch {
      return { error: 'file does not exist' };
    }
    if (stat.isSymbolicLink()) return { error: 'a path segment is a symbolic link or junction' };
  }
  return { file: current, stat };
}

// Opens without following links where the platform can, otherwise with the
// lstat, open, fstat identity fallback (Windows).
function openNoFollow(file, linkStat) {
  const flags = fs.constants;
  if (typeof flags.O_NOFOLLOW === 'number') {
    const fd = fs.openSync(file, flags.O_RDONLY | flags.O_NOFOLLOW);
    return fd;
  }
  const fd = fs.openSync(file, 'r');
  const stat = fs.fstatSync(fd, { bigint: true });
  if (stat.dev !== linkStat.dev || stat.ino !== linkStat.ino) {
    fs.closeSync(fd);
    throw new Error('the file was replaced while it was being opened');
  }
  return fd;
}

function readStable(file, linkStat, maxBytes) {
  const fd = openNoFollow(file, linkStat);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error('not a regular file');
    if (before.nlink !== 1n) throw new Error('the file has more than one link');
    if (before.size > BigInt(maxBytes)) throw new Error(`larger than ${maxBytes} bytes`);
    const size = Number(before.size);
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const n = fs.readSync(fd, buffer, read, size - read, read);
      if (n === 0) break;
      read += n;
    }
    const extra = fs.readSync(fd, Buffer.alloc(1), 0, 1, size);
    const after = fs.fstatSync(fd, { bigint: true });
    if (read !== size || extra !== 0 || after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.dev !== before.dev || after.ino !== before.ino) {
      throw new Error('the file changed while it was being copied');
    }
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function directoryBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += fs.lstatSync(full).size;
    }
  }
  return total;
}

export function promoteArtifacts({ runDir, agentId, entries, maxFileBytes = MAX_FILE_BYTES, maxAgentBytes = MAX_AGENT_BYTES }) {
  const agentDir = path.join(runDir, 'agents', agentId);
  const scratch = path.join(agentDir, 'scratch');
  const artifacts = path.join(agentDir, 'artifacts');
  const promoted = [];
  const dropped = [];
  let total = directoryBytes(artifacts);
  const seenTargets = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const record = { path: entry && entry.path, promote_to: entry && entry.promote_to };
    const drop = (reason) => dropped.push({ ...record, reason });
    const pathProblem = checkEntryPaths(entry);
    if (pathProblem) { drop(pathProblem); continue; }
    if (seenTargets.has(entry.promote_to.toLowerCase())) { drop('two entries promote to the same path'); continue; }
    seenTargets.add(entry.promote_to.toLowerCase());
    const chain = lstatChain(scratch, entry.path);
    if (chain.error) { drop(chain.error); continue; }
    if (!chain.stat.isFile()) { drop('not a regular file'); continue; }
    let buffer;
    try {
      buffer = readStable(chain.file, chain.stat, maxFileBytes);
    } catch (error) {
      drop(error.message);
      continue;
    }
    if (entry.bytes !== undefined && entry.bytes !== buffer.length) { drop(`size ${buffer.length} differs from the reported bytes ${entry.bytes}`); continue; }
    if (total + buffer.length > maxAgentBytes) { drop(`the agent's artifacts would pass ${maxAgentBytes} bytes`); continue; }
    const ext = extensionOf(entry.promote_to);
    if (ext === '.json' || ext === '.har') {
      let parsed = null;
      try {
        parsed = JSON.parse(buffer.toString('utf8'));
      } catch {
        parsed = null;
      }
      if (ext === '.har' && (parsed === null || harHasSensitiveHeader(parsed))) {
        drop(parsed === null ? 'a .har that is not JSON' : 'a .har with cookie, set-cookie or authorization values');
        continue;
      }
      const credential = parsed === null ? null : findInlineCredential(parsed);
      if (credential) { drop(`inline credential under the key ${JSON.stringify(credential)}`); continue; }
    }
    const targetSegments = entry.promote_to.split('/');
    let parent = artifacts;
    let linkProblem = false;
    try {
      fs.mkdirSync(artifacts, { recursive: true });
      for (const segment of targetSegments.slice(0, -1)) {
        parent = path.join(parent, segment);
        const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
        if (stat && !stat.isDirectory()) { linkProblem = true; break; }
        if (!stat) fs.mkdirSync(parent);
      }
    } catch (error) {
      drop(`cannot create the target folder (${error.code || error.message})`);
      continue;
    }
    if (linkProblem) { drop('a target path segment is not a plain folder'); continue; }
    const target = path.join(artifacts, ...targetSegments);
    try {
      fs.writeFileSync(target, buffer, { flag: 'wx' });
    } catch (error) {
      drop(error.code === 'EEXIST' ? 'the target already exists; promotion never overwrites' : `cannot write the target (${error.code || error.message})`);
      continue;
    }
    total += buffer.length;
    promoted.push({ ...record, owned_path: `agents/${agentId}/artifacts/${entry.promote_to}`, bytes: buffer.length, purpose: entry.purpose ?? null });
  }
  return { agent: agentId, promoted, dropped, total_bytes: total };
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--run-dir', '--agent', '--result'].includes(arg)) return { error: `unknown option ${arg}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
    flags[arg.slice(2)] = value;
    i += 1;
  }
  if (!flags['run-dir'] || !flags.agent) return { error: '--run-dir and --agent are required' };
  return { flags };
}

const USAGE = 'usage: node promote.mjs --run-dir <abs run dir> --agent <agent-id> [--result <scratch-relative file, default result.json>]';

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) { process.stdout.write(`${USAGE}\n`); return; }
  if (parsed.error) { process.stderr.write(`${parsed.error}\n${USAGE}\n`); process.exitCode = 2; return; }
  const runDir = parsed.flags['run-dir'];
  const agentId = parsed.flags.agent;
  const resultRel = parsed.flags.result ?? 'result.json';
  if (!path.isAbsolute(runDir) || !AGENT_ID.test(agentId) || WINDOWS_RESERVED.test(agentId) || !isSafeRelativePath(resultRel) ||
      resultRel.split('/').some(isEnvironmentFileName)) {
    process.stderr.write(`refused: the run directory must be absolute, the agent ID safe and the result a safe scratch-relative path\n`);
    process.exitCode = 2;
    return;
  }
  const chain = lstatChain(path.join(runDir, 'agents', agentId, 'scratch'), resultRel);
  if (chain.error || !chain.stat.isFile()) {
    process.stderr.write(`refused: ${chain.error || 'the result is not a regular file'}\n`);
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = JSON.parse(readStable(chain.file, chain.stat, 5 * 1024 * 1024).toString('utf8'));
  } catch (error) {
    process.stderr.write(`refused: the result could not be read as JSON (${error.message})\n`);
    process.exitCode = 2;
    return;
  }
  const report = promoteArtifacts({ runDir, agentId, entries: result && Array.isArray(result.artifacts) ? result.artifacts : [] });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.dropped.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

#!/usr/bin/env node
// Checks, without an agent, that every source location a record cites exists:
// each trace[] and evidence[] entry that names a repository file must name a file
// of the reviewed source ref, and its line must be within that file. This is the
// mechanical part of the Phase 5 checklist (VALIDATION-AND-REPORTING.md 4.2 step 1)
// that a separate agent used to do for every record.
//
//   node check-traces.mjs --findings <out>/findings.json --target <repo-root> [--ref <commit>]
//
// Without --ref the working tree is read. Environment files are never opened.
// Exit 0: every location exists. Exit 1: one or more problems (printed as JSON).
// Exit 2: usage error.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = /(^|\/)(\.env([._-].*)?|\.envrc|[^/]*\.env|\.dev\.vars)$/i;

export function isEnvironmentFile(file) {
  return ENV_FILE.test(String(file).replace(/\\/g, '/'));
}

// Locations that point into the run directory (promoted artifacts) are the
// validators' job, not this script's.
function isRepoLocation(entry) {
  return entry && typeof entry.file === 'string' && entry.file.length > 0 && !entry.file.startsWith('agents/');
}

function safeRelative(file) {
  const normal = file.replace(/\\/g, '/');
  if (path.isAbsolute(normal) || /^[A-Za-z]:/.test(normal)) return null;
  if (normal.split('/').some((part) => part === '..' || part === '')) return null;
  return normal;
}

export function makeReader({ target, ref = null }) {
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let text = null;
    try {
      if (ref) {
        text = execFileSync('git', ['-C', target, 'show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      } else {
        const full = path.join(target, file);
        if (fs.lstatSync(full).isFile()) text = fs.readFileSync(full, 'utf8');
      }
    } catch {
      text = null;
    }
    const lines = text === null ? null : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
    cache.set(file, lines);
    return lines;
  };
}

// Installed dependencies are not part of the reviewed source; their lines are listed, not checked.
const DEPENDENCY = /(^|\/)node_modules\//;

export function checkTraces(findings, read) {
  if (!Array.isArray(findings)) throw new Error('findings must be an array');
  const problems = [];
  const skipped = [];
  let checked = 0;
  findings.forEach((record, index) => {
    if (!record || typeof record !== 'object') return;
    for (const key of ['trace', 'evidence']) {
      const list = Array.isArray(record[key]) ? record[key] : [];
      list.forEach((entry, position) => {
        if (!isRepoLocation(entry)) return;
        const at = { fingerprint: record.fingerprint, pointer: `/${index}/${key}/${position}`, file: entry.file, line: entry.line ?? null };
        const file = safeRelative(entry.file);
        if (file === null) { problems.push({ ...at, problem: 'not a safe repository-relative path' }); return; }
        if (isEnvironmentFile(file)) { problems.push({ ...at, problem: 'names an environment file; not opened' }); return; }
        if (DEPENDENCY.test(file)) { skipped.push({ ...at, reason: 'installed dependency, not in the reviewed source' }); return; }
        checked += 1;
        const lines = read(file);
        if (lines === null) { problems.push({ ...at, problem: 'file does not exist at the reviewed source' }); return; }
        if (entry.line !== undefined && entry.line !== null) {
          if (!Number.isInteger(entry.line) || entry.line < 1 || entry.line > lines) {
            problems.push({ ...at, problem: `line is outside the file (1-${lines})` });
          }
        }
      });
    }
  });
  return { checked, problems, skipped };
}

export function runCli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--findings', '--target', '--ref'].includes(flag) || i + 1 >= argv.length) {
      return { status: 2, stdout: '', stderr: `usage: check-traces.mjs --findings <file> --target <repo-root> [--ref <commit>] (bad argument ${flag})\n` };
    }
    args[flag.slice(2)] = argv[(i += 1)];
  }
  if (!args.findings || !args.target) {
    return { status: 2, stdout: '', stderr: 'usage: check-traces.mjs --findings <file> --target <repo-root> [--ref <commit>]\n' };
  }
  if (isEnvironmentFile(args.findings)) return { status: 2, stdout: '', stderr: 'refusing to open an environment file\n' };
  let findings;
  try {
    findings = JSON.parse(fs.readFileSync(args.findings, 'utf8'));
  } catch (error) {
    return { status: 2, stdout: '', stderr: `cannot read findings: ${error.message}\n` };
  }
  const result = checkTraces(findings, makeReader({ target: args.target, ref: args.ref ?? null }));
  const skippedNote = result.skipped.length ? ` (${result.skipped.length} in installed dependencies not checked)` : '';
  const summary = result.problems.length === 0
    ? `PASS: ${result.checked} source locations exist${skippedNote}\n`
    : `${JSON.stringify(result.problems, null, 2)}\nFAIL: ${result.problems.length} of ${result.checked} source locations do not exist\n`;
  return { status: result.problems.length === 0 ? 0 : 1, stdout: summary, stderr: '' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { status, stdout, stderr } = runCli(process.argv.slice(2));
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(status);
}

#!/usr/bin/env node
// Root-cause grouping before Phase 3 (VALIDATION-AND-REPORTING.md §2.1): lists
// the candidates that probably share one root cause, so the parent merges them
// before it assigns verifiers instead of verifying the same defect twice.
//
//   node group-candidates.mjs --candidates <file> [--near <lines>]
//
// <file> is a JSON array of proposed records, or an object whose values are
// records or {record}. Two candidates fall in one group when their trace sink
// is the same file and line ("same_sink"), or the same file within --near lines
// (default 8; "near_sink"). It only proposes: the parent reads both root causes
// and decides. Prints a JSON report {groups[], singles}. Exit 0 always for a
// readable file; exit 2 for a usage error or an unreadable file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NEAR = 8;

/** The proposed record of one entry, whatever the file's shape. */
function recordOf(entry) {
  if (entry && typeof entry === 'object' && entry.record && typeof entry.record === 'object') return entry.record;
  return entry;
}

/** The trace step marked as the sink, or the last step. */
export function sinkOf(record) {
  const trace = Array.isArray(record?.trace) ? record.trace : [];
  const step = trace.find((t) => t && t.kind === 'sink') ?? trace[trace.length - 1];
  if (!step || typeof step.file !== 'string' || !Number.isInteger(step.line)) return null;
  return { file: step.file.replaceAll('\\', '/'), line: step.line };
}

/**
 * Groups records by sink. Returns groups of at least two fingerprints, each
 * with its reason, in fingerprint order; records with no sink are reported.
 */
export function groupCandidates(records, near = DEFAULT_NEAR) {
  const items = records
    .map(recordOf)
    .filter((r) => r && typeof r.fingerprint === 'string')
    .map((r) => ({ fingerprint: r.fingerprint, sink: sinkOf(r), title: r.title ?? null }))
    .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
  const parent = new Map(items.map((i) => [i.fingerprint, i.fingerprint]));
  const find = (fp) => {
    while (parent.get(fp) !== fp) fp = parent.get(fp);
    return fp;
  };
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const x = items[a].sink;
      const y = items[b].sink;
      if (!x || !y || x.file !== y.file || Math.abs(x.line - y.line) > near) continue;
      const ra = find(items[a].fingerprint);
      const rb = find(items[b].fingerprint);
      if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
    }
  }
  const byRoot = new Map();
  for (const i of items) {
    const root = find(i.fingerprint);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(i);
  }
  const groups = [];
  for (const [root, members] of byRoot) {
    if (members.length < 2) continue;
    groups.push({
      keep: root,
      reason: new Set(members.map((m) => `${m.sink.file}:${m.sink.line}`)).size === 1 ? 'same_sink' : 'near_sink',
      members: members.map((m) => ({ fingerprint: m.fingerprint, sink: m.sink ? `${m.sink.file}:${m.sink.line}` : null, title: m.title })),
    });
  }
  return {
    groups,
    singles: items.length - groups.reduce((n, g) => n + g.members.length, 0),
    without_sink: items.filter((i) => !i.sink).map((i) => i.fingerprint),
  };
}

const USAGE = 'usage: node group-candidates.mjs --candidates <file> [--near <lines>]';

function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);
  const file = args.get('--candidates');
  const near = args.has('--near') ? Number(args.get('--near')) : DEFAULT_NEAR;
  if (!file || ![...args.keys()].every((k) => k === '--candidates' || k === '--near') || !Number.isInteger(near) || near < 0) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    process.stderr.write(`refused: cannot read ${file}: ${error.message}\n`);
    process.exit(2);
  }
  const records = Array.isArray(data) ? data : Object.values(data ?? {});
  process.stdout.write(`${JSON.stringify(groupCandidates(records, near), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

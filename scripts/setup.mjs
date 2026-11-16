#!/usr/bin/env node
// First-use setup (SKILL.md "First use"): makes sure the pinned playwright-core
// is in the skill's own node_modules, so a fresh clone or `npx skills` copy
// works without a manual `npm ci`.
//
//   node setup.mjs            report only: prints {"ready": true|false, ...}
//   node setup.mjs --install  if missing, runs `npm ci --ignore-scripts` in the
//                             skill folder (one download from the npm registry)
//
// playwright-core downloads no browser; the probe uses the local Chrome, Edge or
// Playwright Chromium. Exit 0 when ready, 1 when missing (report mode) or the
// install failed, 2 for a usage error.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The version the skill pins, from its package.json. */
export function pinnedVersion(skillDir = SKILL_DIR) {
  const pkg = JSON.parse(fs.readFileSync(path.join(skillDir, 'package.json'), 'utf8'));
  return pkg.dependencies?.['playwright-core'] ?? null;
}

/** The installed playwright-core version in the skill's node_modules, or null. */
export function installedVersion(skillDir = SKILL_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(skillDir, 'node_modules', 'playwright-core', 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

export function status(skillDir = SKILL_DIR) {
  const pinned = pinnedVersion(skillDir);
  const installed = installedVersion(skillDir);
  return { ready: installed !== null && installed === pinned, pinned, installed, skill_dir: skillDir };
}

function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--install')) {
    process.stderr.write('usage: node setup.mjs [--install]\n');
    process.exit(2);
  }
  let report = status();
  if (!report.ready && argv[0] === '--install') {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const run = spawnSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: SKILL_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
    report = { ...status(), install_exit: run.status };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(report.ready ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

#!/usr/bin/env node
// Detects how a target web project is built and served, which checks it
// already has, and which rule files it carries. Read-only: it lists
// directories, reads package manifests and a few framework config files, and
// never opens an environment file (names are matched and skipped unread).
//
//   node detect-project.mjs --root <abs-target> --out <abs-file outside the target> [--skill-dir <abs>]
//
// Exit 0: the result was written (a plain "static" result included).
// Exit 1: usage error. Exit 2: the root or output path was refused.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DETECT_SCHEMA = 'ui-audit/project-detect@1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_DIR = path.resolve(HERE, '..');

// Directory names never walked: dependencies, VCS data, build output and
// caches, and agent-skill folders (excluded from every audit).
export const SKIP_DIRS = Object.freeze(new Set([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.output', '.svelte-kit', '.astro', '.angular', '.vercel',
  '.netlify', '.turbo', '.cache', '.parcel-cache', 'dist', 'build', 'out', 'coverage', '.claude', '.agents', '.cursor-server',
  '.storage', 'storage', 'uploads', 'tmp', '.pnpm-store', '.yarn',
]));
const WALK_MAX_DEPTH = 6;
const WALK_MAX_ENTRIES = 20000;
const READ_MAX_BYTES = 2 * 1024 * 1024;

export function isEnvironmentFileName(name) {
  return /^\.env($|[.\-_])/i.test(name) || /^\.envrc$/i.test(name) || /\.env$/i.test(name) || /^\.dev\.vars$/i.test(name);
}

export function isForbiddenPath(value) {
  return typeof value === 'string' && value.split(/[\\/]+/).some((segment) => segment !== '' && isEnvironmentFileName(segment));
}

// Rule files by kind (PROJECT-CONVENTIONS.md "Where written rules come from").
// Each pattern is tested against the repository-relative path with "/".
export const RULE_FILE_PATTERNS = Object.freeze([
  { kind: 'agent-guide', test: (p) => /(^|\/)CLAUDE\.md$/.test(p) },
  { kind: 'agent-guide', test: (p) => p === 'AGENTS.md' || p === 'GEMINI.md' || /(^|\/)AGENTS\.md$/.test(p) },
  { kind: 'agent-guide', test: (p) => p === '.github/copilot-instructions.md' || p === '.cursorrules' || p === '.windsurfrules' || p.startsWith('.cursor/rules/') },
  { kind: 'contributing', test: (p) => ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md'].includes(p) },
  { kind: 'readme', test: (p) => p === 'README.md' },
  { kind: 'docs', test: (p) => /^docs\/.+\.(md|mdx)$/i.test(p) && /(design|plan|adr|decision|rfc|spec)/i.test(p) },
  { kind: 'design-tokens', test: (p) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(p) || /(^|\/)(design-)?tokens\.(json|css|scss|ts|js|mjs)$/i.test(p) },
  { kind: 'lint-config', test: (p) => /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[a-z]+)?|\.stylelintrc(\.[a-z]+)?|stylelint\.config\.[cm]?[jt]s|biome\.jsonc?|\.prettierrc(\.[a-z]+)?|prettier\.config\.[cm]?[jt]s)$/.test(p) },
  { kind: 'editor', test: (p) => p === '.editorconfig' },
  { kind: 'pr-template', test: (p) => p === '.github/pull_request_template.md' || p.startsWith('.github/PULL_REQUEST_TEMPLATE/') },
  { kind: 'commit-tooling', test: (p) => /^(commitlint\.config\.[cm]?[jt]s|\.commitlintrc(\.[a-z]+)?|lefthook\.ya?ml|\.lefthook\.ya?ml|\.pre-commit-config\.yaml)$/.test(p) || p.startsWith('.husky/') },
]);

const PM_RUN = Object.freeze({ npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn run', bun: 'bun run' });
const PM_EXEC = Object.freeze({ npm: 'npm exec --no --', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bun run' });

// Framework rules, tried in order; the first match wins for an app directory.
export const FRAMEWORK_RULES = Object.freeze([
  {
    framework: 'nextjs',
    match: (ctx) => ctx.dep('next') && (ctx.exists(/^next\.config\.[cm]?[jt]s$/) || ctx.dir('app') || ctx.dir('pages') || ctx.dir('src/app') || ctx.dir('src/pages')),
    build: 'next build', servePlain: /^next start$/, port: 3000, portPassing: 'flag_and_env',
    serve: (port) => ({ cli: `next start -p ${port} -H 127.0.0.1`, flags: `-p ${port} -H 127.0.0.1`, env: {} }),
  },
  {
    framework: 'nuxt', match: (ctx) => ctx.dep('nuxt'), build: 'nuxt build', servePlain: /^nuxt preview$/, port: 3000, portPassing: 'env',
    serve: (port) => ({ cli: 'nuxt preview', flags: '', env: { PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' } }),
  },
  {
    framework: 'sveltekit', match: (ctx) => ctx.dep('@sveltejs/kit'), build: 'vite build', servePlain: /^vite preview$/, port: 4173, portPassing: 'flag',
    serve: (port) => ({ cli: `vite preview --port ${port} --strictPort --host 127.0.0.1`, flags: `--port ${port} --strictPort --host 127.0.0.1`, env: {} }),
  },
  {
    framework: 'astro', match: (ctx) => ctx.dep('astro'), build: 'astro build', servePlain: /^astro preview$/, port: 4321, portPassing: 'flag',
    serve: (port) => ({ cli: `astro preview --port ${port} --host 127.0.0.1`, flags: `--port ${port} --host 127.0.0.1`, env: {} }),
  },
  {
    framework: 'react-router', match: (ctx) => ctx.dep('@react-router/dev') || ctx.exists(/^react-router\.config\.[cm]?[jt]s$/),
    build: 'react-router build', servePlain: /^react-router-serve \.?\/?build\/server\/index\.js$/, port: 3000, portPassing: 'env',
    serve: (port) => ({ cli: 'react-router-serve ./build/server/index.js', flags: '', env: { PORT: String(port), HOST: '127.0.0.1' } }),
  },
  {
    framework: 'remix', match: (ctx) => ctx.dep('@remix-run/dev'), build: 'remix vite:build', servePlain: /^remix-serve \.?\/?build\/server\/index\.js$/, port: 3000, portPassing: 'env',
    serve: (port) => ({ cli: 'remix-serve ./build/server/index.js', flags: '', env: { PORT: String(port), HOST: '127.0.0.1' } }),
  },
  {
    framework: 'angular', match: (ctx) => ctx.dep('@angular/core') && ctx.exists(/^angular\.json$/), build: 'ng build', servePlain: null, port: 4000, portPassing: 'env',
    serve: (port) => ({ cli: null, flags: '', env: { PORT: String(port) } }),
  },
  {
    framework: 'vite', match: (ctx) => ctx.dep('vite'), build: 'vite build', servePlain: /^vite preview$/, port: 4173, portPassing: 'flag',
    serve: (port) => ({ cli: `vite preview --port ${port} --strictPort --host 127.0.0.1`, flags: `--port ${port} --strictPort --host 127.0.0.1`, env: {} }),
  },
  {
    framework: 'static', match: (ctx) => ctx.exists(/^index\.html$/) || ctx.fileAt('public/index.html'), build: null, servePlain: null, port: 8080, portPassing: 'flag',
    serve: () => ({ cli: null, flags: '', env: {} }),
  },
]);

const VITE_FLAVORS = Object.freeze([
  ['react', 'react'], ['vue', 'vue'], ['svelte', 'svelte'], ['solid', 'solid-js'], ['preact', 'preact'], ['lit', 'lit'],
]);
const STYLING = Object.freeze([
  ['tailwind', 'tailwindcss'], ['styled-components', 'styled-components'], ['emotion', '@emotion/react'], ['sass', 'sass'],
  ['vanilla-extract', '@vanilla-extract/css'], ['mui', '@mui/material'], ['chakra', '@chakra-ui/react'], ['unocss', 'unocss'],
  ['panda', '@pandacss/dev'], ['bootstrap', 'bootstrap'],
]);

function safeLstat(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

function readText(file) {
  if (isForbiddenPath(file)) return null;
  const stat = safeLstat(file);
  if (!stat || !stat.isFile() || stat.size > READ_MAX_BYTES) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

// Lists repository-relative paths, without following links, skipping SKIP_DIRS.
export function walk(root, { maxDepth = WALK_MAX_DEPTH, maxEntries = WALK_MAX_ENTRIES } = {}) {
  const files = [];
  const dirs = [];
  let truncated = false;
  const queue = [{ abs: root, rel: '', depth: 0 }];
  while (queue.length > 0) {
    const { abs, rel, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (files.length + dirs.length >= maxEntries) {
        truncated = true;
        break;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        dirs.push(childRel);
        if (depth + 1 < maxDepth) queue.push({ abs: path.join(abs, entry.name), rel: childRel, depth: depth + 1 });
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }
  return { files, dirs, truncated };
}

export function detectPackageManager(root, pkg) {
  const has = (name) => safeLstat(path.join(root, name))?.isFile() === true;
  const field = pkg && typeof pkg.packageManager === 'string' ? pkg.packageManager : null;
  const fieldMatch = field ? /^(npm|pnpm|yarn|bun)@([0-9][^+\s]*)/.exec(field) : null;
  let name = null;
  let lockfile = null;
  let source = 'default';
  for (const [file, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']]) {
    if (has(file)) {
      name = manager;
      lockfile = file;
      source = 'lockfile';
      break;
    }
  }
  if (name === null && fieldMatch) {
    name = fieldMatch[1];
    source = 'packageManager';
  }
  if (name === null) name = 'npm';
  const version = fieldMatch && fieldMatch[1] === name ? fieldMatch[2] : null;
  let yarnFlavor = null;
  if (name === 'yarn') {
    const major = version ? Number(version.split('.')[0]) : null;
    yarnFlavor = has('.yarnrc.yml') || (major !== null && major >= 2) ? 'berry' : 'classic';
  }
  const install = {
    npm: lockfile ? 'npm ci' : 'npm install',
    pnpm: 'pnpm install --frozen-lockfile',
    yarn: yarnFlavor === 'berry' ? 'yarn install --immutable' : 'yarn install --frozen-lockfile',
    bun: 'bun install --frozen-lockfile',
  }[name];
  return { name, version, lockfile, yarn_flavor: yarnFlavor, source, install };
}

function dependencyVersion(pkg, name) {
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (pkg && pkg[key] && typeof pkg[key][name] === 'string') return pkg[key][name];
  }
  return null;
}

function workspaceDirs(root, pkg, files, dirs) {
  const patterns = [];
  if (pkg && Array.isArray(pkg.workspaces)) patterns.push(...pkg.workspaces);
  else if (pkg && pkg.workspaces && Array.isArray(pkg.workspaces.packages)) patterns.push(...pkg.workspaces.packages);
  const yaml = readText(path.join(root, 'pnpm-workspace.yaml'));
  if (yaml) {
    let inPackages = false;
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const item = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
        if (item) patterns.push(item[1].trim());
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
  }
  const out = new Set();
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) continue;
    const clean = pattern.replace(/\/+$/, '');
    const regex = new RegExp(`^${clean.split('/').map((part) => (part === '**' ? '.+' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+'))).join('/')}$`);
    for (const dir of dirs) if (regex.test(dir) && files.includes(`${dir}/package.json`)) out.add(dir);
  }
  return [...out].sort();
}

function scriptCommand(pm, script) {
  return `${PM_RUN[pm]} ${script}`;
}

function appendFlags(pm, command, flags) {
  if (!flags) return command;
  return pm === 'npm' ? `${command} -- ${flags}` : `${command} ${flags}`;
}

function checkScript(pkg, names) {
  const scripts = pkg && pkg.scripts ? pkg.scripts : {};
  for (const name of names) {
    const value = scripts[name];
    if (typeof value === 'string' && value.trim() !== '' && !/no test specified/.test(value)) return name;
  }
  return null;
}

function nextStaticExport(appRoot) {
  for (const name of ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts']) {
    const text = readText(path.join(appRoot, name));
    if (text && /output\s*:\s*['"`]export['"`]/.test(text)) {
      const distDir = /distDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(text);
      return distDir ? distDir[1] : 'out';
    }
  }
  return null;
}

function angularInfo(appRoot) {
  const config = readJson(path.join(appRoot, 'angular.json'));
  if (!config || !config.projects) return { project: null, ssr: false, outputPath: null };
  const project = config.defaultProject || Object.keys(config.projects)[0] || null;
  const build = project ? config.projects[project]?.architect?.build ?? config.projects[project]?.targets?.build : null;
  const options = build?.options ?? {};
  const outputPath = typeof options.outputPath === 'string' ? options.outputPath : (options.outputPath?.base ?? `dist/${project}`);
  const ssr = Boolean(options.ssr || options.server);
  return { project, ssr, outputPath };
}

export function detectApp(root, appDir, pm, skillDir = DEFAULT_SKILL_DIR) {
  const appRoot = path.join(root, appDir);
  const pkg = readJson(path.join(appRoot, 'package.json'));
  const entries = (() => {
    try {
      return fs.readdirSync(appRoot, { withFileTypes: true });
    } catch {
      return [];
    }
  })();
  const ctx = {
    dep: (name) => dependencyVersion(pkg, name) !== null,
    exists: (regex) => entries.some((entry) => entry.isFile() && regex.test(entry.name)),
    dir: (rel) => safeLstat(path.join(appRoot, rel))?.isDirectory() === true,
    fileAt: (rel) => safeLstat(path.join(appRoot, rel))?.isFile() === true,
  };
  const rule = FRAMEWORK_RULES.find((candidate) => candidate.match(ctx));
  if (!rule) return null;
  const evidence = [];
  const frameworkPackage = { nextjs: 'next', nuxt: 'nuxt', sveltekit: '@sveltejs/kit', astro: 'astro', 'react-router': '@react-router/dev', remix: '@remix-run/dev', angular: '@angular/core', vite: 'vite' }[rule.framework];
  if (frameworkPackage && ctx.dep(frameworkPackage)) evidence.push(`dependency ${frameworkPackage}`);
  for (const entry of entries) if (entry.isFile() && /\.config\.[cm]?[jt]s$|^angular\.json$|^index\.html$/.test(entry.name)) evidence.push(entry.name);
  let flavor = null;
  if (rule.framework === 'vite') flavor = (VITE_FLAVORS.find(([, dep]) => ctx.dep(dep)) || ['vanilla'])[0];
  const scripts = pkg && pkg.scripts ? pkg.scripts : {};
  const port = rule.port;
  const commands = { install: pm.install, build: null, serve: null, dev: null, test: null, lint: null, typecheck: null };
  if (typeof scripts.build === 'string' && scripts.build.trim() !== '') commands.build = scriptCommand(pm.name, 'build');
  else if (rule.build) commands.build = `${PM_EXEC[pm.name]} ${rule.build}`;
  if (typeof scripts.dev === 'string') commands.dev = scriptCommand(pm.name, 'dev');
  for (const [key, names] of [['test', ['test', 'test:unit']], ['lint', ['lint']], ['typecheck', ['typecheck', 'type-check', 'check-types', 'tsc', 'types']]]) {
    const name = checkScript(pkg, names);
    commands[key] = name ? scriptCommand(pm.name, name) : null;
  }
  let staticOutputDir = null;
  let needsSpaFallback = false;
  const staticServe = (dir) => ({
    kind: 'static-server',
    command: `node ${path.join(skillDir, 'scripts', 'static-serve.mjs')} --root ${path.join(appRoot, dir)} --port ${port}${needsSpaFallback ? ' --spa' : ''}`,
    host: '127.0.0.1', port, port_passing: 'flag', args_style: null, env: {},
  });
  if (rule.framework === 'nextjs') {
    const exportDir = nextStaticExport(appRoot);
    if (exportDir) staticOutputDir = exportDir;
  }
  if (rule.framework === 'angular') {
    const info = angularInfo(appRoot);
    if (!info.ssr) {
      staticOutputDir = `${info.outputPath}/browser`;
      needsSpaFallback = true;
    } else {
      commands.serve = { kind: 'framework-cli', command: `node ${info.outputPath}/server/server.mjs`, host: '127.0.0.1', port, port_passing: 'env', args_style: null, env: { PORT: String(port), HOST: '127.0.0.1' } };
    }
  }
  if (rule.framework === 'static') {
    staticOutputDir = ctx.fileAt('index.html') ? '.' : 'public';
    commands.build = typeof scripts.build === 'string' ? commands.build : null;
  }
  if (staticOutputDir !== null) {
    commands.serve = staticServe(staticOutputDir);
  } else if (commands.serve === null) {
    const serve = rule.serve(port);
    let scriptName = null;
    for (const name of ['start', 'preview']) {
      if (typeof scripts[name] === 'string' && rule.servePlain && rule.servePlain.test(scripts[name].trim())) {
        scriptName = name;
        break;
      }
    }
    if (scriptName) {
      commands.serve = {
        kind: 'script', command: appendFlags(pm.name, scriptCommand(pm.name, scriptName), serve.flags), host: '127.0.0.1', port,
        port_passing: rule.portPassing, args_style: pm.name, env: serve.env,
      };
    } else if (serve.cli) {
      commands.serve = {
        kind: 'framework-cli', command: `${PM_EXEC[pm.name]} ${serve.cli}`, host: '127.0.0.1', port, port_passing: rule.portPassing,
        args_style: null, env: serve.env,
      };
    }
  }
  if (rule.framework === 'vite' || rule.framework === 'static') {
    needsSpaFallback = needsSpaFallback || ctx.dep('react-router-dom') || ctx.dep('vue-router') || ctx.dep('@tanstack/react-router') || ctx.dep('wouter');
  }
  let axeCore = null;
  for (const base of [appRoot, root]) {
    const axePkg = readJson(path.join(base, 'node_modules', 'axe-core', 'package.json'));
    const axeFile = path.join(base, 'node_modules', 'axe-core', 'axe.min.js');
    if (axePkg && safeLstat(axeFile)?.isFile()) {
      axeCore = { path: axeFile, version: typeof axePkg.version === 'string' ? axePkg.version : null };
      break;
    }
  }
  const styling = STYLING.filter(([, dep]) => ctx.dep(dep)).map(([label]) => label);
  return {
    dir: appDir || '.',
    name: pkg && typeof pkg.name === 'string' ? pkg.name : null,
    framework: rule.framework,
    framework_version: frameworkPackage ? dependencyVersion(pkg, frameworkPackage) : null,
    flavor,
    evidence,
    commands,
    static_output_dir: staticOutputDir,
    needs_spa_fallback: needsSpaFallback,
    axe_core: axeCore,
    styling,
  };
}

export function detectProject(root, { skillDir = DEFAULT_SKILL_DIR } = {}) {
  const pkg = readJson(path.join(root, 'package.json'));
  const pm = detectPackageManager(root, pkg);
  const { files, dirs, truncated } = walk(root);
  const notes = [];
  if (truncated) notes.push(`walk stopped after ${WALK_MAX_ENTRIES} entries; rule files deeper or later may be missing`);
  const workspaces = workspaceDirs(root, pkg, files, dirs);
  const apps = [];
  const rootApp = detectApp(root, '', pm, skillDir);
  for (const dir of workspaces) {
    const app = detectApp(root, dir, pm, skillDir);
    if (app && app.framework !== 'static') apps.push(app);
  }
  if (rootApp && (rootApp.framework !== 'static' || apps.length === 0)) apps.unshift(rootApp);
  if (apps.length === 0) notes.push('no framework and no index.html found; recon 1d must name the serve command');
  const ruleFiles = [];
  for (const file of files) {
    if (isForbiddenPath(file)) continue;
    const rule = RULE_FILE_PATTERNS.find((pattern) => pattern.test(file));
    if (rule && rule.kind !== 'lint-config') ruleFiles.push({ kind: rule.kind, path: file });
  }
  for (const dir of dirs) if (dir === '.husky' || dir === '.cursor/rules') ruleFiles.push({ kind: dir === '.husky' ? 'commit-tooling' : 'agent-guide', path: `${dir}/` });
  const lintConfigs = files.filter((file) => RULE_FILE_PATTERNS.find((pattern) => pattern.test(file))?.kind === 'lint-config');
  return {
    schema: DETECT_SCHEMA,
    root,
    package_manager: { name: pm.name, version: pm.version, lockfile: pm.lockfile, yarn_flavor: pm.yarn_flavor, source: pm.source },
    workspaces,
    apps,
    rule_files: ruleFiles,
    lint_configs: lintConfigs,
    environment_files_seen: files.filter((file) => isForbiddenPath(file)).length,
    notes,
  };
}

// The output must be absolute and outside the target; the root must be an
// absolute, existing directory.
export function checkPaths(root, out) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return 'the root must be an absolute path';
  const stat = safeLstat(root);
  if (!stat || !stat.isDirectory()) return 'the root is not an existing directory';
  if (typeof out !== 'string' || !path.isAbsolute(out)) return 'the output must be an absolute path';
  if (isForbiddenPath(out)) return 'the output path names an environment file';
  const rel = path.relative(path.resolve(root), path.resolve(out));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return 'the output path is inside the target';
  return null;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--root', '--out', '--skill-dir'].includes(arg)) return { error: `unknown option ${arg}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
    flags[arg.slice(2)] = value;
    i += 1;
  }
  if (!flags.root || !flags.out) return { error: '--root and --out are required' };
  return { flags };
}

const USAGE = 'usage: node detect-project.mjs --root <abs-target> --out <abs-file outside the target> [--skill-dir <abs>]';

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const refusal = checkPaths(parsed.flags.root, parsed.flags.out);
  if (refusal) {
    process.stderr.write(`refused: ${refusal}\n`);
    process.exitCode = 2;
    return;
  }
  const result = detectProject(path.resolve(parsed.flags.root), { skillDir: parsed.flags['skill-dir'] ?? DEFAULT_SKILL_DIR });
  fs.mkdirSync(path.dirname(parsed.flags.out), { recursive: true });
  fs.writeFileSync(parsed.flags.out, `${JSON.stringify(result, null, 2)}\n`);
  const summary = result.apps.map((app) => `${app.dir}: ${app.framework}`).join(', ') || 'no app';
  process.stdout.write(`wrote ${parsed.flags.out} (${summary}; package manager ${result.package_manager.name})\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

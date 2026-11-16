// Tests for detect-project.mjs. Run from the skill directory: node --test scripts/detect-project.test.mjs
// Each test builds a tiny fake project in a temp folder; nothing is installed or run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  detectProject, detectPackageManager, checkPaths, walk, FRAMEWORK_RULES, RULE_FILE_PATTERNS, isForbiddenPath, DETECT_SCHEMA,
} from './detect-project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'detect-project.mjs');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-detect-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const pkg = (deps, scripts = {}, extra = {}) => ({ name: 'demo', scripts, dependencies: deps, ...extra });

test('FRAMEWORK_RULES order is the documented order', () => {
  assert.deepEqual(FRAMEWORK_RULES.map((rule) => rule.framework),
    ['nextjs', 'nuxt', 'sveltekit', 'astro', 'react-router', 'remix', 'angular', 'vite', 'static']);
});

test('Next.js with a plain start script: script serve with loopback host and port', (t) => {
  const root = project({
    'package.json': pkg({ next: '16.3.8', react: '19.0.0' }, { build: 'next build', start: 'next start', lint: 'eslint .', test: 'vitest run', typecheck: 'tsc --noEmit' }),
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'next.config.ts': 'export default {}',
    'src/app/page.tsx': 'export default function Page() { return null }',
    'CLAUDE.md': '# rules', 'AGENTS.md': '# agents', '.env.local': 'SECRET=1', 'eslint.config.mjs': 'export default []',
    'src/styles/tokens.css': ':root{}', 'src/lib/auth/token.ts': 'export {}',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = detectProject(root);
  assert.equal(result.schema, DETECT_SCHEMA);
  assert.equal(result.package_manager.name, 'pnpm');
  const app = result.apps[0];
  assert.equal(app.framework, 'nextjs');
  assert.equal(app.framework_version, '16.3.8');
  assert.equal(app.commands.install, 'pnpm install --frozen-lockfile');
  assert.equal(app.commands.build, 'pnpm run build');
  assert.deepEqual([app.commands.serve.kind, app.commands.serve.command], ['script', 'pnpm run start -p 3000 -H 127.0.0.1']);
  assert.deepEqual([app.commands.test, app.commands.lint, app.commands.typecheck], ['pnpm run test', 'pnpm run lint', 'pnpm run typecheck']);
  assert.ok(result.rule_files.some((entry) => entry.path === 'CLAUDE.md' && entry.kind === 'agent-guide'));
  assert.ok(result.rule_files.some((entry) => entry.path === 'src/styles/tokens.css' && entry.kind === 'design-tokens'));
  assert.ok(!result.rule_files.some((entry) => entry.path === 'src/lib/auth/token.ts'));
  assert.deepEqual(result.lint_configs, ['eslint.config.mjs']);
  assert.equal(result.environment_files_seen, 1);
  assert.ok(!JSON.stringify(result).includes('SECRET'), 'never reads an environment file');
});

test('Next.js start script with its own flags falls back to the framework CLI; npm args style; static export', (t) => {
  const custom = project({
    'package.json': pkg({ next: '15.0.0' }, { build: 'next build', start: 'next start -p 8000' }),
    'package-lock.json': '{}',
    'app/page.js': '',
  });
  const exported = project({
    'package.json': pkg({ next: '15.0.0' }, { build: 'next build' }),
    'next.config.mjs': "export default { output: 'export' }",
    'pages/index.js': '',
  });
  t.after(() => [custom, exported].forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  const app = detectProject(custom).apps[0];
  assert.equal(app.commands.install, 'npm ci');
  assert.deepEqual([app.commands.serve.kind, app.commands.serve.command], ['framework-cli', 'npm exec --no -- next start -p 3000 -H 127.0.0.1']);
  const out = detectProject(exported, { skillDir: '/skill' }).apps[0];
  assert.equal(out.static_output_dir, 'out');
  assert.equal(out.commands.serve.kind, 'static-server');
  assert.match(out.commands.serve.command, /static-serve\.mjs --root .*out --port 3000/);
});

test('Vite flavors, preview scripts and SPA fallback; npm script flags use --', (t) => {
  const root = project({
    'package.json': pkg({ vite: '6.0.0', vue: '3.5.0', 'vue-router': '4.0.0' }, { build: 'vite build', preview: 'vite preview' }),
    'package-lock.json': '{}',
    'vite.config.ts': 'export default {}',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = detectProject(root).apps[0];
  assert.deepEqual([app.framework, app.flavor], ['vite', 'vue']);
  assert.equal(app.commands.serve.command, 'npm run preview -- --port 4173 --strictPort --host 127.0.0.1');
  assert.equal(app.needs_spa_fallback, true);
});

test('each framework is recognised by its evidence', (t) => {
  const cases = [
    ['nuxt', { 'package.json': pkg({ nuxt: '3.0.0' }) }, 'env'],
    ['sveltekit', { 'package.json': pkg({ '@sveltejs/kit': '2.0.0', vite: '6.0.0' }) }, 'flag'],
    ['astro', { 'package.json': pkg({ astro: '5.0.0' }), 'astro.config.mjs': '' }, 'flag'],
    ['react-router', { 'package.json': pkg({ '@react-router/dev': '7.0.0', vite: '6.0.0' }) }, 'env'],
    ['remix', { 'package.json': pkg({ '@remix-run/dev': '2.0.0', vite: '6.0.0' }) }, 'env'],
    ['angular', { 'package.json': pkg({ '@angular/core': '19.0.0' }), 'angular.json': { projects: { shop: { architect: { build: { options: { outputPath: 'dist/shop' } } } } } } }, 'flag'],
    ['static', { 'index.html': '<h1>x</h1>' }, 'flag'],
  ];
  for (const [framework, files, passing] of cases) {
    const root = project(files);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const app = detectProject(root).apps[0];
    assert.equal(app.framework, framework, framework);
    assert.equal(app.commands.serve.port_passing, passing, framework);
    assert.ok(['127.0.0.1'].includes(app.commands.serve.host), framework);
    if (app.commands.serve.env.HOST) assert.equal(app.commands.serve.env.HOST, '127.0.0.1');
    if (framework === 'angular') {
      assert.equal(app.commands.serve.kind, 'static-server');
      assert.equal(app.static_output_dir, 'dist/shop/browser');
    }
  }
});

test('package manager: lockfile first, then packageManager, then npm; yarn flavors', (t) => {
  const roots = [];
  const make = (files) => { const root = project(files); roots.push(root); return root; };
  t.after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  assert.equal(detectPackageManager(make({ 'yarn.lock': '' }), {}).install, 'yarn install --frozen-lockfile');
  assert.equal(detectPackageManager(make({ 'yarn.lock': '', '.yarnrc.yml': '' }), {}).yarn_flavor, 'berry');
  const field = detectPackageManager(make({}), { packageManager: 'pnpm@10.25.0' });
  assert.deepEqual([field.name, field.version, field.source], ['pnpm', '10.25.0', 'packageManager']);
  assert.equal(detectPackageManager(make({ 'bun.lock': '' }), {}).install, 'bun install --frozen-lockfile');
  assert.deepEqual([detectPackageManager(make({}), {}).name, detectPackageManager(make({}), {}).source], ['npm', 'default']);
});

test('workspaces list each app; the walk skips dependencies, build output and agent folders', (t) => {
  const root = project({
    'package.json': { name: 'mono', private: true, workspaces: ['apps/*'] },
    'pnpm-lock.yaml': '',
    'apps/web/package.json': pkg({ next: '16.0.0' }, { build: 'next build', start: 'next start' }),
    'apps/web/app/page.tsx': '',
    'apps/admin/package.json': pkg({ vite: '6.0.0', react: '19.0.0' }),
    'node_modules/axe-core/package.json': { version: '4.10.0' },
    'node_modules/axe-core/axe.min.js': '/* axe */',
    '.claude/skills/x/CLAUDE.md': 'not product',
    'dist/CLAUDE.md': 'build output',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = detectProject(root);
  assert.deepEqual(result.workspaces, ['apps/admin', 'apps/web']);
  assert.deepEqual(result.apps.map((app) => `${app.dir}:${app.framework}`), ['apps/admin:vite', 'apps/web:nextjs']);
  assert.equal(result.apps[0].axe_core.version, '4.10.0');
  assert.ok(!result.rule_files.some((entry) => entry.path.startsWith('.claude/') || entry.path.startsWith('dist/')));
  const listing = walk(root);
  assert.ok(!listing.files.some((file) => file.startsWith('node_modules/')));
});

test('rule file patterns cover every documented kind', () => {
  const samples = {
    'agent-guide': ['CLAUDE.md', 'packages/ui/CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursorrules', '.cursor/rules/ui.mdc', '.windsurfrules'],
    contributing: ['CONTRIBUTING.md', '.github/CONTRIBUTING.md'],
    readme: ['README.md'],
    docs: ['docs/adr/0001-colors.md', 'docs/plans/2026-design.md'],
    'design-tokens': ['tailwind.config.ts', 'src/styles/tokens.css'],
    'lint-config': ['eslint.config.mjs', '.eslintrc.json', '.stylelintrc', 'biome.json', '.prettierrc', 'prettier.config.js'],
    editor: ['.editorconfig'],
    'pr-template': ['.github/pull_request_template.md'],
    'commit-tooling': ['commitlint.config.js', '.commitlintrc.json', 'lefthook.yml', '.pre-commit-config.yaml', '.husky/pre-commit'],
  };
  for (const [kind, paths] of Object.entries(samples)) {
    for (const file of paths) assert.equal(RULE_FILE_PATTERNS.find((pattern) => pattern.test(file))?.kind, kind, file);
  }
  for (const file of ['src/app.ts', 'docs/notes.md', 'src/lib/token.ts']) assert.equal(RULE_FILE_PATTERNS.find((pattern) => pattern.test(file)), undefined, file);
  assert.ok(isForbiddenPath('a/.env.production'));
});

test('checkPaths refuses relative roots, outputs inside the target and environment-file outputs', (t) => {
  const root = project({ 'index.html': '' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(checkPaths(root, path.join(os.tmpdir(), 'out.json')), null);
  assert.match(checkPaths('relative/dir', path.join(os.tmpdir(), 'x.json')), /absolute/);
  assert.match(checkPaths(root, path.join(root, 'tools', 'project-detect.json')), /inside the target/);
  assert.match(checkPaths(root, path.join(os.tmpdir(), '.env')), /environment file/);
  assert.match(checkPaths(path.join(root, 'missing'), path.join(os.tmpdir(), 'x.json')), /not an existing directory/);
});

test('CLI: writes the result outside the target and exits 2 on a refused path', (t) => {
  const root = project({ 'package.json': pkg({ astro: '5.0.0' }) });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-detect-out-'));
  t.after(() => [root, outDir].forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  const out = path.join(outDir, 'tools', 'project-detect.json');
  const ok = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).apps[0].framework, 'astro');
  const refused = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', path.join(root, 'x.json')], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.ok(!fs.existsSync(path.join(root, 'x.json')));
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
});

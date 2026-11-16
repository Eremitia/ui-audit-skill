// Checks the repository itself: SKILL.md frontmatter and size, the files npm test lists, the plugin
// manifests, rule citations against SOURCES.md, relative links, the routing table and the budget
// tables against scripts/orchestrate.mjs, project-specific wording, environment files and
// attribution lines. Run from the skill directory: node --test skill-docs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { ROUTING_TABLE, TASK_KINDS, budgetGate, minimumCap, DEFAULT_CONFIG, DEFAULT_CAPS, SETUP_CALLS } from './scripts/orchestrate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const findingsValidator = require('./validate-findings.cjs');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir = ROOT, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), childRel));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}
const FILES = walk();
const MARKDOWN = FILES.filter((file) => file.endsWith('.md'));
const TEXT = FILES.filter((file) => /\.(md|mjs|cjs|js|json|txt)$/.test(file) || ['LICENSE', 'NOTICE', '.gitignore'].includes(file));

test('SKILL.md frontmatter opens on line 1, uses portable keys only and stays short', () => {
  const text = read('SKILL.md');
  const lines = text.split(/\r?\n/);
  assert.equal(lines[0], '---', 'line 1 is ---');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 1, 'the frontmatter is closed');
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([a-z][a-z-]*):\s?(.*)$/.exec(line);
    assert.ok(match, `frontmatter line parses as "key: value": ${line.slice(0, 60)}`);
    fields[match[1]] = match[2];
  }
  const portable = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
  for (const key of Object.keys(fields)) assert.ok(portable.includes(key), `${key} is a portable frontmatter key`);
  assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(fields.name, 'ui-audit');
  assert.ok(fields.description.length > 0 && fields.description.length <= 1024, `description is ${fields.description.length} characters`);
  assert.equal(fields['allowed-tools'], undefined, 'the skill pre-approves no tools');
  assert.ok(lines.length < 500, `SKILL.md has ${lines.length} lines`);
});

test('every file npm test lists exists, and the plugin, marketplace and package versions agree', () => {
  const pkg = JSON.parse(read('package.json'));
  const listed = pkg.scripts.test.split(/\s+/).filter((part) => /\.[cm]?js$/.test(part));
  assert.ok(listed.length >= 10);
  for (const file of listed) assert.ok(FILES.includes(file), `${file} exists`);
  for (const file of FILES.filter((f) => /\.test\.[cm]?js$/.test(f))) assert.ok(listed.includes(file), `${file} is run by npm test`);
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(plugin.name, 'ui-audit');
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, 'MIT');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, './');
  assert.equal(market.plugins[0].version, pkg.version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages['node_modules/playwright-core'].version, '1.63.0');
  assert.equal(pkg.dependencies['playwright-core'], '1.63.0');
  assert.deepEqual(Object.keys(pkg.dependencies), ['playwright-core'], 'no other dependency');
  assert.equal(lock.packages[''].engines.node, pkg.engines.node);
});

test('every rule citation names a row of SOURCES.md', () => {
  const ids = findingsValidator.loadRuleIds(path.join(ROOT, 'SOURCES.md'));
  assert.ok(ids.size > 300);
  const id = /^[A-Z][A-Z0-9]*-\d{2,3}$/;
  let cited = 0;
  for (const file of MARKDOWN) {
    const text = read(file);
    for (const match of text.matchAll(/\[rule: ([^\]]+)\]/g)) {
      for (const raw of match[1].split(',')) {
        const ref = raw.trim();
        assert.match(ref, id, `${file}: malformed rule id ${JSON.stringify(ref)}`);
        assert.ok(ids.has(ref), `${file}: ${ref} is not in SOURCES.md`);
        cited += 1;
      }
    }
    for (const match of text.matchAll(/\bRULE:([A-Z][A-Z0-9]*-\d{2,3})\b/g)) assert.ok(ids.has(match[1]), `${file}: RULE:${match[1]} is not in SOURCES.md`);
  }
  assert.ok(cited > 100, `${cited} citations checked`);
});

test('relative Markdown links resolve to files of the repository', () => {
  for (const file of MARKDOWN) {
    const text = read(file).replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target) || target.includes('<')) continue;
      const clean = decodeURIComponent(target.split('#')[0]);
      const resolved = path.normalize(path.join(path.dirname(file), clean)).split(path.sep).join('/');
      assert.ok(FILES.includes(resolved) || FILES.some((f) => f.startsWith(`${resolved.replace(/\/$/, '')}/`)), `${file}: broken link ${target}`);
    }
  }
});

function tableRows(text, header) {
  const start = text.indexOf(header);
  assert.ok(start >= 0, `table header ${header} exists`);
  const rows = [];
  for (const line of text.slice(start).split(/\r?\n/).slice(2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

test('the routing table of ORCHESTRATION.md section 2.2 equals ROUTING_TABLE', () => {
  const rows = tableRows(read('ORCHESTRATION.md'), '| task_kind | used for | model | effort | escalation target |');
  const seen = rows.map((row) => row[0]);
  assert.deepEqual(seen, TASK_KINDS, 'same task kinds in the same order');
  for (const [kind, , model, effort, escalation] of rows) {
    const expected = ROUTING_TABLE[kind];
    assert.equal(model, expected.model, `${kind} model`);
    assert.equal(effort, expected.effort, `${kind} effort`);
    assert.equal(escalation.split(' ')[0], expected.escalation, `${kind} escalation`);
  }
  const fixRows = tableRows(read('FIX-MODE.md'), '| task_kind | used for | model | effort | escalation target |');
  for (const [kind, , model, effort, escalation] of fixRows) {
    assert.deepEqual([model, effort, escalation], [ROUTING_TABLE[kind].model, ROUTING_TABLE[kind].effort, ROUTING_TABLE[kind].escalation], kind);
  }
});

test('the budget tables of SKILL.md, ORCHESTRATION.md, RUN-METADATA.md and README.md agree with budgetGate', () => {
  const gates = Object.fromEntries(['quick', 'standard', 'deep'].map((profile) => [profile, budgetGate({
    profile, cap: DEFAULT_CAPS[profile], fraction: DEFAULT_CONFIG.orchestration_reserve_fraction, availability: DEFAULT_CONFIG.models,
    maxRounds: DEFAULT_CONFIG.dialogue.max_rounds,
  })]));
  const reserved = ['quick', 'standard', 'deep'].map((p) => gates[p].reserve.total);
  const holds = ['quick', 'standard', 'deep'].map((p) => gates[p].minimum_cap_with_floor);
  const starts = ['quick', 'standard', 'deep'].map((p) => gates[p].minimum_cap_to_start);
  assert.deepEqual(reserved, [12, 14, 17]);
  assert.deepEqual(holds, [14, 16, 16]);
  assert.deepEqual(starts, [10, 12, 12]);
  assert.equal(gates.quick.reserve_floor, 6);
  const row = (rows, label) => {
    const found = rows.find((cells) => cells[0].startsWith(label));
    assert.ok(found, `row "${label}"`);
    return found.slice(1, 4).map((cell) => Number((/(\d+)\s*$/.exec(cell) || [])[1]));
  };
  const skill = tableRows(read('SKILL.md'), '| Key | quick | standard | deep |');
  assert.deepEqual(row(skill, 'Reserved with the default cap'), reserved);
  assert.deepEqual(row(skill, 'Smallest cap that holds the floor'), holds);
  assert.deepEqual(row(skill, 'Smallest cap that can start'), starts);
  assert.deepEqual(row(skill, 'Reserve floor'), [6, 6, 6]);
  assert.deepEqual(row(skill, 'Setup call'), [SETUP_CALLS, SETUP_CALLS, SETUP_CALLS]);
  const orch = tableRows(read('ORCHESTRATION.md'), '| Key | quick | standard | deep |');
  assert.deepEqual(row(orch, 'Smallest cap that holds the floor'), holds);
  assert.deepEqual(row(orch, 'Smallest cap that can start at all'), starts);
  const meta = tableRows(read('RUN-METADATA.md'), '| | quick | standard | deep |');
  assert.deepEqual(row(meta, 'Reserve at the gate'), reserved);
  assert.deepEqual(row(meta, 'Smallest cap that holds the floor'), holds);
  assert.deepEqual(row(meta, 'Smallest cap that can start'), starts);
  const readme = tableRows(read('README.md'), '| | quick | standard | deep |');
  assert.deepEqual(row(readme, 'Reserved before hunting'), reserved);
  assert.deepEqual(row(readme, 'Smallest cap that keeps consults'), holds);
  assert.deepEqual(row(readme, 'Smallest cap that can start'), starts);
  assert.equal(minimumCap('quick', 0.1, 2, 1), starts[0]);
});

test('the docs use the fictional Brasero app, never a real project, in their examples', () => {
  const real = new RegExp(['mi', 'cancha'].join(''), 'i');
  for (const file of TEXT) {
    read(file).split(/\r?\n/).forEach((line, index) => {
      assert.ok(!real.test(line), `${file}:${index + 1} names a real project; use the fictional Brasero app`);
    });
  }
});

test('no environment file ships, no script opens one, and no line is an attribution trailer', () => {
  const envName = /(^|\/)(\.env($|[.\-_][^/]*$)|\.envrc$|[^/]*\.env$|\.dev\.vars$)/i;
  for (const file of FILES) assert.ok(!envName.test(file), `${file} is an environment file`);
  for (const file of FILES.filter((f) => /\.(mjs|cjs|js)$/.test(f) && !f.endsWith('.test.mjs') && !f.endsWith('.test.cjs'))) {
    const text = read(file);
    assert.ok(!/readFileSync\(\s*['"`][^'"`]*\.env\b/.test(text), `${file} reads an environment file by literal name`);
  }
  for (const file of TEXT) {
    read(file).split(/\r?\n/).forEach((line, index) => {
      assert.ok(!/^\s*(co-authored-by:|generated with\b)/i.test(line), `${file}:${index + 1} is an attribution line`);
      assert.ok(!line.includes('\u{1F916}'), `${file}:${index + 1} carries an assistant signature`);
    });
  }
});

test('example JSON files parse and the config example passes the config checks', () => {
  for (const file of FILES.filter((f) => f.endsWith('.json'))) assert.doesNotThrow(() => JSON.parse(read(file)), file);
  const validator = require('./validate-orchestration.cjs');
  assert.deepEqual([...validator.validateConfigFile(JSON.parse(read('ui-audit.config.example.json')))], []);
  assert.deepEqual([...validator.validateConfigFile(JSON.parse(read('examples/ui-audit.config.json')))], []);
});

test('the companion lens files keep the anchors other files cite', () => {
  const catalog = findingsValidator.BLOCK_CATALOG;
  for (const [file, classes] of Object.entries(catalog)) {
    const text = read(file);
    for (const name of classes) assert.ok(text.includes(name), `${file} still names ${name}`);
  }
});

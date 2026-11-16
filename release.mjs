// npm run release:userscript: publishes dist/ to the fixed GitHub release `userscript`, which every installed
// script checks (@updateURL = <file>.meta.js, @downloadURL = <file>.user.js). It refuses, with the reason and a
// non-zero exit, unless all of this holds:
//   1. the working tree is clean (what is published is a commit),
//   2. the repo is watdafawx/better-browsing (the URLs in the headers point there),
//   3. npm run test:all passes (it also builds dist/),
//   4. no script's @version is below the published one, and a script whose @version equals the published one
//      is byte-identical to it (else installed copies would never see the change: bump that part's version or
//      the bundle's userscriptRevision). Equal and identical scripts are left alone.
// Then it uploads each changed .user.js, and only after that its .meta.js, with --clobber, so a manager that
// sees a new version in a .meta.js always finds the matching .user.js.
import { spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';

const REPO = 'watdafawx/better-browsing', TAG = 'userscript';
const fail = msg => { console.error(`release refused: ${msg}`); process.exit(1); };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const out = (cmd, args) => {
  const r = run(cmd, args);
  if (r.error || r.status !== 0) fail(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout.trim();
};
const clean = () => out('git', ['status', '--porcelain']) === '';
const versionOf = text => (text.match(/^\/\/ @version\s+(\S+)/m) || [])[1] || '';
// <0, 0, >0 like a manager compares: numerically, part by part, missing parts count as 0
const cmp = (a, b) => {
  const x = a.split('.').map(n => parseInt(n, 10) || 0), y = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

if (!clean()) fail('the working tree has uncommitted changes (git status). Commit first.');
const repo = out('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
if (repo !== REPO) fail(`this checkout's GitHub repo is ${repo}, but the scripts' update URLs point at ${REPO}. Rename the repo first.`);

console.log('running npm run test:all ...');
const t = run(process.execPath, ['test/all.mjs'], { stdio: 'inherit' });
if (t.status !== 0) fail('npm run test:all failed.');
if (!clean()) fail('the tests changed tracked files (git status).');

const files = fs.readdirSync('dist').filter(f => f.endsWith('.user.js')).sort();
if (!files.length) fail('dist/ has no scripts.');
const published = new Set(JSON.parse(out('gh', ['release', 'view', TAG, '--repo', REPO, '--json', 'assets'])).assets.map(a => a.name));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-release-'));
const changed = [];
for (const f of files) {
  const meta = f.replace(/\.user\.js$/, '.meta.js');
  if (!fs.existsSync(path.join('dist', meta))) fail(`dist/${meta} is missing.`);
  const local = fs.readFileSync(path.join('dist', f), 'utf8'), v = versionOf(local);
  if (!v) fail(`dist/${f} has no @version.`);
  if (versionOf(fs.readFileSync(path.join('dist', meta), 'utf8')) !== v) fail(`dist/${meta} and dist/${f} have different versions.`);
  if (!published.has(f)) { console.log(`${f}: new, ${v}`); changed.push(f); continue; }
  out('gh', ['release', 'download', TAG, '--repo', REPO, '--pattern', f, '--dir', tmp, '--clobber']);
  const remote = fs.readFileSync(path.join(tmp, f), 'utf8'), rv = versionOf(remote), c = cmp(v, rv);
  if (c < 0) fail(`${f} is ${v}, below the published ${rv}.`);
  if (c === 0 && remote.replace(/\r\n/g, '\n') !== local.replace(/\r\n/g, '\n'))
    fail(`${f} changed but is still ${v}, the published version. Bump the part's version or its userscriptRevision in package.json.`);
  if (c === 0 && !published.has(meta)) { console.log(`${f}: ${v}, unchanged; adding its missing ${meta}`); changed.push(f); continue; }
  if (c === 0) { console.log(`${f}: ${v}, unchanged`); continue; }
  console.log(`${f}: ${rv} -> ${v}`); changed.push(f);
}
fs.rmSync(tmp, { recursive: true, force: true });
if (!changed.length) fail('nothing to publish: every script equals the published one.');

const upload = list => {
  const r = run('gh', ['release', 'upload', TAG, '--repo', REPO, ...list.map(f => path.join('dist', f)), '--clobber'], { stdio: 'inherit' });
  if (r.status !== 0) fail(`gh release upload failed for ${list.join(', ')}.`);
};
upload(changed);
upload(changed.map(f => f.replace(/\.user\.js$/, '.meta.js')));
console.log(`published ${changed.length} script(s): ${changed.join(', ')}`);

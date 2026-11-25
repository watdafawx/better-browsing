// Runs every test: builds every bundle, checks their headers, runs each site's test against that site's own
// script in Chromium and again in Firefox, the double-install test in both, and the X test once more against the
// combined script. The Reddit and Instagram tests run their first part in Chromium either way and only their
// second part in BROWSER. Run: npm run test:all [-- --site=reddit|instagram|x|pinterest]
import { spawnSync } from 'child_process';

const options = process.argv.slice(2);
const site = options[0]?.match(/^--site=(reddit|instagram|x|pinterest)$/)?.[1];
if (options.length && (options.length !== 1 || !site)) {
  console.error('Usage: npm run test:all -- --site=reddit|instagram|x|pinterest');
  process.exit(1);
}
const node = (...args) => ['node', args];
const runs = [
  ['build', ...node('build.js')],
  ['headers', ...node('test/headers.mjs')],
  ['double install, Chromium', ...node('test/double-install.mjs')],
  ['double install, Firefox', ...node('test/double-install.mjs'), { BROWSER: 'firefox' }],
  ['X, Chromium, combined script', ...node('test/x-offline.mjs', 'dist/better-browsing.user.js')],
  ['X, Chromium', ...node('test/x-offline.mjs')],
  ['X, Firefox', ...node('test/x-offline.mjs'), { BROWSER: 'firefox' }],
  ['X, Chromium, Fast UI API', ...node('test/x-api-offline.mjs')],
  ['X, Firefox, Fast UI API', ...node('test/x-api-offline.mjs'), { BROWSER: 'firefox' }],
  ['X, Chromium, Fast UI Home', ...node('test/x-fast-home-offline.mjs')],
  ['X, Firefox, Fast UI Home', ...node('test/x-fast-home-offline.mjs'), { BROWSER: 'firefox' }],
  ['X, Chromium, Fast UI overlays', ...node('test/x-fast-overlay-offline.mjs')],
  ['X, Firefox, Fast UI overlays', ...node('test/x-fast-overlay-offline.mjs'), { BROWSER: 'firefox' }],
  ['Reddit, Chromium', ...node('test/offline.mjs')],
  ['Reddit, Firefox', ...node('test/offline.mjs'), { BROWSER: 'firefox' }],
  ['Instagram, Chromium', ...node('test/instagram-offline.mjs')],
  ['Instagram, Firefox', ...node('test/instagram-offline.mjs'), { BROWSER: 'firefox' }],
  ['Pinterest, Chromium', ...node('test/pinterest-offline.mjs')],
  ['Pinterest, Firefox', ...node('test/pinterest-offline.mjs'), { BROWSER: 'firefox' }],
];

// Shared checks always run. Site changes also exercise that site inside the combined bundle.
const selected = site ? runs.filter(([name]) => /^(build|headers|double install)/.test(name) || name.split(',')[0].toLowerCase() === site) : runs;
if (site && site !== 'x') {
  const script = site === 'reddit' ? 'test/offline.mjs' : `test/${site}-offline.mjs`;
  selected.push([`${site}, Chromium, combined script`, ...node(script), { US_FILE: 'dist/better-browsing.user.js' }]);
}
let bad = 0;
for (const [name, cmd, args, env = {}] of selected) {
  const t0 = Date.now();
  const res = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  const out = (res.stdout || '') + (res.stderr || '');
  const pass = (out.match(/^PASS/gm) || []).length, fail = out.split('\n').filter(l => /^FAIL/.test(l));
  const ok = res.status === 0 && !fail.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${pass} passed, ${fail.length} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const l of fail) console.log('      ' + l.slice(0, 300));
  if (!ok && !fail.length) console.log(out.split('\n').slice(-15).join('\n'));
}
console.log(bad ? `\n${bad} run(s) failed` : '\nall runs passed');
process.exit(bad ? 1 : 0);

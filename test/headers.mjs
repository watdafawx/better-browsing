// Header checks on dist/ (no browser): every site is served by exactly one per-site script (no overlap, no gap),
// the combined script covers the same pages, each .meta.js is its .user.js header with the same @version,
// update URLs point at the right release assets, and every key is one Violentmonkey/Tampermonkey document.
// Run: npm run test:headers (after npm run build)
import fs from 'fs';

const RELEASE = 'https://github.com/watdafawx/better-browsing/releases/download/userscript/';
const SITE_FILES = ['better-browsing-reddit', 'better-browsing-instagram', 'better-browsing-x', 'better-browsing-pinterest'];
const COMBINED = 'better-browsing';
const KEYS = new Set(['name', 'namespace', 'version', 'description', 'match', 'exclude', 'run-at', 'grant', 'inject-into',
  'noframes', 'updateURL', 'downloadURL', 'homepageURL', 'supportURL', 'icon', 'license']);

const checks = {};
const headerOf = text => {
  const m = text.match(/^\/\/ ==UserScript==\n([\s\S]*?)\n\/\/ ==\/UserScript==\n/);
  if (!m) return null;
  const tags = [];
  for (const line of m[1].split('\n')) {
    const t = line.match(/^\/\/ @(\S+)(?:\s+(.*))?$/);
    if (t) tags.push([t[1], (t[2] || '').trim()]);
  }
  return { raw: m[0], tags, get: k => tags.filter(([n]) => n === k).map(([, v]) => v) };
};
const load = f => {
  const user = fs.readFileSync(`dist/${f}.user.js`, 'utf8'), meta = fs.readFileSync(`dist/${f}.meta.js`, 'utf8');
  return { f, user: headerOf(user), meta: headerOf(meta), metaText: meta };
};
const all = [...SITE_FILES, COMBINED].map(f => {
  try { return load(f); } catch (e) { checks[`${f}: built with its .meta.js`] = false; return null; }
}).filter(Boolean);

// Chrome match patterns (what both managers implement for @match): scheme://host/path, `*.` = any subdomain or none
const matchRe = p => {
  const m = p.match(/^(https?|\*):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/);
  if (!m) return null;
  const host = m[2] === '*' ? '[^/]+' : m[2].startsWith('*.') ? `(?:[^/.]+\\.)*${m[2].slice(2).replace(/\./g, '\\.')}` : m[2].replace(/\./g, '\\.');
  const scheme = m[1] === '*' ? 'https?' : m[1];
  return new RegExp(`^${scheme}://${host}${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
};
// @exclude is a glob over the whole URL
const globRe = g => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const runsOn = (h, url) => h.get('match').some(p => matchRe(p)?.test(url)) && !h.get('exclude').some(g => globRe(g).test(url));

for (const b of all) {
  const { f, user, meta } = b;
  checks[`${f}: has a header`] = !!user;
  if (!user) continue;
  checks[`${f}: .meta.js is the .user.js header alone`] = !!meta && b.metaText === user.raw;
  checks[`${f}: .meta.js has the same @version`] = !!meta && meta.get('version')[0] === user.get('version')[0] && /^\d+(\.\d+)+$/.test(user.get('version')[0] || '');
  checks[`${f}: @updateURL is its .meta.js, @downloadURL its .user.js`] = user.get('updateURL')[0] === `${RELEASE}${f}.meta.js` && user.get('downloadURL')[0] === `${RELEASE}${f}.user.js`;
  checks[`${f}: only documented keys, one of each single-valued key`] = user.tags.every(([k]) => KEYS.has(k)) &&
    ['name', 'namespace', 'version', 'run-at', 'grant', 'inject-into', 'updateURL', 'downloadURL'].every(k => user.get(k).length === 1);
  checks[`${f}: page-world, document-start, top frame only`] = user.get('grant')[0] === 'none' && user.get('run-at')[0] === 'document-start' &&
    user.get('inject-into')[0] === 'auto' && user.get('noframes').length === 1;
  checks[`${f}: every @match is a valid match pattern`] = user.get('match').length > 0 && user.get('match').every(p => !!matchRe(p));
  checks[`${f}: namespace better-browsing-watdafawx`] = user.get('namespace')[0] === 'better-browsing-watdafawx';
}
const sites = all.filter(b => b.f !== COMBINED && b.user), combined = all.find(b => b.f === COMBINED)?.user;
checks['every script has its own @name'] = new Set(all.map(b => b.user?.get('name')[0])).size === all.length;
checks['the combined script keeps its @name'] = combined?.get('name')[0] === 'Better Browsing (Reddit + Instagram)';

// Icons: the four scripts sit next to each other in the manager's menu, so each needs its own mark
const icons = all.map(b => b.user?.get('icon')[0] || '');
const svgOf = v => {
  const m = v.match(/^data:image\/svg\+xml;base64,(.+)$/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8').trim() : '';
};
checks['every script has an @icon that is an inline SVG'] = icons.every(v => /^<svg[\s>]/.test(svgOf(v)));
checks['no two scripts share an @icon'] = new Set(icons).size === icons.length && icons.every(Boolean);

// No overlap, no gap: per-site @match lists are disjoint and together are the combined script's
const pats = sites.flatMap(b => b.user.get('match'));
checks['no @match pattern appears in two per-site scripts'] = new Set(pats).size === pats.length;
checks['per-site @match patterns together are the combined script\'s'] = !!combined &&
  JSON.stringify([...pats].sort()) === JSON.stringify([...combined.get('match')].sort()) &&
  JSON.stringify(sites.flatMap(b => b.user.get('exclude')).sort()) === JSON.stringify([...combined.get('exclude')].sort());
const SAMPLES = ['https://www.reddit.com/', 'https://reddit.com/r/test/', 'https://sh.reddit.com/r/x/comments/a/b/',
  'https://www.instagram.com/p/abc/', 'https://x.com/home', 'https://www.pinterest.com/pin/1/', 'https://de.pinterest.com/', 'https://pinterest.com/'];
for (const url of SAMPLES) {
  const by = sites.filter(b => runsOn(b.user, url)).map(b => b.f);
  checks[`${url} runs exactly one per-site script (${by.join(', ') || 'none'}) and the combined one`] = by.length === 1 && !!combined && runsOn(combined, url);
}
for (const url of ['https://old.reddit.com/r/test/', 'https://www.instagram.com.evil.example/', 'https://example.com/', 'https://notreddit.com/'])
  checks[`${url} runs no script`] = [...sites, all.find(b => b.f === COMBINED)].every(b => !b?.user || !runsOn(b.user, url));
// each site's pages and nothing else: the hosts in a per-site script's patterns name one site
const siteOf = p => (p.match(/(reddit|instagram|x|pinterest)\.com/) || [])[1];
checks['each per-site script matches one site only'] = sites.every(b => new Set(b.user.get('match').map(siteOf)).size === 1 &&
  b.f.endsWith('-' + siteOf(b.user.get('match')[0])));

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
process.exit(failed ? 1 : 0);

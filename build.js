// node build.js  ->  dist/: one userscript (Tampermonkey / Violentmonkey) per site, plus the old combined script
// while users move over. No dependencies, Node 22+.
//
//   better-browsing-reddit.user.js     Better Browsing for Reddit       (+ .meta.js, the header alone)
//   better-browsing-instagram.user.js  Better Browsing for Instagram
//   better-browsing-x.user.js          Better Browsing for X
//   better-browsing-pinterest.user.js  Better Browsing for Pinterest
//   better-browsing.user.js            the combined script (legacy, all four sites)
//
// Every bundle runs in the page itself (@grant none) at document-start, so the audio patches are in place
// before the sites' players load. Each one inlines what it needs from the one source tree: userscript/*.js
// once at the top, then per site its main-world files (through runMain), its content scripts in manifest
// order with `<site>.api` (storage, userscript/store.js) set right after defaults.js, its popup.js form
// mounted in a panel (userscript/panel.js), then its CSS. Each site block first claims the page
// (userscript/claim.js), so a second copy of the same site on the page exits.
// Managers check @updateURL (the .meta.js) for a higher @version and download @downloadURL (see "Userscript"
// in CLAUDE.md). Adding a site: one entry in SITES and one in BUNDLES.
const fs = require('fs'), path = require('path');
const { REPO, RELEASE, read, SHARED, iconOf, join, SITES, partVersion } = require('./build-lib.js');

// Versions. A per-site script is `<part version>.<revision>`; the combined one keeps its old scheme,
// `<reddit>.<instagram>.<x>.<pinterest>.<revision>`, so it stays above every version it published.
// Revisions (package.json `userscriptRevision`, one per bundle) are for changes to a script alone (header,
// userscript/*, build.js output): bump the affected bundles' revisions for those, set a bundle's back to 0
// when a part in it changes version. Managers compare versions part by part, numerically.
const pkg = JSON.parse(read('package.json'));
const revision = key => (pkg.userscriptRevision || {})[key] || 0;

// Each entry is one published script. `combined`: the legacy bundle, whose @name must never change (managers
// key a script on @name + @namespace) and which shows the per-site install notice off Reddit.
const BUNDLES = [
  { key: 'reddit', file: 'better-browsing-reddit', name: 'Better Browsing for Reddit', sites: ['reddit'] },
  { key: 'instagram', file: 'better-browsing-instagram', name: 'Better Browsing for Instagram', sites: ['instagram'] },
  { key: 'x', file: 'better-browsing-x', name: 'Better Browsing for X', sites: ['x'] },
  { key: 'pinterest', file: 'better-browsing-pinterest', name: 'Better Browsing for Pinterest', sites: ['pinterest'] },
  { key: 'combined', file: 'better-browsing', name: 'Better Browsing (Reddit + Instagram)', sites: ['instagram', 'x', 'pinterest', 'reddit'], combined: true },
];
const versionOf = b => b.combined
  ? [...['reddit', 'instagram', 'x', 'pinterest'].map(partVersion), revision(b.key)].join('.')
  : `${partVersion(b.sites[0])}.${revision(b.key)}`;
const fileOf = site => BUNDLES.find(b => !b.combined && b.sites[0] === site).file;

function header(b, version) {
  const s = b.sites.map(k => SITES[k]);
  const description = b.combined
    ? `The old combined script: Reddit, Instagram, X and Pinterest in one. Each site now has its own script (Better Browsing for Reddit, Instagram, X, Pinterest); install the ones you use. This one stands aside on any site whose own script is installed.`
    : s[0].about;
  const lines = [
    ['name', b.name], ['namespace', 'better-browsing-watdafawx'], ['version', version], ['description', description],
    ...s.flatMap(x => x.match.map(m => ['match', m])), ...s.flatMap(x => x.exclude.map(m => ['exclude', m])),
    ['run-at', 'document-start'], ['grant', 'none'], ['inject-into', 'auto'], ['noframes', ''],
    ['updateURL', `${RELEASE}${b.file}.meta.js`], ['downloadURL', `${RELEASE}${b.file}.user.js`],
    ['homepageURL', REPO], ['supportURL', `${REPO}/issues`], ['icon', iconOf(b.combined ? 'combined' : b.sites[0])], ['license', 'MIT'],
  ];
  return `// ==UserScript==\n${lines.map(([k, v]) => `// @${k.padEnd(12)} ${v}`.trimEnd()).join('\n')}\n// ==/UserScript==\n`;
}

// The script body: shared code once, then each site behind its host test and its claim on the page.
function bundle(b) {
  const blocks = b.sites.map(k => {
    const s = SITES[k];
    const notice = b.combined && k !== 'reddit'
      ? `\n  bbSplitNotice(${JSON.stringify(s.label)}, ${JSON.stringify(`${RELEASE}${fileOf(k)}.user.js`)}, ${JSON.stringify(`${REPO}#install`)});` : '';
    return `if (${s.test}) {\n  if (bbClaim(${JSON.stringify(k)}, ${!!b.combined})) {${notice}${s.code()}\n  }\n}`;
  });
  const sites = `const host = location.hostname;\n${blocks.join(' else ')}`;
  // Some managers run document-start scripts before <html> exists; everything here needs it.
  return `(() => {\n${join(SHARED)}\nconst start = () => {\n${sites}\n};\n` +
    `if (document.documentElement) start();\n` +
    `else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });\n})();\n`;
}

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });
for (const b of BUNDLES) {
  const version = versionOf(b), head = header(b, version), body = bundle(b);
  fs.writeFileSync(path.join('dist', `${b.file}.user.js`), `${head}\n${body}`);
  fs.writeFileSync(path.join('dist', `${b.file}.meta.js`), head);
  console.log(`built dist/${b.file}.user.js`, version, Math.round(Buffer.byteLength(head + body) / 1024) + ' KB');
}

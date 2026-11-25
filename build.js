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

const REPO = 'https://github.com/watdafawx/better-browsing';
const RELEASE = `${REPO}/releases/download/userscript/`;
const read = f => fs.readFileSync(f, 'utf8');
const SHARED = ['userscript/run-main.js', 'userscript/store.js', 'userscript/panel.js', 'userscript/claim.js'];
// One icon per script, so four installed scripts (and the old combined one) are told apart in the manager's
// menu. Each is inlined as an SVG data URI: nothing to fetch, and a couple of hundred bytes in the .meta.js.
// Adding a site: add userscript/icons/<site>.svg.
const iconOf = key => 'data:image/svg+xml;base64,' + fs.readFileSync(`userscript/icons/${key}.svg`).toString('base64');

// [main-world files, content files, css files, shadow css files] from a manifest, as paths under srcDir.
// `shadow_css` (a top-level manifest key) is CSS for a shadow root: it is not added to the page as a <style>,
// it becomes the string `<ns>.FAST_CSS`, set right after defaults.js, for the code that builds that root.
function scripts(man, srcDir) {
  const cs = man.content_scripts, files = list => [...new Set(list)].map(f => `${srcDir}/${f}`);
  return [files(cs.filter(c => c.world === 'MAIN').flatMap(c => c.js)), files(cs.filter(c => c.world !== 'MAIN').flatMap(c => c.js)),
    files(cs.flatMap(c => c.css || [])), files(man.shadow_css || [])];
}
// Comments and runs of whitespace out: enough for CSS that only ever lives in a JS string
const minCss = css => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};>])\s*/g, '$1').trim();
const join = files => files.map(f => `// ---- ${f} ----\n${read(f)}`).join('\n\n');
const style = (id, files) => `(() => { const s = document.createElement('style'); s.id = '${id}'; s.textContent = ${JSON.stringify(files.map(read).join('\n'))}; (document.head || document.documentElement).append(s); })();`;
// The settings form: popup.html from <header> to </main> (icon inlined), popup.css for a shadow root
function panel(srcDir) {
  const icon = 'data:image/png;base64,' + fs.readFileSync(`${srcDir}/icons/icon48.png`).toString('base64');
  const html = read(`${srcDir}/popup/popup.html`);
  return {
    html: html.slice(html.indexOf('<header>'), html.indexOf('</main>') + 7).replace('../icons/icon48.png', icon),
    css: read(`${srcDir}/popup/popup.css`).replace(/:root/g, ':host').replace(/^body \{/m, '.panel > div {')
  };
}

// One site's code. `api`: code that sets <ns>.api, inserted right after defaults.js.
// `extra`: constants the site's code uses. `main`: wraps the runMain call. `panelJs`: makes the panel.
function siteCode({ srcDir, manifest, api, extra = '', main = s => s, panelJs, cssId, ns }) {
  const [mainFiles, content, css, shadowCss] = scripts(JSON.parse(read(manifest)), srcDir);
  const shadow = shadowCss.length ? `\n${ns}.FAST_CSS = ${JSON.stringify(minCss(shadowCss.map(read).join('\n')))};` : '';
  const p = panel(srcDir);
  const i = content.findIndex(f => f.endsWith('/defaults.js'));
  return `
const PANEL_HTML = ${JSON.stringify(p.html)};
const PANEL_CSS = ${JSON.stringify(p.css)};
${extra}
${main(`runMain(() => {\n${join(mainFiles)}\n});`)}
${join(content.slice(0, i + 1))}
${api}${shadow}
${join([...content.slice(i + 1), `${srcDir}/popup/popup.js`])}
${panelJs}
${style(cssId, css)}`;
}

// Every site: its label, where its code lives, its @match/@exclude, the host test the bundle runs it under,
// and how its settings open (for @description).
const SITES = {
  // hls.js sits in a function that runs on first use (RBE.loadHls in video.js); the local
  // exports/module/define make its UMD wrapper set globalThis.Hls.
  reddit: {
    label: 'Reddit', manifest: 'manifest.base.json',
    match: ['https://*.reddit.com/*'], exclude: ['https://old.reddit.com/*'],
    test: `/(^|\\.)reddit\\.com$/.test(host) && host !== 'old.reddit.com' && !location.pathname.startsWith('/media')`,
    about: 'Post and comment viewer, image viewer, video autoplay and sound, spoilers, NSFW and themes for new Reddit. Settings: the gear in Reddit\'s top bar.',
    code: () => siteCode({
      srcDir: 'src', manifest: 'manifest.base.json', cssId: 'rbe-css',
      api: `RBE.api = bbStore('rbe-userscript-storage', true);`,
      extra: `const RBE_LOAD_HLS = () => { if (globalThis.Hls) return; (function () { var exports, module, define;
${read('src/vendor/hls.min.js').replace(/^\/\/# sourceMappingURL=.*$/m, '')}
}).call(globalThis); };`,
      main: s => `if (!location.pathname.startsWith('/login')) ${s}`,
      panelJs: `RBE.openSettingsInPage = bbPanel({ cls: 'rbe-root rbe-us-settings', html: PANEL_HTML, css: PANEL_CSS,
  mount: (root, close) => RBE.mountSettings(root, { close }),
  onToggle: open => document.querySelector('.rbe-nav-gear')?.classList.toggle('on', open) });`
    })
  },
  instagram: {
    label: 'Instagram', manifest: 'instagram/manifest.base.json',
    match: ['https://www.instagram.com/*'], exclude: [],
    test: `host === 'www.instagram.com'`,
    about: 'Browser video controls, sound at your volume and a fast lightbox for Instagram. Settings: the sidebar gear or Alt+W.',
    code: () => siteCode({
      srcDir: 'instagram/src', manifest: 'instagram/manifest.base.json', cssId: 'igb-css',
      api: `IGB.api = bbStore('igb-userscript-settings');`,
      panelJs: `IGB.openSettings = bbPanel({ cls: 'igb-root igb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => IGB.mountSettings(root) });`
    })
  },
  x: {
    label: 'X', manifest: 'x/manifest.base.json',
    match: ['https://x.com/*'], exclude: [],
    test: `host === 'x.com'`,
    about: 'Browser video controls with one video playing at a time, sound on, one-click retweet, Like + Retweet and copy link for Discord on X. Settings: the sidebar gear or Alt+W.',
    code: () => siteCode({
      srcDir: 'x/src', manifest: 'x/manifest.base.json', cssId: 'xbb-css', ns: 'XBB',
      api: `XBB.api = bbStore('xbb-userscript-settings');`,
      panelJs: `XBB.openSettings = bbPanel({ cls: 'xbb-root xbb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => XBB.mountSettings(root) });`
    })
  },
  pinterest: {
    label: 'Pinterest', manifest: 'pinterest/manifest.base.json',
    match: ['https://*.pinterest.com/*'], exclude: [],
    test: `/(^|\\.)pinterest\\.com$/.test(host)`,
    about: 'Pin viewer over the grid, video sound at your volume, offscreen pause and promoted pins hidden on Pinterest. Settings: Pinterest\'s left sidebar or Alt+W.',
    code: () => siteCode({
      srcDir: 'pinterest/src', manifest: 'pinterest/manifest.base.json', cssId: 'pin-css',
      api: `PIN.api = bbStore('pin-userscript-settings');`,
      panelJs: `PIN.openSettings = bbPanel({ cls: 'pin-root pin-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => PIN.mountSettings(root) });`
    })
  },
};

// Versions. A per-site script is `<part version>.<revision>`; the combined one keeps its old scheme,
// `<reddit>.<instagram>.<x>.<pinterest>.<revision>`, so it stays above every version it published.
// Revisions (package.json `userscriptRevision`, one per bundle) are for changes to a script alone (header,
// userscript/*, build.js output): bump the affected bundles' revisions for those, set a bundle's back to 0
// when a part in it changes version. Managers compare versions part by part, numerically.
const pkg = JSON.parse(read('package.json'));
const partVersion = site => JSON.parse(read(SITES[site].manifest)).version;
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

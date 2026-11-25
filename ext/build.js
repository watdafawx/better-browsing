// node ext/build.js [--dev] [--build-id=<id>]  ->  dist/better-browsing-ext/: one unpacked MV3 extension for
// Reddit, Instagram, X and Pinterest (Chrome first, Firefox 128+ ready). See EXT-PLAN.md.
//
// Zero source duplication: the only inputs are the four site trees (src/, instagram/src/, x/src/, pinterest/src/),
// userscript/*.js, their manifest.base.json files and ext/. Per site it writes
//   <site>/main.js     the manifest's `world: "MAIN"` files (no runMain, no nonce hack: the manifest does it)
//   <site>/content.js  userscript/store.js, panel.js, claim.js, ext/prelude.js, the claim, the site's content
//                      scripts in manifest order with `<ns>.api` after defaults.js, ext/bridge.js (+ bridge-x.js
//                      for X), popup/popup.js (the settings form) and the panel
//   <site>/content.css the manifest's css
//   reddit/hls.js      hls.js as a file of its own, injected on first video by the worker (`bb-load-hls`)
// plus background.js, popup/, icons/ and manifest.json. --dev: "Better Browsing (Dev)", the dev server's
// host + `alarms`, hot reload and live log (ext/dev-server.js).
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);   // build-lib.js reads paths relative to the repo root
const lib = require('../build-lib.js');
const { read, join, minCss, scripts, panel, hlsSource, SITES, partVersion } = lib;

const OUT = path.join(ROOT, 'dist', 'better-browsing-ext');
const args = process.argv.slice(2);
const DEV = args.includes('--dev');
const idArg = args.find(a => a.startsWith('--build-id='));
const BUILD_ID = idArg ? idArg.slice('--build-id='.length) : String(Date.now());
const KEYS = ['reddit', 'instagram', 'x', 'pinterest'];

const write = (rel, content) => {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const copy = (from, rel) => { const full = path.join(OUT, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.copyFileSync(from, full); };

// What only the extension needs per site: how the page-world file starts (a site's own skip rules), and the
// code that sits before the site's scripts. Reddit's hls.js is a separate file (the worker injects it), so
// RBE_LOAD_HLS asks the worker and resolves once globalThis.Hls exists; RBE.loadHls (video.js) already runs
// it through Promise.resolve().then(), so an async loader fits and the lightbox/viewer warm-ups stay as they are.
const EXT = {
  reddit: {
    // /media is not a page we run on (SITES.reddit.test has the same rule); the match pattern keeps the manifest in step
    exclude: ['https://*.reddit.com/media*'],
    skip: `location.pathname.startsWith('/media')`,
    skipMain: `location.pathname.startsWith('/login')`,
    extra: `const RBE_LOAD_HLS = async () => {
  if (globalThis.Hls) return;
  const r = await bbExt.send({ type: 'bb-load-hls' });
  if (!r || !r.ok || !globalThis.Hls) throw new Error('hls.js was not injected' + (r && r.error ? ': ' + r.error : ''));
};`
  },
  instagram: {}, x: { bridge: 'ext/bridge-x.js' }, pinterest: {}
};

// match pattern -> RegExp source (Chrome's rules: `*.` host also matches the bare domain, `*` in a path is anything)
function patternRe(p) {
  const m = /^(https?|\*):\/\/([^/]+)(\/.*)$/.exec(p);
  const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const host = m[2].startsWith('*.') ? `(?:[^/]+\\.)?${esc(m[2].slice(2))}` : esc(m[2]);
  return `^${m[1] === '*' ? 'https?' : m[1]}://${host}${esc(m[3]).replace(/\*/g, '.*')}$`;
}
const siteTable = () => KEYS.map(k => {
  const s = SITES[k];
  return {
    key: k, label: s.label, version: partVersion(k), patterns: s.match,
    home: s.match[0].replace('*.', 'www.').replace(/\*$/, ''),
    match: s.match.map(patternRe), exclude: [...s.exclude, ...(EXT[k].exclude || [])].map(patternRe)
  };
});

const fill = (src, site) => src
  .replace(/__BB_DEV__/g, String(DEV)).replace(/__XBB_DEV__/g, String(DEV))
  .replace(/__BB_BUILD_ID__/g, JSON.stringify(BUILD_ID))
  .replace(/__BB_SITE__/g, JSON.stringify(site || ''))
  .replace(/__BB_VERSION__/g, JSON.stringify(site ? partVersion(site) : ''))
  .replace(/__BB_NS_STR__/g, JSON.stringify(site ? SITES[site].ns : ''))
  .replace(/__BB_NS__/g, site ? SITES[site].ns : '');

function siteFiles(key) {
  const s = SITES[key], x = EXT[key];
  const [mainFiles, content, css, shadowCss] = scripts(JSON.parse(read(s.manifest)), s.srcDir);
  const p = panel(s.srcDir);
  const i = content.findIndex(f => f.endsWith('/defaults.js'));
  const shadow = shadowCss.length ? `\n${s.ns}.FAST_CSS = ${JSON.stringify(minCss(shadowCss.map(read).join('\n')))};` : '';
  const claim = `if (!bbClaim(${JSON.stringify(key)}, 'ext')) return;`;

  // page world: claim the page first (so a userscript that runs after us stands aside, and one that ran before
  // us keeps its page), then the site's hooks
  const mainJs = `(() => {
${x.skipMain ? `if (${x.skipMain}) return;\n` : ''}const r = document.documentElement;
if (!r || (r.hasAttribute('data-bb-site') && r.getAttribute('data-bb-by') !== 'ext')) return;
r.setAttribute('data-bb-site', ${JSON.stringify(key)}); r.setAttribute('data-bb-by', 'ext');
${join(mainFiles)}
})();\n`;

  const contentJs = `(() => {
${join(['userscript/store.js', 'userscript/panel.js', 'userscript/claim.js', 'ext/prelude.js'])}
${x.skip ? `if (${x.skip}) return;\n` : ''}${claim}
const PANEL_HTML = ${JSON.stringify(p.html)};
const PANEL_CSS = ${JSON.stringify(p.css)};
${x.extra || ''}
${join(content.slice(0, i + 1))}
${s.api}${shadow}
${join(['ext/bridge.js', ...(x.bridge ? [x.bridge] : [])])}
${join([...content.slice(i + 1), `${s.srcDir}/popup/popup.js`])}
${s.panelJs}
})();\n`;

  write(`${key}/main.js`, fill(mainJs, key));
  write(`${key}/content.js`, fill(contentJs, key));
  write(`${key}/content.css`, css.map(read).join('\n'));
  copy(`${s.srcDir}/icons/icon48.png`, `icons/sites/${key}.png`);
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const k of KEYS) siteFiles(k);

  // reddit/hls.js: the same UMD shim the userscript wraps it in (the local exports/module/define make it set globalThis.Hls)
  write('reddit/hls.js', `(function () { var exports, module, define;\n${hlsSource()}\n}).call(globalThis);\n`);

  const table = JSON.stringify(siteTable());
  write('background.js', fill(read('ext/background.js'), '').replace(/__BB_SITES__/g, table));
  write('popup/popup.html', read('ext/popup.html'));
  write('popup/popup.css', read('ext/popup.css'));
  write('popup/popup.js', fill(read('ext/popup.js'), '').replace(/__BB_SITES__/g, table));
  for (const n of [16, 32, 48, 128]) copy(`ext/icons/icon${n}.png`, `icons/icon${n}.png`);

  const base = JSON.parse(read('ext/manifest.base.json'));
  const content_scripts = KEYS.flatMap(k => {
    const s = SITES[k];
    const common = { matches: s.match, run_at: 'document_start' };
    const exclude = [...s.exclude, ...(EXT[k].exclude || [])];
    if (exclude.length) common.exclude_matches = exclude;
    return [
      { ...common, js: [`${k}/main.js`], world: 'MAIN' },
      { ...common, js: [`${k}/content.js`], css: [`${k}/content.css`] }
    ];
  });
  const host_permissions = [...new Set([...KEYS.flatMap(k => SITES[k].match), 'https://api.x.com/*', 'https://abs.twimg.com/*'])];
  if (DEV) host_permissions.push('http://127.0.0.1:47910/*');
  const manifest = {
    manifest_version: 3,
    name: DEV ? `${base.name} (Dev)` : base.name,
    version: base.version,
    description: base.description,
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    action: { default_title: 'Better Browsing', default_popup: 'popup/popup.html', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
    permissions: ['declarativeNetRequest', 'scripting', 'storage', 'activeTab', ...(DEV ? ['alarms'] : [])],
    host_permissions,
    // Chrome uses the service worker and ignores `scripts`; Firefox does the opposite
    background: { service_worker: 'background.js', scripts: ['background.js'] },
    content_scripts,
    browser_specific_settings: { gecko: base.gecko }
  };
  write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

  const kb = f => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
  console.log(`built dist/better-browsing-ext/ (${DEV ? 'dev' : 'prod'}, id=${BUILD_ID}) v${base.version}`);
  for (const k of KEYS) console.log(`  ${k.padEnd(10)} part ${partVersion(k).padEnd(7)} content ${String(kb(`${k}/content.js`)).padStart(4)} KB  main ${String(kb(`${k}/main.js`)).padStart(3)} KB  css ${String(kb(`${k}/content.css`)).padStart(3)} KB`);
  console.log(`  reddit/hls.js ${kb('reddit/hls.js')} KB (lazy)`);
}

if (require.main === module) build();
module.exports = { build };

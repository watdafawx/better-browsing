// Shared by build.js (userscripts) and ext/build.js (the MV3 extension): the one place that knows each site's
// source tree, manifest, match patterns and how its settings open. Paths are relative to the repo root (cwd).
const fs = require('fs');

const REPO = 'https://github.com/watdafawx/better-browsing';
const RELEASE = `${REPO}/releases/download/userscript/`;
const read = f => fs.readFileSync(f, 'utf8');
const SHARED = ['userscript/run-main.js', 'userscript/store.js', 'userscript/panel.js', 'userscript/claim.js'];
// hls.js with its source-map pointer removed (the userscript inlines it, the extension ships it as reddit/hls.js)
const hlsSource = () => read('src/vendor/hls.min.js').replace(/^\/\/# sourceMappingURL=.*$/m, '');
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
// and how its settings open (for @description). `code()` is the userscript's block for the site (siteCode).
const SITES = {
  // hls.js sits in a function that runs on first use (RBE.loadHls in video.js); the local
  // exports/module/define make its UMD wrapper set globalThis.Hls. The extension ships it as its own file instead.
  reddit: {
    label: 'Reddit', manifest: 'manifest.base.json', srcDir: 'src', cssId: 'rbe-css', ns: 'RBE',
    match: ['https://*.reddit.com/*'], exclude: ['https://old.reddit.com/*'],
    test: `/(^|\\.)reddit\\.com$/.test(host) && host !== 'old.reddit.com' && !location.pathname.startsWith('/media')`,
    about: 'Post and comment viewer, image viewer, video autoplay and sound, spoilers, NSFW and themes for new Reddit. Settings: the gear in Reddit\'s top bar.',
    api: `RBE.api = bbStore('rbe-userscript-storage', true);`,
    extra: `const RBE_LOAD_HLS = () => { if (globalThis.Hls) return; (function () { var exports, module, define;
${hlsSource()}
}).call(globalThis); };`,
    main: s => `if (!location.pathname.startsWith('/login')) ${s}`,
    panelJs: `RBE.openSettingsInPage = bbPanel({ cls: 'rbe-root rbe-us-settings', html: PANEL_HTML, css: PANEL_CSS,
  mount: (root, close) => RBE.mountSettings(root, { close }),
  onToggle: open => document.querySelector('.rbe-nav-gear')?.classList.toggle('on', open) });`
  },
  instagram: {
    label: 'Instagram', manifest: 'instagram/manifest.base.json', srcDir: 'instagram/src', cssId: 'igb-css', ns: 'IGB',
    match: ['https://www.instagram.com/*'], exclude: [],
    test: `host === 'www.instagram.com'`,
    about: 'Browser video controls, sound at your volume and a fast lightbox for Instagram. Settings: the sidebar gear or Alt+W.',
    api: `IGB.api = bbStore('igb-userscript-settings');`,
    panelJs: `IGB.openSettings = bbPanel({ cls: 'igb-root igb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => IGB.mountSettings(root) });`
  },
  x: {
    label: 'X', manifest: 'x/manifest.base.json', srcDir: 'x/src', cssId: 'xbb-css', ns: 'XBB',
    match: ['https://x.com/*'], exclude: [],
    test: `host === 'x.com'`,
    about: 'Browser video controls with one video playing at a time, sound on, one-click retweet, Like + Retweet and copy link for Discord on X. Settings: the sidebar gear or Alt+W.',
    api: `XBB.api = bbStore('xbb-userscript-settings');`,
    panelJs: `XBB.openSettings = bbPanel({ cls: 'xbb-root xbb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => XBB.mountSettings(root) });`
  },
  pinterest: {
    label: 'Pinterest', manifest: 'pinterest/manifest.base.json', srcDir: 'pinterest/src', cssId: 'pin-css', ns: 'PIN',
    match: ['https://*.pinterest.com/*'], exclude: [],
    test: `/(^|\\.)pinterest\\.com$/.test(host)`,
    about: 'Pin viewer over the grid, video sound at your volume, offscreen pause and promoted pins hidden on Pinterest. Settings: Pinterest\'s left sidebar or Alt+W.',
    api: `PIN.api = bbStore('pin-userscript-settings');`,
    panelJs: `PIN.openSettings = bbPanel({ cls: 'pin-root pin-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => PIN.mountSettings(root) });`
  },
};
for (const s of Object.values(SITES)) s.code = () => siteCode(s);
const partVersion = site => JSON.parse(read(SITES[site].manifest)).version;

module.exports = { fs, REPO, RELEASE, read, SHARED, iconOf, scripts, minCss, join, style, panel, siteCode, hlsSource, SITES, partVersion };

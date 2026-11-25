// Build unpacked MV3 extension for X Fast UI (Chrome + Firefox) -> dist/x-fast-ext/
// Usage: node x/ext/build-ext.mjs [--dev] [--build-id=<id>]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'dist', 'x-fast-ext');
const args = process.argv.slice(2);
const DEV = args.includes('--dev');
const idArg = args.find(a => a.startsWith('--build-id='));
const BUILD_ID = idArg ? idArg.slice(11) : String(Date.now());

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const write = (rel, content) => {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

function build() {
  fs.mkdirSync(OUT, { recursive: true });
  const man = JSON.parse(read('x/manifest.base.json'));
  const cs = man.content_scripts;
  const uniq = list => [...new Set(list)].map(f => `x/src/${f}`);
  const mainFiles = uniq(cs.filter(c => c.world === 'MAIN').flatMap(c => c.js));
  const contentFiles = uniq(cs.filter(c => c.world !== 'MAIN').flatMap(c => c.js));
  const cssFiles = uniq(cs.flatMap(c => c.css || []));
  const shadowCssFiles = (man.shadow_css || []).map(f => `x/src/${f}`);

  const join = files => files.map(f => `// ---- ${f} ----\n${read(f)}`).join('\n\n');

  // 1. Main-world bundle (runs natively in world: "MAIN" at document_start — zero nonce CSP hacks needed)
  write('main-world.js', `(() => {\n${join(mainFiles)}\n})();\n`);

  // 2. Content-script bundle (runs in isolated world at document_start, shares same localStorage keys)
  const iconB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'x/src/icons/icon48.png')).toString('base64');
  const popupHtml = read('x/src/popup/popup.html');
  const panelHtml = popupHtml.slice(popupHtml.indexOf('<header>'), popupHtml.indexOf('</main>') + 7).replace('../icons/icon48.png', iconB64);
  const panelCss = read('x/src/popup/popup.css').replace(/:root/g, ':host').replace(/^body \{/m, '.panel > div {');
  const fastCss = shadowCssFiles.map(f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, ' ').trim()).join('\n');

  const defaultsIdx = contentFiles.findIndex(f => f.endsWith('/defaults.js'));
  const bridgeSrc = read('x/ext/bridge.js').replace(/__XBB_DEV__/g, String(DEV));

  const contentBundle = `(() => {
'use strict';
${join(['userscript/store.js', 'userscript/panel.js', 'userscript/claim.js'])}
if (!bbClaim('x', false)) return;
const PANEL_HTML = ${JSON.stringify(panelHtml)};
const PANEL_CSS = ${JSON.stringify(panelCss)};
${join(contentFiles.slice(0, defaultsIdx + 1))}
XBB.api = bbStore('xbb-userscript-settings');
XBB.FAST_CSS = ${JSON.stringify(fastCss)};
${bridgeSrc}
${join([...contentFiles.slice(defaultsIdx + 1), 'x/src/popup/popup.js'])}
XBB.openSettings = bbPanel({ cls: 'xbb-root xbb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => XBB.mountSettings(root) });
})();\n`;
  write('content.js', contentBundle);

  // 3. Content CSS
  write('content.css', cssFiles.map(read).join('\n'));

  // 4. Background service worker
  const bgSrc = read('x/ext/background.js')
    .replace(/__XBB_DEV__/g, String(DEV))
    .replace(/__XBB_BUILD_ID__/g, JSON.stringify(BUILD_ID));
  write('background.js', bgSrc);

  // 5. Icon
  fs.copyFileSync(path.join(ROOT, 'x/src/icons/icon48.png'), path.join(OUT, 'icon48.png'));

  // 6. MV3 Manifest (Chrome + Firefox compatible)
  const hostPermissions = [
    'https://x.com/*',
    'https://api.x.com/*',
    'https://abs.twimg.com/*'
  ];
  if (DEV) hostPermissions.push('http://127.0.0.1:47910/*');

  const permissions = ['declarativeNetRequest', 'storage', 'tabs'];
  if (DEV) permissions.push('alarms');

  const manifest = {
    manifest_version: 3,
    name: DEV ? 'Better Browsing for X (Fast UI Dev)' : 'Better Browsing for X (Fast UI)',
    version: man.version,
    description: 'Zero-JS-overhead Fast UI + native video & QoL for X.com',
    icons: { '48': 'icon48.png' },
    action: { default_icon: 'icon48.png', default_title: 'Better Browsing for X Settings' },
    permissions,
    host_permissions: hostPermissions,
    background: {
      service_worker: 'background.js',
      scripts: ['background.js']
    },
    content_scripts: [
      {
        matches: ['https://x.com/*'],
        js: ['main-world.js'],
        run_at: 'document_start',
        world: 'MAIN'
      },
      {
        matches: ['https://x.com/*'],
        js: ['content.js'],
        css: ['content.css'],
        run_at: 'document_start'
      }
    ],
    browser_specific_settings: {
      gecko: {
        id: 'better-browsing-x-fast@watdafawx',
        strict_min_version: '128.0'
      }
    }
  };
  write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

  const kb = f => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
  console.log(`built dist/x-fast-ext/ (${DEV ? 'dev' : 'prod'} id=${BUILD_ID}) content=${kb('content.js')}KB main=${kb('main-world.js')}KB`);
}

if (require.main === module) build();
module.exports = { build };

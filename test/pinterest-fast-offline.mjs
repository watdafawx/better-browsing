// Offline test: Pinterest Fast UI (Milestone 1) against its own userscript. Answers every pinterest.com / pinimg.com
// request from fixtures (a fake Pinterest app that asks for its own homefeed, a fake resource backend), so it never
// touches the site. Run: node test/pinterest-fast-offline.mjs  (BROWSER=firefox for Firefox)
//   - masonry: the pure layout against a brute-force reference, in Node
//   - fastUi off: nothing mounts, no request of ours
//   - fastUi on: mounts, hides Pinterest's page, Home from the tapped UserHomefeedResource (0 requests of ours),
//     promoted pins and modules dropped, pagination with the learned template and headers, the SSR path
//   - 500 pins: at most 50 cards in the DOM while scrolling; a resize reflows the columns and keeps the anchor card
//   - viewer: full viewport (48px bar, full-height stage, collapsible 360px panel with Info & Comments / More like this
//     tabs), thumb -> 1200x -> original on zoom, zoom to the pointer + drag to pan (clamped, no scrollbars), the wheel
//     steps pins at 1x, idea pages, V_720P video, comments, related, prev/next,
//     Esc and Back to the exact pixel, Pinterest's router never sees our popstates
//   - escape hatches (Alt+Shift+P, Native button, the sidebar entry, ?pin=native) and the breaker fallback
import { chromium, firefox } from 'playwright';
import path from 'path'; import fs from 'fs'; import vm from 'vm';

const usFile = path.resolve(process.env.US_FILE || 'dist/better-browsing-pinterest.user.js');
if (!fs.existsSync(usFile)) { console.log('FAIL userscript built: ' + usFile + ' missing (npm run build)'); process.exit(1); }
const FF = process.env.BROWSER === 'firefox', bt = FF ? firefox : chromium;
const checks = {};
const r = {};
const logs = [];

// ---------- masonry, in Node ----------
{
  const sb = { globalThis: {} };
  sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync('pinterest/src/content/fast/masonry.js', 'utf8'), sb);
  const masonry = sb.masonry;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const items = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), w: 474, h: Math.round(474 * (0.5 + rnd() * 1.8)), t: rnd() < 0.8 }));
  const footer = it => (it.t ? 44 : 0);
  const m = masonry({ gap: 16, minCol: 180, footer });
  const res = m.setWidth(1160);
  m.append(items.slice(0, 700)); m.append(items.slice(700));
  // brute force reference
  const cols = res.cols, colW = res.colW, bottoms = new Array(cols).fill(0), ref = [];
  for (const it of items) {
    let c = 0; for (let k = 1; k < cols; k++) if (bottoms[k] < bottoms[c]) c = k;
    const hh = Math.round(colW * Math.min(3, Math.max(1 / 3, it.h / it.w))) + footer(it);
    ref.push({ x: c * (colW + 16), y: bottoms[c], h: hh }); bottoms[c] += hh + 16;
  }
  let same = true;
  for (let i = 0; i < items.length; i++) { const a = m.rect(i), b = ref[i]; if (a.x !== b.x || a.y !== b.y || a.h !== b.h) { same = false; break; } }
  let visOk = true;
  for (const top of [0, 5000, 23456, m.height() - 300]) {
    const v = m.visible(top, top + 900);
    const bf = []; for (let i = 0; i < items.length; i++) { const b = ref[i]; if (b.y + b.h >= top && b.y <= top + 900) bf.push(i); }
    if (v.join() !== bf.join()) visOk = false;
  }
  const colsAt = w => { const mm = masonry({ gap: 16, minCol: 180 }); return mm.setWidth(w).cols; };
  const a = m.anchor(23456);
  const r2 = m.setWidth(800);
  checks['masonry: shortest-column layout equals a brute-force reference (2,000 pins, two appends)'] = same && res.cols === 6;
  checks['masonry: visible() equals a brute-force intersection'] = visOk;
  checks['masonry: 2 to 6 columns, minColWidth 180'] = colsAt(300) === 2 && colsAt(560) === 2 && colsAt(588) === 3 && colsAt(4000) === 6 && colsAt(1160) === 6;
  checks['masonry: a width change relayouts and anchor() finds the card under a line'] = r2.changed && r2.cols === 4 && a.i >= 0 && ref[a.i].y <= 23456 + 1 && ref[a.i].y + ref[a.i].h >= 23456;
}

// ---------- fixtures ----------
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const clip = fs.readFileSync('test/fixtures/clip.webm');
const RATIOS = [1.5, 1.25, 1.78, 1, 1.33, 0.75, 2, 1.4];
const pin = n => {
  const id = String(1000000 + n), hh = Math.round(474 * RATIOS[n % RATIOS.length]);
  const p = {
    type: 'pin', id, title: 'Pin ' + n, description: 'About pin ' + n, dominant_color: '#a0a0a0', link: 'https://example.com/p' + n,
    images: {
      '236x': { url: `https://i.pinimg.com/236x/${id}.jpg`, width: 236, height: Math.round(hh / 2) },
      '474x': { url: `https://i.pinimg.com/474x/${id}.jpg`, width: 474, height: hh },
      '1200x': { url: `https://i.pinimg.com/1200x/${id}.jpg`, width: 1200, height: Math.round(hh * 1200 / 474) },
      orig: { url: `https://i.pinimg.com/originals/${id}.jpg`, width: 2400, height: Math.round(hh * 2400 / 474) }
    },
    pinner: { id: 'u' + n, username: 'user' + n, full_name: 'User ' + n },
    aggregated_pin_data: { id: 'AGG' + n, aggregated_stats: { saves: n * 10 } }, comment_count: n % 3
  };
  if (n === 1) p.videos = { video_list: { V_720P: { url: 'https://v1.pinimg.com/videos/mc/720p/v1.mp4', width: 720, height: 1280, duration: 15000, thumbnail: `https://i.pinimg.com/videos/thumbnails/v1.jpg` }, V_HLSV4: { url: 'https://v1.pinimg.com/videos/iht/hls/v1.m3u8' } } };
  if (n === 2) p.story_pin_data = { page_count: 3, pages: [1, 2, 3].map(k => ({ blocks: [], image: { images: {
    '474x': { url: `https://i.pinimg.com/474x/st${k}.jpg`, width: 474, height: 842 }, '1200x': { url: `https://i.pinimg.com/1200x/st${k}.jpg`, width: 1200, height: 2133 },
    orig: { url: `https://i.pinimg.com/originals/st${k}.jpg`, width: 1080, height: 1920 } } } })) };
  return p;
};
const promoted = n => Object.assign(pin(n), { id: String(9000000 + n), is_promoted: true, promoter: { username: 'brand' } });
const module = { type: 'story', id: 'mod1', story_type: 'shopping_carousel', objects: [] };
const env = (data, bookmark) => JSON.stringify({ resource_response: { status: 'success', code: 0, message: 'ok', data, bookmark }, resource: { name: 'X', options: {} } });

let mode = 'normal';            // normal | big | drift | signedout | ssr
const ours = {}, oursHeaders = [], appCalls = {};
const homePage = bm => {
  if (mode === 'big') return { data: Array.from({ length: 500 }, (_, i) => pin(i)), bookmark: '-end-' };
  if (!bm) return { data: [...Array.from({ length: 30 }, (_, i) => pin(i)), promoted(1), module, promoted(2), ...Array.from({ length: 30 }, (_, i) => pin(30 + i))], bookmark: 'bm1' };
  if (bm === 'bm1') return { data: Array.from({ length: 30 }, (_, i) => pin(60 + i)), bookmark: 'bm2' };
  return { data: Array.from({ length: 10 }, (_, i) => pin(90 + i)), bookmark: '-end-' };
};

const app = `(() => {
  window.__appPop = 0;
  addEventListener('popstate', () => { window.__appPop++; });
  const opts = { field_set_key: 'hf_grid', in_nux: false, in_news_hub: false, static_feed: false, live_option: 'yes' };
  const q = 'source_url=' + encodeURIComponent('/') + '&data=' + encodeURIComponent(JSON.stringify({ options: opts, context: {} })) + '&_=' + Date.now();
  fetch('/resource/UserHomefeedResource/get/?' + q, { headers: { 'x-pinterest-pws-handler': 'www/index.js', 'x-pinterest-source-url': '/', 'X-APP-VERSION': 'abc123', 'x-fake-app': '1' } })
    .then(r => r.json()).then(j => { const d = document.createElement('div'); d.id = 'app-grid'; d.textContent = 'native grid ' + ((j.resource_response && j.resource_response.data) || []).length; document.getElementById('app').append(d); })
    .catch(() => {});
})();`;
const ssr = () => `<script id="__PWS_INITIAL_PROPS__" type="application/json">${JSON.stringify({ initialReduxState: { resources: { UserHomefeedResource: { 'key1': { data: homePage('').data, nextBookmark: 'bm1' } } } } }).replace(/</g, '\\u003c')}</script>`;
const html = () => `<!doctype html><html><head><title>Pinterest fixture</title></head><body>
<div id="app" style="min-height:400px"><header>native header</header>
<div class="navcol" style="display:flex;flex-direction:column;gap:24px;width:80px">
  <div data-test-id="vertical-nav-icon"><div><div aria-label="Home"><a href="/" aria-label="Home"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg><span>Home</span></a></div></div></div>
  <div data-test-id="vertical-nav-icon"><div><div aria-label="Explore"><a href="/ideas/" aria-label="Explore"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg><span>Explore</span></a></div></div></div>
</div></div>
${mode === 'ssr' ? ssr() : '<script src="https://s.pinimg.com/webapp/app-fake.js"></script>'}
</body></html>`;

async function route(rt) {
  const req = rt.request(), u = new URL(req.url());
  if (u.hostname === 's.pinimg.com') return rt.fulfill({ status: 200, contentType: 'application/javascript', body: app });
  if (u.pathname.startsWith('/resource/')) {
    const name = u.pathname.replace(/^\/resource\/|\/$/g, '');
    const hdr = req.headers();
    const fromApp = hdr['x-fake-app'] === '1';
    if (fromApp) appCalls[name] = (appCalls[name] || 0) + 1;
    else { ours[name] = (ours[name] || 0) + 1; oursHeaders.push({ name, handler: hdr['x-pinterest-pws-handler'] || '', ver: hdr['x-app-version'] || '', src: hdr['x-pinterest-source-url'] || '', data: u.searchParams.get('data') || '' }); }
    let options = {};
    try { options = JSON.parse(u.searchParams.get('data') || '{}').options || {}; } catch {}
    if (name === 'UserHomefeedResource/get') {
      if (mode === 'signedout' && !fromApp) return rt.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ resource_response: { status: 'failure', message: 'Unauthorized' } }) });
      if (mode === 'drift' && !fromApp) return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resource_response: { status: 'failure', message: 'Invalid Request', data: null } }) });
      if ((mode === 'drift' || mode === 'signedout') && fromApp) return rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      const pg = homePage((options.bookmarks || [])[0]);
      return rt.fulfill({ status: 200, contentType: 'application/json', body: env(pg.data, pg.bookmark) });
    }
    if (name === 'PinResource/get') {
      const n = (+options.id || 0) - 1000000;
      const p = pin(n);
      p.description = 'Full description of pin ' + n;
      return rt.fulfill({ status: 200, contentType: 'application/json', body: env(p) });
    }
    if (name === 'UnifiedCommentsResource/get') {
      if (options.aggregated_pin_id === 'AGG4') return rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: env([{ text: 'comment on ' + options.aggregated_pin_id, user: { username: 'cmtr', full_name: 'Commenter' } }, { text: 'second one', user: { username: 'zed' } }]) });
    }
    if (name === 'RelatedModulesResource/get') {
      const base = (+options.pin_id || 0) - 1000000;
      return rt.fulfill({ status: 200, contentType: 'application/json', body: env([module, ...Array.from({ length: 8 }, (_, i) => pin(500 + base * 10 + i)), promoted(77)]) });
    }
    return rt.fulfill({ status: 200, contentType: 'application/json', body: env(null) });
  }
  if (/\.(mp4)$/i.test(u.pathname)) return rt.fulfill({ status: 200, contentType: 'video/webm', body: clip });
  if (/\.(m3u8)$/i.test(u.pathname)) return rt.fulfill({ status: 404, body: '' });
  if (/\.(jpg|jpeg|png|webp)$/i.test(u.pathname)) return rt.fulfill({ status: 200, contentType: 'image/png', body: png });
  return rt.fulfill({ status: 200, contentType: 'text/html', body: html() });
}

const browser = await bt.launch(FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0 } } : { args: ['--autoplay-policy=no-user-gesture-required'] });
async function newCtx(settings, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.route(/pinterest\.com|pinimg\.com/, route);
  if (settings) {
    await ctx.addInitScript(s => {
      try {
        if (!localStorage.getItem('pin-test-seeded')) {
          localStorage.setItem('pin-userscript-settings', JSON.stringify({ settings: s }));
          localStorage.setItem('pin-settings-snapshot', JSON.stringify(s));
          localStorage.setItem('pin-test-seeded', '1');
        }
      } catch {}
    }, settings);
  }
  await ctx.addInitScript({ path: usFile });
  return ctx;
}
const watch = (page, tag) => {
  page.on('pageerror', e => logs.push(`[${tag} pageerror] ` + e.message));
  page.on('dialog', d => { logs.push(`[${tag} DIALOG!] ` + d.message()); d.dismiss(); });
  page.on('console', m => { if (m.type() === 'error' && /\[PIN|Uncaught/.test(m.text())) logs.push(`[${tag} error] ` + m.text().slice(0, 200)); });
};
const reset = () => { for (const k of Object.keys(ours)) delete ours[k]; for (const k of Object.keys(appCalls)) delete appCalls[k]; oursHeaders.length = 0; };
const shadow = (page, fn, arg) => page.evaluate(([src, a]) => { const root = document.querySelector('pin-fast')?.shadowRoot; return (0, eval)('(' + src + ')')(root, a); }, [fn.toString(), arg]);
const wait = ms => new Promise(res => setTimeout(res, ms));
async function until(page, fn, arg, ms = 4000) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < ms) { v = await shadow(page, fn, arg).catch(() => null); if (v) return v; await wait(60); }
  return v;
}
const FAST = { fastUi: true, fastUiTheme: 'black', videoMode: 'volume', videoVolume: 40 };

// ---------- 1. fastUi off ----------
{
  mode = 'normal'; reset();
  const ctx = await newCtx(null);
  const page = await ctx.newPage(); watch(page, 'off');
  await page.goto('https://www.pinterest.com/');
  await page.waitForTimeout(1500);
  r.off = await page.evaluate(() => ({ host: !!document.querySelector('pin-fast'), attr: document.documentElement.getAttribute('data-pin-fast'), tap: document.documentElement.hasAttribute('data-pin-api-tap'), app: !!document.getElementById('app-grid'), appVisible: getComputedStyle(document.getElementById('app')).display !== 'none' }));
  r.off.ours = Object.values(ours).reduce((a, b) => a + b, 0);
  checks['fastUi off: Fast UI never mounts, the tap stays off and none of our requests go out'] = !r.off.host && r.off.attr === null && !r.off.tap && r.off.app && r.off.appVisible && r.off.ours === 0;
  await ctx.close();
}

// ---------- 2. fastUi on: Home, promoted, pagination, the viewer, escape hatches ----------
{
  mode = 'normal'; reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, 'home');
  await page.goto('https://www.pinterest.com/');
  await until(page, root => root && root.querySelectorAll('.card').length > 10);
  await page.waitForTimeout(400);
  r.home = await page.evaluate(() => {
    const host = document.querySelector('pin-fast'), root = host && host.shadowRoot, st = PIN.fast.router.home().state();
    const ops = JSON.parse(localStorage.getItem('pin-ops-v1') || 'null');
    const ids = PIN.fast.router.home().ids();
    return {
      attr: document.documentElement.getAttribute('data-pin-fast'), hostShown: getComputedStyle(host).display !== 'none',
      appHidden: getComputedStyle(document.getElementById('app')).display === 'none', theme: host.getAttribute('data-theme'),
      adopted: (root.adoptedStyleSheets || []).length, cards: root.querySelectorAll('.card').length, st,
      promotedIn: ids.some(id => id.startsWith('9')), modIn: ids.includes('mod1'),
      learned: ops && ops.ops && ops.ops['UserHomefeedResource/get'], appVersion: ops && ops.appVersion,
      transform: root.querySelector('.card').style.transform, contain: getComputedStyle(root.querySelector('.card')).contain,
      badgeVideo: root.querySelector('.card[data-id="1000001"] .badge.show')?.textContent || '', badgeStory: root.querySelector('.card[data-id="1000002"] .badge.show')?.textContent || ''
    };
  });
  r.home.oursAtBoot = ours['UserHomefeedResource/get'] || 0;
  checks['fastUi on: <pin-fast> mounts, Pinterest\'s page is hidden, Lights Out theme'] = r.home.attr === 'home' && r.home.hostShown && r.home.appHidden && r.home.theme === 'black';
  checks['Home renders from Pinterest\'s own tapped UserHomefeedResource (0 requests of ours at boot)'] = r.home.st.count === 60 && r.home.st.source === 'tap' && r.home.oursAtBoot === 0 && appCalls['UserHomefeedResource/get'] === 1;
  checks['promoted pins and modules are dropped from the grid'] = r.home.st.promoted === 2 && r.home.st.dropped >= 1 && !r.home.promotedIn && !r.home.modIn;
  checks['the tap learns the template, handler and app version (pin-ops-v1)'] = r.home.learned?.handler === 'www/index.js' && r.home.learned?.options?.live_option === 'yes' && r.home.appVersion === 'abc123';
  checks['cards: translate3d, contained, video and idea badges'] = /translate3d/.test(r.home.transform) && /paint|content|strict/.test(r.home.contain) && r.home.badgeVideo === '0:15' && r.home.badgeStory === '3';

  // pagination
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(140); }
  await page.waitForTimeout(500);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(140); }
  await page.waitForTimeout(600);
  r.pages = await page.evaluate(() => PIN.fast.router.home().state());
  const next = oursHeaders.filter(h => h.name === 'UserHomefeedResource/get');
  r.pageReq = next.map(h => ({ handler: h.handler, ver: h.ver, src: h.src, opts: JSON.parse(h.data).options }));
  checks['pagination: bookmarks until -end-, with the learned options and Pinterest\'s headers'] = r.pages.count === 100 && r.pages.ended && next.length === 2
    && r.pageReq.every(q => q.handler === 'www/index.js' && q.ver === 'abc123' && q.src === '/' && q.opts.live_option === 'yes') && r.pageReq[0].opts.bookmarks[0] === 'bm1' && r.pageReq[1].opts.bookmarks[0] === 'bm2';

  // theme switch
  await page.locator('pin-fast [data-theme-pick="dim"]').click();
  await page.waitForTimeout(200);
  r.theme = await page.evaluate(() => ({ host: document.querySelector('pin-fast').getAttribute('data-theme'), saved: JSON.parse(localStorage.getItem('pin-userscript-settings')).settings.fastUiTheme, pressed: document.querySelector('pin-fast').shadowRoot.querySelector('[data-theme-pick="dim"]').getAttribute('aria-pressed') }));
  checks['the theme switcher applies and saves Dim'] = r.theme.host === 'dim' && r.theme.saved === 'dim' && r.theme.pressed === 'true';

  // ---- viewer ----
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.evaluate(() => scrollTo(0, 333));
  await page.waitForTimeout(250);
  const y0 = await page.evaluate(() => scrollY);
  // a click in place (a locator click would scroll the card into view first)
  await shadow(page, root => root.querySelector('.card[data-id="1000003"] a.media').click());
  r.lb1 = await until(page, root => { const d = root.querySelector('dialog.lb'); const img = d && d.querySelector('.st-box img'); return d && d.open && img && /\/1200x\//.test(img.getAttribute('src')) ? { open: d.open, src: img.getAttribute('src'), url: location.pathname, modal: d.matches(':modal'), title: d.querySelector('.side h2')?.textContent } : null; });
  r.lb1side = await until(page, root => { const t = root.querySelector('dialog.lb .side')?.textContent || ''; return /Full description of pin 3/.test(t) && /comment on AGG3/.test(t) ? t : null; });
  r.lb1rel = await until(page, root => { const n = root.querySelectorAll('dialog.lb .rgrid .card').length; return n ? n : null; });
  checks['a card opens the viewer: modal dialog, /pin/<id>/, thumb then 1200x'] = r.lb1?.open && r.lb1.modal && r.lb1.url === '/pin/1000003/' && /1200x\/1000003\.jpg$/.test(r.lb1.src) && r.lb1.title === 'Pin 3';
  checks['the side panel merges PinResource and shows the comments'] = !!r.lb1side;
  checks['related pins: "More like this" with promoted and modules dropped'] = r.lb1rel === 8;
  // zoom
  await page.locator('pin-fast dialog.lb .st-box').click();
  r.zoom = await until(page, root => { const img = root.querySelector('dialog.lb .st-box img'); return img && /\/originals\//.test(img.getAttribute('src')) ? { src: img.getAttribute('src'), zoomed: root.querySelector('.st-box').classList.contains('zoomed') } : null; });
  checks['zoom swaps 1200x for the original'] = r.zoom?.zoomed && /originals\/1000003\.jpg$/.test(r.zoom.src);
  // the whole viewport: a 48px bar, the stage gets all the height left, a 360px panel holds "More like this"
  r.vp = await shadow(page, root => {
    const d = root.querySelector('dialog.lb'), b = d.getBoundingClientRect(), st = d.querySelector('.stage').getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight, head: d.querySelector('.lb-head').getBoundingClientRect().height,
      stageW: st.width, stageH: st.height, side: d.querySelector('.side').getBoundingClientRect().width, radius: getComputedStyle(d).borderRadius,
      relInSide: !!d.querySelector('.side .prel .rgrid'), relBelow: !!d.querySelector(':scope > .related'), stx: st.left + st.width / 2, sty: st.top + st.height / 2, sl: st.left, sideX: d.querySelector('.side').getBoundingClientRect().left };
  });
  checks['the viewer fills the viewport: 48px bar, a full-height stage, the 360px panel holds "More like this"'] = r.vp.x === 0 && r.vp.y === 0 && r.vp.w === r.vp.vw && r.vp.h === r.vp.vh
    && r.vp.head === 48 && r.vp.stageH === r.vp.vh - 48 && r.vp.side === 360 && Math.abs(r.vp.stageW + 360 - r.vp.vw) <= 1 && r.vp.radius === '0px' && r.vp.relInSide && !r.vp.relBelow;
  // zoom toward the pointer, drag to pan (clamped), never a scrollbar
  const cx = r.vp.stx, cy = r.vp.sty;
  const zst = () => page.evaluate(() => PIN.fast.viewer.zoom());
  const lim = z => ({ mx: Math.max(0, (z.w * z.s - r.vp.stageW) / 2), my: Math.max(0, (z.h * z.s - r.vp.stageH) / 2) });
  r.z1 = await zst();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy + 40, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(80);
  r.z2 = await zst();
  // far past the picture's edge, inside the viewport (Firefox reports junk coordinates outside it)
  await page.mouse.move(r.vp.sl + 100, 70); await page.mouse.down(); await page.mouse.move(r.vp.sl + r.vp.stageW - 10, r.vp.vh - 10, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(80);
  r.z3 = await zst();
  r.zScroll = await shadow(page, root => { const b = root.querySelector('dialog.lb .st-box'), st = root.querySelector('dialog.lb .stage'), img = b.querySelector('img');
    return { ov: getComputedStyle(b).overflow + '/' + getComputedStyle(st).overflow, pos: b.scrollLeft + b.scrollTop + st.scrollLeft + st.scrollTop, tf: img.style.transform, zoomed: b.classList.contains('zoomed') }; });
  const l3 = lim(r.z3);
  checks['a click zooms 2.2x at the pointer; a drag pans without toggling, clamped to the picture, no scrollbars'] = Math.abs(r.z1.s - 2.2) < 0.01 && Math.abs(r.z1.tx) < 1 && Math.abs(r.z1.ty) < 1
    && Math.abs(r.z2.tx - Math.min(60, lim(r.z2).mx)) < 1 && Math.abs(r.z2.ty - Math.min(40, lim(r.z2).my)) < 1 && r.z2.s === r.z1.s
    && Math.abs(r.z3.tx - l3.mx) < 1 && Math.abs(r.z3.ty - l3.my) < 1 && r.zScroll.ov === 'hidden/hidden' && r.zScroll.pos === 0 && /translate3d\(.*scale\(2\.2/.test(r.zScroll.tf) && r.zScroll.zoomed;
  // a double click fits again; Ctrl+wheel zooms toward the pointer; + / - / 0
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(120);
  r.z4 = await zst();
  await shadow(page, (root, a) => root.querySelector('dialog.lb .stage').dispatchEvent(new WheelEvent('wheel', { deltaY: -150, ctrlKey: true, clientX: a.x + 150, clientY: a.y, bubbles: true, cancelable: true, composed: true })), { x: cx, y: cy });
  r.z5 = await zst();
  await page.keyboard.press('0'); r.z6 = await zst();
  await page.keyboard.press('+'); r.z7 = await zst();
  await page.keyboard.press('-'); r.z8 = await zst();
  const k5 = r.z5.s;
  checks['double click fits; Ctrl+wheel zooms toward the pointer; + / - / 0'] = r.z4.s === 1 && r.z4.tx === 0 && k5 > 1.5 && k5 <= 4
    && Math.abs(r.z5.tx - Math.max(-lim(r.z5).mx, 150 * (1 - k5))) < 1 && Math.abs(r.z5.ty) < 1 && r.z6.s === 1 && Math.abs(r.z7.s - 1.4) < 0.01 && r.z8.s === 1;
  // the wheel over the stage steps at 1x (jitter ignored), pans when zoomed, and the panel scrolls on its own
  await page.mouse.move(r.vp.sl + 120, cy);
  await page.mouse.wheel(0, 4);
  await page.waitForTimeout(200);
  r.w0 = await page.evaluate(() => location.pathname);
  await page.mouse.wheel(0, 120);
  r.w1 = await until(page, () => location.pathname === '/pin/1000004/' ? location.pathname : null, null, 2000);
  await page.waitForTimeout(220);
  await page.mouse.wheel(0, -120);
  r.w2 = await until(page, () => location.pathname === '/pin/1000003/' ? location.pathname : null, null, 2000);
  await page.waitForTimeout(220);
  await page.mouse.move(r.vp.sideX + 150, cy);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(220);
  r.w3 = await page.evaluate(() => ({ url: location.pathname, y: scrollY }));
  await page.keyboard.press('z');
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(220);
  r.w4 = Object.assign(await zst(), { url: await page.evaluate(() => location.pathname) });
  checks['the wheel over the stage steps next / previous at 1x, never on jitter or over the panel, and pans when zoomed'] = r.w0 === '/pin/1000003/' && r.w1 === '/pin/1000004/' && r.w2 === '/pin/1000003/'
    && r.w3.url === '/pin/1000003/' && r.w3.y === y0 && r.w4.url === '/pin/1000003/' && r.w4.s > 1 && Math.abs(r.w4.ty - Math.max(-lim(r.w4).my, -120)) < 1;
  // prev/next
  await page.keyboard.press('ArrowRight');
  r.next = await until(page, root => { const img = root.querySelector('dialog.lb .st-box img'); return location.pathname === '/pin/1000004/' && img && /1000004/.test(img.getAttribute('src')) ? { url: location.pathname, len: history.length } : null; });
  r.cmErr = await until(page, root => root.querySelector('dialog.lb [data-cm-err]') ? 'err' : null);
  r.nextZoom = await page.evaluate(() => PIN.fast.viewer.zoom().s);
  checks['ArrowRight steps to the next pin of the grid (replacing the entry), back at 1x'] = r.next?.url === '/pin/1000004/' && r.nextZoom === 1;
  // the panel: the top bar button and `i` collapse and open it; "More like this" is its second tab
  await page.locator('pin-fast dialog.lb [data-lb-act="side"]').click();
  r.sideOff = await shadow(page, root => { const d = root.querySelector('dialog.lb'); return { off: d.classList.contains('side-off'), shown: getComputedStyle(d.querySelector('.side')).display !== 'none', stageW: d.querySelector('.stage').getBoundingClientRect().width, pressed: d.querySelector('[data-lb-act="side"]').getAttribute('aria-pressed'), saved: localStorage.getItem('pin-fast-lb-side') }; });
  await page.keyboard.press('i');
  r.sideOn = await shadow(page, root => { const d = root.querySelector('dialog.lb'); return { off: d.classList.contains('side-off'), stageW: d.querySelector('.stage').getBoundingClientRect().width, saved: localStorage.getItem('pin-fast-lb-side') }; });
  await page.locator('pin-fast dialog.lb [data-lb-tab="rel"]').click();
  r.tabRel = await until(page, root => { const d = root.querySelector('dialog.lb'), rel = d.querySelector('.prel'), card = rel.querySelector('.card a.media');
    return !rel.hidden && card && card.getBoundingClientRect().width > 0 && d.querySelector('[data-count-rel]').textContent ? { info: d.querySelector('.pinfo').hidden, count: d.querySelector('[data-count-rel]').textContent, sel: d.querySelector('[data-lb-tab="rel"]').getAttribute('aria-selected'), cardX: card.getBoundingClientRect().left, sideX: d.querySelector('.side').getBoundingClientRect().left, ov: getComputedStyle(rel).overflowY } : null; });
  checks['the panel collapses (button) for an edge-to-edge stage and comes back with i; remembered'] = r.sideOff.off && !r.sideOff.shown && r.sideOff.stageW === r.vp.vw && r.sideOff.pressed === 'false' && r.sideOff.saved === '0'
    && !r.sideOn.off && Math.abs(r.sideOn.stageW + 360 - r.vp.vw) <= 1 && r.sideOn.saved === '1';
  checks['"More like this" is a panel tab with a count badge, scrolling on its own'] = !!r.tabRel && r.tabRel.info && r.tabRel.count === '8' && r.tabRel.sel === 'true' && r.tabRel.cardX >= r.tabRel.sideX && r.tabRel.ov === 'auto';
  checks['a comments failure is an inline note, Home stays ours'] = r.cmErr === 'err' && (await page.evaluate(() => document.documentElement.getAttribute('data-pin-fast'))) === 'home';
  // a related pin: one more level, Back returns
  await page.locator('pin-fast dialog.lb .rgrid .card a.media').first().click();
  r.rel = await until(page, root => /^\/pin\/100054\d\/$/.test(location.pathname) && !root.querySelector('[data-lb-act="back"]').hidden ? location.pathname : null);
  await page.goBack();
  r.relBack = await until(page, root => location.pathname === '/pin/1000004/' && root.querySelector('dialog.lb').open ? location.pathname : null);
  checks['a related pin opens one level deeper; Back returns to the pin before'] = !!r.rel && r.relBack === '/pin/1000004/';
  // Esc: closed, exact pixel
  await page.keyboard.press('Escape');
  r.esc = await until(page, root => !root.querySelector('dialog.lb').open && location.pathname === '/' ? { y: scrollY, pop: window.__appPop } : null);
  await page.waitForTimeout(250);
  r.escY = await page.evaluate(() => scrollY);
  checks['Esc closes the viewer back to / on the exact scroll pixel'] = r.esc && r.escY === y0 && y0 === 333;
  // idea pin pages
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.locator('pin-fast .card[data-id="1000002"] a.media').click();
  r.st1 = await until(page, root => { const n = root.querySelector('dialog.lb [data-pgno]'); const img = root.querySelector('dialog.lb .st-box img'); return n && img ? { n: n.textContent, src: img.getAttribute('src') } : null; });
  await page.keyboard.press('ArrowRight');
  r.st2 = await until(page, root => { const n = root.querySelector('dialog.lb [data-pgno]'); return n && n.textContent === '2 / 3' ? { n: n.textContent, src: root.querySelector('dialog.lb .st-box img').getAttribute('src'), url: location.pathname } : null; });
  checks['an idea pin steps through its pages before the next pin'] = r.st1?.n === '1 / 3' && /st1\.jpg$/.test(r.st1.src) && r.st2?.n === '2 / 3' && /st2\.jpg$/.test(r.st2.src) && r.st2.url === '/pin/1000002/';
  // video: ArrowLeft x2 (page 1, then pin 1)
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
  await page.keyboard.press('ArrowLeft');
  r.video = await until(page, root => { const v = root.querySelector('dialog.lb video'); return v && location.pathname === '/pin/1000001/' ? { src: v.getAttribute('src') || v.src, own: v.dataset.pinOwn, vol: v.volume, muted: v.muted, controls: v.controls } : null; });
  await page.waitForTimeout(700);
  r.videoPlay = await shadow(page, root => { const v = root.querySelector('dialog.lb video'); return v ? { paused: v.paused, rs: v.readyState } : null; });
  checks['a video pin plays V_720P in our own player with the sound settings'] = /720p\/v1\.mp4$/.test(r.video?.src || '') && r.video.own === '1' && Math.abs(r.video.vol - 0.4) < 0.01 && r.video.muted === false && r.video.controls === true;
  // Back (browser): closed, exact pixel
  await page.goBack();
  r.back = await until(page, root => !root.querySelector('dialog.lb').open && location.pathname === '/' ? { y: scrollY, pop: window.__appPop, v: !!root.querySelector('dialog.lb video') } : null);
  checks['browser Back closes the viewer on the exact pixel; the video is gone'] = r.back && r.back.y === 0 && !r.back.v;
  checks['Pinterest\'s router never saw a popstate of ours'] = r.back && r.back.pop === 0 && r.esc && r.esc.pop === 0;

  // ---- escape hatches ----
  await page.keyboard.press('Alt+Shift+KeyP');
  await page.waitForTimeout(250);
  r.esc1 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-pin-fast'), host: getComputedStyle(document.querySelector('pin-fast')).display, app: getComputedStyle(document.getElementById('app')).display, entry: !!document.querySelector('.pin-fast-entry') }));
  await page.keyboard.press('Alt+Shift+KeyP');
  await page.waitForTimeout(250);
  r.esc2 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-pin-fast'), cards: document.querySelector('pin-fast').shadowRoot.querySelectorAll('.card').length, count: PIN.fast.router.home().state().count }));
  checks['Alt+Shift+P: Pinterest\'s page and back, the grid kept'] = r.esc1.attr === 'native' && r.esc1.host === 'none' && r.esc1.app !== 'none' && r.esc1.entry && r.esc2.attr === 'home' && r.esc2.cards > 0 && r.esc2.count === 100;
  await page.locator('pin-fast [data-pin-to-native]').click();
  await page.waitForTimeout(250);
  r.nat = await page.evaluate(() => document.documentElement.getAttribute('data-pin-fast'));
  await page.locator('.pin-fast-entry a').click();
  await page.waitForTimeout(250);
  r.entry = await page.evaluate(() => document.documentElement.getAttribute('data-pin-fast'));
  checks['the Native Pinterest button escapes, the sidebar "Fast UI" entry comes back'] = r.nat === 'native' && r.entry === 'home';

  // ?pin=native
  const p2 = await ctx.newPage(); watch(p2, 'native');
  await p2.goto('https://www.pinterest.com/?pin=native');
  await p2.waitForTimeout(900);
  r.qnative = await p2.evaluate(() => ({ attr: document.documentElement.getAttribute('data-pin-fast'), host: document.querySelector('pin-fast') ? getComputedStyle(document.querySelector('pin-fast')).display : 'absent', app: getComputedStyle(document.getElementById('app')).display }));
  checks['?pin=native starts on Pinterest\'s own page'] = r.qnative.attr === 'native' && (r.qnative.host === 'none' || r.qnative.host === 'absent') && r.qnative.app !== 'none';
  await ctx.close();
}

// ---------- 3. 500 pins: the DOM cap, resize with the anchor ----------
{
  mode = 'big'; reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, 'big');
  await page.goto('https://www.pinterest.com/');
  await until(page, root => root && root.querySelectorAll('.card').length > 10 ? true : null);
  await page.waitForTimeout(300);
  let max = 0, min = 1e9;
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(40);
    const n = await shadow(page, root => root.querySelectorAll('.card').length);
    max = Math.max(max, n); min = Math.min(min, n);
  }
  await page.evaluate(() => scrollTo(0, 25000));
  await page.waitForTimeout(250);
  const n2 = await shadow(page, root => root.querySelectorAll('.card').length);
  max = Math.max(max, n2); min = Math.min(min, n2);
  r.big = { max, min, count: (await page.evaluate(() => PIN.fast.router.home().state())).count, ours: ours['UserHomefeedResource/get'] || 0 };
  checks['500 pins: at most 50 cards in the DOM while scrolling (never empty)'] = r.big.count === 500 && r.big.max <= 50 && r.big.min > 0;
  // resize
  await page.evaluate(() => scrollTo(0, 12000));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const home = PIN.fast.router.home(), m = home.grid.masonry, root = document.querySelector('pin-fast').shadowRoot;
    const grid = root.querySelector('.grid'), top = grid.getBoundingClientRect().top + scrollY;
    const a = m.anchor(scrollY - top);
    const id = home.ids()[a.i], node = root.querySelector(`.card[data-id="${id}"]`);
    return { id, top: node.getBoundingClientRect().top, cols: m.cols() };
  });
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(id => {
    const home = PIN.fast.router.home(), root = document.querySelector('pin-fast').shadowRoot;
    const node = root.querySelector(`.card[data-id="${id}"]`);
    return { top: node ? node.getBoundingClientRect().top : null, cols: home.grid.masonry.cols(), cards: root.querySelectorAll('.card').length };
  }, before.id);
  r.resize = { before, after };
  checks['a resize reflows the columns and keeps the anchor card on its pixel'] = before.cols === 6 && after.cols < before.cols && after.top != null && Math.abs(after.top - before.top) <= 1 && after.cards <= 50;
  await ctx.close();
}

// ---------- 4. SSR first page ----------
{
  mode = 'ssr'; reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, 'ssr');
  await page.goto('https://www.pinterest.com/');
  await until(page, root => root && root.querySelectorAll('.card').length > 10 ? true : null);
  await page.waitForTimeout(900);
  r.ssr = Object.assign(await page.evaluate(() => PIN.fast.router.home().state()), { ours: ours['UserHomefeedResource/get'] || 0 });
  checks['without a tap, Home paints from the server-rendered state (0 requests)'] = r.ssr.source === 'ssr' && r.ssr.count === 60 && r.ssr.ours === 0;
  await ctx.close();
}

// ---------- 5. breaker: drift and signed out ----------
for (const m of ['drift', 'signedout']) {
  mode = m; reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, m);
  await page.goto('https://www.pinterest.com/');
  await page.waitForTimeout(2200);
  r[m] = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-pin-fast'), broken: sessionStorage.getItem('pin-fast-broken'), app: getComputedStyle(document.getElementById('app')).display, toast: document.querySelector('.pin-fast-toast')?.textContent || '' }));
  r[m].ours = ours['UserHomefeedResource/get'] || 0;
  await ctx.close();
}
checks['an "Invalid Request" answer opens the breaker and hands Home back to Pinterest for the session'] = r.drift.attr === null && /UserHomefeedResource/.test(r.drift.broken || '') && r.drift.app !== 'none' && r.drift.ours === 1 && /Pinterest changed/.test(r.drift.toast);
checks['a 401 (signed out) hands Home to Pinterest with a sign-in note'] = r.signedout.attr === null && /signed-out/.test(r.signedout.broken || '') && r.signedout.app !== 'none' && /Sign in/.test(r.signedout.toast);

checks['no page errors or dialogs'] = !logs.some(l => /pageerror|DIALOG/.test(l));

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
await browser.close();
if (failed) { console.log(JSON.stringify({ r, logs }, null, 2)); process.exit(1); }

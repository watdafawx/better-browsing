// Offline test: Pinterest Fast UI (Milestone 2) against its own userscript. Every pinterest.com / pinimg.com request
// is answered from fixtures (a fake Pinterest app that asks for its own homefeed or search, a fake resource backend
// with reads and the two writes), so it never touches the site. Run: node test/pinterest-fast-m2-offline.mjs
// (BROWSER=firefox for Firefox)
//   - routes: home / search / profile / board, the reserved first segments
//   - search: the top bar goes to /search/pins/?q= in Fast UI (no reload), BaseSearchResource with Pinterest's headers,
//     promoted pins dropped, bookmark paging, the All / Videos / Idea Pins chips; a tapped search costs 0 requests;
//     a failing search is the view's own banner (never the breaker of Home), "Open Search on Pinterest" is ?pin=native
//   - save: the viewer's `s` opens the picker (no last board), search + Enter saves (RepinResource/create POST,
//     X-CSRFToken, form body), "Saving…" then "Saved" and a toast, the last board kept; the card's quick Save; Create
//     board; a 403 rolls back with a toast and never fails a route
//   - keys: / focuses the search, Esc leaves it, j/k ring, Enter opens, z zooms, s saves, Esc closes the picker first
//   - profile (header, Boards / Pins tabs), board (header, feed, paging, owner link), author and board links in cards
//     and the viewer, the rail's Profile / Boards / Home, Back to Home on the exact pixel with no request, Pinterest's
//     router never sees a popstate of ours
import { chromium, firefox } from 'playwright';
import path from 'path'; import fs from 'fs';

const usFile = path.resolve(process.env.US_FILE || 'dist/better-browsing-pinterest.user.js');
if (!fs.existsSync(usFile)) { console.log('FAIL userscript built: ' + usFile + ' missing (npm run build)'); process.exit(1); }
const FF = process.env.BROWSER === 'firefox', bt = FF ? firefox : chromium;
const checks = {};
const r = {};
const logs = [];

// ---------- fixtures ----------
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const clip = fs.readFileSync('test/fixtures/clip.webm');
const RATIOS = [1.5, 1.25, 1.78, 1, 1.33, 0.75, 2, 1.4];
const isVideo = n => n % 5 === 4;
const isStory = n => n % 7 === 5 && !isVideo(n);
const pin = (n, base = 1000000, mixed = false) => {
  const id = String(base + n), hh = Math.round(474 * RATIOS[n % RATIOS.length]);
  const p = {
    type: 'pin', id, title: 'Pin ' + n, description: 'About pin ' + n, dominant_color: '#a0a0a0', link: 'https://example.com/p' + n,
    images: {
      '474x': { url: `https://i.pinimg.com/474x/${id}.jpg`, width: 474, height: hh },
      '1200x': { url: `https://i.pinimg.com/1200x/${id}.jpg`, width: 1200, height: Math.round(hh * 1200 / 474) },
      orig: { url: `https://i.pinimg.com/originals/${id}.jpg`, width: 2400, height: Math.round(hh * 2400 / 474) }
    },
    pinner: { id: 'u' + n, username: 'user' + n, full_name: 'User ' + n },
    board: { id: '555002', name: 'Board 2', url: '/user5/board-2/' },
    aggregated_pin_data: { id: 'AGG' + id, aggregated_stats: { saves: n * 10 } }, comment_count: 0,
    // Pinterest's organic pins carry these as false / 0 (isPromotedData must not read them as ads)
    promoted_is_removable: false, ad_match_reason: 0
  };
  if (mixed && isVideo(n)) p.videos = { video_list: { V_720P: { url: `https://v1.pinimg.com/videos/mc/720p/${id}.mp4`, width: 720, height: 1280, duration: 15000, thumbnail: `https://i.pinimg.com/videos/thumbnails/${id}.jpg` } } };
  if (mixed && isStory(n)) p.story_pin_data = { page_count: 3, pages: [1, 2, 3].map(k => ({ blocks: [], image: { images: {
    '474x': { url: `https://i.pinimg.com/474x/s${id}-${k}.jpg`, width: 474, height: 842 }, '1200x': { url: `https://i.pinimg.com/1200x/s${id}-${k}.jpg`, width: 1200, height: 2133 } } } })) };
  return p;
};
const promoted = n => Object.assign(pin(n, 9000000), { is_promoted: true, promoter: { username: 'brand' } });
const module = { type: 'story', id: 'mod1', story_type: 'shopping_carousel', objects: [] };
const env = (data, bookmark) => JSON.stringify({ resource_response: { status: 'success', code: 0, message: 'ok', data, bookmark }, resource: { name: 'X', options: {} } });
const failure = () => JSON.stringify({ resource_response: { status: 'failure', message: 'Invalid Request', data: null } });
const FAIL_PIN = '2000006';
const searchPage = (q, bm) => {
  const base = q === 'dogs' ? 2500000 : 2000000;
  if (!bm) return { data: [...Array.from({ length: 12 }, (_, i) => pin(i, base, true)), promoted(1), module, ...Array.from({ length: 13 }, (_, i) => pin(12 + i, base, true))], bookmark: 'sb1' };
  return { data: Array.from({ length: 10 }, (_, i) => pin(25 + i, base, true)), bookmark: '-end-' };
};
const user = u => ({ id: 'id-' + u, username: u, full_name: u === 'meuser' ? 'Me User' : u.replace(/^user(\d+)$/, 'User $1'), about: 'Bio of ' + u,
  follower_count: 1234, following_count: 56, image_large_url: 'https://i.pinimg.com/280x/av-' + u + '.jpg' });
const board = (u, k) => ({ type: 'board', id: String(555000 + k), name: 'Board ' + k, url: `/${u}/board-${k}/`, description: 'About board ' + k, pin_count: 30,
  privacy: k === 3 ? 'secret' : 'public', image_cover_url: `https://i.pinimg.com/222x/b${k}.jpg`, owner: { id: 'id-' + u, username: u, full_name: user(u).full_name } });
const PICKER = [
  { type: 'board', id: '777001', name: 'Interiors', url: '/meuser/interiors/', pin_count: 4, privacy: 'public', owner: { username: 'meuser' } },
  { type: 'board', id: '777002', name: 'Recipes', url: '/meuser/recipes/', pin_count: 9, privacy: 'public', owner: { username: 'meuser' } },
  { type: 'board', id: '777003', name: 'Travel', url: '/meuser/travel/', pin_count: 2, privacy: 'secret', owner: { username: 'meuser' } }
];

const ours = {}, oursReq = [], appCalls = {}, posts = [];
const app = `(() => {
  window.__appPop = 0;
  addEventListener('popstate', () => { window.__appPop++; });
  const ask = (name, opts, src, handler) => {
    const q = 'source_url=' + encodeURIComponent(src) + '&data=' + encodeURIComponent(JSON.stringify({ options: opts, context: {} })) + '&_=' + Date.now();
    return fetch('/resource/' + name + '/?' + q, { headers: { 'x-pinterest-pws-handler': handler, 'x-pinterest-source-url': src, 'X-APP-VERSION': 'abc123', 'x-fake-app': '1' } }).then(r => r.json()).catch(() => null);
  };
  const p = location.pathname;
  if (p === '/') ask('UserHomefeedResource/get', { field_set_key: 'hf_grid', in_nux: false, in_news_hub: false, static_feed: false, live_option: 'yes' }, '/', 'www/index.js');
  else if (p.startsWith('/search/pins')) {
    const q = new URLSearchParams(location.search).get('q') || '';
    ask('BaseSearchResource/get', { query: q, scope: 'pins', auto_correction_disabled: false, page_size: 25, redux_normalize_feed: true, rs: 'typed', source_url: p + location.search, app_opt: 'yes' }, p + location.search, 'www/search/[scope].js');
  }
})();`;
const html = () => `<!doctype html><html><head><title>Pinterest fixture</title></head><body>
<div id="app" style="min-height:400px"><header>native header <div data-test-id="header-profile"><a href="/meuser/">me</a></div></header>
<div class="navcol"><div data-test-id="vertical-nav-icon"><div><a href="/" aria-label="Home"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg><span>Home</span></a></div></div></div>
</div>
<script src="https://s.pinimg.com/webapp/app-fake.js"></script>
</body></html>`;

const wait = ms => new Promise(res => setTimeout(res, ms));
async function route(rt) {
  const req = rt.request(), u = new URL(req.url());
  if (u.hostname === 's.pinimg.com') return rt.fulfill({ status: 200, contentType: 'application/javascript', body: app });
  if (u.pathname.startsWith('/resource/')) {
    const name = u.pathname.replace(/^\/resource\/|\/$/g, '');
    const hdr = req.headers();
    const fromApp = hdr['x-fake-app'] === '1';
    const post = req.method() === 'POST';
    const data = post ? new URLSearchParams(req.postData() || '').get('data') : u.searchParams.get('data');
    let options = {};
    try { options = JSON.parse(data || '{}').options || {}; } catch {}
    if (fromApp) appCalls[name] = (appCalls[name] || 0) + 1;
    else {
      ours[name] = (ours[name] || 0) + 1;
      oursReq.push({ name, handler: hdr['x-pinterest-pws-handler'] || '', src: hdr['x-pinterest-source-url'] || '', options });
      if (post) posts.push({ name, options, csrf: hdr['x-csrftoken'] || '', ct: hdr['content-type'] || '', src: hdr['x-pinterest-source-url'] || '', handler: hdr['x-pinterest-pws-handler'] || '', body: req.postData() || '' });
    }
    const ok = (d, bm) => rt.fulfill({ status: 200, contentType: 'application/json', body: env(d, bm) });
    if (name === 'UserHomefeedResource/get') {
      const bm = (options.bookmarks || [])[0];
      return ok(!bm ? Array.from({ length: 60 }, (_, i) => pin(i)) : Array.from({ length: 10 }, (_, i) => pin(60 + i)), bm ? '-end-' : 'bm1');
    }
    if (name === 'BaseSearchResource/get') {
      if (options.query === 'fail') return rt.fulfill({ status: 200, contentType: 'application/json', body: failure() });
      const pg = searchPage(options.query, (options.bookmarks || [])[0]);
      return ok(pg.data, pg.bookmark);
    }
    if (name === 'UserResource/get') return ok(user(options.username || 'nobody'));
    if (name === 'BoardsResource/get') return ok(Array.from({ length: 6 }, (_, k) => board(options.username, k + 1)), '-end-');
    if (name === 'UserPinsResource/get') return ok(Array.from({ length: 20 }, (_, i) => pin(i, 3000000)), '-end-');
    if (name === 'BoardResource/get') { const k = +(String(options.slug || '').replace('board-', '')) || 1; return ok(board(options.username, k)); }
    if (name === 'BoardFeedResource/get') {
      const bm = (options.bookmarks || [])[0];
      return ok(!bm ? Array.from({ length: 25 }, (_, i) => pin(i, 4000000)) : Array.from({ length: 5 }, (_, i) => pin(25 + i, 4000000)), bm ? '-end-' : 'bf1');
    }
    if (name === 'BoardPickerBoardsResource/get') return ok({ all_boards: PICKER, recent_boards: [PICKER[2]] });
    if (name === 'RepinResource/create') {
      if (options.pin_id === FAIL_PIN) return rt.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ resource_response: { status: 'failure', message: 'Forbidden' } }) });
      await wait(350);
      return ok({ id: 'repin-' + options.pin_id, board: { id: options.board_id } });
    }
    if (name === 'BoardResource/create') return ok({ type: 'board', id: '777099', name: options.name, privacy: options.privacy, url: '/meuser/garden/', pin_count: 0, owner: { username: 'meuser' } });
    if (name === 'PinResource/get') {
      const id = String(options.id || ''), n = +id % 100000, base = +id - n;
      return ok(pin(n, base, base === 2000000 || base === 2500000));
    }
    if (name === 'UnifiedCommentsResource/get') return ok([]);
    if (name === 'RelatedModulesResource/get') return ok([]);
    return ok(null);
  }
  if (/\.(mp4)$/i.test(u.pathname)) return rt.fulfill({ status: 200, contentType: 'video/webm', body: clip });
  if (/\.(jpg|jpeg|png|webp)$/i.test(u.pathname)) return rt.fulfill({ status: 200, contentType: 'image/png', body: png });
  return rt.fulfill({ status: 200, contentType: 'text/html', body: html() });
}

const browser = await bt.launch(FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0 } } : { args: ['--autoplay-policy=no-user-gesture-required'] });
const FAST = { fastUi: true, fastUiTheme: 'light', videoMode: 'volume', videoVolume: 40 };
async function newCtx(settings) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/pinterest\.com|pinimg\.com/, route);
  await ctx.addCookies([{ name: 'csrftoken', value: 'tok123', domain: 'www.pinterest.com', path: '/', secure: true }]);
  await ctx.addInitScript(s => {
    try {
      if (!localStorage.getItem('pin-test-seeded')) {
        localStorage.setItem('pin-userscript-settings', JSON.stringify({ settings: s }));
        localStorage.setItem('pin-settings-snapshot', JSON.stringify(s));
        localStorage.setItem('pin-test-seeded', '1');
      }
    } catch {}
  }, settings);
  await ctx.addInitScript({ path: usFile });
  return ctx;
}
const watch = (page, tag) => {
  page.on('pageerror', e => logs.push(`[${tag} pageerror] ` + e.message));
  page.on('dialog', d => { logs.push(`[${tag} DIALOG!] ` + d.message()); d.dismiss(); });
  page.on('console', m => { if (m.type() === 'error' && /\[PIN|Uncaught/.test(m.text())) logs.push(`[${tag} error] ` + m.text().slice(0, 200)); });
};
const reset = () => { for (const o of [ours, appCalls]) for (const k of Object.keys(o)) delete o[k]; oursReq.length = 0; posts.length = 0; };
const shadow = (page, fn, arg) => page.evaluate(([src, a]) => { const root = document.querySelector('pin-fast')?.shadowRoot; return (0, eval)('(' + src + ')')(root, a); }, [fn.toString(), arg]);
async function until(page, fn, arg, ms = 5000) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < ms) { v = await shadow(page, fn, arg).catch(() => null); if (v) return v; await wait(60); }
  return v;
}
const click = (page, sel) => shadow(page, (root, s) => { const el = root.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const view = page => page.evaluate(() => { const v = PIN.fast.router.current(); return { route: PIN.fast.router.route(), url: location.pathname + location.search, st: v && v.state ? v.state() : null, attr: document.documentElement.getAttribute('data-pin-fast') }; });
const deepActive = page => page.evaluate(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a ? a.tagName + (a.closest && a.closest('.search') ? ':search' : '') : ''; });

// ---------- 1. one session: search, save, keys, Back to Home, profile, board, the rail ----------
{
  reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, 'm2');
  await page.goto('https://www.pinterest.com/');
  await until(page, root => root && root.querySelectorAll('.card').length > 10);
  r.routes = await page.evaluate(() => {
    const t = ['/', '/homefeed/', '/search/pins/', '/user5/', '/user5/_saved/', '/user5/_created/', '/user5/board-2/', '/user5/_tried/', '/pin/123/', '/ideas/',
      '/settings/', '/today/', '/business/hub/', '/explore/cats/', '/user5/board-2/section/', '/me/', '/resource/', '/_/x/'];
    return Object.fromEntries(t.map(p => [p, PIN.fast.routeOf(p)]));
  });
  checks['routes: home, search, profile (+ _saved/_created), board; reserved first segments never a profile'] =
    r.routes['/'] === 'home' && r.routes['/homefeed/'] === 'home' && r.routes['/search/pins/'] === 'search' && r.routes['/user5/'] === 'profile'
    && r.routes['/user5/_saved/'] === 'profile' && r.routes['/user5/_created/'] === 'profile' && r.routes['/user5/board-2/'] === 'board'
    && ['/user5/_tried/', '/pin/123/', '/ideas/', '/settings/', '/today/', '/business/hub/', '/explore/cats/', '/user5/board-2/section/', '/me/', '/resource/', '/_/x/'].every(p => r.routes[p] === null);

  await page.evaluate(() => { window.__marker = 1; scrollTo(0, 500); });
  await page.waitForTimeout(250);
  r.homeY0 = await page.evaluate(() => scrollY);

  // ---- search from the top bar ----
  await page.locator('pin-fast .search input').fill('cats');
  await page.keyboard.press('Enter');
  r.search = await until(page, root => { const s = root.querySelector('section.view.search:not([hidden])'); return s && s.querySelectorAll('.card').length >= 10 ? { cards: s.querySelectorAll('.card').length, title: s.querySelector('[data-search-title]')?.textContent, homeHidden: root.querySelector('section.view.home').hidden, q: root.querySelector('.search input').value } : null; });
  r.searchView = await view(page);
  r.searchMarker = await page.evaluate(() => ({ marker: window.__marker, pop: window.__appPop, label: document.querySelector('pin-fast').shadowRoot.querySelector('main.feed').getAttribute('aria-label') }));
  const sreq = oursReq.filter(q => q.name === 'BaseSearchResource/get');
  checks['search: the top bar opens /search/pins/?q= in Fast UI (no reload), Home hidden, the query in the bar'] = r.search && r.search.title === 'cats' && r.search.homeHidden && r.search.q === 'cats'
    && r.searchView.url === '/search/pins/?q=cats&rs=typed' && r.searchView.route === 'search' && r.searchView.attr === 'search' && r.searchMarker.marker === 1 && r.searchMarker.label === 'Search';
  checks['search: BaseSearchResource with the query, Pinterest\'s handler and source URL; promoted pins and modules dropped'] = sreq.length >= 1 && !sreq[0].options.bookmarks && sreq[0].options.query === 'cats' && sreq[0].options.scope === 'pins'
    && sreq[0].handler === 'www/search/[scope].js' && sreq[0].src === '/search/pins/?q=cats&rs=typed' && r.searchView.st.count >= 25 && r.searchView.st.promoted === 1 && r.searchView.st.dropped >= 1;

  // paging
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(120); }
  await until(page, () => PIN.fast.router.current().state().ended || null);
  r.spage = (await view(page)).st;
  const sreq2 = oursReq.filter(q => q.name === 'BaseSearchResource/get');
  checks['search: bookmark paging until -end-'] = r.spage.count === 35 && r.spage.ended && sreq2.length === 2 && sreq2[1].options.bookmarks[0] === 'sb1' && sreq2[1].options.query === 'cats';
  // chips
  const all35 = Array.from({ length: 35 }, (_, i) => i);
  await click(page, '.chips [data-filter="video"]');
  r.chipV = await until(page, root => { const f = root.querySelector('section.view.search .pfeed'); return f && f.getAttribute('data-shown') !== '35' ? { shown: +f.getAttribute('data-shown'), cards: [...root.querySelectorAll('section.view.search .card')].map(c => c.getAttribute('data-id')), on: root.querySelector('.chip.on').getAttribute('data-filter') } : null; });
  await click(page, '.chips [data-filter="story"]');
  r.chipS = await until(page, root => { const f = root.querySelector('section.view.search .pfeed'); return f && root.querySelector('.chip.on').getAttribute('data-filter') === 'story' ? { shown: +f.getAttribute('data-shown') } : null; });
  await click(page, '.chips [data-filter="all"]');
  r.chipA = await until(page, root => { const f = root.querySelector('section.view.search .pfeed'); return f && f.getAttribute('data-shown') === '35' ? 35 : null; });
  checks['search chips: Videos / Idea Pins filter the loaded pins, All brings them back'] = r.chipV && r.chipV.shown === all35.filter(isVideo).length && r.chipV.cards.every(id => isVideo(+id - 2000000))
    && r.chipS && r.chipS.shown === all35.filter(isStory).length && r.chipA === 35;

  // ---- the viewer: s opens the picker (no last board), search + Enter saves ----
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(200);
  await click(page, '.card[data-id="2000001"] a.media');
  r.lb = await until(page, root => { const d = root.querySelector('dialog.lb'); return d && d.open && location.pathname === '/pin/2000001/' ? { crumb: d.querySelector('.crumb')?.textContent, save: d.querySelector('.savepill')?.textContent } : null; });
  await page.keyboard.press('s');
  r.pk = await until(page, root => { const p = root.querySelector('.picker'); return p && p.classList.contains('show') && p.querySelectorAll('.pk-row').length === 3 ? { inDialog: !!p.closest('dialog.lb'), popover: (() => { try { return p.matches(':popover-open'); } catch { return 'n/a'; } })(), rows: [...p.querySelectorAll('.pk-row .pk-nm')].map(n => n.textContent), heads: [...p.querySelectorAll('.pk-h')].map(n => n.textContent), sel: p.querySelector('.pk-row.sel')?.textContent } : null; });
  r.pkFocus = await deepActive(page);
  await page.keyboard.press('ArrowDown');
  r.pkSel = await shadow(page, root => root.querySelector('.picker .pk-row.sel .pk-nm')?.textContent);
  checks['viewer: crumb "Search", s opens the board picker inside the dialog (Recent / All boards, ↓ moves)'] = r.lb?.crumb === 'Search' && r.lb.save === 'Save' && r.pk && r.pk.inDialog && r.pk.popover === true
    && r.pk.rows.join() === 'Travel,Interiors,Recipes' && r.pk.heads.join() === 'Recent,All boards' && r.pkFocus === 'INPUT' && r.pkSel === 'Interiors';
  await page.locator('pin-fast [data-pk-q]').fill('rec');
  r.pkFilter = await shadow(page, root => [...root.querySelectorAll('.picker .pk-row .pk-nm')].map(n => n.textContent).join());
  await page.keyboard.press('Enter');
  r.saving = await until(page, root => { const b = root.querySelector('dialog.lb .savepill'); return b && b.textContent === 'Saving…' ? 'Saving…' : null; }, null, 1500);
  r.saved = await until(page, root => { const b = root.querySelector('dialog.lb .savepill'); const t = root.querySelector('dialog.lb .vtoast.on'); return b && b.textContent === 'Saved' && t ? { toast: t.textContent, picker: root.querySelector('.picker').classList.contains('show') } : null; });
  r.last = await page.evaluate(() => JSON.parse(localStorage.getItem('pin-last-board') || 'null'));
  const p1 = posts.find(p => p.name === 'RepinResource/create');
  checks['save: picker search + Enter, "Saving…" then "Saved" with a toast in the viewer, the last board kept'] = r.pkFilter === 'Recipes' && r.saving === 'Saving…' && r.saved && r.saved.toast === 'Saved to Recipes' && !r.saved.picker
    && r.last && r.last.id === '777002' && r.last.name === 'Recipes';
  checks['save: RepinResource/create is a form POST with X-CSRFToken, Pinterest\'s source URL and handler'] = !!p1 && p1.options.pin_id === '2000001' && p1.options.board_id === '777002' && p1.csrf === 'tok123'
    && /application\/x-www-form-urlencoded/.test(p1.ct) && p1.src === '/pin/2000001/' && p1.handler === 'www/pin/[id].js' && /^source_url=/.test(p1.body) && /&data=/.test(p1.body);
  // Esc closes the picker first, then the viewer
  await click(page, 'dialog.lb .savepick');
  await until(page, root => root.querySelector('.picker')?.classList.contains('show') || null);
  await page.keyboard.press('Escape');
  r.esc1 = await until(page, root => !root.querySelector('.picker').classList.contains('show') ? { lb: root.querySelector('dialog.lb').open } : null);
  await page.keyboard.press('Escape');
  r.esc2 = await until(page, root => !root.querySelector('dialog.lb').open && location.pathname === '/search/pins/' ? { url: location.pathname + location.search } : null);
  checks['Esc closes the picker first, then the viewer (back on the search)'] = r.esc1 && r.esc1.lb === true && r.esc2 && r.esc2.url === '/search/pins/?q=cats&rs=typed';

  // ---- the card's quick Save (the last board) ----
  await click(page, '.card[data-id="2000002"] .save');
  r.quick = await until(page, root => { const c = root.querySelector('.card[data-id="2000002"]'); return c && c.classList.contains('saved') && c.querySelector('.save').textContent === 'Saved' ? true : null; });
  const p2 = posts.filter(p => p.name === 'RepinResource/create')[1];
  checks['a card\'s Save pill saves to the last board at once'] = r.quick === true && p2 && p2.options.pin_id === '2000002' && p2.options.board_id === '777002';

  // ---- Create board from a card's picker ----
  await click(page, '.card[data-id="2000003"] .savepick');
  r.pk2 = await until(page, root => { const p = root.querySelector('.picker'); return p && p.classList.contains('show') && p.querySelectorAll('.pk-row').length ? { inDialog: !!p.closest('dialog'), picking: !!root.querySelector('.card[data-id="2000003"].picking') } : null; });
  await click(page, '[data-pk-new]');
  await page.locator('pin-fast [data-pk-name]').fill('Garden');
  await click(page, '[data-pk-make]');
  r.created = await until(page, root => { const c = root.querySelector('.card[data-id="2000003"]'); return c && c.classList.contains('saved') ? root.querySelector('.vtoast.on')?.textContent : null; });
  const pc = posts.find(p => p.name === 'BoardResource/create'), p3 = posts.filter(p => p.name === 'RepinResource/create')[2];
  r.last2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pin-last-board') || 'null'));
  checks['Create board: BoardResource/create (POST), then the pin is saved to it'] = r.pk2 && !r.pk2.inDialog && r.pk2.picking && r.created === 'Saved to Garden' && pc && pc.options.name === 'Garden' && pc.options.privacy === 'public' && pc.csrf === 'tok123'
    && p3 && p3.options.board_id === '777099' && r.last2?.id === '777099';

  // ---- keys ----
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.keyboard.press('/');
  r.kSlash = await deepActive(page);
  await page.keyboard.press('Escape');
  r.kEsc = await deepActive(page);
  await page.keyboard.press('j');
  const f1 = await shadow(page, root => root.querySelector('section.view.search .card.kfocus')?.getAttribute('data-id'));
  await page.keyboard.press('j');
  const f2 = await shadow(page, root => root.querySelector('section.view.search .card.kfocus')?.getAttribute('data-id'));
  await page.keyboard.press('k');
  const f3 = await shadow(page, root => root.querySelector('section.view.search .card.kfocus')?.getAttribute('data-id'));
  await page.keyboard.press('Enter');
  r.kOpen = await until(page, (root, id) => root.querySelector('dialog.lb').open && location.pathname === '/pin/' + id + '/' ? true : null, f1);
  await page.waitForTimeout(150);
  await page.keyboard.press('z');
  r.kZoom = await until(page, root => root.querySelector('dialog.lb .st-box.zoomed') ? true : null);
  await page.keyboard.press('Escape');
  await until(page, root => !root.querySelector('dialog.lb').open || null);
  await page.keyboard.press('s');
  r.kSave = await until(page, (root, id) => root.querySelector(`.card[data-id="${id}"]`)?.classList.contains('saved') ? true : null, f1);
  const p4 = posts.filter(p => p.name === 'RepinResource/create').pop();
  checks['keys: / focuses the search and Esc leaves it; j/j/k ring; Enter opens; z zooms; s saves the ringed card'] = r.kSlash === 'INPUT:search' && r.kEsc !== 'INPUT:search'
    && f1 && f2 && f1 !== f2 && f3 === f1 && r.kOpen && r.kZoom && r.kSave && p4.options.pin_id === f1 && p4.options.board_id === '777099';

  // ---- a refused save rolls back; never a route failure ----
  const before = ours['RepinResource/create'] || 0;
  await click(page, `.card[data-id="${FAIL_PIN}"] .save`);
  r.roll = await until(page, (root, id) => { const c = root.querySelector(`.card[data-id="${id}"]`), t = root.querySelector('.vtoast.on'); return c && !c.classList.contains('saved') && c.querySelector('.save').textContent === 'Save' && t && /Couldn't save/.test(t.textContent) ? t.textContent : null; }, FAIL_PIN);
  r.rollState = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-pin-fast'), broken: sessionStorage.getItem('pin-fast-broken'), owned: PIN.fast.state().owned }));
  await click(page, `.card[data-id="${FAIL_PIN}"] .save`);
  await wait(700);
  r.retry = (ours['RepinResource/create'] || 0) - before;
  checks['a 403 on save rolls back with a toast; the route stays ours (no breaker, nothing broken), a retry goes out'] = !!r.roll && r.rollState.attr === 'search' && r.rollState.broken === null && r.rollState.owned && r.retry === 2;

  // ---- Back to Home: the exact pixel, no request, Pinterest never told ----
  await page.goBack();
  r.home = await until(page, root => { const h = root.querySelector('section.view.home'); return h && !h.hidden && location.pathname === '/' && !root.querySelector('section.view.search') ? { cards: h.querySelectorAll('.card').length } : null; });
  await page.waitForTimeout(250);
  r.homeBack = await page.evaluate(() => ({ y: scrollY, count: PIN.fast.router.home().state().count, marker: window.__marker, pop: window.__appPop, q: document.querySelector('pin-fast').shadowRoot.querySelector('.search input').value }));
  checks['Back to Home: the same masonry on the exact scroll pixel, no homefeed request, no reload, search cleared'] = r.home && r.home.cards > 0 && r.homeBack.y === r.homeY0 && r.homeY0 === 500
    && r.homeBack.count === 60 && !ours['UserHomefeedResource/get'] && r.homeBack.marker === 1 && r.homeBack.pop === 0 && r.homeBack.q === '';

  // ---- an author link in a card: the profile ----
  await click(page, '.card[data-id="1000005"] a.byl');
  r.prof = await until(page, root => { const v = root.querySelector('section.view.profile'); return v && v.querySelector('.pname') && v.querySelectorAll('.bcard').length === 6 ? { name: v.querySelector('.pname').textContent, user: v.querySelector('.puser').textContent, bio: v.querySelector('.pbio')?.textContent, stats: v.querySelector('.pstats').textContent, tab: v.querySelector('.tab.on')?.getAttribute('data-tab'), lock: !!v.querySelector('.bcard[data-board-id="555003"] .lock'), url: location.pathname } : null; });
  const ureq = oursReq.filter(q => q.name === 'BoardsResource/get').pop();
  checks['profile: an author link opens /<user>/ with UserResource header and the Boards tab (BoardsResource, secret lock)'] = r.prof && r.prof.url === '/user5/' && r.prof.name === 'User 5' && r.prof.user === '@user5'
    && r.prof.bio === 'Bio of user5' && /1,?234|1\.2k|1234/.test(r.prof.stats) && r.prof.tab === 'boards' && r.prof.lock && ureq && ureq.options.username === 'user5' && ureq.src === '/user5/_saved/';
  await click(page, 'section.view.profile a.tab[data-tab="pins"]');
  r.pins = await until(page, root => { const v = root.querySelector('section.view.profile'); return v && location.pathname === '/user5/_created/' && v.querySelectorAll('.card').length === 20 ? { tab: v.querySelector('.tab.on')?.getAttribute('data-tab'), boards: v.querySelectorAll('.bcard').length } : null; });
  checks['profile: the Pins tab is UserPinsResource in the same view (no second UserResource)'] = r.pins && r.pins.tab === 'pins' && r.pins.boards === 0 && ours['UserResource/get'] === 1 && ours['UserPinsResource/get'] === 1;
  await click(page, 'section.view.profile a.tab[data-tab="boards"]');
  await until(page, root => root.querySelectorAll('section.view.profile .bcard').length === 6 || null);

  // ---- a board card: the board view ----
  await click(page, 'section.view.profile a.bcard[data-board-id="555002"]');
  r.board = await until(page, root => { const v = root.querySelector('section.view.board'); return v && v.querySelector('h1.vtitle') && v.querySelectorAll('.card').length >= 10 ? { title: v.querySelector('h1.vtitle').textContent, desc: v.querySelector('.bdesc')?.textContent, pins: v.querySelector('[data-board-pins]').textContent, owner: v.querySelector('.bown a.olink')?.getAttribute('href'), url: location.pathname, profile: !!root.querySelector('section.view.profile') } : null; });
  const bf = oursReq.filter(q => q.name === 'BoardFeedResource/get');
  checks['board: BoardResource header (title, description, pins, owner link) and BoardFeedResource by board_id'] = r.board && r.board.url === '/user5/board-2/' && r.board.title === 'Board 2' && r.board.desc === 'About board 2'
    && r.board.pins === '30 pins' && r.board.owner === '/user5/' && !r.board.profile && bf.length >= 1 && !bf[0].options.bookmarks && bf[0].options.board_id === '555002' && bf[0].src === '/user5/board-2/';
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(120); }
  r.bpage = await until(page, () => { const s = PIN.fast.router.current().state().pins; return s && s.ended ? s : null; });
  checks['board: bookmark paging until -end-'] = r.bpage && r.bpage.count === 30 && oursReq.filter(q => q.name === 'BoardFeedResource/get').length === 2;
  // the viewer's author link: the viewer closes, then the profile
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(200);
  r.boardY = 0;
  await click(page, 'section.view.board .card[data-id="4000003"] a.media');
  r.lb2 = await until(page, root => { const d = root.querySelector('dialog.lb'); return d.open && d.querySelector('[data-lb-author]') && d.querySelector('[data-lb-board]') ? { crumb: d.querySelector('.crumb').textContent, board: d.querySelector('[data-lb-board]').getAttribute('href') } : null; });
  await click(page, 'dialog.lb [data-lb-author]');
  r.lbAuthor = await until(page, root => { const v = root.querySelector('section.view.profile'); return !root.querySelector('dialog.lb').open && location.pathname === '/user3/' && v && v.querySelector('.pname')?.textContent === 'User 3' ? true : null; });
  checks['viewer: crumb "Board"; the author link closes the viewer and opens that profile in Fast UI'] = r.lb2 && r.lb2.crumb === 'Board' && r.lb2.board === '/user5/board-2/' && r.lbAuthor;
  await page.goBack();
  r.boardBack = await until(page, root => { const v = root.querySelector('section.view.board'); return location.pathname === '/user5/board-2/' && v && v.querySelector('h1.vtitle')?.textContent === 'Board 2' && v.querySelectorAll('.card').length ? true : null; });
  checks['Back from a profile returns to the board view'] = r.boardBack;
  await click(page, 'section.view.board .bown a.olink');
  r.owner = await until(page, root => location.pathname === '/user5/' && root.querySelector('section.view.profile .pname')?.textContent === 'User 5' ? true : null);
  checks['board: the owner link opens the owner\'s profile'] = r.owner;

  // ---- the rail ----
  await click(page, '.rail [data-act="profile"]');
  r.me = await until(page, root => location.pathname === '/meuser/' && root.querySelector('section.view.profile .pname')?.textContent === 'Me User' ? { on: root.querySelector('.rail .rbtn.on')?.getAttribute('data-rail') } : null);
  await click(page, '.rail [data-act="boards"]');
  r.myBoards = await until(page, root => location.pathname === '/meuser/_saved/' && root.querySelectorAll('section.view.profile .bcard').length === 6 ? { on: root.querySelector('.rail .rbtn.on')?.getAttribute('data-rail') } : null);
  await click(page, '.rail [data-rail="home"]');
  r.railHome = await until(page, root => { const h = root.querySelector('section.view.home'); return location.pathname === '/' && h && !h.hidden && h.querySelectorAll('.card').length ? { on: root.querySelector('.rail .rbtn.on')?.getAttribute('data-rail') } : null; });
  r.end = await page.evaluate(() => ({ pop: window.__appPop, marker: window.__marker, broken: sessionStorage.getItem('pin-fast-broken'), count: PIN.fast.router.home().state().count }));
  checks['rail: Profile is the signed-in user (Pinterest\'s header link), Boards their _saved tab, Home the kept masonry'] = r.me?.on === 'profile' && r.myBoards?.on === 'boards' && r.railHome?.on === 'home' && r.end.count === 60 && !ours['UserHomefeedResource/get'];
  checks['the whole session: no reload, Pinterest\'s router never saw a popstate of ours, nothing broken'] = r.end.pop === 0 && r.end.marker === 1 && r.end.broken === null;
  await ctx.close();
}

// ---------- 2. a tapped search: 0 requests of ours ----------
{
  reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, 'tap');
  await page.goto('https://www.pinterest.com/search/pins/?q=dogs&rs=typed');
  r.tap = await until(page, root => { const s = root.querySelector('section.view.search'); return s && s.querySelectorAll('.card').length > 10 ? { title: s.querySelector('[data-search-title]').textContent, q: root.querySelector('.search input').value } : null; });
  await page.waitForTimeout(900);
  r.tapSt = (await view(page)).st;
  checks['a search page load renders from Pinterest\'s own tapped BaseSearchResource (0 first-page requests of ours)'] = r.tap && r.tap.title === 'dogs' && r.tap.q === 'dogs' && r.tapSt.source === 'tap' && r.tapSt.count >= 25
    && r.tapSt.promoted === 1 && !oursReq.some(q => q.name === 'BaseSearchResource/get' && !q.options.bookmarks) && appCalls['BaseSearchResource/get'] === 1;
  await ctx.close();
}

// ---------- 3. a failing search: the view's own banner, then ?pin=native ----------
{
  reset();
  const ctx = await newCtx(FAST);
  const page = await ctx.newPage(); watch(page, 'fail');
  await page.goto('https://www.pinterest.com/search/pins/?q=fail&rs=typed');
  r.fail = await until(page, root => { const b = root.querySelector('section.view.search [data-fv-banner]'); return b ? { kind: b.getAttribute('data-fv-banner'), text: b.textContent, native: b.querySelector('[data-fv-native]')?.getAttribute('href'), retry: !!b.querySelector('[data-fv-retry]') } : null; }, null, 6000);
  r.failState = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-pin-fast'), broken: sessionStorage.getItem('pin-fast-broken'), owned: PIN.fast.state().owned, home: PIN.fast.isBroken('home') }));
  checks['a failing search is the view\'s own banner ("Open Search on Pinterest"); Home and the route are never failed'] = r.fail && r.fail.kind === 'failure' && /Open Search on Pinterest/.test(r.fail.text) && !r.fail.retry
    && r.failState.attr === 'search' && r.failState.broken === null && r.failState.owned && !r.failState.home;
  await click(page, 'section.view.search [data-fv-native]');
  await page.waitForURL(/pin=native/, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  r.failNative = await page.evaluate(() => ({ url: location.pathname + location.search, attr: document.documentElement.getAttribute('data-pin-fast'), app: getComputedStyle(document.getElementById('app')).display }));
  checks['"Open Search on Pinterest" loads Pinterest\'s page with ?pin=native'] = /^\/search\/pins\/\?q=fail&rs=typed&pin=native$/.test(r.failNative.url) && r.failNative.attr === 'native' && r.failNative.app !== 'none';
  await ctx.close();
}

checks['no page errors or dialogs'] = !logs.some(l => /pageerror|DIALOG/.test(l));

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
await browser.close();
if (failed) { console.log(JSON.stringify({ r, logs }, null, 2)); process.exit(1); }

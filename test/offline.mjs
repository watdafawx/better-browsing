// Offline smoke test: runs the Reddit userscript (dist/better-browsing-reddit.user.js; US_FILE= another bundle) in Chromium and answers every
// reddit.com request from fixtures below, so it never touches live Reddit. Run: npm test.
// The second part runs it again in BROWSER (chromium, or firefox) for the panel, perf and away checks.
import { chromium, firefox } from 'playwright';
import { idleMutations, churnCost, costOk } from './lib/perf.mjs';
import { awayChecks, awayOk } from './lib/away.mjs';
import path from 'path'; import fs from 'fs';

const usFile = path.resolve(process.env.US_FILE || 'dist/better-browsing-reddit.user.js');
const CLIP_BYTES = fs.readFileSync(path.resolve('test/fixtures/clip.webm'));
const CLIP = 'data:video/webm;base64,' + CLIP_BYTES.toString('base64');
if (!fs.existsSync(usFile)) { console.log('FAIL userscript built: ' + usFile + ' missing (npm run build)'); process.exit(1); }
const b1 = await chromium.launch();
const ctx = await b1.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript({ path: usFile });

const post = (id, extra = {}) => ({ name: 't3_' + id, id, title: 'Post ' + id, author: 'alice', author_fullname: 't2_a', subreddit: 'test',
  subreddit_name_prefixed: 'r/test', permalink: `/r/test/comments/${id}/post_${id}/`, created_utc: Date.now() / 1000 - 3600, score: 42, num_comments: 3,
  is_self: true, selftext_html: '<div class="md"><p>Body <span class="md-spoiler-text">secret</span> <img src=x onerror=alert(1)><script>bad()</script><a href="javascript:alert(2)" onclick="x()">js</a></p></div>', ...extra });
const comment = (id, body, replies = '') => ({ kind: 't1', data: { name: 't1_' + id, id, author: 'bob', author_fullname: 't2_b', body_html: body, score: 5,
  created_utc: Date.now() / 1000 - 60, permalink: `/r/test/comments/aaa/post/${id}/`, replies } });
const thread = id => {
  if (id === 'rrr') return [{ data: { children: [] } }, { data: { children: [] } }];   // API has nothing: force the feed-markup fallback
  const p = id === 'vvv' ? post(id, { is_video: true, is_self: false, selftext_html: null,
    secure_media: { reddit_video: { hls_url: 'https://v.redd.it/x/HLSPlaylist.m3u8', fallback_url: 'https://v.redd.it/x/DASH_480.mp4', width: 640, height: 360 } } }) : post(id);
  const kids = [];
  for (let i = 0; i < 60; i++) kids.push(comment('c' + i, `<div class="md"><p>Comment ${i} <a href="/r/test/comments/bbb/x/">link</a> <img src="https://evil.com/x.png"></p></div>`,
    i === 0 ? { data: { children: [comment('r0', '<div class="md"><p>reply</p></div>')] } } : ''));
  kids.push({ kind: 'more', data: { count: 2, children: ['m1', 'm2'], parent_id: 't3_' + id } });
  return [{ data: { children: [{ kind: 't3', data: p }] } }, { data: { children: kids } }];
};
const feed = `<!doctype html><html><head><title>fixture</title></head><body>
<header style="height:48px"><button aria-label="Open chat">chat</button></header>
<shreddit-feed>
${['aaa', 'bbb', 'vvv', 'ccc'].map(id => `<article><shreddit-post id="t3_${id}" permalink="/r/test/comments/${id}/post_${id}/" post-type="${id === 'vvv' ? 'video' : 'text'}" post-title="Post ${id}" style="display:block;height:220px;border:1px solid #ccc;margin:8px">
<a slot="full-post-link" href="/r/test/comments/${id}/post_${id}/">Post ${id}</a><div slot="text-body">body ${id}</div></shreddit-post></article>`).join('\n')}
<article><shreddit-post id="t3_rrr" permalink="/r/test/comments/rrr/post_rrr/" post-type="video" content-href="https://redgifs.com/watch/tremendousthoughtfulneonrainbowfish" post-title="Redgifs" style="display:block;height:220px;border:1px solid #ccc;margin:8px">
<a slot="full-post-link" href="/r/test/comments/rrr/post_rrr/">Redgifs</a>
<shreddit-player src="https://v.redd.it/silent/HLSPlaylist.m3u8" poster="https://external-preview.redd.it/x.jpeg"></shreddit-player></shreddit-post></article>
</shreddit-feed>
<div style="height:2000px"></div></body></html>`;

const reqs = [];
const fixtures = async route => {
  const u = new URL(route.request().url());
  reqs.push({ t: Date.now(), u: u.pathname + u.search });
  const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  let m;
  if ((m = u.pathname.match(/\/comments\/([a-z0-9]+)\/[^/]*\.json$/))) return json(thread(m[1]));
  if (u.pathname.startsWith('/api/morechildren')) return json({ json: { data: { things: [comment('m1', '<p>more1</p>'), comment('m2', '<p>more2</p>')].map(c => ({ ...c, data: { ...c.data, parent_id: 't3_aaa' } })) } } });
  if (u.pathname.startsWith('/api/user_data_by_account_ids')) return json({});
  if (u.pathname.endsWith('/about.json')) return json({ data: {} });
  if (u.pathname.startsWith('/api/me')) return json({ data: {} });
  if (/\/rbe-clip\d*\.mp4$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'video/webm', body: CLIP_BYTES });   // a real, playable clip
  if (u.pathname.endsWith('.m3u8')) return route.fulfill({ status: 404, body: '' });
  if (u.pathname.endsWith('.mp4')) return route.fulfill({ status: 404, body: '' });
  if (u.pathname.startsWith('/r/test')) return route.fulfill({ status: 200, contentType: 'text/html', body: feed });
  if (/redgifs\.com$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>redgifs player</p>' });
  return route.fulfill({ status: 404, body: '' });
};
await ctx.route(/reddit\.com|redd\.it|redditstatic|redgifs\.com/, fixtures);

const logs = [];
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || /RBE/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('dialog', d => { logs.push('[DIALOG!] ' + d.message()); d.dismiss(); });
// settings written the way the panel writes them (read-modify-write of storage.sync `settings`)
const setSetting = (key, value) => page.evaluate(([k, v]) => RBE.api.storage.sync.get('settings').then(({ settings = {} }) => RBE.api.storage.sync.set({ settings: { ...settings, [k]: v } })), [key, value]);

const r = {};
await page.goto('https://www.reddit.com/r/test/');
await page.waitForTimeout(1500);
r.themeStyle = await page.evaluate(() => !!document.getElementById('rbe-theme'));
r.quickbar = await page.evaluate(() => !!document.getElementById('rbe-qb'));
r.gear = await page.evaluate(() => !!document.querySelector('.rbe-nav-gear'));
r.snapshot = await page.evaluate(() => !!localStorage.getItem('rbe-settings-snapshot'));
r.videoAttr = await page.evaluate(() => document.documentElement.dataset.rbeVideo);

// hover → prefetch
const a = await page.locator('shreddit-post#t3_aaa').boundingBox();
const hoverAt = Date.now();
await page.mouse.move(a.x + 200, a.y + 100);
await page.waitForTimeout(700);
r.prefetch = reqs.filter(q => q.t >= hoverAt && /comments/.test(q.u)).map(q => q.u);

// click → viewer, should reuse prefetch
const n0 = reqs.length, c0 = Date.now();
await page.mouse.click(a.x + 200, a.y + 100);
await page.waitForSelector('.rbe-viewer .rbe-comments', { timeout: 10000 });
r.openMs = Date.now() - c0;
r.reqsOnOpen = reqs.slice(n0).filter(q => /comments/.test(q.u)).length;
r.commentCount = await page.evaluate(() => document.querySelectorAll('.rbe-viewer .rbe-c').length);
r.sanitize = await page.evaluate(() => ({
  body: document.querySelector('.rbe-post-body').innerHTML,
  evilImg: document.querySelectorAll('.rbe-viewer img[src*="evil"]').length,
  link: document.querySelector('.rbe-c-body a')?.getAttribute('href'),
  target: document.querySelector('.rbe-c-body a')?.getAttribute('target'),
}));
// Sanitizer and embed-URL security: unwrapped tags must not shield their children, schemes are parsed
r.sanitizeSec = await page.evaluate(() => {
  const s = RBE.sanitize;
  return {
    font: s('<font><img src="https://i.redd.it/a.png" onerror="alert(1)"></font>'),
    nested: s('<font><center><a href="javascript:alert(1)" onclick="x()">n</a></center></font>'),
    tab: s('<a href="java&#x09;script:alert(1)">t</a><a href="&#x20;JaVaScRiPt:alert(1)">u</a>'),
    vb: s('<a href="vbscript:x">v</a><a href="data:text/html,x">d</a><a href="blob:https://x/y">b</a>'),
    ok: s('<a href="mailto:a@b.c">m</a><a href="https://example.com/x">h</a><a href="/r/test/">r</a>'),
    embedJs: RBE.extractMedia({ is_self: false, url: 'https://example.com/v', secure_media_embed: { content: '&lt;iframe src="javascript:alert(1)"&gt;&lt;/iframe&gt;' } }).items.some(i => i.type === 'embed'),
    embedOk: RBE.extractMedia({ is_self: false, url: 'https://www.youtube.com/watch?v=a', secure_media_embed: { content: '&lt;iframe src="https://www.youtube.com/embed/a"&gt;&lt;/iframe&gt;' } }).items[0]?.type,
    frame: !!RBE.safeFrameSrc && RBE.safeFrameSrc('javascript:alert(1)') === '',
  };
});
r.cv = await page.evaluate(() => getComputedStyle(document.querySelector('.rbe-comments > .rbe-c')).contentVisibility);
// load more
await page.click('.rbe-viewer .rbe-more');
await page.waitForTimeout(500);
r.afterMore = await page.evaluate(() => document.querySelectorAll('.rbe-viewer .rbe-c').length);
// collapse
await page.click('.rbe-viewer .rbe-c .rbe-c-line');
r.collapsed = await page.evaluate(() => document.querySelector('.rbe-viewer .rbe-c').classList.contains('collapsed') && document.querySelector('.rbe-viewer .rbe-c-count').textContent);
// sort change → new request
const n1 = reqs.length;
await page.selectOption('.rbe-viewer .rbe-select', 'new');
await page.waitForTimeout(500);
r.sortReq = reqs.slice(n1).map(q => q.u).filter(u => /sort=new/.test(u)).length;
// J → next post
await page.keyboard.press('j');
await page.waitForTimeout(500);
r.afterJ = await page.evaluate(() => document.querySelector('.rbe-v-head .rbe-btn[title="Open on Reddit"]').href);
await page.click('.rbe-v-head .rbe-embed-btn');
await page.waitForTimeout(100);
r.embed = await page.evaluate(() => ({ copied: (document.getElementById("rbe-toast")?.textContent || "").replace(/^(Copied|Could not copy:) /, ""), inPost: !!document.querySelector('.rbe-post-stats .rbe-embed-btn') }));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
r.closed = await page.evaluate(() => !document.querySelector('.rbe-viewer'));
// 🔗 in the feed action row (shadow root with Reddit's share slot)
await page.evaluate(() => { const p = document.querySelector('shreddit-post#t3_ccc'); p.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot><div data-testid="action-row"><slot name="share-button"></slot></div>'; });
await page.waitForTimeout(900);
r.feedEmbed = await page.evaluate(() => { const b = document.querySelector('shreddit-post#t3_ccc').shadowRoot.querySelector('.rbe-feed-embed'); return !!b && b.previousElementSibling?.getAttribute('name') === 'share-button'; });
await page.evaluate(() => document.querySelector('shreddit-post#t3_ccc').shadowRoot.querySelector('.rbe-feed-embed').click());
await page.waitForTimeout(100);
r.feedEmbedCopied = await page.evaluate(() => document.getElementById('rbe-toast')?.textContent || '');
r.feedEmbedNoViewer = await page.evaluate(() => !document.querySelector('.rbe-viewer'));

// reopen aaa → cached
const n2 = reqs.length;
await page.mouse.click(a.x + 200, a.y + 100);
await page.waitForSelector('.rbe-viewer .rbe-comments');
r.reopenReqs = reqs.slice(n2).filter(q => /comments/.test(q.u)).length;
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// video post → hls.js runs on demand, attaches MediaSource (blob:)
const v = await page.locator('shreddit-post#t3_vvv').boundingBox();
await page.mouse.click(v.x + 200, v.y + 100);
await page.waitForSelector('.rbe-viewer video', { timeout: 10000 });
await page.waitForTimeout(2500);
r.video = await page.evaluate(() => { const el = document.querySelector('.rbe-viewer video'); return { src: (el.currentSrc || el.getAttribute('src') || '').slice(0, 30), vol: el.volume, muted: el.muted, controls: el.controls }; });
r.silentToast = await page.evaluate(() => document.getElementById('rbe-toast')?.textContent || '');
// the controls toggle applies live; with it off a click plays/pauses
const setNative = on => setSetting('nativeControls', on);
await setNative(false);
await page.waitForTimeout(500);
r.nativeOff = await page.evaluate(() => { const el = document.querySelector('.rbe-viewer video'), e = new MouseEvent('click', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return { controls: el.controls, handled: e.defaultPrevented }; });   // our click-to-toggle took it
await setNative(true);
await page.waitForTimeout(500);
r.nativeOn = await page.evaluate(() => document.querySelector('.rbe-viewer video').controls);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Reddit's own players (shadow DOM): a mute right after a click elsewhere is Reddit's, not the user's;
// one right after a click on that player's own button is the user's and sticks
r.audio = await page.evaluate(() => {
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<video style="width:300px;height:200px"></video><button id="mb">mute</button>';
  const v = root.querySelector('video');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  v.muted = true;
  const afterElsewhere = v.muted;
  root.getElementById('mb').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  v.muted = true;
  return { afterElsewhere, afterOwn: v.muted, user: v.dataset.rbeUserAudio || null };
});
// clicking the post around a shadow-DOM player (upvote, comments, title) is not a click on the
// player: Reddit's mute of that video must not stick. It used to (it counted as the user's, and
// the protection stayed off), so a video that started with sound went back to muted.
r.audioScope = await page.evaluate(() => new Promise(res => {
  const art = document.createElement('article'); document.body.append(art);
  const host = document.createElement('shreddit-player'); art.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<video style="width:300px;height:200px"></video><button id="pm">mute</button>';
  const up = document.createElement('button'); art.append(up);
  const v = root.querySelector('video');
  Object.defineProperty(v, 'paused', { get: () => false });
  v.play().catch(() => {});
  up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  v.muted = true;                                   // Reddit mutes the player right after that click
  const ignored = v.muted === false, tagged = v.dataset.rbeUserAudio || null;
  setTimeout(() => res({ ignored, tagged, muted: v.muted, vol: v.volume }), 1000);
}));
// a playing video that ended up muted (user never muted it) gets the volume back after a click
r.safety = await page.evaluate(() => new Promise(res => {
  document.body.insertAdjacentHTML('beforeend', '<video id="stuck" muted style="width:300px;height:200px"></video>');
  const v = document.getElementById('stuck');
  Object.defineProperty(v, 'paused', { get: () => false });
  v.dispatchEvent(new Event('play'));
  setTimeout(() => res({ muted: v.muted, vol: v.volume, active: navigator.userActivation.hasBeenActive }), 1000);
}));
// lightbox open (<html data-rbe-lb>): page videos are paused when they start, ours are left alone
r.lbPause = await page.evaluate(() => {
  document.body.insertAdjacentHTML('beforeend', '<video id="behind"></video><div class="rbe-root"><video id="mine"></video></div>');
  const spy = id => { const v = document.getElementById(id); v.n = 0; v.pause = () => { v.n++; }; return v; };
  const a = spy('behind'), b = spy('mine');
  a.dispatchEvent(new Event('play')); b.dispatchEvent(new Event('play'));
  const before = a.n;
  document.documentElement.setAttribute('data-rbe-lb', '');
  a.dispatchEvent(new Event('play')); b.dispatchEvent(new Event('play'));
  const res = { before, behind: a.n, mine: b.n };
  document.documentElement.removeAttribute('data-rbe-lb');
  return res;
});

// a video that was playing when it left the viewport comes back when it returns (the site pauses feed
// videos itself, so the resume cannot rely on our own pause having done it)
r.resume = await page.evaluate(() => new Promise(res => {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;top:0;left:0;width:320px;height:200px;z-index:1';
  const v = document.createElement('video');
  v.style.cssText = 'width:320px;height:200px';
  box.append(v);
  document.body.prepend(box);
  let playing = false; const calls = [];
  Object.defineProperty(v, 'paused', { configurable: true, get: () => !playing });
  v.play = () => { playing = true; calls.push('play'); v.dispatchEvent(new Event('play')); v.dispatchEvent(new Event('playing')); return Promise.resolve(); };
  v.pause = () => { if (!playing) return; playing = false; calls.push('pause'); v.dispatchEvent(new Event('pause')); };
  setTimeout(() => {                                  // let the observer see it first
    v.play();                                         // as if the site started it
    setTimeout(() => {
      v.pause();                                      // the site pauses it as it leaves
      box.style.top = '5000px';
      setTimeout(() => {
        const marked = v.dataset.rbePausedOffscreen || null;
        box.style.top = '0px';                        // back into view
        setTimeout(() => {
          const out = { marked, resumed: playing, plays: calls.filter(c => c === 'play').length };
          box.remove();
          res(out);
        }, 1200);
      }, 900);
    }, 500);
  }, 900);
}));

// settings change through storage reaches the page (filtered onChanged)
await setSetting('theme', 'nord');
await page.waitForTimeout(500);
r.themeApplied = await page.evaluate(() => document.documentElement.classList.contains('rbe-themed'));

// reload: snapshot gives theme before storage read
await page.reload();
r.themedAtDomStart = await page.evaluate(() => document.documentElement.classList.contains('rbe-themed'));

r.logs = logs;
await b1.close();

// ---------- settings panel, lightbox, perf and away checks, in BROWSER ----------
r.us = { built: true };
{
  // BROWSER=firefox runs this part in Firefox (the part above always runs in Chromium)
  const FF = process.env.BROWSER === 'firefox', bt = FF ? firefox : chromium;
  const launchOpts = FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0 } } : {};
  r.us.browser = FF ? 'firefox' : 'chromium';
  const b2 = await bt.launch(launchOpts);
  const c2 = await b2.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.route(/reddit\.com|redd\.it|redditstatic/, fixtures);
  await c2.addInitScript({ path: usFile });
  const p2 = await c2.newPage();
  const usLogs = [];
  p2.on('pageerror', e => usLogs.push(e.message));
  p2.on('dialog', d => { usLogs.push('dialog ' + d.message()); d.dismiss(); });
  await p2.goto('https://www.reddit.com/r/test/');
  await p2.waitForTimeout(1500);
  r.us.idle = await idleMutations(p2);
  Object.assign(r.us, await p2.evaluate(() => ({
    theme: !!document.getElementById('rbe-theme'), css: !!document.getElementById('rbe-css'),
    quickbar: !!document.getElementById('rbe-qb'), gear: !!document.querySelector('.rbe-nav-gear'),
    accountsBtn: !!document.querySelector('#rbe-qb [title="Accounts"]'), hlsBefore: !!window.Hls,
    videoAttr: document.documentElement.dataset.rbeVideo || ''
  })));
  const pb = await p2.locator('shreddit-post#t3_aaa').boundingBox();
  await p2.mouse.click(pb.x + 200, pb.y + 100);
  await p2.waitForSelector('.rbe-viewer .rbe-c', { timeout: 8000 }).catch(() => {});
  r.us.comments = await p2.evaluate(() => document.querySelectorAll('.rbe-viewer .rbe-c').length);
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  const vb = await p2.locator('shreddit-post#t3_vvv').boundingBox();
  await p2.mouse.click(vb.x + 200, vb.y + 100);
  await p2.waitForSelector('.rbe-viewer video', { timeout: 8000 }).catch(() => {});
  await p2.waitForTimeout(2000);
  Object.assign(r.us, await p2.evaluate(() => { const v = document.querySelector('.rbe-viewer video'); return { hlsAfter: typeof window.Hls === 'function', vol: v?.volume }; }));
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  await p2.click('.rbe-nav-gear').catch(() => {});
  await p2.waitForTimeout(500);
  // real clicks inside the panel (shadow DOM) must keep it open
  await p2.locator('.rbe-us-settings #tabs button[data-tab="video"]').click().catch(() => {});
  await p2.waitForTimeout(300);
  r.us.openAfterClick = await p2.evaluate(() => !!document.querySelector('.rbe-us-settings') && document.querySelector('.rbe-us-settings').shadowRoot.querySelector('#tabs .on')?.dataset.tab);
  Object.assign(r.us, await p2.evaluate(() => {
    const root = document.querySelector('.rbe-us-settings')?.shadowRoot;
    return { panelInputs: root?.querySelectorAll('[data-key]').length || 0, panelAccounts: !!root?.querySelector('[data-tab="accounts"]'), themes: root?.querySelectorAll('#themes .theme').length || 0 };
  }));
  await p2.evaluate(() => [...document.querySelector('.rbe-us-settings').shadowRoot.querySelectorAll('#themes .theme')].find(b => b.textContent === 'nord')?.click());
  await p2.waitForTimeout(800);
  r.us.saved = await p2.evaluate(() => JSON.parse(localStorage.getItem('rbe-userscript-storage') || '{}')?.sync?.settings?.theme);
  r.us.applied = await p2.evaluate(() => document.documentElement.classList.contains('rbe-themed'));
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(200);
  r.us.panelClosed = await p2.evaluate(() => !document.querySelector('.rbe-us-settings'));
  // image lightbox (gallery post, opened the way the viewer does)
  await p2.evaluate(() => RBE.openLightbox({ scope: 'post', index: 0, postData: { name: 't3_ggg', id: 'ggg', title: 'Gallery', author: 'a', subreddit_name_prefixed: 'r/test',
    permalink: '/r/test/comments/ggg/g/', created_utc: 1, is_gallery: true, gallery_data: { items: [{ media_id: 'm1' }, { media_id: 'm2' }] },
    media_metadata: { m1: { status: 'valid', e: 'Image', s: { u: 'https://i.redd.it/one.png', x: 800, y: 600 } }, m2: { status: 'valid', e: 'Image', s: { u: 'https://i.redd.it/two.png', x: 800, y: 600 } } } } }));
  await p2.waitForTimeout(800);
  r.us.lightbox = await p2.evaluate(() => { const lb = document.querySelector('.rbe-lb'); return lb && { fixed: getComputedStyle(lb).position === 'fixed', full: lb.getBoundingClientRect().width === innerWidth, img: [...lb.querySelectorAll('img')].some(i => /one\.png$/.test(i.src)), count: lb.querySelector('.rbe-lb-count')?.textContent }; });
  await p2.keyboard.press('Escape');
  // a plain .mp4 link: silent in the lightbox before, though the post viewer played it with sound.
  // A start the browser refuses (sound blocked) must come back on the next click, not stay muted.
  r.us.mp4 = await p2.evaluate(() => new Promise(res => {
    const P = HTMLMediaElement.prototype, orig = P.play;
    let blocked = false;
    P.play = function () {
      if (!blocked && this.dataset.rbeOwn === '1') { blocked = true; return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }
      return orig.apply(this, arguments);
    };
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));   // the click that opens the lightbox
    RBE.openLightbox({ scope: 'post', index: 0, postData: { name: 't3_mmm', id: 'mmm', title: 'Clip', author: 'a', subreddit_name_prefixed: 'r/test',
      permalink: '/r/test/comments/mmm/c/', created_utc: 1, is_self: false, url: 'https://v.redd.it/x/clip.mp4' } });
    setTimeout(() => {
      const v = document.querySelector('.rbe-lb video');
      const blockedMuted = !!v && v.muted;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      setTimeout(() => {
        P.play = orig;
        res({ there: !!v, blockedMuted, muted: v?.muted, vol: v?.volume, user: v?.dataset.rbeUserAudio || null });
      }, 400);
    }, 500);
  }));
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(200);
  // a Reddit-hosted video: the bar can hand it to Reddit's own player and back
  r.us.orig = await p2.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    RBE.openLightbox({ scope: 'post', index: 0, postData: { name: 't3_vvv', id: 'vvv', title: 'Video', author: 'a',
      subreddit_name_prefixed: 'r/test', permalink: '/r/test/comments/vvv/post_vvv/', created_utc: 1, is_video: true, is_self: false,
      secure_media: { reddit_video: { hls_url: 'https://v.redd.it/x/HLSPlaylist.m3u8', fallback_url: 'https://v.redd.it/x/DASH_480.mp4', width: 640, height: 360 } } } });
    const btn = () => document.querySelector('.rbe-lb-orig-btn');
    await wait(900);
    const out = { btn: !!btn(), video: !!document.querySelector('.rbe-lb-stage video') };
    btn()?.click(); await wait(600);
    out.frame = document.querySelector('.rbe-lb-stage iframe')?.src || '';
    out.videoAfter = !!document.querySelector('.rbe-lb-stage video');
    btn()?.click(); await wait(600);
    out.videoBack = !!document.querySelector('.rbe-lb-stage video');
    out.frameGone = !document.querySelector('.rbe-lb-stage iframe');
    return out;
  });
  await p2.keyboard.press('Escape');
  // an embedded player stays the provider's own iframe, and the bar links to the provider's page
  r.us.embedOut = await p2.evaluate(async () => {
    RBE.openLightbox({ scope: 'post', index: 0, postData: { name: 't3_eee', id: 'eee', title: 'YT', author: 'a',
      subreddit_name_prefixed: 'r/test', permalink: '/r/test/comments/eee/yt/', created_utc: 1, is_self: false,
      url: 'https://www.youtube.com/watch?v=abc', media: { oembed: { provider_name: 'YouTube' } },
      secure_media_embed: { content: '<iframe src="https://www.youtube.com/embed/abc"></iframe>' } } });
    await new Promise(r => setTimeout(r, 700));
    const a = document.querySelector('.rbe-lb-bar a[title^="Open at"]');
    return { href: a?.getAttribute('href') || '', frame: !!document.querySelector('.rbe-lb-stage iframe') };
  });
  await p2.keyboard.press('Escape');
  // a redgifs post whose API data we don't get: the feed markup has only Reddit's silent <shreddit-player>
  // preview, so we must build the provider's player from the post's link instead
  r.us.redgifs = await p2.evaluate(async () => {
    const probes = {
      rg: RBE.embedFromUrl?.('https://redgifs.com/watch/tremendousthoughtfulneonrainbowfish'),
      yt: RBE.embedFromUrl?.('https://www.youtube.com/watch?v=abc123&t=5'),
      gifv: RBE.embedFromUrl?.('https://i.imgur.com/x.gifv'),
      host: RBE.embedFromUrl?.('https://v.redd.it/x/HLSPlaylist.m3u8'),
    };
    RBE.openLightbox({ scope: 'feed', postId: 't3_rrr' });
    await new Promise(r => setTimeout(r, 1500));
    const s = document.querySelector('.rbe-lb-stage');
    return {
      iframe: s?.querySelector('iframe')?.src || '',
      video: !!(s?.querySelector('video')),
      reload: !!document.querySelector('.rbe-lb-reload-btn'),
      rg: probes.rg?.src || '', yt: probes.yt?.src || '', gifv: probes.gifv?.src || '', host: probes.host,
    };
  });
  await p2.keyboard.press('Escape');
  // provider players are mounted only while in view: the strip used to play one seven posts down
  r.us.lazy = await p2.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:4000px;width:300px;height:200px';
    const f = document.createElement('iframe');
    host.append(f); document.body.append(host);
    RBE.lazyFrame(f, 'https://www.redgifs.com/ifr/tremendousthoughtfulneonrainbowfish');
    await new Promise(r => setTimeout(r, 800));
    const off = f.getAttribute('src') || '';
    host.style.top = '0px';
    await new Promise(r => setTimeout(r, 800));
    const on = f.getAttribute('src') || '';
    host.remove();
    return { off, on };
  });
  // Videos out of view: nothing plays while wholly outside the viewport, and what the page wanted playing
  // starts when it comes in. Real clips, players in open and closed shadow roots, the ways Reddit's players
  // start a video without our offscreen observer seeing an edge crossing.
  r.us.offscreen = await p2.evaluate(async CLIP => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const OUT = '3000px', IN = '100px';
    const mk = ({ mode = 'open', html, tag = 'shreddit-player' }) => {
      const host = document.createElement(tag);
      host.style.cssText = `position:fixed;left:0;top:${OUT};width:320px;height:180px;display:block;z-index:5`;
      const root = host.attachShadow({ mode });
      root.innerHTML = html;
      document.body.append(host);
      return { host, v: root.querySelector('video'), show(on) { host.style.top = on ? IN : OUT; }, done() { host.remove(); } };
    };
    const vid = (attrs = '') => `<video muted loop ${attrs} style="width:320px;height:180px"></video>`;
    const playing = v => !v.paused;
    const out = {};
    // A: Reddit's player calls play() a little before its video scrolls in (open shadow root, already scanned)
    let p = mk({ html: vid(`src="${CLIP}"`) });
    await wait(1200);
    p.v.play().catch(() => {});
    await wait(700);
    out.aOff = playing(p.v);
    p.show(true); await wait(1000);
    out.aIn = playing(p.v);
    p.show(false); await wait(800);
    out.aLeft = playing(p.v);
    p.show(true); await wait(1000);
    out.aBack = playing(p.v);
    p.done();
    // B: the same player in a closed shadow root (video.js can never find it)
    p = mk({ mode: 'closed', tag: 'div', html: vid(`src="${CLIP}"`) });
    await wait(300);
    p.v.play().catch(() => {});
    await wait(700);
    out.bOff = playing(p.v);
    p.show(true); await wait(1000);
    out.bIn = playing(p.v);
    p.show(false); await wait(800);
    out.bLeft = playing(p.v);
    p.show(true); await wait(1000);
    out.bBack = playing(p.v);
    p.done();
    // Closed-root native autoplay never calls the patched play(), and cannot be found by a DOM scan.
    p = mk({ mode: 'closed', tag: 'div', html: vid(`autoplay src="${CLIP}"`) });
    await wait(1500);
    out.closedAutoplayOff = playing(p.v);
    p.show(true); await wait(1000);
    out.closedAutoplayIn = playing(p.v);
    p.show(false); await wait(800);
    out.closedAutoplayLeft = playing(p.v);
    p.done();
    // A player can start before asynchronous settings arrive, with no later edge crossing.
    {
      const config = document.documentElement.getAttribute('data-rbe-video');
      document.documentElement.removeAttribute('data-rbe-video');
      await wait(50);
      p = mk({ mode: 'closed', tag: 'div', html: vid(`autoplay src="${CLIP}"`) });
      // Chromium defers offscreen native autoplay itself; explicitly start to exercise the same race there.
      p.v.play().catch(() => {});
      await wait(1000);
      out.beforeSettings = playing(p.v);
      document.documentElement.setAttribute('data-rbe-video', config);
      await wait(1000);
      out.afterSettings = playing(p.v);
      out.closedDiagnostic = window.__rbeVideoState().videos.some(v => v.closed && v.outside && v.paused);
      p.show(true); await wait(1000);
      out.settingsResume = playing(p.v);
      p.done();
    }
    // C: autoplay attribute, the source arrives while the player is out of view (re-mount, lazy source)
    p = mk({ html: vid('autoplay') });
    await wait(1200);
    p.v.src = CLIP;
    await wait(900);
    out.cOff = playing(p.v);
    p.show(true); await wait(1000);
    out.cIn = playing(p.v);
    p.done();
    // D: a player that (re)starts its video once it can play again after buffering, out of view
    p = mk({ html: vid() });
    await wait(1200);
    p.v.addEventListener('canplay', () => p.v.play().catch(() => {}), { once: true });
    p.v.src = CLIP;
    await wait(900);
    out.dOff = playing(p.v);
    p.show(true); await wait(1000);
    out.dIn = playing(p.v);
    p.done();
    // E: autoplay attribute with its source from the start: it plays before our scan finds it
    p = mk({ html: vid(`autoplay src="${CLIP}"`) });
    await wait(1500);
    out.eOff = playing(p.v);
    p.show(true); await wait(1000);
    out.eIn = playing(p.v);
    p.done();
    // F: our own video, built and started, then inserted out of view
    {
      const box = document.createElement('div');
      box.className = 'rbe-root';
      box.style.cssText = `position:fixed;left:0;top:${OUT};width:320px;height:180px;z-index:5`;
      const v = document.createElement('video');
      v.src = CLIP; v.style.cssText = 'width:320px;height:180px';
      RBE.setupOwnVideo(v);
      box.append(v); document.body.append(box);
      await wait(1000);
      out.fOff = playing(v);
      box.style.top = IN; await wait(1000);
      out.fIn = playing(v);
      RBE.destroyVideos(box); box.remove();
    }
    // G: the user paused it and pressed play again: that earlier pause must not stop it coming back later
    {
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:0;top:${IN};width:320px;height:180px;z-index:5`;
      box.innerHTML = vid(`src="${CLIP}"`);
      const v = box.firstChild;
      document.body.append(box);
      v.play().catch(() => {});
      await wait(1500);
      const click = () => v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      click(); v.pause(); await wait(300);
      out.gUserPaused = v.dataset.rbeUserPaused || null;
      click(); v.play().catch(() => {}); await wait(1500);
      box.style.top = OUT; await wait(800);
      out.gLeft = playing(v);
      box.style.top = IN; await wait(1000);
      out.gBack = playing(v);
      box.remove();
    }
    // I: lightbox open, an autoplay player inside a shadow root starts without calling play()
    p = mk({ html: vid('autoplay') });
    p.show(true);
    await wait(1200);
    document.documentElement.setAttribute('data-rbe-lb', '');
    p.v.src = CLIP;
    await wait(900);
    out.iBehindLb = playing(p.v);
    document.documentElement.removeAttribute('data-rbe-lb');
    p.done();
    return out;
  }, CLIP);
  // strip-mode lightbox: neighbours below the fold wait, and play once scrolled to
  await p2.evaluate(() => RBE.api.storage.sync.get('settings').then(({ settings = {} }) => RBE.api.storage.sync.set({ settings: { ...settings, lightboxStyle: 'strip' } })));
  await p2.waitForTimeout(400);
  r.us.strip = await p2.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ids = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
    RBE.openLightbox({ scope: 'post', index: 0, postData: { name: 't3_sss', id: 'sss', title: 'Gifs', author: 'a', subreddit_name_prefixed: 'r/test',
      permalink: '/r/test/comments/sss/g/', created_utc: 1, is_gallery: true, gallery_data: { items: ids.map(media_id => ({ media_id })) },
      media_metadata: Object.fromEntries(ids.map((m, i) => [m, { status: 'valid', e: 'AnimatedImage', s: { mp4: `https://i.redd.it/rbe-clip${i}.mp4`, gif: `https://i.redd.it/g${i}.gif`, x: 800, y: 600 } }])) } });
    const state = () => [...document.querySelectorAll('.rbe-lb video')].map(v => {
      const r = v.getBoundingClientRect();
      return { out: r.bottom <= 0 || r.top >= innerHeight, playing: !v.paused };
    });
    await wait(2000);
    const first = state();
    const vids = document.querySelectorAll('.rbe-lb video');
    vids[vids.length - 1]?.scrollIntoView({ block: 'center' });
    await wait(1500);
    const later = state();
    return { first, later };
  });
  await p2.keyboard.press('Escape');
  await p2.evaluate(() => RBE.api.storage.sync.get('settings').then(({ settings = {} }) => RBE.api.storage.sync.set({ settings: { ...settings, lightboxStyle: 'step' } })));
  await p2.waitForTimeout(300);
  r.us.errors = usLogs;
  r.us.away = await awayChecks(p2);
  // Every JSON fallback refuses access: stop on an unavailable post, then accept another step.
  const blocked = await c2.newPage();
  const blockedRequests = [];
  await blocked.route(/reddit\.com/, route => {
    const u = new URL(route.request().url());
    if (/info\.json|\/by_id\/|\/comments\/.*\.json/.test(u.pathname)) {
      blockedRequests.push(u.pathname);
      return route.fulfill({ status: 403, body: '' });
    }
    if (u.pathname === '/r/blocked/') return route.fulfill({ contentType: 'text/html', body: `<shreddit-feed>${['blocked1', 'blocked2', 'blocked3'].map((id, i) =>
      `<shreddit-post id="t3_${id}" post-type="image" permalink="/r/test/comments/${id}/post/" ${i === 1 ? '' : 'content-href="https://i.redd.it/blocked.png"'}></shreddit-post>`).join('')}</shreddit-feed>` });
    return fixtures(route);
  });
  await blocked.goto('https://www.reddit.com/r/blocked/');
  await blocked.waitForFunction(() => !!window.RBE?.openLightbox && !!RBE.settings);
  await blocked.waitForTimeout(200);
  await blocked.evaluate(() => {
    RBE.settings.lightboxPosts = 'images';
    RBE.settings.lightboxStyle = 'step';
    window.blockedLb = RBE.openLightbox({ postId: 't3_blocked1', scope: 'feed' });
  });
  await blocked.waitForFunction(() => document.querySelector('.rbe-lb-count')?.textContent === 'post 1/3');
  await blocked.keyboard.press('ArrowDown');
  await blocked.waitForFunction(() => document.querySelector('.rbe-lb-err')?.textContent.includes('Couldn’t load this post') && document.querySelector('.rbe-lb-count')?.textContent === 'post 2/3', null, { timeout: 3000 });
  await blocked.keyboard.press('j');
  await blocked.waitForFunction(() => document.querySelector('.rbe-lb-count')?.textContent === 'post 3/3', { timeout: 3000 });
  r.us.blockedStep = true;
  const batchCount = () => blockedRequests.filter(u => /info\.json|\/by_id\//.test(u)).length;
  const beforeRetry = batchCount();
  await blocked.evaluate(() => RBE.getPost('t3_blocked4'));
  const duringCooldown = batchCount();
  await blocked.evaluate(async () => {
    const now = Date.now;
    Date.now = () => now() + 61000;
    try { await RBE.getPost('t3_blocked5'); } finally { Date.now = now; }
  });
  r.us.batchRetry = beforeRetry === 2 && duringCooldown === beforeRetry && batchCount() === beforeRetry + 2;
  await blocked.route('**/hung.json', () => {});
  r.us.fetchTimeout = await blocked.evaluate(async () => {
    try { await RBE.getJSON('/hung.json', { timeoutMs: 50 }); return false; }
    catch (err) { return /timed out/.test(err.message); }
  });
  await blocked.clock.install();
  await blocked.evaluate(() => {
    const lb = window.blockedLb;
    window.savedItems = lb.items;
    lb.items = () => new Promise(() => {});
    window.stalledStep = lb.step(-1);
  });
  await blocked.clock.runFor(15001);
  r.us.stepWatchdog = await blocked.evaluate(async () => {
    await window.stalledStep;
    const lb = window.blockedLb, released = !lb.busy;
    lb.items = window.savedItems;
    await lb.step(-1);
    return released && !lb.busy && lb.pi === 1;
  });
  await blocked.close();
  await b2.close();
  r.us.cost = await churnCost({ browserType: bt, name: r.us.browser, launchOpts, route: { re: /reddit\.com|redd\.it|redditstatic/, fn: fixtures }, url: 'https://www.reddit.com/r/test/', usFile });
}

const checks = {
  'userscript: all JSON endpoints 403 still allow lightbox steps': r.us.blockedStep,
  'userscript: batch endpoints retry after cooldown': r.us.batchRetry,
  'userscript: hung JSON fetch times out': r.us.fetchTimeout,
  'userscript: stalled step watchdog releases navigation': r.us.stepWatchdog,
  ...awayOk('userscript (' + (r.us.browser || '') + ')', r.us.away || {}),
  'theme style injected': r.themeStyle,
  'quick bar shown': r.quickbar,
  'nav gear placed': r.gear,
  'settings snapshot saved': r.snapshot,
  'hover prefetches thread': r.prefetch.length === 1,
  'click reuses prefetch': r.reqsOnOpen === 0,
  'comments rendered': r.commentCount === 61,
  'unsafe html stripped': !/onerror|<script|javascript:/i.test(r.sanitize.body) && r.sanitize.evilImg === 0,
  'sanitizer cleans the children of an unwrapped tag (<font><img onerror>)': !/onerror/i.test(r.sanitizeSec.font) && /<img[^>]+i.redd.it/.test(r.sanitizeSec.font) && !/onclick|javascript/i.test(r.sanitizeSec.nested) && /<a /.test(r.sanitizeSec.nested),
  'sanitizer parses link schemes (tab/space/case tricks, vbscript, data, blob dropped; http, mailto, relative kept)': !/href/.test(r.sanitizeSec.tab) && !/href/.test(r.sanitizeSec.vb) && (r.sanitizeSec.ok.match(/href=/g) || []).length === 3 && /href="mailto:a@b.c"/.test(r.sanitizeSec.ok),
  'embed iframe src from API markup must be http(s)': r.sanitizeSec.embedJs === false && r.sanitizeSec.embedOk === 'embed' && r.sanitizeSec.frame,
  'relative links absolutized': r.sanitize.link === 'https://www.reddit.com/r/test/comments/bbb/x/',
  'load more works': r.afterMore === 63,
  'collapse shows count': r.collapsed === ' (+1)',
  'sort refetches': r.sortReq === 1,
  'J goes to next post': /bbb/.test(r.afterJ),
  'Esc closes viewer': r.closed,
  'reopen uses cache': r.reopenReqs === 0,
  'video gets volume setting': r.video.vol === 0.1,
  'silent MP4 fallback says so once instead of looking broken': /plays silent/.test(r.silentToast),
  ['userscript: idle page, the script changes nothing on its own, no feedback loop (' + r.us.browser + ')']: r.us.idle <= 10,
  ['userscript: on a page that keeps changing, the script adds little work (' + r.us.browser + ')']: costOk(r.us.browser, r.us.cost),
  'viewer video has browser controls; the setting turns them off (click toggles play) and on again, live': r.video.controls === true && r.nativeOff.controls === false && r.nativeOff.handled && r.nativeOn === true,
  'page mute after a click elsewhere ignored': r.audio.afterElsewhere === false,
  'mute after a click on the player sticks': r.audio.afterOwn === true && r.audio.user === '1',
  'click on the post, not the player, never mutes it': r.audioScope.ignored && r.audioScope.tagged === null && r.audioScope.muted === false && Math.abs(r.audioScope.vol - 0.1) < 0.01,
  'lightbox open pauses page videos that start, not its own': r.lbPause.before === 0 && r.lbPause.behind === 1 && r.lbPause.mine === 0,
  'video stuck muted gets unmuted after a click': r.safety.active && r.safety.muted === false && Math.abs(r.safety.vol - 0.1) < 0.01,
  'a video that was playing when it left the view comes back when it returns': r.resume?.marked === '1' && r.resume.resumed === true && r.resume.plays >= 2,
  'theme change applies': r.themeApplied,
  'Discord button added next to Share in feed posts': r.feedEmbed && /redditez\.com\/r\/test\/comments\/ccc\//.test(r.feedEmbedCopied) && r.feedEmbedNoViewer,
  'Discord link button copies redditez.com permalink': /^https:\/\/redditez\.com\/r\/[^/]+\/comments\/[a-z0-9]+\//.test(r.embed?.copied || '') && r.embed.inPost,
  'no page errors or dialogs': !logs.some(l => /pageerror|DIALOG/.test(l)),
  'userscript: theme, quick bar, gear; no accounts button': r.us.built && r.us.theme && r.us.css && r.us.quickbar && r.us.gear && !r.us.accountsBtn && /"mode":"volume"/.test(r.us.videoAttr),
  'userscript: viewer and comments': r.us.comments === 61,
  'userscript: hls.js loads on first video, volume applied': r.us.hlsBefore === false && r.us.hlsAfter === true && r.us.vol === 0.1,
  'userscript: gear opens settings panel (no accounts tab)': r.us.panelInputs > 20 && !r.us.panelAccounts && r.us.themes > 3,
  'userscript: settings change saved and applied live': r.us.saved === 'nord' && r.us.applied,
  'userscript: Esc closes panel, no page errors': r.us.panelClosed && r.us.errors?.length === 0,
  'userscript: clicks inside the settings panel keep it open': r.us.openAfterClick === 'video',
  'userscript: image lightbox opens with the gallery': !!r.us.lightbox?.fixed && r.us.lightbox.full && r.us.lightbox.img && r.us.lightbox.count === '1/2',
  'userscript: a plain .mp4 link gets sound in the lightbox, and a refused start comes back on the next click': r.us.mp4?.there && r.us.mp4.blockedMuted === true && r.us.mp4.muted === false && Math.abs(r.us.mp4.vol - 0.1) < 0.01 && r.us.mp4.user === null,
  'userscript: the lightbox hands a Reddit video to Reddit\'s own player and takes it back': r.us.orig?.btn && r.us.orig.video && /^https:\/\/embed\.reddit\.com\/r\/test\/comments\/vvv\/post_vvv\/\?embed=true&showmedia=true/.test(r.us.orig.frame) && !/\.js(\?|$)/.test(r.us.orig.frame) && !r.us.orig.videoAfter && r.us.orig.videoBack && r.us.orig.frameGone,
  'userscript: an embedded player stays the provider\'s iframe; the bar opens the provider page': r.us.embedOut?.frame && r.us.embedOut.href === 'https://www.youtube.com/watch?v=abc',
  'userscript: a provider link builds its own player (redgifs, YouTube, gifv) and never hijacks hosted videos': r.us.redgifs?.rg === 'https://www.redgifs.com/ifr/tremendousthoughtfulneonrainbowfish' && r.us.redgifs.yt === 'https://www.youtube-nocookie.com/embed/abc123' && /\.mp4$/.test(r.us.redgifs.gifv) && r.us.redgifs.host === null,
  'userscript: a redgifs post with no API data opens the redgifs player, not Reddit\'s silent preview': /^https:\/\/www\.redgifs\.com\/ifr\/tremendousthoughtfulneonrainbowfish/.test(r.us.redgifs?.iframe || '') && !r.us.redgifs.video,
  'userscript: a provider player is mounted only in view (no audio from an embed behind you)': r.us.lazy?.off === '' && /^https:\/\/www\.redgifs\.com\/ifr\//.test(r.us.lazy?.on || ''),
  'userscript: an embedded player has a reload button for a dead provider': r.us.redgifs?.reload === true,
  'userscript: a page player\'s play() out of view waits, plays in view, pauses as it leaves and comes back (open shadow root)': (o => o && !o.aOff && o.aIn && !o.aLeft && o.aBack)(r.us.offscreen),
  'userscript: closed-root native autoplay waits offscreen, starts on entry and pauses on exit': (o => o && !o.closedAutoplayOff && o.closedAutoplayIn && !o.closedAutoplayLeft)(r.us.offscreen),
  'userscript: late settings stop closed-root playback and allow resume on entry': (o => o && o.beforeSettings && !o.afterSettings && o.settingsResume && o.closedDiagnostic)(r.us.offscreen),
  'userscript: the same for a player in a closed shadow root': (o => o && !o.bOff && o.bIn && !o.bLeft && o.bBack)(r.us.offscreen),
  'userscript: an autoplay player whose source arrives out of view waits until it comes in': (o => o && !o.cOff && o.cIn)(r.us.offscreen),
  'userscript: a player restarting its video after buffering out of view waits until it comes in': (o => o && !o.dOff && o.dIn)(r.us.offscreen),
  'userscript: an autoplay video that started before our scan is paused out of view and plays when it comes in': (o => o && !o.eOff && o.eIn)(r.us.offscreen),
  'userscript: our own video inserted out of view does not play until it comes in': (o => o && !o.fOff && o.fIn)(r.us.offscreen),
  'userscript: a user pause followed by the user\'s play does not stop the video coming back after it scrolls away': (o => o && o.gUserPaused === '1' && !o.gLeft && o.gBack)(r.us.offscreen),
  'userscript: an autoplay player in a shadow root stays paused behind the lightbox': r.us.offscreen?.iBehindLb === false,
  'userscript: strip lightbox: neighbours below the fold do not play; scrolled to, they do': (s => !!s && s.first.length > 2 && s.first[0].playing && s.first.some(x => x.out) && !s.first.some(x => x.out && x.playing)
    && s.later[s.later.length - 1].playing && !s.later.some(x => x.out && x.playing))(r.us.strip),
};

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
if (failed) console.log('userscript details:', JSON.stringify(r.us));
if (failed) { console.log(JSON.stringify(r, null, 2)); process.exit(1); }

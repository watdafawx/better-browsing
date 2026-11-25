// Offline test for the X Fast UI, Milestone 3 (overlays: x/src/content/fast/lightbox.js, drawer.js, keys.js): the media
// lightbox, the thread drawer over Home and the keyboard. Loads dist/better-browsing-x.user.js into plain Chromium (or
// Firefox with BROWSER=firefox) on a mock x.com: a small "X app" in #react-root that fetches its own HomeTimeline at
// boot and follows popstate like React Router, a fake webpack chunk with the operations (made-up query IDs; one run
// without TweetDetail, as before the user ever opened a post on X), and a fake GraphQL backend whose TweetDetail answers
// in X's 2026 Relay shape. Never touches live X. Run: npm run test:x:overlay
import { chromium, firefox } from 'playwright';
import fs from 'fs';
import path from 'path';

const usFile = path.resolve(process.argv[2] || process.env.US_FILE || 'dist/better-browsing-x.user.js');
const FF = process.env.BROWSER === 'firefox';
const CLIP = fs.readFileSync(path.resolve('test/fixtures/clip.webm'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const launchOpts = FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } } : { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await (FF ? firefox : chromium).launch(launchOpts);
const logs = [], ok = {}, r = {};
const check = (name, cond, detail) => { ok[name] = !!cond; r[name] = detail; };

// ---------- GraphQL payload fixtures ----------
const user = (id, sn, name) => ({ __typename: 'User', rest_id: id, is_blue_verified: false,
  core: { name, screen_name: sn, created_at: 'Mon Jan 02 15:04:05 +0000 2012' }, avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg` }, legacy: { followers_count: 10 } });
const U = { alice: user('100', 'alice', 'Alice'), bob: user('200', 'bob', 'Bob'), carol: user('300', 'carol', 'Carol'), dave: user('400', 'dave', 'Dave') };
const tw = (id, u, legacy = {}) => ({
  __typename: 'Tweet', rest_id: id, core: { user_results: { result: u } }, views: { count: '4521', state: 'EnabledWithCount' },
  legacy: { bookmark_count: 3, bookmarked: false, created_at: 'Thu Nov 20 10:30:00 +0000 2025', conversation_id_str: id, entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
    favorite_count: 10, favorited: false, full_text: 'hi', is_quote_status: false, lang: 'en', quote_count: 1, reply_count: 2, retweet_count: 3, retweeted: false, user_id_str: u.rest_id, id_str: id, ...legacy } });
const videoMedia = id => ({ type: 'video', id_str: 'v' + id, media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/poster.jpg`, url: 'https://t.co/v' + id, original_info: { width: 1280, height: 720 },
  video_info: { aspect_ratio: [16, 9], duration_millis: 15041, variants: [
    { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/ext_tw_video/${id}/pu/pl/x.m3u8` },
    { bitrate: 256000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/avc1/320x180/a.mp4` },
    { bitrate: 2176000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/avc1/1280x720/b.mp4` }] } });
const photo = n => ({ type: 'photo', id_str: 'ph' + n, media_url_https: `https://pbs.twimg.com/media/p${n}.jpg`, url: 'https://t.co/p' + n, original_info: { width: 1200, height: 800 }, ext_alt_text: 'cat ' + n });
const T = {
  std: tw('1001', U.alice, { full_text: 'Hello and welcome, a plain first post' }),
  photos: tw('1005', U.alice, { full_text: 'four photos https://t.co/p1', extended_entities: { media: [photo(1), photo(2), photo(3), photo(4)] } }),
  video: tw('1007', U.alice, { full_text: 'a video https://t.co/v1007', extended_entities: { media: [videoMedia('1007')] } }),
  focal: tw('1501', U.alice, { full_text: '@carol the focal post of a thread', display_text_range: [7, 33], in_reply_to_status_id_str: '1500', in_reply_to_screen_name: 'carol', in_reply_to_user_id_str: '300', conversation_id_str: '1500' }),
};
const filler = (id, u = U.bob, text) => tw(String(id), u, { full_text: text || `Filler post ${id}, a line of plain text.` });
const itemOf = result => ({ itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result }, tweetDisplayType: 'Tweet' });
const tEntry = res => ({ entryId: 'tweet-' + res.rest_id, sortIndex: '1', content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: itemOf(res) } });
const cEntry = (type, v) => ({ entryId: 'cursor-' + type.toLowerCase() + '-' + v, sortIndex: '1', content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: v, cursorType: type } });
const range = (a, n, f) => Array.from({ length: n }, (_, i) => f(a + i, i));
const HOME = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries: [
  tEntry(T.std), tEntry(T.photos), tEntry(T.video), ...range(1100, 4, id => tEntry(filler(id))), tEntry(T.focal), ...range(1110, 24, id => tEntry(filler(id))),
  cEntry('Top', 'TOP0'), cEntry('Bottom', 'BOT1')] }] } } } });

// TweetDetail in X's 2026 Relay shape: threaded_conversation_with_injections_v2, entry_id, content.content, cursor_type,
// tweet_results { id, rest_id, result } with details / counts / perspective
const rtw = (id, u, text, o = {}) => ({ id: 'VHdlZXQ6' + id, rest_id: id, result: { __typename: 'Tweet', rest_id: id, core: { user_results: { result: u } },
  details: { full_text: text, created_at_ms: 1763634600000 + (+id % 100) * 60000, ...(o.replyTo ? { in_reply_to_status_id_str: o.replyTo } : {}) },
  counts: { reply_count: 1, retweet_count: 0, quote_count: 0, favorite_count: 5, bookmark_count: 0 }, perspective: { favorited: false, retweeted: false, bookmarked: false },
  views: { count: '77' }, url_entities: [], mention_entities: [], media_entities2: o.media || [] } });
const rItem = t => ({ __typename: 'TimelineTweet', tweet_results: t, display_type: 'Tweet' });
const rEntry = t => ({ entry_id: 'tweet-' + t.rest_id, sort_index: '1', content: { __typename: 'TimelineTimelineItem', content: rItem(t) } });
const rModule = (id, ts) => ({ entry_id: 'conversationthread-' + id, sort_index: '1', content: { __typename: 'TimelineTimelineModule', display_type: 'VerticalConversation',
  items: ts.map(t => ({ entry_id: 'conversationthread-' + id + '-tweet-' + t.rest_id, item: { content: rItem(t) } })) } });
const rCursor = (type, v) => ({ entry_id: 'cursor-' + type.toLowerCase() + '-' + v, sort_index: '0', content: { __typename: 'TimelineTimelineCursor', value: v, cursor_type: type } });
const R = {
  1500: rtw('1500', U.carol, 'the root of the thread'),
  1501: rtw('1501', U.alice, 'the focal post of a thread', { replyTo: '1500' }),
  1502: rtw('1502', U.bob, 'first reply', { replyTo: '1501' }),
  1503: rtw('1503', U.alice, 'the author answers the first reply', { replyTo: '1502' }),
  1504: rtw('1504', U.dave, 'another reply', { replyTo: '1501' }),
  1510: rtw('1510', U.dave, 'a late reply', { replyTo: '1501' }),
  1511: rtw('1511', U.carol, 'the last reply', { replyTo: '1501' }),
  1520: rtw('1520', U.carol, 'a reply to the first reply', { replyTo: '1502' }),
  1005: rtw('1005', U.alice, 'four photos', { media: [photo(1), photo(2), photo(3), photo(4)] }),
};
const detail = (focal, cursor) => {
  let entries;
  if (cursor === 'DBOT-1501') entries = [rEntry(R[1510]), rEntry(R[1511])];
  else if (focal === '1501') entries = [rEntry(R[1500]), rEntry(R[1501]), rModule('a', [R[1502], R[1503]]), rEntry(R[1504]), rCursor('Bottom', 'DBOT-1501')];
  else if (focal === '1502') entries = [rEntry(R[1500]), rEntry(R[1501]), rEntry(R[1502]), rEntry(R[1520])];
  else if (R[focal]) entries = [rEntry(R[focal])];
  else entries = [];
  return { data: { threaded_conversation_with_injections_v2: { instructions: [{ __typename: 'TimelineAddEntries', type: 'TimelineAddEntries', entries }] } } };
};

// ---------- the page ----------
const OPS = { HomeTimeline: ['QIDHOME0000000001', 'query'], HomeLatestTimeline: ['QIDLATEST00000001', 'query'], TweetDetail: ['QIDDETAIL00000001', 'query'],
  FavoriteTweet: ['QIDFAV00000000001', 'mutation'], UnfavoriteTweet: ['QIDUNFAV000000001', 'mutation'], CreateRetweet: ['QIDRT000000000001', 'mutation'],
  DeleteRetweet: ['QIDUNRT0000000001', 'mutation'], CreateBookmark: ['QIDBM000000000001', 'mutation'], DeleteBookmark: ['QIDUNBM0000000001', 'mutation'] };
const chunk = ops => `window.__mkop = function (q, n, t, fs) { return new Function('e', 'e.exports={queryId:"' + q + '",operationName:"' + n + '",operationType:"' + t + '",metadata:{featureSwitches:' + JSON.stringify(fs || []) + ',fieldToggles:[]}}'); };
window.webpackChunk_twitter_responsive_web = [[['pre'], {${Object.entries(ops).map(([op, [q, t]], i) => `${100 + i}: __mkop('${q}', '${op}', '${t}', ['feat_a'])`).join(',')}}]];`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Home / X</title></head><body style="margin:0;background:#000;color:#e7e9ea;font:15px sans-serif">
<div id="react-root"><div style="display:flex">
<header style="width:260px"><nav aria-label="Primary" role="navigation">
<a href="/home" data-testid="AppTabBar_Home_Link" aria-label="Home"><div><svg viewBox="0 0 24 24" width="24"><path d="M2 2h20v20H2z"/></svg><span>Home</span></div></a>
<a href="/explore" data-testid="AppTabBar_Explore_Link" aria-label="Search and explore"><div><svg viewBox="0 0 24 24" width="24"><path d="M2 2h20v20H2z"/></svg><span>Explore</span></div></a>
</nav></header>
<main id="xmain" style="height:3000px"><div id="xpage">X page /home</div></main></div></div>
<script>
window.__xNav = []; window.__xKeys = [];
addEventListener('popstate', function () { __xNav.push(location.pathname); document.getElementById('xpage').textContent = 'X page ' + location.pathname; });
document.addEventListener('keydown', function (e) { __xKeys.push(e.key); });
var HEADERS = { authorization: 'Bearer TESTBEARER', 'x-csrf-token': 'csrf-live', 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes', 'x-twitter-client-language': 'en' };
var FEATS = encodeURIComponent(JSON.stringify({ feat_a: true, feat_b: false }));
window.xGet = function (qid, op, vars) {
  return fetch('/i/api/graphql/' + qid + '/' + op + '?variables=' + encodeURIComponent(JSON.stringify(vars)) + '&features=' + FEATS, { headers: HEADERS, credentials: 'include' }).then(function (r) { return r.json(); });
};
setTimeout(function () { xGet('QIDHOME0000000001', 'HomeTimeline', { count: 20, includePromotedContent: true, latestControlAvailable: true, requestContext: 'launch', withCommunity: true }); }, 150);
</script></body></html>`;

function backend(srv) {
  return async route => {
    const req = route.request(), u = new URL(req.url());
    try {
      if (u.hostname === 'video.twimg.com') {
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
        if (!m) return await route.fulfill({ status: 200, contentType: 'video/webm', body: CLIP, headers: { 'accept-ranges': 'bytes' } });
        const a = +m[1], b = m[2] ? Math.min(+m[2], CLIP.length - 1) : CLIP.length - 1;
        return await route.fulfill({ status: 206, contentType: 'video/webm', body: CLIP.subarray(a, b + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${CLIP.length}` } });
      }
      if (u.hostname === 'pbs.twimg.com') return await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (u.hostname !== 'x.com') return await route.fulfill({ status: 404, body: '' });
      const g = /^\/i\/api\/graphql\/([\w-]+)\/(\w+)/.exec(u.pathname);
      if (!g) return await route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
      const q = { qid: g[1], op: g[2], method: req.method() };
      const body = req.postData();
      q.vars = JSON.parse(u.searchParams.get('variables') || (body ? JSON.stringify(JSON.parse(body).variables) : 'null')) || {};
      srv.reqs.push(q);
      let out = { data: { ok: q.op } };
      if (q.op === 'HomeTimeline') out = q.vars.cursor ? { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [cEntry('Top', 'TOPX')] }] } } } } : HOME();
      else if (q.op === 'TweetDetail') { if (srv.detailDelay) await new Promise(res => setTimeout(res, srv.detailDelay)); out = detail(String(q.vars.focalTweetId), q.vars.cursor); }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    } catch {}
  };
}

const seedScript = s => `localStorage.setItem('xbb-userscript-settings', ${JSON.stringify(JSON.stringify({ settings: s }))}); localStorage.setItem('xbb-settings-snapshot', ${JSON.stringify(JSON.stringify(s))});`;
async function open({ seed = { fastUi: true }, ops = OPS, srvOpts = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (!FF) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
  const srv = Object.assign({ reqs: [] }, srvOpts);
  await ctx.route(/x\.com|twimg\.com|example\.test/, backend(srv));
  await ctx.addCookies([{ name: 'night_mode', value: '2', url: 'https://x.com' }]);
  await ctx.addInitScript(seedScript(seed));
  await ctx.addInitScript(chunk(ops));
  await ctx.addInitScript({ path: usFile });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || /XBB/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto('https://x.com/home');
  return { ctx, page, srv };
}
const hits = (srv, op) => srv.reqs.filter(q => q.op === op);
const S = 'document.querySelector("xbb-fast")?.shadowRoot';
const waitFor = (page, expr, timeout = 6000) => page.waitForFunction(expr, null, { timeout, polling: 50 }).then(() => true, () => false);
const waitTweet = (page, id) => waitFor(page, `!!${S}?.querySelector('.vlist article.tweet[data-id="${id}"]')`, 8000);
const owner = page => page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-xbb-fast'), react: getComputedStyle(document.getElementById('react-root')).display, path: location.pathname }));
const frames = page => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60)))));
const settle = async (page, ms = 250) => { await page.waitForTimeout(ms); await frames(page); };
const sy = page => page.evaluate(() => Math.round(scrollY));
const lb = page => page.evaluate(() => XBB.fast.lightbox.debug());
const dr = page => page.evaluate(() => XBB.fast.drawer.debug());
const hist = page => page.evaluate(() => ({ path: location.pathname, overlay: history.state && history.state.overlay, len: history.length }));
// a tweet in the feed, scrolled a little below the header (so the scroll position is not 0 and is worth keeping)
const scrollToTweet = (page, id) => page.evaluate(id => new Promise(res => {
  const step = (n) => {
    const sr = document.querySelector('xbb-fast').shadowRoot, a = sr.querySelector(`.vlist article.tweet[data-id="${id}"]`);
    if (a) { const y = a.getBoundingClientRect().top + scrollY - 260; scrollTo(0, y); return requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => res(Math.round(scrollY)), 80))); }
    const y = XBB.fast.view().list().offsetOf(id);
    if (y == null || n > 30) return res(null);
    scrollTo(0, y); requestAnimationFrame(() => requestAnimationFrame(() => step(n + 1)));
  };
  step(0);
}), id);
const feed = (id, sel = '') => `xbb-fast .vlist article.tweet[data-id="${id}"] ${sel}`.trim();
const inDrawer = (id, sel = '') => `xbb-fast dialog.drawer article.tweet[data-id="${id}"] ${sel}`.trim();

// ---------- 1. the media lightbox ----------
{
  const { ctx, page, srv } = await open();
  await waitTweet(page, '1005');
  await settle(page);
  const y0 = await scrollToTweet(page, '1005');
  const len0 = (await hist(page)).len;
  await page.locator(feed('1005', 'a.ph[data-lb="0"]')).click();
  await waitFor(page, 'XBB.fast.lightbox.isOpen()');
  await settle(page, 150);
  let d = await lb(page), h = await hist(page);
  check('lightbox: a photo click opens the dialog (showModal) on the first photo at name=large, with a history entry', d.open && d.cur?.id === '1005' && d.cur.i === 0 && d.count === '1 / 4' && /name=large/.test(d.src || '') && h.overlay === 'lightbox' && h.path === '/home' && h.len === len0 + 1
    && await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.lb').matches(':modal')), { d, h, len0 });
  check('lightbox: the bottom bar has the author, text and the actions (like, RT, like+RT, bookmark, copy, open thread)', await page.evaluate(() => {
    const sr = document.querySelector('xbb-fast').shadowRoot, b = sr.querySelector('dialog.lb .lb-bar');
    return !!b && /Alice/.test(b.querySelector('.lb-who').textContent) && /four photos/.test(b.querySelector('.lb-text').textContent)
      && ['rt', 'like', 'lrt', 'bm', 'copy'].every(k => b.querySelector(`[data-act="${k}"]`)) && !!b.querySelector('[data-lb-act="thread"]');
  }), null);
  await page.locator('xbb-fast dialog.lb [data-lb-act="next"]').click();
  await settle(page, 80);
  const c2 = (await lb(page)).count;
  await page.keyboard.press('ArrowRight');
  await settle(page, 80);
  const c3 = (await lb(page)).count;
  await page.mouse.move(700, 450);
  await page.waitForTimeout(320);
  await page.mouse.wheel(0, 150);
  await settle(page, 120);
  const c4 = (await lb(page)).count;
  await page.waitForTimeout(320);
  await page.keyboard.press('ArrowRight');
  await settle(page, 80);
  const c4b = (await lb(page)).count;
  await page.keyboard.press('ArrowLeft');
  await settle(page, 80);
  d = await lb(page); h = await hist(page);
  check('lightbox: steps through 4 photos (Next button, Right arrow, wheel), stops at the end, Left goes back', c2 === '2 / 4' && c3 === '3 / 4' && c4 === '4 / 4' && c4b === '4 / 4' && d.count === '3 / 4' && /p3\.jpg/.test(d.src) && h.len === len0 + 1, { c2, c3, c4, c4b, d, h });
  await page.locator('xbb-fast dialog.lb [data-lb-act="alt"]').click();
  check('lightbox: the ALT button shows the alt text', await page.evaluate(() => { const a = document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.lb .lb-alt'); return !a.hidden && a.textContent === 'cat 3'; }), null);
  await page.locator('xbb-fast dialog.lb .lb-stage img').click();
  await settle(page, 80);
  const z1 = await lb(page);
  await page.keyboard.press('+');
  const z2 = await lb(page);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  const z3 = await lb(page);
  check('lightbox: a click on the picture zooms in at name=orig, + and - change the zoom', z1.zoom === 2 && /name=orig/.test(z1.src) && z2.zoom === 3 && z3.zoom === 1, { z1, z2, z3 });
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.lightbox.isOpen()');
  await settle(page);
  h = await hist(page);
  let o = await owner(page);
  check('lightbox: Esc closes it, the history entry goes, the feed is at the same pixel', !(await lb(page)).open && h.overlay !== 'lightbox' && h.path === '/home' && Math.abs(await sy(page) - y0) <= 1 && o.attr === 'home', { h, y: await sy(page), y0, o });
  await page.locator(feed('1005', 'a.ph[data-lb="2"]')).click();
  await waitFor(page, 'XBB.fast.lightbox.isOpen()');
  const reopen = await lb(page);
  await page.goBack();
  await waitFor(page, '!XBB.fast.lightbox.isOpen()');
  await settle(page);
  h = await hist(page); o = await owner(page);
  check('lightbox: opens at the photo clicked; the browser Back closes it with the scroll kept and Home still ours', reopen.count === '3 / 4' && !(await lb(page)).open && h.path === '/home' && o.attr === 'home' && o.react === 'none' && Math.abs(await sy(page) - y0) <= 1 && !(await page.evaluate(() => __xNav.length)), { reopen, h, o, y: await sy(page), y0 });

  // a video: the expand button opens it in the lightbox, the feed's videos pause and stay paused behind it
  await scrollToTweet(page, '1007');
  await page.locator(feed('1007', '.vid')).hover();
  await page.locator(feed('1007', 'button.expand')).click();
  await waitFor(page, 'XBB.fast.lightbox.isOpen()');
  await page.waitForTimeout(900);
  const vid = await page.evaluate(() => {
    const sr = document.querySelector('xbb-fast').shadowRoot, v = sr.querySelector('dialog.lb video[data-xbb-lb-video]');
    return { has: !!v, src: v && v.currentSrc || v?.src, controls: v?.controls, feedPlaying: [...sr.querySelectorAll('.vlist video')].filter(x => !x.paused).length };
  });
  check('lightbox: a video opens in a <video controls> at the best MP4; no feed video plays behind it', vid.has && vid.controls && /1280x720\/b\.mp4/.test(vid.src) && vid.feedPlaying === 0, vid);
  // like from the lightbox bar: the same store, so the feed's button follows
  await page.locator('xbb-fast dialog.lb .lb-bar [data-act="like"]').click();
  await page.waitForTimeout(300);
  const liked = await page.evaluate(() => ({ lb: document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.lb [data-act="like"]').getAttribute('aria-pressed'), feed: document.querySelector('xbb-fast').shadowRoot.querySelector('.vlist article.tweet[data-id="1007"] [data-act="like"]')?.getAttribute('aria-pressed') }));
  check('lightbox: Like in the bar sends FavoriteTweet and the feed card follows', hits(srv, 'FavoriteTweet').some(q => q.vars.tweet_id === '1007') && liked.lb === 'true' && liked.feed === 'true', { liked, favs: hits(srv, 'FavoriteTweet') });
  // "Open thread": the lightbox entry becomes the drawer's
  await page.locator('xbb-fast dialog.lb [data-lb-act="thread"]').click();
  await waitFor(page, 'XBB.fast.drawer.isOpen() && !XBB.fast.lightbox.isOpen()');
  h = await hist(page);
  check('lightbox: "Open thread" swaps the viewer for the drawer on that post', (await dr(page)).focal === '1007' && h.path === '/alice/status/1007' && h.overlay === 'drawer', h);
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('lightbox: and Esc there closes it to /home', (await hist(page)).path === '/home' && (await owner(page)).attr === 'home', await hist(page));
  await ctx.close();
}

// ---------- 2. the thread drawer ----------
{
  const { ctx, page, srv } = await open({ srvOpts: { detailDelay: 500 } });
  await waitTweet(page, '1501');
  await settle(page);
  const y0 = await scrollToTweet(page, '1501');
  await page.locator(feed('1501', '.text')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()', 3000);
  const early = await page.evaluate(() => ({ focal: !!document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.drawer article.tweet.focal[data-id="1501"]'), replies: XBB.fast.drawer.debug().replies.length }));
  let o = await owner(page), h = await hist(page);
  check('drawer: a card click opens the drawer and paints the post from the store at once (before TweetDetail answers)', early.focal && early.replies === 0, early);
  check('drawer: the URL is the post (/alice/status/1501) but Home stays ours: X is not told, its page stays hidden', h.path === '/alice/status/1501' && h.overlay === 'drawer' && o.attr === 'home' && o.react === 'none' && !(await page.evaluate(() => __xNav.length)), { h, o });
  await waitFor(page, 'XBB.fast.drawer.debug().replies.length >= 3');
  let d = await dr(page);
  const det = hits(srv, 'TweetDetail');
  check('drawer: one TweetDetail call for the focal post; Relay ancestors above, replies below', det.length === 1 && det[0].vars.focalTweetId === '1501' && det[0].qid === 'QIDDETAIL00000001' && d.ancestors.join() === '1500' && d.replies.join() === '1502,1503,1504' && d.cursor === 'DBOT-1501', { det, d });
  check('drawer: the focal post is big with its full date; the reply module has its thread line', await page.evaluate(() => {
    const sr = document.querySelector('xbb-fast').shadowRoot;
    return !!sr.querySelector('dialog.drawer article.tweet.focal .fulldate') && !!sr.querySelector('dialog.drawer .dr-anc article.tweet[data-id="1500"]') && !!sr.querySelector('dialog.drawer article.tweet.thread-next[data-id="1502"]') && !!sr.querySelector('dialog.drawer article.tweet.thread-prev[data-id="1503"]');
  }), null);
  check('drawer: the feed behind did not move', Math.abs(await sy(page) - y0) <= 1, { y: await sy(page), y0 });
  await page.locator('xbb-fast dialog.drawer [data-dr="more"]').click();
  await waitFor(page, 'XBB.fast.drawer.debug().replies.includes("1511")');
  d = await dr(page);
  check('drawer: "Show more replies" loads the next page with the cursor', d.replies.join() === '1502,1503,1504,1510,1511' && hits(srv, 'TweetDetail').some(q => q.vars.cursor === 'DBOT-1501') && !d.cursor, d);
  // a reply: one level deeper, with Back in the header
  await page.locator(inDrawer('1502', '.text')).click();
  await waitFor(page, 'XBB.fast.drawer.focal() === "1502" && XBB.fast.drawer.debug().replies.length > 0');
  d = await dr(page); h = await hist(page);
  const backShown = await page.evaluate(() => !document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.drawer [data-dr="back"]').hidden);
  check('drawer: a reply pushes onto the stack (/bob/status/1502, Back shown, its own ancestors and replies)', d.stack.join() === '1501,1502' && h.path === '/bob/status/1502' && backShown && d.ancestors.join() === '1500,1501' && d.replies.join() === '1520', { d, h, backShown });
  const before = hits(srv, 'TweetDetail').length;
  await page.locator('xbb-fast dialog.drawer [data-dr="back"]').click();
  await waitFor(page, 'XBB.fast.drawer.focal() === "1501" && XBB.fast.drawer.debug().replies.length >= 3');
  h = await hist(page);
  check('drawer: Back goes one post back, from the cache (no new request)', h.path === '/alice/status/1501' && hits(srv, 'TweetDetail').length === before, { h, n: hits(srv, 'TweetDetail').length, before });
  await page.locator('xbb-fast dialog.drawer [data-dr="mode"]').click();
  const centred = await page.evaluate(() => ({ c: document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.drawer').classList.contains('center'), ls: localStorage.getItem('xbb-fast-drawer-mode') }));
  await page.locator('xbb-fast dialog.drawer [data-dr="mode"]').click();
  check('drawer: the header toggles a centred modal (remembered)', centred.c && centred.ls === 'center', centred);
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  h = await hist(page); o = await owner(page);
  check('drawer: Esc closes it to /home, at the exact scroll pixel, Home still ours', h.path === '/home' && !h.overlay && o.attr === 'home' && Math.abs(await sy(page) - y0) <= 1 && !(await page.evaluate(() => __xNav.length)), { h, o, y: await sy(page), y0 });

  // the time link and the browser Back
  await page.locator(feed('1501', 'a.when')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  const viaTime = (await hist(page)).path;
  await page.goBack();
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('drawer: the time opens it too; the browser Back closes it with the scroll kept', viaTime === '/alice/status/1501' && (await hist(page)).path === '/home' && Math.abs(await sy(page) - y0) <= 1, { viaTime, h: await hist(page), y: await sy(page), y0 });
  // Reply, then a click beside the panel
  await page.locator(feed('1501', '[data-act="reply"]')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  await page.mouse.click(200, 450);
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('drawer: Reply opens it; a click on the backdrop closes it to /home', (await hist(page)).path === '/home' && Math.abs(await sy(page) - y0) <= 1, { h: await hist(page), y: await sy(page), y0 });

  // a photo inside the drawer opens the lightbox on top; Esc closes one level at a time
  await scrollToTweet(page, '1005');
  const y1 = await sy(page);
  await page.locator(feed('1005', '.text')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  await page.locator(inDrawer('1005', 'a.ph[data-lb="1"]')).click();
  await waitFor(page, 'XBB.fast.lightbox.isOpen()');
  const both = { lb: await lb(page), dr: (await dr(page)).open, h: await hist(page) };
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.lightbox.isOpen()');
  await settle(page, 150);
  const after1 = { lb: (await lb(page)).open, dr: (await dr(page)).open, h: await hist(page) };
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('drawer: a photo in the drawer opens the lightbox on top; Esc closes the lightbox, then the drawer', both.lb.open && both.lb.count === '2 / 4' && both.dr && after1.dr && !after1.lb && after1.h.path === '/alice/status/1005' && (await hist(page)).path === '/home' && Math.abs(await sy(page) - y1) <= 1, { both, after1, h: await hist(page) });

  // X fetched TweetDetail itself (the tap): the drawer uses that response and sends nothing
  const n0 = hits(srv, 'TweetDetail').length;
  await page.evaluate(() => xGet('QIDDETAIL00000001', 'TweetDetail', { focalTweetId: '1502', with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: true }));
  await page.waitForTimeout(700);
  await page.evaluate(() => XBB.fast.drawer.open('1502'));
  await waitFor(page, 'XBB.fast.drawer.debug().replies.length > 0');
  check('drawer: a TweetDetail X fetched itself is used as is (no request of ours)', hits(srv, 'TweetDetail').length === n0 + 1 && (await dr(page)).replies.join() === '1520', { n: hits(srv, 'TweetDetail').length, n0 });
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await ctx.close();
}

// ---------- 3. TweetDetail not learned yet (missing-op): the post, a note, Open on X; Home is never failed ----------
{
  const ops = Object.fromEntries(Object.entries(OPS).filter(([k]) => k !== 'TweetDetail'));
  const { ctx, page, srv } = await open({ ops });
  await waitTweet(page, '1501');
  await settle(page);
  await scrollToTweet(page, '1501');
  await page.locator(feed('1501', '.text')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  await waitFor(page, '/Replies not loaded yet/.test(XBB.fast.drawer.debug().banner)');
  const d = await dr(page);
  const st = await page.evaluate(() => ({ broken: XBB.fast.isBroken('home'), ss: sessionStorage.getItem('xbb-fast-broken'), open: XBB.gql.breaker.isOpen('TweetDetail'), homeOpen: XBB.gql.breaker.isOpen('HomeTimeline'),
    focal: !!document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.drawer article.tweet.focal[data-id="1501"]'),
    btn: !!document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.drawer .dr-banner [data-dr="native"]') }));
  const o = await owner(page);
  check('missing-op: the focal post shows with "Replies not loaded yet — Open on X once to learn TweetDetail" and an Open on X button', st.focal && st.btn && /Replies not loaded yet — Open on X once to learn TweetDetail/.test(d.banner) && hits(srv, 'TweetDetail').length === 0, { d, st });
  check('missing-op: Home is not failed (no broken route, Home breaker closed, Fast UI still owns Home)', !st.broken && !st.ss && !st.homeOpen && o.attr === 'home' && o.react === 'none', { st, o });
  await page.locator('xbb-fast dialog.drawer .dr-banner [data-dr="native"]').click();
  await waitFor(page, '!document.documentElement.hasAttribute("data-xbb-fast") || document.documentElement.getAttribute("data-xbb-fast") === "native"');
  await settle(page);
  const o2 = await owner(page);
  const nav = await page.evaluate(() => __xNav.slice());
  check('missing-op: Open on X hands that post to X\'s own page (X is told by popstate, its page shows)', o2.path === '/alice/status/1501' && o2.react !== 'none' && o2.attr !== 'home' && nav.includes('/alice/status/1501') && !(await dr(page)).open, { o2, nav });
  // X's own page now fetches TweetDetail: the op is learned and the breaker closes by itself
  await page.evaluate(() => xGet('QIDLEARNED0000001', 'TweetDetail', { focalTweetId: '1501', with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: true }));
  await page.waitForTimeout(700);
  const learned = await page.evaluate(() => ({ open: XBB.gql.breaker.isOpen('TweetDetail'), status: XBB.gql.status ? null : null }));
  check('missing-op: a TweetDetail X sends teaches the op and closes its breaker', !learned.open, learned);
  await ctx.close();
}

// ---------- 4. keyboard ----------
{
  const { ctx, page, srv } = await open();
  await waitTweet(page, '1005');
  await settle(page, 400);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); __xKeys.length = 0; });
  const kf = () => page.evaluate(() => ({ key: XBB.fast.keys.debug().feed, ring: [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('.vlist article.tweet.kfocus')].map(a => a.dataset.id) }));
  await page.keyboard.press('j');
  await settle(page, 400);
  const k1 = await kf();
  await page.keyboard.press('j');
  await settle(page, 500);
  const k2 = await kf();
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await settle(page, 500);
  const k3 = await kf();
  check('keys: j / k move the focus ring through the feed', k1.key === '1001' && k1.ring.join() === '1001' && k2.key === '1005' && k2.ring.join() === '1005' && k3.key === '1005', { k1, k2, k3 });
  check('keys: X\'s own page never sees the shortcut keys', (await page.evaluate(() => __xKeys.slice())).length === 0, await page.evaluate(() => __xKeys.slice()));
  await page.keyboard.press('l');
  await page.keyboard.press('t');
  await page.keyboard.press('b');
  await page.waitForTimeout(500);
  const pr = await page.evaluate(() => { const a = document.querySelector('xbb-fast').shadowRoot.querySelector('.vlist article.tweet[data-id="1005"]'); return ['like', 'rt', 'bm'].map(k => a.querySelector(`[data-act="${k}"]`)?.getAttribute('aria-pressed')); });
  check('keys: l / t / b like, retweet and bookmark the focused post', hits(srv, 'FavoriteTweet').some(q => q.vars.tweet_id === '1005') && hits(srv, 'CreateRetweet').some(q => q.vars.tweet_id === '1005') && hits(srv, 'CreateBookmark').some(q => q.vars.tweet_id === '1005') && pr.join() === 'true,true,true', { pr, reqs: srv.reqs.map(q => q.op) });
  if (!FF) {
    await page.keyboard.press('c');
    await page.waitForTimeout(400);
    const c = await page.evaluate(() => ({ last: XBB.fast.lastCopy, toast: document.querySelector('.xbb-fast-toast')?.textContent }));
    check('keys: c copies the post\'s embed link', /\/alice\/status\/1005/.test(c.last || '') && /Link copied/.test(c.toast || ''), c);
  }
  await page.keyboard.press('m');
  await waitFor(page, 'XBB.fast.lightbox.isOpen()', 3000);
  const m = await lb(page);
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.lightbox.isOpen()');
  await settle(page);
  check('keys: m opens the focused post\'s media in the lightbox, Esc closes it', m.open && m.cur?.id === '1005' && !(await lb(page)).open && (await hist(page)).path === '/home', m);
  await page.keyboard.press('o');
  await waitFor(page, 'XBB.fast.drawer.isOpen()', 3000);
  const o1 = await dr(page);
  await waitFor(page, 'XBB.fast.drawer.articles().length >= 1');
  await page.keyboard.press('j');
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  const afterDr = await kf();
  check('keys: o opens the focused post in the drawer, keys act on the drawer\'s post there, Esc closes it (the ring stays)', o1.open && o1.focal === '1005' && (await hist(page)).path === '/home' && afterDr.key === '1005', { o1, afterDr });
  await page.keyboard.press('Escape');
  await settle(page, 100);
  const cleared = await kf();
  check('keys: Esc with nothing open clears the focus ring', cleared.key === null && cleared.ring.length === 0, cleared);
  await page.keyboard.press('/');
  await settle(page, 100);
  const focusSearch = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return sr.activeElement === sr.querySelector('.side .search input'); });
  await page.keyboard.type('jj');
  await settle(page, 100);
  const typed = await page.evaluate(() => ({ v: document.querySelector('xbb-fast').shadowRoot.querySelector('.side .search input').value, f: XBB.fast.keys.debug().feed }));
  check('keys: / focuses the search box; typing there is not taken for shortcuts', focusSearch && typed.v === 'jj' && typed.f === null, { focusSearch, typed });
  await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.activeElement?.blur());
  // the setting off: no shortcut acts
  await page.evaluate(() => { XBB.settings.fastUiKeys = false; });
  await page.keyboard.press('j');
  await settle(page, 100);
  check('keys: with fastUiKeys off nothing happens', (await kf()).key === null, await kf());
  await ctx.close();
}

let fails = 0;
for (const [k, v] of Object.entries(ok)) {
  if (!v) fails++;
  console.log(`${v ? 'PASS' : 'FAIL'}  ${k}${v ? '' : '  ' + JSON.stringify(r[k])}`);
}
if (logs.length) console.log('\nconsole:\n' + [...new Set(logs)].slice(0, 40).join('\n'));
await browser.close();
process.exit(fails ? 1 : 0);

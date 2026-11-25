// Offline test for the X Fast UI, Milestone 2 (x/src/content/fast/): the shell, the Home view with its two tabs,
// tweet cards, video, the action bar and every way back to X's own page. Loads dist/better-browsing-x.user.js into
// plain Chromium (or Firefox with BROWSER=firefox) on a mock x.com: a small "X app" in #react-root that fetches its
// own HomeTimeline at boot and follows popstate like React Router, a fake webpack chunk with the operations (made-up
// query IDs), and a fake GraphQL backend with timeline pages, a Following timeline and the mutations. Never touches
// live X. Run: npm run test:x:fast
import { chromium, firefox } from 'playwright';
import fs from 'fs';
import path from 'path';
import { idleMutations, churnCost, costOk } from './lib/perf.mjs';

const usFile = path.resolve(process.argv[2] || process.env.US_FILE || 'dist/better-browsing-x.user.js');
const FF = process.env.BROWSER === 'firefox';
const CLIP = fs.readFileSync(path.resolve('test/fixtures/clip.webm'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const launchOpts = FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } } : { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await (FF ? firefox : chromium).launch(launchOpts);
const logs = [], ok = {}, r = {};
const check = (name, cond, detail) => { ok[name] = !!cond; r[name] = detail; };

// ---------- GraphQL payload fixtures ----------
const user = (id, sn, name, extra = {}) => ({ __typename: 'User', rest_id: id, is_blue_verified: id === '100',
  core: { name, screen_name: sn, created_at: 'Mon Jan 02 15:04:05 +0000 2012' }, avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg` },
  verification: id === '100' ? { verified_type: 'Business' } : {}, legacy: { followers_count: 10 }, ...extra });
const U = { alice: user('100', 'alice', 'Alice'), bob: user('200', 'bob', 'Bob'), carol: user('300', 'carol', 'Carol'), dave: user('400', 'dave', 'Dave'), erin: user('500', 'erin', '') };
const tw = (id, u, legacy = {}, top = {}) => ({
  __typename: 'Tweet', rest_id: id, core: { user_results: { result: u } }, views: { count: '4521', state: 'EnabledWithCount' },
  legacy: { bookmark_count: 3, bookmarked: false, created_at: 'Thu Nov 20 10:30:00 +0000 2025', conversation_id_str: id, entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
    favorite_count: 10, favorited: false, full_text: 'hi', is_quote_status: false, lang: 'en', quote_count: 1, reply_count: 2, retweet_count: 3, retweeted: false, user_id_str: u.rest_id, id_str: id, ...legacy },
  ...top,
});
const videoMedia = (id, w = 1280, hh = 720) => ({ type: 'video', id_str: 'v' + id, media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/poster.jpg`, url: 'https://t.co/v' + id, original_info: { width: w, height: hh },
  video_info: { aspect_ratio: [16, 9], duration_millis: 15041, variants: [
    { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/ext_tw_video/${id}/pu/pl/x.m3u8` },
    { bitrate: 256000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/avc1/320x180/a.mp4` },
    { bitrate: 2176000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/avc1/1280x720/b.mp4` }] } });
const photo = n => ({ type: 'photo', id_str: 'ph' + n, media_url_https: `https://pbs.twimg.com/media/p${n}.jpg`, url: 'https://t.co/p' + n, original_info: { width: 1200, height: 800 }, ext_alt_text: 'cat ' + n });
const bv = (key, value) => ({ key, value });
const sv = (key, s) => bv(key, { string_value: s, type: 'STRING' });
const LONG = 'This is a long-form post with enough words to need more than six lines in a card. '.repeat(14).trim();
const T = {
  std: tw('1001', U.alice, { full_text: 'Hello &amp; welcome #hello @bob https://t.co/abc123',
    entities: { hashtags: [{ text: 'hello' }], symbols: [], user_mentions: [{ id_str: '200', screen_name: 'bob', name: 'Bob' }], urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.test/page', display_url: 'example.test/page' }] } }),
  note: tw('1002', U.alice, { full_text: LONG.slice(0, 270) + '… https://t.co/long1' }, { note_tweet: { is_expandable: true, note_tweet_results: { result: { id: 'n1', text: LONG, entity_set: { hashtags: [], urls: [], user_mentions: [] } } } } }),
  quote: tw('1003', U.carol, { full_text: 'quoting this https://t.co/q1', is_quote_status: true, entities: { hashtags: [], symbols: [], user_mentions: [], urls: [{ url: 'https://t.co/q1', expanded_url: 'https://x.com/alice/status/1901', display_url: 'x.com/alice/status/1901' }] } },
    { quoted_status_result: { result: tw('1901', U.alice, { full_text: 'the quoted post' }) } }),
  reply: tw('1004', U.bob, { full_text: '@alice thanks for this!', display_text_range: [7, 23], in_reply_to_status_id_str: '1001', in_reply_to_screen_name: 'alice', in_reply_to_user_id_str: '100' }),
  photos: tw('1005', U.alice, { full_text: 'three photos https://t.co/p1', extended_entities: { media: [photo(1), photo(2), photo(3)] }, possibly_sensitive: true }),
  rt: tw('1006', U.dave, { full_text: 'RT @alice: original', retweeted_status_result: { result: tw('1907', U.alice, { full_text: 'an original post that dave reposted' }) } }),
  video: tw('1007', U.alice, { full_text: 'a video https://t.co/v1007', extended_entities: { media: [videoMedia('1007')] } }),
  gif: tw('1008', U.alice, { full_text: 'gif https://t.co/g1', extended_entities: { media: [{ type: 'animated_gif', id_str: 'g1', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg', url: 'https://t.co/g1', original_info: { width: 400, height: 400 },
    video_info: { aspect_ratio: [1, 1], variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/g.mp4' }] } }] } }),
  poll: tw('1009', U.alice, { full_text: 'vote' }, { card: { rest_id: 'card://1', legacy: { name: 'poll3choice_text_only', url: 'card://1', binding_values: [
    sv('choice1_label', 'Red'), sv('choice2_label', 'Green'), sv('choice3_label', 'Blue'), sv('choice1_count', '10'), sv('choice2_count', '30'), sv('choice3_count', '60'),
    bv('counts_are_final', { boolean_value: true, type: 'BOOLEAN' }), sv('end_datetime_utc', '2025-11-21T10:30:00Z')] } } }),
  link: tw('1010', U.alice, { full_text: 'read this https://t.co/card1' }, { card: { rest_id: 'card://2', legacy: { name: 'summary_large_image', url: 'https://t.co/card1', binding_values: [
    sv('title', 'Example title'), sv('description', 'Example desc'), sv('vanity_url', 'example.test'), sv('card_url', 'https://t.co/card1'),
    bv('thumbnail_image_original', { image_value: { url: 'https://pbs.twimg.com/card_img/1/a?format=jpg&name=orig', width: 800, height: 418 }, type: 'IMAGE' })] } } }),
  cnote: tw('1011', U.alice, { full_text: 'disputed claim' }, { birdwatch_pivot: { destinationUrl: 'https://twitter.com/i/birdwatch/n/999', note: { rest_id: '999' }, subtitle: { text: 'Context &amp; sources', entities: [] }, title: 'Readers added context' } }),
  vis: { __typename: 'TweetWithVisibilityResults', tweet: tw('1012', U.bob, { full_text: 'limited reply' }), tweetInterstitial: { text: { text: 'The author limited who can reply.' } } },
  quoteTomb: tw('1013', U.carol, { full_text: 'quoting a ghost', is_quote_status: true }, { quoted_status_result: { result: { __typename: 'TweetTombstone', tombstone: { text: { text: 'This Post is unavailable.' } } } } }),
  video2: tw('1014', U.erin, { full_text: 'a second video https://t.co/v1014', extended_entities: { media: [videoMedia('1014')] } }),
  reply2: tw('1016', U.carol, { full_text: '@dave agreed', display_text_range: [6, 12], in_reply_to_status_id_str: '1999', in_reply_to_screen_name: 'dave', in_reply_to_user_id_str: '400' }),
  html: tw('1015', U.bob, { full_text: '<img src=x onerror="window.__pwned=1"> &lt;b&gt;not bold&lt;/b&gt;' }),
};
const filler = (id, u = U.bob, text) => tw(String(id), u, { full_text: text || `Filler post ${id}, a line of plain text.` });

const itemOf = result => ({ itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result }, tweetDisplayType: 'Tweet' });
const tEntry = res => ({ entryId: 'tweet-' + (res.rest_id || res.tweet?.rest_id || Math.random()), sortIndex: '1', content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: itemOf(res) } });
const cEntry = (type, v) => ({ entryId: 'cursor-' + type.toLowerCase() + '-' + v, sortIndex: '1', content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: v, cursorType: type } });
const mEntry = (id, results) => ({ entryId: 'conversationthread-' + id, sortIndex: '1', content: { entryType: 'TimelineTimelineModule', __typename: 'TimelineTimelineModule', displayType: 'VerticalConversation',
  items: results.map(res => ({ entryId: 'conversationthread-' + id + '-tweet-' + res.rest_id, item: { itemContent: itemOf(res) } })) } });
const timeline = (entries, wrap = 'home') => {
  const ins = [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries }];
  return wrap === 'home' ? { data: { home: { home_timeline_urt: { instructions: ins } } } } : { data: { home: { home_timeline_urt: { instructions: ins } } } };
};
const range = (a, n, f) => Array.from({ length: n }, (_, i) => f(a + i, i));
const PAGES = {
  first: () => timeline([
    tEntry(T.std), tEntry(T.note), tEntry(T.quote),
    { entryId: 'promoted-tweet-9001', sortIndex: '1', content: { entryType: 'TimelineTimelineItem', itemContent: { ...itemOf(filler(9001, U.carol, 'buy now')), promotedMetadata: { advertiser_id: '1' } } } },
    mEntry('77', [T.std, T.reply]), tEntry(T.photos), tEntry(T.rt), tEntry(T.video), tEntry(T.gif), tEntry(T.poll), tEntry(T.link), tEntry(T.cnote), tEntry(T.vis), tEntry(T.quoteTomb),
    ...range(1100, 6, id => tEntry(filler(id))), tEntry(T.video2), tEntry(T.html), tEntry(T.reply2),
    ...range(1110, 20, id => tEntry(filler(id))),
    cEntry('Top', 'TOP0'), cEntry('Bottom', 'BOT1')]),
  page: n => timeline([...range(2000 + n * 100, 20, id => tEntry(filler(id))), cEntry('Top', 'TOPX'), ...(n < 4 ? [cEntry('Bottom', 'BOT' + (n + 1))] : [])]),
  fresh: () => timeline([tEntry(filler(8001, U.carol, 'brand new post one')), tEntry(filler(8002, U.carol, 'brand new post two')), tEntry(T.std), cEntry('Top', 'TOP1'), cEntry('Bottom', 'BOTF')]),
  big: () => timeline([...range(3000, 250, id => tEntry(filler(id, id % 2 ? U.bob : U.dave, `Big list post ${id}`))), cEntry('Top', 'TOPB')]),
  following: () => timeline([...range(5001, 25, id => tEntry(filler(id, U.dave, `following post ${id}`))), cEntry('Top', 'FTOP'), cEntry('Bottom', 'FBOT1')]),
  following2: () => timeline([...range(5101, 10, id => tEntry(filler(id, U.dave, `following post ${id}`))), cEntry('Top', 'FTOP2')]),
};

// ---------- the page ----------
const OPS = { HomeTimeline: ['QIDHOME0000000001', 'query'], HomeLatestTimeline: ['QIDLATEST00000001', 'query'], FavoriteTweet: ['QIDFAV00000000001', 'mutation'], UnfavoriteTweet: ['QIDUNFAV000000001', 'mutation'],
  CreateRetweet: ['QIDRT000000000001', 'mutation'], DeleteRetweet: ['QIDUNRT0000000001', 'mutation'], CreateBookmark: ['QIDBM000000000001', 'mutation'], DeleteBookmark: ['QIDUNBM0000000001', 'mutation'] };
const CHUNK = `window.__mkop = function (q, n, t, fs) { return new Function('e', 'e.exports={queryId:"' + q + '",operationName:"' + n + '",operationType:"' + t + '",metadata:{featureSwitches:' + JSON.stringify(fs || []) + ',fieldToggles:[]}}'); };
window.webpackChunk_twitter_responsive_web = [[['pre'], {${Object.entries(OPS).map(([op, [q, t]], i) => `${100 + i}: __mkop('${q}', '${op}', '${t}', ['feat_a'])`).join(',')}}]];`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Home / X</title></head><body style="margin:0;background:#000;color:#e7e9ea;font:15px sans-serif">
<div id="react-root"><div style="display:flex">
<header style="width:260px"><nav aria-label="Primary" role="navigation">
<a href="/home" data-testid="AppTabBar_Home_Link" aria-label="Home"><div><svg viewBox="0 0 24 24" width="24"><path d="M2 2h20v20H2z"/></svg><span>Home</span></div></a>
<a href="/explore" data-testid="AppTabBar_Explore_Link" aria-label="Search and explore"><div><svg viewBox="0 0 24 24" width="24"><path d="M2 2h20v20H2z"/></svg><span>Explore</span></div></a>
<a href="/alice" data-testid="AppTabBar_Profile_Link" aria-label="Profile"><div><svg viewBox="0 0 24 24" width="24"><path d="M2 2h20v20H2z"/></svg><span>Profile</span></div></a>
</nav></header>
<main id="xmain" style="height:3000px"><div id="xpage">X page /home</div><article data-testid="tweet"><div>X's own tweet</div></article></main></div></div>
<script>
window.__xNav = [];
addEventListener('popstate', function () { __xNav.push(location.pathname); document.getElementById('xpage').textContent = 'X page ' + location.pathname; });
var HEADERS = { authorization: 'Bearer TESTBEARER', 'x-csrf-token': 'csrf-live', 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes', 'x-twitter-client-language': 'en' };
var FEATS = encodeURIComponent(JSON.stringify({ feat_a: true, feat_b: false }));
var QID = { HomeTimeline: 'QIDHOME0000000001', HomeLatestTimeline: 'QIDLATEST00000001' };
window.xHome = function (op, vars) {
  return fetch('/i/api/graphql/' + QID[op] + '/' + op + '?variables=' + encodeURIComponent(JSON.stringify(vars)) + '&features=' + FEATS, { headers: HEADERS, credentials: 'include' }).then(function (r) { return r.json(); });
};
window.__xVars = { count: 20, includePromotedContent: true, latestControlAvailable: true, requestContext: 'launch', withCommunity: true };
setTimeout(function () { xHome('HomeTimeline', window.__xVars); }, 150);
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
      const status = srv.status[q.op] || 200;
      let out = { data: { ok: q.op } };
      if (q.op === 'HomeTimeline') {
        const c = q.vars.cursor;
        out = srv.empty ? { data: { home: {} } } : srv.big ? PAGES.big() : !c ? (srv.fresh ? PAGES.fresh() : PAGES.first()) : PAGES.page(+(/^BOT(\d+)$/.exec(c) || [0, 9])[1]);
      } else if (q.op === 'HomeLatestTimeline') out = q.vars.cursor ? PAGES.following2() : PAGES.following();
      if (srv.delay) await new Promise(res => setTimeout(res, srv.delay));
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? out : { errors: [{ message: 'nope' }] }) });
    } catch {}
  };
}

const seedScript = s => `localStorage.setItem('xbb-userscript-settings', ${JSON.stringify(JSON.stringify({ settings: s }))}); localStorage.setItem('xbb-settings-snapshot', ${JSON.stringify(JSON.stringify(s))});`;
async function open({ seed = { fastUi: true }, url = '/home', srvOpts = {}, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height } });
  if (!FF) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
  const srv = Object.assign({ reqs: [], status: {} }, srvOpts);
  await ctx.route(/x\.com|twimg\.com|example\.test/, backend(srv));
  await ctx.addCookies([{ name: 'night_mode', value: '2', url: 'https://x.com' }]);
  await ctx.addInitScript(seedScript(seed));
  await ctx.addInitScript(CHUNK);
  await ctx.addInitScript({ path: usFile });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || /XBB/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto('https://x.com' + url);
  return { ctx, page, srv };
}
const hits = (srv, op) => srv.reqs.filter(q => q.op === op);
const S = 'document.querySelector("xbb-fast")?.shadowRoot';
const waitTweet = (page, id, timeout = 8000) => page.waitForFunction(`!!${S}?.querySelector('article.tweet[data-id="${id}"]')`, null, { timeout }).then(() => true, () => false);
const owner = page => page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-xbb-fast'),
  react: getComputedStyle(document.getElementById('react-root')).display,
  fast: document.querySelector('xbb-fast') ? getComputedStyle(document.querySelector('xbb-fast')).display : 'absent',
  path: location.pathname,
  entry: document.querySelectorAll('.xbb-fast-entry').length,
}));
const frames = page => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60)))));
const dbg = page => page.evaluate(() => XBB.fast.debug());
const act = (page, id, k) => page.locator(`xbb-fast article.tweet[data-id="${id}"] [data-act="${k}"]`).first();
const pressed = (page, id, k) => page.evaluate(([id, k]) => { const b = document.querySelector('xbb-fast').shadowRoot.querySelector(`article.tweet[data-id="${id}"] [data-act="${k}"]`); return b ? { p: b.getAttribute('aria-pressed'), n: b.querySelector('.n')?.textContent ?? null, done: b.classList.contains('done') } : null; }, [id, k]);
const scrollToTweet = (page, id, block = 'center') => page.evaluate(([id, block]) => new Promise(res => {
  const step = () => {
    const sr = document.querySelector('xbb-fast').shadowRoot, a = sr.querySelector(`article.tweet[data-id="${id}"]`);
    if (a) { a.scrollIntoView({ block }); return requestAnimationFrame(() => requestAnimationFrame(() => { const b = sr.querySelector(`article.tweet[data-id="${id}"]`); if (b) b.scrollIntoView({ block }); res(true); })); }
    const y = XBB.fast.view().list().offsetOf(id);
    if (y == null) return res(false);
    scrollTo(0, y); requestAnimationFrame(() => requestAnimationFrame(step));
  };
  step();
}), [id, block]);

// ---------- 1. Fast UI off: nothing of it exists ----------
{
  const { ctx, page, srv } = await open({ seed: { fastUi: false } });
  await page.waitForTimeout(1500);
  const o = await owner(page);
  check('fastUi off: <xbb-fast> never mounts, #react-root shows, no data-xbb-fast', o.fast === 'absent' && o.attr === null && o.react !== 'none' && o.entry === 0, o);
  check('fastUi off: X\'s own Home request is not tapped', hits(srv, 'HomeTimeline').length === 1 && await page.evaluate(() => !document.documentElement.hasAttribute('data-xbb-api-tap') && !XBB.gql.getTapped('HomeTimeline')), hits(srv, 'HomeTimeline').length);
  const idle = await idleMutations(page, 2500);
  check('fastUi off: zero idle mutations', idle === 0, idle);
  await ctx.close();
}

// ---------- 2. Fast UI on, /home ----------
{
  const { ctx, page, srv } = await open();
  const shown = await waitTweet(page, '1001');
  await frames(page);
  let o = await owner(page);
  check('fastUi on: shell mounts on /home and #react-root is hidden', shown && o.attr === 'home' && o.react === 'none' && o.fast === 'block', o);
  let d = await dbg(page);
  check('boot: the tapped HomeTimeline renders with 0 extra requests', hits(srv, 'HomeTimeline').length === 1 && d.extraRequests === 0 && d.view.rows >= 30, { hits: srv.reqs.map(q => q.op), d });
  check('boot: the promoted entry is not shown, the repeat in the thread module is folded', await page.evaluate(() => { const v = XBB.fast.view().list().rows(); return !v.some(x => x.id === '9001') && v.filter(x => x.id === '1001').length === 1; }), null);
  const shell = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return { topbar: !!sr.querySelector('.topbar'), rail: !!sr.querySelector('.rail .nav[aria-current="page"]'), side: !!sr.querySelector('.side .search input'), tabs: [...sr.querySelectorAll('.tabs [role="tab"]')].map(b => b.textContent + ':' + b.getAttribute('aria-selected')).join(), theme: document.querySelector('xbb-fast').getAttribute('data-theme'), style: XBB.fast.debug().styleMode, bg: getComputedStyle(document.querySelector('xbb-fast')).backgroundColor, stat: sr.querySelector('.stat')?.textContent }; });
  check('shell: top bar, rail, sidebar, two tabs, a theme and its stylesheet', shell.topbar && shell.rail && shell.side && shell.tabs === 'For you:true,Following:false' && shell.theme === 'black' && /adopted|style/.test(shell.style) && shell.bg === 'rgb(0, 0, 0)', shell);

  // every card shape, collected while scrolling through the page (the list is virtual: off-screen rows are gone)
  const shapes = await page.evaluate(() => new Promise(res => {
    const sr = document.querySelector('xbb-fast').shadowRoot, seen = {};
    const look = () => {
      const q = (k, sel) => { if (sr.querySelector(sel)) seen[k] = true; };
      q('text', 'article.tweet[data-id="1001"] .text a[href="/hashtag/hello?src=hashtag_click"]');
      q('mention', 'article.tweet[data-id="1001"] .text a[href="/bob"]');
      q('url', 'article.tweet[data-id="1001"] .text a[href="https://example.test/page"]');
      q('long', 'article.tweet[data-id="1002"] .text.clamp + .show-more');
      q('quote', 'article.tweet[data-id="1003"] .quote[data-href="/alice/status/1901"]');
      q('quoteLinkDropped', 'article.tweet[data-id="1003"] .text:not(:has(a))');
      q('thread', 'article.tweet.thread-next[data-id="1001"], article.tweet.thread-prev[data-id="1004"]');
      q('replyTo', 'article.tweet[data-id="1016"] .reply-to a[href="/dave"]');
      q('sensitive', 'article.tweet[data-id="1005"] .sens [data-act="reveal"]');
      q('retweet', 'article.tweet[data-id="1907"] .ctx');
      q('video', 'article.tweet[data-id="1007"] .vid video[controls][data-xbb-fast-video]');
      q('gif', 'article.tweet[data-id="1008"] video[data-xbb-gif][loop]');
      q('poll', 'article.tweet[data-id="1009"] .poll .opt.win');
      q('link', 'article.tweet[data-id="1010"] a.lcard[href="https://t.co/card1"]');
      q('note', 'article.tweet[data-id="1011"] .cnote');
      q('interstitial', 'article.tweet[data-id="1012"] .inter');
      q('quoteTomb', 'article.tweet[data-id="1013"] .quote.tomb');
      q('initials', 'article.tweet[data-id="1014"] .av');
      q('badge', 'article.tweet[data-id="1001"] .badge.gold');
      q('actions', 'article.tweet[data-id="1001"] .actions [data-act="lrt"] ~ [data-act="bm"] ~ [data-act="copy"]');
      const h = sr.querySelector('article.tweet[data-id="1015"] .text');
      if (h) { seen.htmlSafe = !sr.querySelector('article.tweet[data-id="1015"] img[src="x"]') && /<img src=x/.test(h.textContent) && !window.__pwned; }
    };
    let n = 0;
    const step = () => { look(); if (n++ > 40 || scrollY + innerHeight >= document.documentElement.scrollHeight - 5) { scrollTo(0, 0); res(seen); return; } scrollBy(0, 400); requestAnimationFrame(() => requestAnimationFrame(step)); };
    step();
  }));
  const want = ['text', 'mention', 'url', 'long', 'quote', 'quoteLinkDropped', 'thread', 'replyTo', 'sensitive', 'retweet', 'video', 'gif', 'poll', 'link', 'note', 'interstitial', 'quoteTomb', 'initials', 'badge', 'actions', 'htmlSafe'];
  check('cards: every shape renders (text, links, long-form, quote, thread, reply, media, video, GIF, poll, link card, note, interstitial, tombstone)', want.every(k => shapes[k]), want.filter(k => !shapes[k]));
  await frames(page);

  // reveal sensitive media: the row re-renders in place
  await scrollToTweet(page, '1005');
  await page.locator('xbb-fast article.tweet[data-id="1005"] [data-act="reveal"]').click();
  await frames(page);
  check('cards: revealing sensitive media re-renders the row', await page.evaluate(() => { const a = document.querySelector('xbb-fast').shadowRoot.querySelector('article.tweet[data-id="1005"]'); return !!a && !a.querySelector('.sens') && a.querySelectorAll('.media a.ph img').length === 3; }), null);

  // long-form expansion above the viewport: what is at the top of the screen stays exactly where it is
  await page.evaluate(() => scrollTo(0, 0));
  await frames(page);
  const anchor = await page.evaluate(() => new Promise(res => {
    const sr = document.querySelector('xbb-fast').shadowRoot, list = XBB.fast.view().list();
    const off = list.offsetOf('1002'), rowH = sr.querySelector('article.tweet[data-id="1002"]').closest('.row').offsetHeight;
    const listTop = sr.querySelector('.vlist').getBoundingClientRect().top + scrollY;
    scrollTo(0, listTop + off + rowH + 250);
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
      const rows = [...sr.querySelectorAll('.vlist > .row')].filter(n => n.getBoundingClientRect().top >= 0).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const a = rows[0], before = a.getBoundingClientRect().top, key = a.firstChild?.dataset.id;
      const note = sr.querySelector('article.tweet[data-id="1002"]'), noteBottom = note.getBoundingClientRect().bottom, h0 = note.offsetHeight;
      note.querySelector('.show-more').click();
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
        const b = sr.querySelector(`article.tweet[data-id="${key}"]`);
        const n2 = sr.querySelector('article.tweet[data-id="1002"]');
        res({ key, before, after: b && b.getBoundingClientRect().top, noteAbove: noteBottom < 0, grew: n2 ? n2.offsetHeight - h0 : null, clamp: n2 && !!n2.querySelector('.text.clamp') });
      }, 120)));
    }, 80)));
  }));
  check('scroll anchor: expanding a long-form tweet above the viewport does not move what is on screen', anchor.noteAbove && anchor.grew > 40 && !anchor.clamp && Math.abs(anchor.after - anchor.before) < 2, anchor);

  // video: native controls, one at a time, the user's volume
  await scrollToTweet(page, '1007');
  await page.waitForTimeout(1500);
  const vstate = () => page.evaluate(() => [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('video:not([data-xbb-gif])')].map(v => ({ id: v.closest('article').dataset.id, playing: !v.paused, muted: v.muted, volume: v.volume, controls: v.controls })));
  let vs = await vstate();
  const p1 = vs.filter(v => v.playing);
  check('video: native controls, the one in view plays with the user\'s volume', vs.length >= 1 && vs.every(v => v.controls) && p1.length === 1 && p1[0].id === '1007' && !p1[0].muted && Math.abs(p1[0].volume - 0.4) < 0.01, vs);
  await page.evaluate(() => { window.__both = 0; window.__vt = setInterval(() => { const n = [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('video:not([data-xbb-gif])')].filter(v => !v.paused).length; if (n > 1) window.__both++; }, 50); });
  await scrollToTweet(page, '1014');
  await page.waitForTimeout(1800);
  vs = await vstate();
  const both = await page.evaluate(() => { clearInterval(window.__vt); return window.__both; });
  const p2 = vs.filter(v => v.playing);
  check('video: one at a time, the next one in view takes over', p2.length === 1 && p2[0].id === '1014' && both <= 2, { vs, both });
  const gifPlays = await page.evaluate(() => { const g = document.querySelector('xbb-fast').shadowRoot.querySelector('video[data-xbb-gif]'); return g ? { muted: g.muted, loop: g.loop } : null; });
  check('video: GIFs are muted loops outside the video policy', !gifPlays || (gifPlays.muted && gifPlays.loop), gifPlays);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);

  // actions
  await act(page, '1001', 'like').click();
  await page.waitForTimeout(500);
  let pr = await pressed(page, '1001', 'like');
  const fav = hits(srv, 'FavoriteTweet');
  check('action: Like is optimistic and sends FavoriteTweet', pr && pr.p === 'true' && pr.n === '11' && fav.length === 1 && fav[0].vars.tweet_id === '1001' && fav[0].method === 'POST', { pr, fav });
  await act(page, '1001', 'like').click();
  await page.waitForTimeout(500);
  pr = await pressed(page, '1001', 'like');
  check('action: Like again sends UnfavoriteTweet', pr.p === 'false' && pr.n === '10' && hits(srv, 'UnfavoriteTweet').length === 1, pr);
  srv.status.FavoriteTweet = 403; srv.delay = 400;
  await act(page, '1004', 'like').click();
  const mid = await pressed(page, '1004', 'like');
  await page.waitForTimeout(700);
  pr = await pressed(page, '1004', 'like');
  const toast = await page.evaluate(() => { const t = document.querySelector('.xbb-fast-toast'); return t ? { on: t.classList.contains('on'), text: t.textContent } : null; });
  check('action: a refused Like rolls back with a toast', mid.p === 'true' && pr.p === 'false' && pr.n === '10' && toast && toast.on && /Couldn't like/.test(toast.text), { mid, pr, toast });
  delete srv.status.FavoriteTweet; srv.delay = 0;
  await page.evaluate(() => XBB.gql.breaker.reset());
  await page.evaluate(() => { sessionStorage.removeItem('xbb-fast-broken'); });
  o = await owner(page);
  if (o.attr !== 'home') await page.evaluate(() => location.reload());
  if (o.attr !== 'home') await waitTweet(page, '1001');

  await act(page, '1003', 'lrt').click();
  await page.waitForTimeout(700);
  const lrt = { like: await pressed(page, '1003', 'like'), rt: await pressed(page, '1003', 'rt'), lrt: await pressed(page, '1003', 'lrt') };
  const rtq = hits(srv, 'CreateRetweet');
  check('action: Like + Retweet sends both and marks both', lrt.like.p === 'true' && lrt.rt.p === 'true' && lrt.lrt.p === 'true' && rtq.length === 1 && rtq[0].vars.tweet_id === '1003' && hits(srv, 'FavoriteTweet').some(q => q.vars.tweet_id === '1003'), { lrt, rtq: rtq.map(q => q.vars) });
  await act(page, '1001', 'bm').click();
  await page.waitForTimeout(400);
  check('action: Bookmark sends CreateBookmark', (await pressed(page, '1001', 'bm')).p === 'true' && hits(srv, 'CreateBookmark').length === 1, null);
  await act(page, '1001', 'copy').click();
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => XBB.fast.lastCopy);
  const clip = FF ? copied : await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  pr = await pressed(page, '1001', 'copy');
  check('action: Copy embed link copies the vxtwitter link', copied === 'https://vxtwitter.com/alice/status/1001' && clip === copied && pr.done, { copied, clip, pr });

  // Following tab
  await page.locator('xbb-fast .tabs [data-tab="following"]').click();
  const fol = await waitTweet(page, '5001');
  const lat = hits(srv, 'HomeLatestTimeline');
  check('tabs: Following loads HomeLatestTimeline with Home\'s variables', fol && lat.length >= 1 && !lat[0].vars.cursor && lat[0].vars.count === 20 && lat[0].vars.requestContext === undefined, lat.map(q => q.vars));
  await page.locator('xbb-fast .tabs [data-tab="foryou"]').click();
  const back = await waitTweet(page, '1001');
  check('tabs: back on For you, the timeline is still there (no new request)', back && hits(srv, 'HomeTimeline').filter(q => !q.vars.cursor).length === 1, hits(srv, 'HomeTimeline').map(q => q.vars.cursor || '-'));

  // pagination
  for (let i = 0; i < 12 && hits(srv, 'HomeTimeline').filter(q => q.vars.cursor).length < 2; i++) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
  }
  d = await dbg(page);
  const pages = hits(srv, 'HomeTimeline').filter(q => q.vars.cursor).map(q => q.vars.cursor);
  check('pagination: near the end the next page loads with the bottom cursor, one at a time', pages[0] === 'BOT1' && pages[1] === 'BOT2' && new Set(pages).size === pages.length && d.view.rows >= 80, { pages, rows: d.view.rows });
  check('stats: the top bar counts our own requests', /extra requests/.test(await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('.stat').textContent)) && d.extraRequests >= 2, d.extraRequests);

  // new posts while scrolled down: the pill
  await page.evaluate(() => scrollTo(0, 1600));
  await frames(page);
  srv.fresh = true;
  await page.evaluate(() => xHome('HomeTimeline', window.__xVars));
  await page.waitForTimeout(500);
  const pill = await page.evaluate(() => { const p = document.querySelector('xbb-fast').shadowRoot.querySelector('[data-pill]'); return { hidden: p.hidden, text: p.textContent, y: scrollY }; });
  await page.locator('xbb-fast [data-pill]').click();
  const gotNew = await waitTweet(page, '8001', 3000);
  const yTop = await page.evaluate(() => scrollY);
  check('new posts: a "Show 2 posts" pill while scrolled down; it puts them on top', !pill.hidden && pill.text === 'Show 2 posts' && pill.y > 1000 && gotNew && yTop < 5, { pill, gotNew, yTop });

  // links to a page Fast UI does not own go to X's own router; Back brings Fast UI where it was
  await page.evaluate(() => scrollTo(0, 400));
  await frames(page);
  // (profiles, search and bookmarks are Fast UI's own since M4; Explore is still X's)
  await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('.rail a[href="/explore"]').click());
  await page.waitForTimeout(400);
  o = await owner(page);
  const xNav = await page.evaluate(() => window.__xNav.slice());
  check('router: a link to a page Fast UI does not own (Explore) hands it to X\'s router (no reload)', o.path === '/explore' && o.attr === null && o.react !== 'none' && o.fast === 'none' && xNav.includes('/explore') && o.entry === 1, { o, xNav });
  await page.evaluate(() => history.back());
  await page.waitForTimeout(500);
  o = await owner(page);
  const y = await page.evaluate(() => scrollY);
  check('router: Back returns to Fast UI at the same place', o.path === '/home' && o.attr === 'home' && o.react === 'none' && Math.abs(y - 400) < 60, { o, y });

  // the escape hatch
  await page.locator('xbb-fast [data-xbb-to-native]').click();
  await page.waitForTimeout(200);
  o = await owner(page);
  check('escape: the Native X button shows X\'s own page, with a "Fast UI" entry in its sidebar', o.attr === 'native' && o.react !== 'none' && o.fast === 'none' && o.entry === 1, o);
  await page.locator('.xbb-fast-entry').click();
  await page.waitForTimeout(200);
  o = await owner(page);
  check('escape: the sidebar entry switches back', o.attr === 'home' && o.react === 'none' && o.entry === 0, o);
  await page.keyboard.press('Alt+Shift+KeyX');
  await page.waitForTimeout(200);
  const k1 = await owner(page);
  await page.keyboard.press('Alt+Shift+KeyX');
  await page.waitForTimeout(200);
  const k2 = await owner(page);
  check('escape: Alt+Shift+X switches both ways', k1.attr === 'native' && k1.react !== 'none' && k2.attr === 'home' && k2.react === 'none', { k1, k2 });

  // theme
  await page.locator('xbb-fast [data-bt-open]').click();     // the Appearance popover (userscript/themes.js)
  await page.locator('xbb-fast [data-theme-pick="dim"]').click();
  await page.waitForTimeout(300);
  const dim = await page.evaluate(() => ({ t: document.querySelector('xbb-fast').getAttribute('data-theme'), bg: getComputedStyle(document.querySelector('xbb-fast')).backgroundColor, saved: JSON.parse(localStorage.getItem('xbb-userscript-settings')).settings.fastUiTheme }));
  check('theme: Dim applies and is saved', dim.t === 'dim' && dim.bg === 'rgb(21, 32, 43)' && dim.saved === 'dim', dim);

  // Hopper palette from the picker: exact colours, variables inline, data-theme by mode, the page behind it, no leftovers on a classic theme
  await page.locator('xbb-fast [data-bt-open]').click();
  const tn = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return { n: sr.querySelectorAll('.bt-item').length, label: sr.querySelector('.bt-cur').textContent, open: sr.querySelector('.bt-pop').matches(':popover-open') }; });
  check('picker: opens, lists 22 themes (3 classic + 19 Hopper)', tn.open && tn.n === 22 && tn.label === 'Dim', tn);
  await page.locator('xbb-fast [data-theme-pick="tokyo-night"]').click();
  await page.waitForTimeout(300);
  const tk = await page.evaluate(() => { const h = document.querySelector('xbb-fast'), sr = h.shadowRoot; return { t: h.getAttribute('data-theme'), id: h.getAttribute('data-bb-theme'), bg: getComputedStyle(h).backgroundColor, accent: h.style.getPropertyValue('--accent'), html: getComputedStyle(document.documentElement).backgroundColor, saved: JSON.parse(localStorage.getItem('xbb-userscript-settings')).settings.fastUiTheme, label: sr.querySelector('.bt-cur').textContent, pressed: sr.querySelector('[data-theme-pick="tokyo-night"]')?.getAttribute('aria-pressed') }; });
  check('theme: Tokyo Night is the exact Hopper palette, saved, the page behind follows', tk.t === 'black' && tk.id === 'tokyo-night' && tk.bg === 'rgb(26, 27, 38)' && tk.accent === '#7aa2f7' && tk.html === 'rgb(26, 27, 38)' && tk.saved === 'tokyo-night' && tk.label === 'Tokyo Night' && tk.pressed === 'true', tk);
  // import a custom theme (Hopper JSON shape), pick it, then back to a classic theme
  const imp = await page.evaluate(() => XBB.fast.themes.importJson(JSON.stringify({ name: 'T', themes: [{ name: 'Test Teal', mode: 'light', colors: { background: '#f0fdfa', foreground: '#134e4a', 'primary.background': '#0d9488' } }] })));
  check('import: Hopper-style JSON becomes a custom theme', imp.ok && imp.ids[0] === 'custom-test-teal', imp);
  await page.evaluate(() => XBB.saveSetting('fastUiTheme', 'custom-test-teal'));
  await page.waitForTimeout(300);
  const ct = await page.evaluate(() => { const h = document.querySelector('xbb-fast'); return { t: h.getAttribute('data-theme'), bg: getComputedStyle(h).backgroundColor, scheme: h.style.colorScheme }; });
  check('theme: an imported light theme applies (data-theme light)', ct.t === 'light' && ct.bg === 'rgb(240, 253, 250)' && ct.scheme === 'light', ct);
  await page.evaluate(() => { XBB.fast.themes.removeCustom('custom-test-teal'); return XBB.saveSetting('fastUiTheme', 'dim'); });
  await page.waitForTimeout(300);
  const backDim = await page.evaluate(() => { const h = document.querySelector("xbb-fast"); return { t: h.getAttribute("data-theme"), bg: getComputedStyle(h).backgroundColor, inline: h.style.cssText, page: document.documentElement.hasAttribute('data-bb-page') }; });
  check('theme: back to Dim leaves no inline variables or page colour behind', backDim.t === "dim" && backDim.bg === "rgb(21, 32, 43)" && backDim.inline === "" && !backDim.page, backDim);

  // idle: nothing changes by itself, in the page or in the shadow root
  await page.evaluate(() => { for (const v of document.querySelector('xbb-fast').shadowRoot.querySelectorAll('video')) v.pause(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__shadowMut = 0; new MutationObserver(rs => { window.__shadowMut += rs.length; }).observe(document.querySelector('xbb-fast').shadowRoot, { subtree: true, childList: true, attributes: true, characterData: true }); });
  const idleDoc = await idleMutations(page, 2500);
  const idleShadow = await page.evaluate(() => window.__shadowMut);
  check('CPU: Fast UI on an idle page changes nothing by itself', idleDoc <= 10 && idleShadow <= 10, { idleDoc, idleShadow });
  await ctx.close();
}

// ---------- 3. a 250-tweet timeline stays small in the DOM ----------
{
  const { ctx, page } = await open({ srvOpts: { big: true } });
  await waitTweet(page, '3000');
  const res = await page.evaluate(() => new Promise(done => {
    const sr = document.querySelector('xbb-fast').shadowRoot;
    let max = 0, n = 0;
    const step = () => {
      max = Math.max(max, sr.querySelectorAll('.vlist > .row').length);
      if (n++ > 400 || scrollY + innerHeight >= document.documentElement.scrollHeight - 2) {
        requestAnimationFrame(() => requestAnimationFrame(() => done({ max, rows: XBB.fast.view().list().rows().length, last: !!sr.querySelector('article.tweet[data-id="3249"]'), steps: n })));
        return;
      }
      scrollBy(0, 700);
      requestAnimationFrame(() => requestAnimationFrame(step));
    };
    step();
  }));
  check('virtual list: 250 tweets, at most 35 rows mounted while scrolling to the end', res.rows === 250 && res.max <= 35 && res.max > 5 && res.last, res);
  await ctx.close();
}

// ---------- 4. ?xbb=native starts on X's own page ----------
{
  const { ctx, page } = await open({ url: '/home?xbb=native' });
  await page.waitForTimeout(1200);
  const o = await owner(page);
  check('escape: ?xbb=native starts on X\'s page, Fast UI not even mounted', o.attr === 'native' && o.react !== 'none' && o.fast === 'absent' && o.entry === 1, o);
  await page.keyboard.press('Alt+Shift+KeyX');
  const shown = await waitTweet(page, '1001');
  check('escape: from there Alt+Shift+X opens Fast UI with what X already loaded', shown && (await owner(page)).attr === 'home' && (await dbg(page)).extraRequests === 0, await owner(page));
  await ctx.close();
}

// ---------- 5. a broken API hands Home back to X ----------
{
  const { ctx, page, srv } = await open();
  await waitTweet(page, '1001');
  srv.status.HomeLatestTimeline = 400;
  await page.locator('xbb-fast .tabs [data-tab="following"]').click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-xbb-fast') !== 'home', null, { timeout: 5000 }).catch(() => {});
  const o = await owner(page);
  const st = await page.evaluate(() => ({ open: XBB.gql.breaker.isOpen('HomeLatestTimeline'), broken: sessionStorage.getItem('xbb-fast-broken'), toast: document.querySelector('.xbb-fast-toast')?.textContent }));
  check('breaker: a 400 on Following trips the breaker and X gets Home back', o.attr === null && o.react !== 'none' && o.fast === 'none' && st.open && /home/.test(st.broken || '') && /X changed something/.test(st.toast || ''), { o, st });
  await ctx.close();
}
{
  const { ctx, page } = await open({ srvOpts: { empty: true } });
  await page.waitForTimeout(1500);
  const o = await owner(page);
  check('schema guard: a HomeTimeline with no timeline in it hands Home back to X', o.attr === null && o.react !== 'none', o);
  await ctx.close();
}

// ---------- 6. CPU on a page that keeps changing, Fast UI on ----------
{
  const name = FF ? 'firefox' : 'chromium';
  const settings = JSON.stringify({ settings: { fastUi: true } });
  const c = await churnCost({ browserType: FF ? firefox : chromium, name, launchOpts, route: { re: /x\.com|twimg\.com/, fn: backend({ reqs: [], status: {} }) }, url: 'https://x.com/home', usFile,
    newContextOpts: { storageState: { cookies: [], origins: [{ origin: 'https://x.com', localStorage: [{ name: 'xbb-userscript-settings', value: settings }, { name: 'xbb-settings-snapshot', value: JSON.stringify({ fastUi: true }) }] }] } } });
  check('CPU: Fast UI on a page that keeps changing adds little work (' + name + ')', costOk(name, c), c);
}

let fails = 0;
for (const [k, v] of Object.entries(ok)) {
  if (!v) fails++;
  console.log(`${v ? 'PASS' : 'FAIL'}  ${k}${v ? '' : '  ' + JSON.stringify(r[k])}`);
}
if (logs.length) console.log('\nconsole:\n' + [...new Set(logs)].slice(0, 40).join('\n'));
await browser.close();
process.exit(fails ? 1 : 0);

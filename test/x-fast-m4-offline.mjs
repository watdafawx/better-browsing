// Offline test for the X Fast UI, Milestone 4 (views and popouts: x/src/content/fast/notifications.js, messages.js,
// feed.js, views/profile.js, views/search.js, views/bookmarks.js, the route table in flag.js/router.js/shell.js).
// Loads dist/better-browsing-x.user.js into plain Chromium (or Firefox with BROWSER=firefox) on a mock x.com: a small
// "X app" that fetches its own HomeTimeline and unread badge at boot and its UserByScreenName when its router lands on
// a profile, a fake webpack chunk with the operations (made-up query IDs; one run without the optional ones, in Zero-JS
// ext mode) and a fake backend for GraphQL and X's REST API (notifications, DMs, friendships). Never touches live X.
// Run: npm run test:x:m4
import { chromium, firefox } from 'playwright';
import path from 'path';

const usFile = path.resolve(process.argv[2] || process.env.US_FILE || 'dist/better-browsing-x.user.js');
const FF = process.env.BROWSER === 'firefox';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const browser = await (FF ? firefox : chromium).launch(FF ? {} : { args: ['--autoplay-policy=no-user-gesture-required'] });
const logs = [], ok = {}, r = {};
const check = (name, cond, detail) => { ok[name] = !!cond; r[name] = detail; };

// ---------- GraphQL payload fixtures ----------
const user = (id, sn, name, legacy = {}, extra = {}) => ({ __typename: 'User', rest_id: id, is_blue_verified: false,
  core: { name, screen_name: sn, created_at: 'Mon Jan 02 15:04:05 +0000 2012' }, avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg` },
  legacy: { followers_count: 10, friends_count: 5, statuses_count: 1234, ...legacy }, ...extra });
const U = {
  alice: user('100', 'alice', 'Alice', { description: 'Alice writes about cats and code', location: 'Berlin', profile_banner_url: 'https://pbs.twimg.com/profile_banners/100/1700000000',
    entities: { url: { urls: [{ expanded_url: 'https://alice.example.test/' }] } } }),
  bob: user('200', 'bob', 'Bob'), carol: user('300', 'carol', 'Carol', { description: 'Carol likes cats too' }), dave: user('400', 'dave', 'Dave'),
  me: user('999', 'me_user', 'Me Myself')
};
const BY_SN = { alice: U.alice, bob: U.bob, carol: U.carol, dave: U.dave, me_user: U.me };
const tw = (id, u, legacy = {}) => ({
  __typename: 'Tweet', rest_id: id, core: { user_results: { result: u } }, views: { count: '4521', state: 'EnabledWithCount' },
  legacy: { bookmark_count: 3, bookmarked: false, created_at: 'Thu Nov 20 10:30:00 +0000 2025', conversation_id_str: id, entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
    favorite_count: 10, favorited: false, full_text: 'hi', is_quote_status: false, lang: 'en', quote_count: 1, reply_count: 2, retweet_count: 3, retweeted: false, user_id_str: u.rest_id, id_str: id, ...legacy } });
const photo = n => ({ type: 'photo', id_str: 'ph' + n, media_url_https: `https://pbs.twimg.com/media/p${n}.jpg`, url: 'https://t.co/p' + n, original_info: { width: 1200, height: 800 } });
const filler = (id, u = U.bob, text) => tw(String(id), u, { full_text: text || `Filler post ${id}, a line of plain text.` });
const itemOf = result => ({ itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result }, tweetDisplayType: 'Tweet' });
const tEntry = res => ({ entryId: 'tweet-' + res.rest_id, sortIndex: '1', content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: itemOf(res) } });
const uEntry = u => ({ entryId: 'user-' + u.rest_id, sortIndex: '1', content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineUser', __typename: 'TimelineUser', user_results: { result: u } } } });
const cEntry = (type, v) => ({ entryId: 'cursor-' + type.toLowerCase() + '-' + v, sortIndex: '1', content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: v, cursorType: type } });
const range = (a, n, f) => Array.from({ length: n }, (_, i) => f(a + i, i));
const add = entries => [{ type: 'TimelineAddEntries', entries }];
const HOME = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineClearCache' }, ...add([
  tEntry(tw('1001', U.alice, { full_text: 'Hello and welcome, a plain first post' })), ...range(1100, 30, id => tEntry(filler(id))), cEntry('Top', 'TOP0'), cEntry('Bottom', 'BOT1')])] } } } });
const userTl = entries => ({ data: { user: { result: { __typename: 'User', timeline: { timeline: { instructions: add(entries) } } } } } });
const USER_TL = {
  UserTweets: uid => userTl([...range(2001, 12, id => tEntry(filler(id, uid === '999' ? U.me : U.alice, `Alice's own post ${id}`))), cEntry('Bottom', 'UT2')]),
  UserTweetsAndReplies: () => userTl([...range(2101, 6, id => tEntry(filler(id, U.alice, `Alice replies ${id}`))), cEntry('Bottom', 'UR2')]),
  UserMedia: () => userTl([tEntry(tw('2201', U.alice, { full_text: 'photo post https://t.co/p1', extended_entities: { media: [photo(1)] } })), cEntry('Bottom', 'UM2')])
};
const SEARCH = (q, product) => ({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions: add(product === 'People'
  ? [uEntry(U.carol), uEntry(U.dave), cEntry('Bottom', 'SP2')]
  : [...range(product === 'Latest' ? 3101 : 3001, 10, id => tEntry(filler(id, U.bob, `${q} are great, post ${id}`))), cEntry('Bottom', 'S2')]) } } } } });
const BOOKMARKS = cursor => ({ data: { bookmark_timeline_v2: { timeline: { instructions: add(
  !cursor ? [...range(4001, 20, id => tEntry(filler(id, U.carol, `Saved post ${id}`))), cEntry('Bottom', 'BK2')]
    : cursor === 'BK2' ? [...range(4021, 5, id => tEntry(filler(id, U.carol, `Saved post ${id}`))), cEntry('Bottom', 'BK3')]
      : [cEntry('Bottom', 'BK3')]) } } } });

// Mentions over GraphQL, X's 2026 Relay shape (entry_id, content.content, tweet_results { id, rest_id, result })
const rtw = (id, u, text) => ({ id: 'VHdlZXQ6' + id, rest_id: id, result: { __typename: 'Tweet', rest_id: id, core: { user_results: { result: u } },
  details: { full_text: text, created_at_ms: 1763634600000 }, counts: { reply_count: 0, retweet_count: 0, quote_count: 0, favorite_count: 1, bookmark_count: 0 },
  perspective: { favorited: false, retweeted: false, bookmarked: false }, url_entities: [], mention_entities: [], media_entities2: [] } });
const NOTIF_GQL = () => ({ data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: { instructions: [
  { __typename: 'TimelineAddEntries', type: 'TimelineAddEntries', entries: [
    { entry_id: 'notification-m1', sort_index: '700', content: { __typename: 'TimelineTimelineItem', content: { __typename: 'TimelineNotification', id: 'm1', notification_icon: 'person_icon',
      rich_message: { text: 'Dave followed you' }, template: { from_users: [{ user_results: { result: U.dave } }], target_objects: [] }, timestamp_ms: 1763634600000, notification_url: { url: 'https://x.com/dave' } } } },
    { entry_id: 'tweet-1502', sort_index: '600', content: { __typename: 'TimelineTimelineItem', content: { __typename: 'TimelineTweet', tweet_results: rtw('1502', U.bob, '@me_user a mention of you') } } },
    { entry_id: 'cursor-bottom-MB1', sort_index: '1', content: { __typename: 'TimelineTimelineCursor', value: 'MB1', cursor_type: 'Bottom' } }] }] } } } } } } });

// ---------- REST fixtures (flat v1.1 objects) ----------
const v1 = u => ({ id_str: u.rest_id, screen_name: u.core.screen_name, name: u.core.name, profile_image_url_https: u.avatar.image_url, followers_count: 10 });
const NOTIF_ALL = () => ({
  globalObjects: {
    users: { 100: v1(U.alice), 200: v1(U.bob), 400: v1(U.dave) },
    tweets: { 1001: { id_str: '1001', full_text: 'Hello and welcome, a plain first post', user_id_str: '100', created_at: 'Thu Nov 20 10:30:00 +0000 2025', favorite_count: 11, retweet_count: 3, reply_count: 2, entities: {} } },
    notifications: {
      n1: { id: 'n1', timestampMs: '1763634600000', icon: { id: 'heart_icon' }, message: { text: 'Bob liked your post' }, template: { aggregateUserActionsV1: { fromUsers: [{ user: { id: '200' } }], targetObjects: [{ tweet: { id: '1001' } }] } } },
      n2: { id: 'n2', timestampMs: '1763630000000', icon: { id: 'person_icon' }, message: { text: 'Dave followed you' }, template: { aggregateUserActionsV1: { fromUsers: [{ user: { id: '400' } }], targetObjects: [] } } }
    }
  },
  timeline: { id: 'Notifications', instructions: [{ markEntriesUnreadGreaterThanSortIndex: { sortIndex: '500' } }, { addEntries: { entries: [
    { entryId: 'notification-n1', sortIndex: '600', content: { item: { content: { notification: { id: 'n1', url: { url: 'https://x.com/alice/status/1001' }, fromUsers: ['200'] } } } } },
    { entryId: 'notification-n2', sortIndex: '400', content: { item: { content: { notification: { id: 'n2', url: { url: 'https://x.com/dave' }, fromUsers: ['400'] } } } } },
    { entryId: 'cursor-bottom-NB1', sortIndex: '100', content: { operation: { cursor: { value: 'NB1', cursorType: 'Bottom' } } } }] } }] }
});
const T0 = 1763634000000;
const dmUsers = () => ({ 999: v1(U.me), 100: v1(U.alice), 300: v1(U.carol) });
const dmConvs = () => ({
  '100-999': { conversation_id: '100-999', type: 'ONE_TO_ONE', sort_event_id: '5002', sort_timestamp: String(T0 + 200000), last_read_event_id: '5001', participants: [{ user_id: '100' }, { user_id: '999' }], trusted: true },
  '300-999': { conversation_id: '300-999', type: 'ONE_TO_ONE', is_e2ee: true, sort_event_id: '4001', sort_timestamp: String(T0), last_read_event_id: '4001', participants: [{ user_id: '300' }, { user_id: '999' }], trusted: true }
});
const dmMsg = (id, conv, sender, text, t) => ({ message: { id, time: String(t), conversation_id: conv, message_data: { id, time: String(t), sender_id: sender, text } } });
const INBOX = () => ({ inbox_initial_state: { cursor: 'C1', users: dmUsers(), conversations: dmConvs(), entries: [dmMsg('5001', '100-999', '999', 'hey alice', T0 + 100000), dmMsg('5002', '100-999', '100', 'hi there, how are you?', T0 + 200000)] } });
const CONV = id => ({ conversation_timeline: { status: 'AT_END', min_entry_id: '4990', users: dmUsers(), conversations: { [id]: dmConvs()[id] },
  entries: [dmMsg('4990', id, '100', 'an older message', T0), dmMsg('5001', id, '999', 'hey alice', T0 + 100000), dmMsg('5002', id, '100', 'hi there, how are you?', T0 + 200000)] } });

// ---------- the page ----------
const OPS = { HomeTimeline: ['QIDHOME0000000001', 'query'], HomeLatestTimeline: ['QIDLATEST00000001', 'query'], TweetDetail: ['QIDDETAIL00000001', 'query'],
  UserByScreenName: ['QIDUSER0000000001', 'query'], UserTweets: ['QIDUTWEETS0000001', 'query'], UserTweetsAndReplies: ['QIDUREPLIES000001', 'query'],
  UserMedia: ['QIDUMEDIA00000001', 'query'], SearchTimeline: ['QIDSEARCH00000001', 'query'], Bookmarks: ['QIDBOOKMARKS00001', 'query'],
  NotificationsTimeline: ['QIDNOTIF000000001', 'query'],
  FavoriteTweet: ['QIDFAV00000000001', 'mutation'], UnfavoriteTweet: ['QIDUNFAV000000001', 'mutation'], CreateBookmark: ['QIDBM000000000001', 'mutation'], DeleteBookmark: ['QIDUNBM0000000001', 'mutation'] };
const chunk = ops => `window.__mkop = function (q, n, t, fs) { return new Function('e', 'e.exports={queryId:"' + q + '",operationName:"' + n + '",operationType:"' + t + '",metadata:{featureSwitches:' + JSON.stringify(fs || []) + ',fieldToggles:[]}}'); };
window.webpackChunk_twitter_responsive_web = [[['pre'], {${Object.entries(ops).map(([op, [q, t]], i) => `${100 + i}: __mkop('${q}', '${op}', '${t}', ['feat_a'])`).join(',')}}]];`;
// The fake X app: its router fetches the profile when it lands on one (X does), unless __xQuiet (Zero-JS: X's JS is blocked)
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Home / X</title></head><body style="margin:0;background:#000;color:#e7e9ea;font:15px sans-serif">
<div id="react-root"><div style="display:flex">
<header style="width:260px"><nav aria-label="Primary" role="navigation">
<a href="/home" data-testid="AppTabBar_Home_Link" aria-label="Home"><span>Home</span></a>
<a href="/me_user" data-testid="AppTabBar_Profile_Link" aria-label="Profile"><span>Profile</span></a>
</nav></header>
<main id="xmain" style="height:3000px"><div id="xpage">X page /home</div></main></div></div>
<script>
window.__xNav = [];
var HEADERS = { authorization: 'Bearer TESTBEARER', 'x-csrf-token': 'csrf-live', 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes', 'x-twitter-client-language': 'en' };
var FEATS = encodeURIComponent(JSON.stringify({ feat_a: true, feat_b: false }));
window.xGet = function (qid, op, vars) {
  return fetch('/i/api/graphql/' + qid + '/' + op + '?variables=' + encodeURIComponent(JSON.stringify(vars)) + '&features=' + FEATS, { headers: HEADERS, credentials: 'include' }).then(function (r) { return r.json(); });
};
window.xRest = function (p) { return fetch(p, { headers: HEADERS, credentials: 'include' }).then(function (r) { return r.json(); }); };
var RESERVED = /^\\/(home|explore|notifications|messages|search|settings|i|compose)(\\/|$)/;
addEventListener('popstate', function () {
  __xNav.push(location.pathname + location.search);
  document.getElementById('xpage').textContent = 'X page ' + location.pathname;
  var m = /^\\/(\\w{1,15})(\\/(with_replies|media))?$/.exec(location.pathname);
  if (m && !RESERVED.test(location.pathname) && !window.__xQuiet) xGet('QIDUSER0000000001', 'UserByScreenName', { screen_name: m[1], withGrokTranslatedBio: false });
});
setTimeout(function () { xGet('QIDHOME0000000001', 'HomeTimeline', { count: 20, includePromotedContent: true, latestControlAvailable: true, requestContext: 'launch', withCommunity: true }); }, 150);
setTimeout(function () { if (!window.__xQuiet) xRest('/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1'); }, 700);
</script></body></html>`;

function backend(srv) {
  return async route => {
    const req = route.request(), u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    try {
      if (u.hostname === 'pbs.twimg.com') return await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (u.hostname !== 'x.com') return await route.fulfill({ status: 404, body: '' });
      const g = /^\/i\/api\/graphql\/([\w-]+)\/(\w+)/.exec(u.pathname);
      if (g) {
        const q = { qid: g[1], op: g[2], method: req.method(), t: Date.now() };
        const body = req.postData();
        q.vars = JSON.parse(u.searchParams.get('variables') || (body ? JSON.stringify(JSON.parse(body).variables) : 'null')) || {};
        srv.reqs.push(q);
        let out = { data: { ok: q.op } };
        if (q.op === 'HomeTimeline') out = q.vars.cursor ? { data: { home: { home_timeline_urt: { instructions: add([cEntry('Top', 'TOPX')]) } } } } : HOME();
        else if (q.op === 'UserByScreenName') { const usr = BY_SN[String(q.vars.screen_name).toLowerCase()]; out = usr ? { data: { user: { result: usr } } } : { data: {} }; }
        else if (USER_TL[q.op]) out = q.vars.cursor ? userTl([cEntry('Bottom', q.vars.cursor)]) : USER_TL[q.op](String(q.vars.userId));
        else if (q.op === 'SearchTimeline') out = q.vars.cursor ? { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: add([cEntry('Bottom', q.vars.cursor)]) } } } } } : SEARCH(q.vars.rawQuery, q.vars.product);
        else if (q.op === 'Bookmarks') out = BOOKMARKS(q.vars.cursor);
        else if (q.op === 'NotificationsTimeline') out = NOTIF_GQL();
        else if (q.op === 'TweetDetail') out = { data: { threaded_conversation_with_injections_v2: { instructions: add([]) } } };
        return await json(out);
      }
      if (u.pathname.startsWith('/i/api/')) {
        const q = { path: u.pathname, method: req.method(), query: Object.fromEntries(u.searchParams), headers: req.headers(), t: Date.now() };
        const body = req.postData();
        if (body) q.body = /json/.test(req.headers()['content-type'] || '') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
        srv.rest.push(q);
        const p = u.pathname;
        if (p === '/i/api/2/badge_count/badge_count.json') return await json({ ntab_unread_count: 3, dm_unread_count: 2, total_unread_count: 5 });
        if (p === '/i/api/2/notifications/all.json') return srv.noRest ? await json({ errors: [{ code: 34 }] }, 404) : await json(NOTIF_ALL());
        if (p === '/i/api/2/notifications/mentions.json') return await json({ errors: [{ code: 34, message: 'Sorry, that page does not exist.' }] }, 404);
        if (p === '/i/api/1.1/dm/inbox_initial_state.json') return await json(INBOX());
        const cv = /^\/i\/api\/1\.1\/dm\/conversation\/([\w-]+)\.json$/.exec(p);
        if (cv) return await json(CONV(cv[1]));
        if (p === '/i/api/1.1/dm/new2.json') {
          await new Promise(res => setTimeout(res, 500));
          if (srv.failSend) return await json({ errors: [{ code: 349, message: 'You cannot send messages to this user.' }] }, 403);
          const b = q.body || {};
          return await json({ entries: [{ message: { id: '6' + (srv.rest.length + 1000), time: String(Date.now()), conversation_id: b.conversation_id, request_id: b.request_id, message_data: { id: 'x', time: String(Date.now()), sender_id: '999', text: b.text } } }], users: {} });
        }
        if (p === '/i/api/1.1/friendships/create.json') { await new Promise(res => setTimeout(res, 300)); return await json(v1(U.alice)); }
        if (p === '/i/api/1.1/friendships/destroy.json') { await new Promise(res => setTimeout(res, 300)); return await json({ errors: [{ code: 200, message: 'Forbidden.' }] }, 403); }
        if (p === '/i/api/1.1/search/typeahead.json') {
          const qq = (q.query.q || '').trim();
          return await json({
            topics: [{ topic: qq + ' photos' }, { topic: qq + ' news' }],
            users: [Object.assign(v1(U.carol), { ext_is_blue_verified: true }), v1(U.dave)]
          });
        }
        return await json({ errors: [{ code: 34 }] }, 404);
      }
      return await route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    } catch {}
  };
}

const seedScript = s => `localStorage.setItem('xbb-userscript-settings', ${JSON.stringify(JSON.stringify({ settings: s }))}); localStorage.setItem('xbb-settings-snapshot', ${JSON.stringify(JSON.stringify(s))});`;
async function open({ seed = { fastUi: true }, ops = OPS, srvOpts = {}, quiet = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const srv = Object.assign({ reqs: [], rest: [] }, srvOpts);
  await ctx.route(/x\.com|twimg\.com|example\.test/, backend(srv));
  await ctx.addCookies([{ name: 'night_mode', value: '2', url: 'https://x.com' }, { name: 'twid', value: 'u%3D999', url: 'https://x.com' }, { name: 'ct0', value: 'csrf-live', url: 'https://x.com' }]);
  await ctx.addInitScript(seedScript(seed));
  if (quiet) await ctx.addInitScript('window.__xQuiet = true;');
  await ctx.addInitScript(chunk(ops));
  await ctx.addInitScript({ path: usFile });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || /XBB/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto('https://x.com/home');
  return { ctx, page, srv };
}
const hits = (srv, op) => srv.reqs.filter(q => q.op === op);
const firsts = (srv, op) => hits(srv, op).filter(q => !q.vars.cursor);
const rest = (srv, p) => srv.rest.filter(q => q.path === p);
const S = 'document.querySelector("xbb-fast")?.shadowRoot';
const waitFor = (page, expr, timeout = 6000) => page.waitForFunction(expr, null, { timeout, polling: 50 }).then(() => true, () => false);
const waitTweet = (page, id, where = '.vlist') => waitFor(page, `!!${S}?.querySelector('${where} article.tweet[data-id="${id}"]')`, 8000);
const owner = page => page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-xbb-fast'), react: getComputedStyle(document.getElementById('react-root')).display, path: location.pathname, search: location.search }));
const frames = page => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60)))));
const settle = async (page, ms = 250) => { await page.waitForTimeout(ms); await frames(page); };
const sy = page => page.evaluate(() => Math.round(scrollY));
const vd = page => page.evaluate(() => XBB.fast.view() && XBB.fast.view().debug ? XBB.fast.view().debug() : null);
const nt = page => page.evaluate(() => XBB.fast.notifications.debug());
const dm = page => page.evaluate(() => XBB.fast.messages.debug());
const hist = page => page.evaluate(() => ({ path: location.pathname, overlay: history.state && history.state.overlay, len: history.length }));
const sr = sel => `xbb-fast ${sel}`;
const text = (page, sel) => page.evaluate(sel => { const e = document.querySelector('xbb-fast').shadowRoot.querySelector(sel); return e ? e.textContent : null; }, sel);
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

// ---------- 1. notifications and messages over Home ----------
{
  const { ctx, page, srv } = await open();
  await waitTweet(page, '1110');
  await settle(page);
  await waitFor(page, `${S}.querySelector('[data-nt-open] .nbadge:not([hidden])')`, 4000);
  const badge = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot, q = s => sr.querySelector(s); return { nt: q('[data-nt-open] .nbadge')?.hidden ? null : q('[data-nt-open] .nbadge').textContent, dm: q('[data-dm-open] .nbadge')?.hidden ? null : q('[data-dm-open] .nbadge').textContent }; });
  check('notifications: the rail badges come from X\'s own badge_count poll (the tap, no request of ours)', badge.nt === '3' && badge.dm === '2' && rest(srv, '/i/api/2/badge_count/badge_count.json').length === 1, badge);

  const y0 = await scrollToTweet(page, '1110');
  const h0 = await hist(page);
  await page.locator(sr('.rail [data-nt-open]')).click();
  await waitFor(page, 'XBB.fast.notifications.isOpen() && XBB.fast.notifications.debug().all >= 2');
  let n = await nt(page);
  const items = await page.evaluate(() => [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('.ntf .nt-item')].map(e => ({ tw: e.dataset.ntTw || null, user: e.dataset.ntUser || null, unread: e.classList.contains('unread'), text: e.textContent })));
  const allReq = rest(srv, '/i/api/2/notifications/all.json');
  check('notifications: the rail button opens the popout; All comes from REST all.json (legacy globalObjects) with the unread mark', n.open && n.via === 'rest' && n.all === 2 && allReq.length === 1 && allReq[0].query.count === '30' && allReq[0].query.include_profile_interstitial_type === '1'
    && items[0].tw === '1001' && items[0].unread && /Bob liked your post/.test(items[0].text) && items[1].user === 'dave' && !items[1].unread, { n, items, allReq: allReq.map(q => q.query) });
  check('notifications: the popout never leaves the page (same URL, same history, same scroll); the badge clears', (await hist(page)).path === '/home' && (await hist(page)).len === h0.len && Math.abs(await sy(page) - y0) <= 1
    && n.unread.notifications === 0 && await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('[data-nt-open] .nbadge').hidden), { n, y: await sy(page), y0 });
  await page.locator(sr('.ntf [data-nt-tab="mentions"]')).click();
  await waitFor(page, 'XBB.fast.notifications.debug().mentions >= 2');
  n = await nt(page);
  check('notifications: Mentions: REST mentions.json answers 404, so X\'s GraphQL NotificationsTimeline (Relay shape) is used', n.tab === 'mentions' && n.via === 'gql' && n.mentions === 2 && rest(srv, '/i/api/2/notifications/mentions.json').length === 1
    && hits(srv, 'NotificationsTimeline').some(q => q.vars.timeline_type === 'Mentions' && q.vars.count === 30), { n, gql: hits(srv, 'NotificationsTimeline') });
  await page.locator(sr('.ntf [data-nt-tab="all"]')).click();
  await page.locator(sr('.ntf .nt-item[data-nt-tw="1001"] .nt-msg')).click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  await settle(page, 150);
  let h = await hist(page);
  check('notifications: a click on a post\'s notification closes the popout and opens that post in the drawer, over Home', !(await nt(page)).open && await page.evaluate(() => XBB.fast.drawer.focal()) === '1001' && h.overlay === 'drawer' && (await owner(page)).attr === 'home', { h });
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('notifications: and Esc there returns to /home at the same scroll pixel', (await hist(page)).path === '/home' && Math.abs(await sy(page) - y0) <= 1, { h: await hist(page), y: await sy(page), y0 });
  // Esc on the popout itself, then the narrow layout is a sheet
  await page.locator(sr('.rail [data-nt-open]')).click();
  await waitFor(page, 'XBB.fast.notifications.isOpen()');
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.notifications.isOpen()');
  check('notifications: Esc closes the popout (light dismiss)', !(await nt(page)).open && (await hist(page)).path === '/home', await nt(page));

  // ---------- messages ----------
  await page.locator(sr('.rail [data-dm-open]')).click();
  await waitFor(page, 'XBB.fast.messages.isOpen() && XBB.fast.messages.debug().convs >= 2');
  let d = await dm(page);
  h = await hist(page);
  const rows = await page.evaluate(() => [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('dialog.dm .dm-conv')].map(e => ({ id: e.dataset.dmConv, unread: e.classList.contains('unread'), text: e.textContent })));
  const inboxReq = rest(srv, '/i/api/1.1/dm/inbox_initial_state.json');
  check('messages: the rail button opens the drawer (showModal, a history entry) with the inbox from inbox_initial_state.json', d.open && h.overlay === 'messages' && h.path === '/home' && inboxReq.length === 1 && inboxReq[0].headers.authorization === 'Bearer TESTBEARER'
    && rows.length === 2 && rows[0].id === '100-999' && rows[0].unread && /Alice/.test(rows[0].text) && /hi there, how are you\?/.test(rows[0].text) && /Encrypted conversation/.test(rows[1].text)
    && await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.dm').matches(':modal')), { d, h, rows });
  await page.locator(sr('dialog.dm .dm-conv[data-dm-conv="100-999"]')).click();
  await waitFor(page, 'XBB.fast.messages.debug().msgs && XBB.fast.messages.debug().msgs.length >= 3');
  d = await dm(page);
  check('messages: a conversation opens with its messages (conversation/<id>.json), oldest first, and the reply box', d.cur === '100-999' && d.msgs.map(m => m.id).join() === '4990,5001,5002' && rest(srv, '/i/api/1.1/dm/conversation/100-999.json').length === 1
    && await page.evaluate(() => !document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.dm .dm-foot').hidden && /Alice/.test(document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.dm .dr-head h2').textContent)), d);
  await page.locator(sr('dialog.dm .dm-foot textarea')).fill('see you tomorrow');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const pend = await dm(page);
  await waitFor(page, 'XBB.fast.messages.debug().msgs.every(m => !m.pending) && XBB.fast.messages.debug().msgs.length === 4');
  d = await dm(page);
  const sent = rest(srv, '/i/api/1.1/dm/new2.json')[0];
  check('messages: Enter sends at once (a pending bubble), new2.json gets conversation_id + text + request_id, X\'s copy replaces ours', pend.msgs.length === 4 && pend.msgs[3].pending && pend.msgs[3].text === 'see you tomorrow'
    && sent && sent.method === 'POST' && sent.body.conversation_id === '100-999' && sent.body.text === 'see you tomorrow' && /^[\w-]{8,}$/.test(sent.body.request_id || '') && sent.headers['x-csrf-token'] === 'csrf-live'
    && d.msgs.length === 4 && !d.msgs[3].pending && !/^tmp-/.test(d.msgs[3].id) && await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.dm .dm-foot textarea').value === ''), { pend, d, sent: sent && sent.body });
  srv.failSend = true;
  await page.locator(sr('dialog.dm .dm-foot textarea')).fill('this one fails');
  await page.locator(sr('dialog.dm [data-dm="send"]')).click();
  await page.waitForTimeout(120);
  const pend2 = await dm(page);
  await waitFor(page, 'XBB.fast.messages.debug().msgs.length === 4');
  await settle(page, 100);
  d = await dm(page);
  const back = await page.evaluate(() => ({ v: document.querySelector('xbb-fast').shadowRoot.querySelector('dialog.dm .dm-foot textarea').value, toast: document.querySelector('.xbb-fast-toast')?.textContent }));
  check('messages: a send X refuses is rolled back: the bubble goes, the text is back in the box, a toast says so', pend2.msgs.length === 5 && pend2.msgs[4].pending && d.msgs.length === 4 && back.v === 'this one fails' && /Couldn't send/.test(back.toast || ''), { pend2, d, back });
  srv.failSend = false;
  await page.locator(sr('dialog.dm [data-dm="back"]')).click();
  await waitFor(page, '!XBB.fast.messages.debug().cur');
  await page.locator(sr('dialog.dm .dm-conv[data-dm-conv="300-999"]')).click();
  await waitFor(page, 'XBB.fast.messages.debug().cur === "300-999"');
  await settle(page, 100);
  d = await dm(page);
  const enc = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot, b = sr.querySelector('dialog.dm .fd-banner'); return { text: b && b.textContent, btn: b && b.querySelector('[data-dm-native]')?.dataset.dmNative, foot: sr.querySelector('dialog.dm .dm-foot').hidden }; });
  check('messages: an encrypted (XChat) conversation shows a banner with one click to X\'s own chat, no reply box, no request', d.encrypted && /end-to-end encrypted/.test(enc.text || '') && enc.btn === '/i/chat/300-999' && enc.foot && rest(srv, '/i/api/1.1/dm/conversation/300-999.json').length === 0, { d, enc });
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.messages.isOpen()');
  await settle(page);
  check('messages: Esc closes the drawer back to /home at the same scroll pixel, Home still ours', (await hist(page)).path === '/home' && !(await hist(page)).overlay && (await owner(page)).attr === 'home' && Math.abs(await sy(page) - y0) <= 1, { h: await hist(page), y: await sy(page), y0 });
  await page.locator(sr('.rail [data-dm-open]')).click();
  await waitFor(page, 'XBB.fast.messages.isOpen()');
  await page.mouse.click(200, 450);
  await waitFor(page, '!XBB.fast.messages.isOpen()');
  await settle(page);
  check('messages: a click on the backdrop closes it too', (await hist(page)).path === '/home' && Math.abs(await sy(page) - y0) <= 1, { h: await hist(page), y: await sy(page) });
  await page.locator(sr('.rail [data-dm-open]')).click();
  await waitFor(page, 'XBB.fast.messages.isOpen()');
  await page.locator(sr('dialog.dm [data-dm="chat"]')).click();
  await waitFor(page, 'location.pathname === "/i/chat"');
  await settle(page);
  const o = await owner(page);
  check('messages: "XChat / Calls on X" hands /i/chat to X\'s own router (X is told by popstate, its page shows)', o.path === '/i/chat' && o.react !== 'none' && o.attr !== 'home' && (await page.evaluate(() => __xNav.slice())).includes('/i/chat') && !(await dm(page)).open, { o, nav: await page.evaluate(() => __xNav.slice()) });
  await ctx.close();
}

// ---------- 2. profile, search, bookmarks ----------
{
  const { ctx, page, srv } = await open();
  await waitTweet(page, '1001');
  await settle(page);
  const y0 = await scrollToTweet(page, '1103');
  // a script click: a real one would first scroll the post into view (and so lose the position this checks)
  await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('.vlist article.tweet[data-id="1001"] a.name').click());
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'profile' && /Alice writes/.test(${S}.querySelector('.pf-hero')?.textContent || '')`);
  await waitTweet(page, '2001');
  await settle(page);
  let o = await owner(page), v = await vd(page);
  const hero = await page.evaluate(() => {
    const sr = document.querySelector('xbb-fast').shadowRoot, q = s => sr.querySelector(s);
    return { name: q('.pf-name')?.textContent, handle: q('.pf-names .handle')?.textContent, bio: q('.pf-bio')?.textContent, meta: q('.pf-meta')?.textContent, counts: q('.pf-counts')?.textContent,
      banner: q('.pf-banner img')?.getAttribute('src'), av: q('img.pf-av')?.getAttribute('src'), follow: q('[data-pf="follow"]')?.textContent, back: !!q('.pf-bar [data-pf="back"]'),
      tabs: [...sr.querySelectorAll('.feed.profile [data-fd-tab]')].map(b => b.dataset.fdTab + ':' + b.getAttribute('aria-selected')).join(), title: q('.pf-title')?.textContent };
  });
  const ubsn = hits(srv, 'UserByScreenName');
  check('profile: an author link opens /alice in Fast UI (X\'s page stays hidden), the account from X\'s own UserByScreenName (tapped, none of ours)', o.path === '/alice' && o.attr === 'profile' && o.react === 'none' && ubsn.length === 1 && v && v.uid === '100' && v.user === 'ok', { o, v, ubsn });
  check('profile: the header has Back, banner, avatar, name, @handle, bio, location, website, joined, following/followers and Follow', hero.back && /profile_banners\/100\/1700000000\/1500x500/.test(hero.banner || '') && /_400x400/.test(hero.av || '')
    && /Alice/.test(hero.name) && hero.handle === '@alice' && hero.bio === 'Alice writes about cats and code' && /Berlin/.test(hero.meta) && /alice\.example\.test/.test(hero.meta) && /Joined January 2012/.test(hero.meta)
    && /5 Following/.test(hero.counts) && /10 Followers/.test(hero.counts) && hero.follow === 'Follow' && /1,?234 posts|1\.2K posts/.test(hero.title), hero);
  const ut = firsts(srv, 'UserTweets');
  check('profile: Posts load with UserTweets for that user (UserOriginalsTimeline not harvested: the fallback), tabs Posts/Replies/Media', ut.length === 1 && ut[0].vars.userId === '100' && v.rows === 12 && hero.tabs === 'posts:true,replies:false,media:false', { ut, v, tabs: hero.tabs });
  // Follow: optimistic, then X's answer; Unfollow refused: rolled back
  await page.locator(sr('[data-pf="follow"]')).click();
  await page.waitForTimeout(80);
  const f1 = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return { pressed: sr.querySelector('[data-pf="follow"]').getAttribute('aria-pressed'), counts: sr.querySelector('.pf-counts').textContent }; });
  await page.waitForTimeout(500);
  const fc = rest(srv, '/i/api/1.1/friendships/create.json');
  const f2 = await vd(page);
  check('profile: Follow flips at once (Following, 11 followers), then POSTs friendships/create.json { user_id } as a form', f1.pressed === 'true' && /11 Followers/.test(f1.counts) && fc.length === 1 && fc[0].method === 'POST' && fc[0].body.user_id === '100'
    && /x-www-form-urlencoded/.test(fc[0].headers['content-type']) && f2.following === 'following', { f1, fc: fc.map(q => q.body), f2 });
  await page.locator(sr('[data-pf="follow"]')).click();
  await page.waitForTimeout(80);
  const f3 = await vd(page);
  await page.waitForTimeout(600);
  const f4 = await vd(page);
  const toast = await page.evaluate(() => document.querySelector('.xbb-fast-toast')?.textContent);
  check('profile: Unfollow X refuses (403) is rolled back to Following with a toast', f3.following === 'none' && rest(srv, '/i/api/1.1/friendships/destroy.json').length === 1 && f4.following === 'following' && /Couldn't unfollow @alice/.test(toast || '')
    && /11 Followers/.test(await text(page, '.pf-counts')), { f3, f4, toast });
  // tabs replace the URL
  const len1 = (await hist(page)).len;
  await page.locator(sr('.feed.profile [data-fd-tab="replies"]')).click();
  await waitTweet(page, '2101');
  const pr = { o: await owner(page), len: (await hist(page)).len };
  await page.locator(sr('.feed.profile [data-fd-tab="media"]')).click();
  await waitTweet(page, '2201');
  const pm = { o: await owner(page), len: (await hist(page)).len };
  check('profile: Replies and Media tabs load UserTweetsAndReplies / UserMedia and replace the URL (/alice/with_replies, /alice/media)', pr.o.path === '/alice/with_replies' && pm.o.path === '/alice/media' && pr.len === len1 && pm.len === len1
    && firsts(srv, 'UserTweetsAndReplies').length === 1 && firsts(srv, 'UserMedia').length === 1 && firsts(srv, 'UserMedia')[0].vars.userId === '100' && pm.o.attr === 'profile', { pr, pm });
  // a post on the profile opens in the drawer; an author link inside the drawer goes to that profile and closes it
  await page.locator(sr('.vlist article.tweet[data-id="2201"] .text')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  const drOver = { o: await owner(page), h: await hist(page) };
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('profile: a post on the profile opens in the drawer over it; Esc returns to /alice/media', drOver.h.overlay === 'drawer' && drOver.h.path === '/alice/status/2201' && drOver.o.attr === 'profile' && (await owner(page)).path === '/alice/media', { drOver, o: await owner(page) });
  await page.locator(sr('.pf-bar [data-pf="back"]')).click();
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'home' && !!${S}.querySelector('.vlist article.tweet[data-id="1103"]')`);
  await settle(page, 400);
  o = await owner(page);
  check('profile: Back returns to Home where it was (no new HomeTimeline request, same scroll)', o.path === '/home' && o.attr === 'home' && firsts(srv, 'HomeTimeline').length === 1 && Math.abs(await sy(page) - y0) <= 2, { o, y: await sy(page), y0, home: firsts(srv, 'HomeTimeline').length });

  // ---------- search ----------
  await page.locator(sr('.side .search input')).focus();
  await page.locator(sr('.side .search input')).fill('cats');
  await waitFor(page, `${S}.querySelectorAll('.side .sr-drop .sr-opt').length >= 4`, 3000);
  const ta = await page.evaluate(() => {
    const sr = document.querySelector('xbb-fast').shadowRoot;
    return {
      opts: [...sr.querySelectorAll('.side .sr-drop .sr-opt')].map(el => el.textContent.trim()),
      taHits: true
    };
  });
  check('search: live typeahead dropdown shows query, topics and accounts from /i/api/1.1/search/typeahead.json', rest(srv, '/i/api/1.1/search/typeahead.json').length >= 1
    && ta.opts.some(s => /Search for "cats"/.test(s)) && ta.opts.some(s => /cats photos/.test(s)) && ta.opts.some(s => /@carol/.test(s)), { ta, reqs: rest(srv, '/i/api/1.1/search/typeahead.json').map(q => q.query) });
  await page.keyboard.press('Enter');
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'search'`);
  await waitTweet(page, '3001');
  await settle(page);
  o = await owner(page); v = await vd(page);
  const st = firsts(srv, 'SearchTimeline');
  const bar = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return { q: sr.querySelector('.sr-bar input')?.value, back: !!sr.querySelector('.sr-bar [data-sr="back"]'), sideHidden: !!sr.querySelector('.side [data-xbb-search]')?.hidden, chips: sr.querySelectorAll('.sr-chips .sr-chip').length, tabs: [...sr.querySelectorAll('.feed.search-view [data-fd-tab]')].map(b => b.dataset.fdTab).join() }; });
  check('search: the sidebar search goes to /search?q=cats in Fast UI: SearchTimeline { rawQuery, count, querySource, product: Top }', o.path === '/search' && /q=cats/.test(o.search) && st.length === 1 && st[0].vars.rawQuery === 'cats' && st[0].vars.product === 'Top'
    && st[0].vars.count === 20 && st[0].vars.querySource === 'typed_query' && v.rows === 10 && hits(srv, 'SearchTimeline').some(q => q.vars.cursor === 'S2') && bar.q === 'cats' && bar.back && bar.sideHidden && bar.chips >= 6 && bar.tabs === 'top,latest,people,media', { o, st, v, bar });
  // quick filter chips toggle operators and preserve the active tab
  await page.locator(sr('.feed.search-view [data-fd-tab="latest"]')).click();
  await waitTweet(page, '3101');
  await page.locator(sr('.sr-chips [data-sr-chip="f100"]')).click();
  await waitFor(page, `/min_faves%3A100/.test(location.search)`);
  await settle(page, 150);
  const chip1 = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return { search: location.search, q: sr.querySelector('.sr-bar input')?.value, f100: sr.querySelector('[data-sr-chip="f100"]')?.getAttribute('aria-pressed'), f1k: sr.querySelector('[data-sr-chip="f1k"]')?.getAttribute('aria-pressed') }; });
  await page.locator(sr('.sr-chips [data-sr-chip="f1k"]')).click();
  await waitFor(page, `/min_faves%3A1000/.test(location.search)`);
  await settle(page, 150);
  const chip2 = await page.evaluate(() => { const sr = document.querySelector('xbb-fast').shadowRoot; return { search: location.search, q: sr.querySelector('.sr-bar input')?.value, f100: sr.querySelector('[data-sr-chip="f100"]')?.getAttribute('aria-pressed'), f1k: sr.querySelector('[data-sr-chip="f1k"]')?.getAttribute('aria-pressed') }; });
  check('search: filter chips toggle operators (mutually exclusive min_faves) and keep the active tab (Latest)', /f=live/.test(chip1.search) && chip1.q === 'cats min_faves:100' && chip1.f100 === 'true' && chip1.f1k === 'false'
    && /f=live/.test(chip2.search) && chip2.q === 'cats min_faves:1000' && chip2.f100 === 'false' && chip2.f1k === 'true', { chip1, chip2 });
  // recent searches saved in localStorage and shown when input is cleared
  await page.locator(sr('.sr-bar .sr-clear')).click();
  await waitFor(page, `${S}.querySelectorAll('.sr-bar .sr-drop .sr-opt').length >= 1`, 2000);
  const rec = await page.evaluate(() => [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('.sr-bar .sr-drop .sr-opt')].map(e => e.textContent.trim()));
  check('search: recent searches saved and shown when the box is cleared', rec.includes('cats') && rec.includes('cats min_faves:1000'), rec);
  await page.keyboard.press('Escape');
  // go back to plain "cats" search for the remaining tab checks
  await page.evaluate(() => XBB.fast.go('/search?q=cats&src=typed_query'));
  await waitFor(page, `location.search === '?q=cats&src=typed_query'`);
  await waitTweet(page, '3001');
  await page.locator(sr('.feed.search-view [data-fd-tab="people"]')).click();
  await waitFor(page, `${S}.querySelectorAll('.vlist article.ucard').length === 2`);
  const cards = await page.evaluate(() => [...document.querySelector('xbb-fast').shadowRoot.querySelectorAll('.vlist article.ucard')].map(c => ({ href: c.dataset.href, text: c.textContent })));
  check('search: People shows account cards (SearchTimeline product People), the URL says f=user', cards.length === 2 && cards[0].href === '/carol' && /Carol likes cats too/.test(cards[0].text) && /@dave/.test(cards[1].text)
    && hits(srv, 'SearchTimeline').some(q => q.vars.product === 'People') && /f=user/.test((await owner(page)).search), { cards, o: await owner(page) });
  await page.locator(sr('.feed.search-view [data-fd-tab="latest"]')).click();
  await waitTweet(page, '3101');
  check('search: Latest is product Latest (f=live)', hits(srv, 'SearchTimeline').some(q => q.vars.product === 'Latest') && /f=live/.test((await owner(page)).search), await owner(page));
  await page.locator(sr('.feed.search-view [data-fd-tab="top"]')).click();
  await waitTweet(page, '3001');
  const nTop = firsts(srv, 'SearchTimeline').filter(q => q.vars.product === 'Top').length;
  await page.locator(sr('.vlist article.tweet[data-id="3001"] .text')).first().click();
  await waitFor(page, 'XBB.fast.drawer.isOpen()');
  const srDr = await hist(page);
  await page.keyboard.press('Escape');
  await waitFor(page, '!XBB.fast.drawer.isOpen()');
  await settle(page);
  check('search: back on Top uses the kept results (no new request); a result opens in the drawer, Esc returns to the search', nTop === 1 && srDr.overlay === 'drawer' && srDr.path === '/bob/status/3001' && (await owner(page)).path === '/search' && (await owner(page)).attr === 'search', { nTop, srDr, o: await owner(page) });
  await page.locator(sr('.feed.search-view [data-fd-tab="people"]')).click();
  await waitFor(page, `${S}.querySelectorAll('.vlist article.ucard').length === 2`);
  await page.locator(sr('.vlist article.ucard[data-href="/carol"] .bio, .vlist article.ucard[data-href="/carol"]')).first().click();
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'profile' && location.pathname === '/carol'`);
  check('search: a People card opens that profile in Fast UI', (await owner(page)).path === '/carol' && (await owner(page)).attr === 'profile', await owner(page));
  await page.locator(sr('.pf-bar [data-pf="back"]')).click();
  await waitFor(page, `location.pathname === '/search' && document.documentElement.getAttribute('data-xbb-fast') === 'search'`);
  check('search: Back from that profile returns to the search', (await owner(page)).path === '/search' && /q=cats/.test((await owner(page)).search), await owner(page));

  // ---------- bookmarks ----------
  await page.locator(sr('.rail a[data-route="bookmarks"]')).click();
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'bookmarks'`);
  await waitTweet(page, '4001');
  await settle(page);
  v = await vd(page);
  const bk1 = firsts(srv, 'Bookmarks');
  const bkHead = await text(page, '.feed.bookmarks-view .pf-title');
  const cur = await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('.rail a[data-route="bookmarks"]').getAttribute('aria-current'));
  check('bookmarks: the rail link routes to /i/bookmarks in Fast UI: header "Bookmarks", the Bookmarks op { count: 20 }, the rail marks it', (await owner(page)).path === '/i/bookmarks' && bk1.length === 1 && bk1[0].vars.count === 20 && v.rows >= 20 && /Bookmarks/.test(bkHead || '') && cur === 'page', { v, bk1, bkHead, cur });
  for (let i = 0; i < 6 && (await vd(page)).rows < 25; i++) { await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page, 300); }
  await waitFor(page, 'XBB.fast.view().debug().rows === 25');
  for (let i = 0; i < 4; i++) { await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page, 250); }
  v = await vd(page);
  const bk = hits(srv, 'Bookmarks');
  check('bookmarks: scrolling to the end loads the next page with the cursor, and stops when X has no more', v.rows === 25 && bk.some(q => q.vars.cursor === 'BK2') && bk.length <= 3 && v.done, { v, bk: bk.map(q => q.vars.cursor || null) });
  // the logged-in user's own profile from the rail
  await page.locator(sr('.rail a[data-profile]')).click();
  await waitFor(page, `location.pathname === '/me_user' && document.documentElement.getAttribute('data-xbb-fast') === 'profile' && !!${S}.querySelector('.pf-hero [data-fd-native="/settings/profile"]')`);
  const meCur = await page.evaluate(() => document.querySelector('xbb-fast').shadowRoot.querySelector('.rail a[data-profile]').getAttribute('aria-current'));
  check('profile: the rail\'s Profile is the logged-in user (twid + X\'s own profile link): /me_user, "Edit profile", marked current', (await owner(page)).path === '/me_user' && meCur === 'page', { o: await owner(page), meCur });
  // reserved names are never a profile
  const reserved = await page.evaluate(() => ['/explore', '/notifications', '/messages', '/settings', '/i/lists', '/compose/post', '/home'].map(p => XBB.fast.handleOf(p)));
  check('routing: reserved paths (explore, notifications, messages, settings, i, compose, home) are never a profile', reserved.every(x => !x), reserved);
  check('routing: none of this touched Home\'s breaker', await page.evaluate(() => !XBB.fast.isBroken('home') && !sessionStorage.getItem('xbb-fast-broken')), null);
  await ctx.close();
}

// ---------- 3. Zero-JS ext mode with the optional ops not learned: banners, 0 ms fetches, Home never failed ----------
{
  const ops = Object.fromEntries(Object.entries(OPS).filter(([k]) => !['UserTweets', 'UserTweetsAndReplies', 'UserMedia', 'SearchTimeline', 'Bookmarks', 'NotificationsTimeline'].includes(k)));
  const { ctx, page, srv } = await open({ ops, quiet: true, srvOpts: { noRest: true } });
  await waitTweet(page, '1001');
  await settle(page);
  await page.evaluate(() => { window.__setBlock = []; XBB.ext = { blocking: () => true, setBlock: (on, o) => { __setBlock.push([on, o]); }, hasCachedHome: () => true }; });
  const t0 = Date.now();
  await page.evaluate(() => XBB.fast.go('/bob'));
  await waitFor(page, 'XBB.fast.view() && XBB.fast.view().debug().user === "ok"', 3000);
  const firstAt = (hits(srv, 'UserByScreenName')[0] || {}).t;
  await waitFor(page, `!!${S}.querySelector('.feed.profile .fd-banner:not([hidden])')`, 3000);
  let v = await vd(page);
  const ban = await text(page, '.feed.profile .fd-banner');
  check('zero-js: a profile fetches its account at once (no wait for a tap that never comes)', firstAt && firstAt - t0 < 600 && hits(srv, 'UserByScreenName').length === 1 && v.uid === '200', { dt: firstAt && firstAt - t0, v });
  check('missing ops: the Posts tab shows "Posts not learned yet" with Open on X (UserOriginalsTimeline and UserTweets unknown), no request', v.banner === 'learn' && /Posts not learned yet/.test(ban || '') && !hits(srv, 'UserTweets').length, { v, ban });
  await page.evaluate(() => XBB.fast.go('/search?q=dogs&src=typed_query'));
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'search' && !!${S}.querySelector('.feed.search-view .fd-banner:not([hidden])')`, 3000);
  const sBan = await text(page, '.feed.search-view .fd-banner');
  check('missing ops: search shows "Search not learned yet" with Open on X', /Search not learned yet/.test(sBan || ''), sBan);
  await page.evaluate(() => XBB.fast.go('/i/bookmarks'));
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'bookmarks' && !!${S}.querySelector('.feed.bookmarks-view .fd-banner:not([hidden])')`, 3000);
  const bBan = await text(page, '.feed.bookmarks-view .fd-banner');
  check('missing ops: bookmarks shows "Bookmarks not learned yet" with Open on X', /Bookmarks not learned yet/.test(bBan || ''), bBan);
  await page.locator(sr('.rail [data-nt-open]')).click();
  await waitFor(page, '!!XBB.fast.notifications.debug().banner', 3000);
  const n = await nt(page);
  check('missing ops: notifications: REST gone (404) and NotificationsTimeline unknown: "not learned yet" + Open Notifications on X', /not learned yet/.test(n.banner || '') && rest(srv, '/i/api/2/notifications/all.json').length === 1
    && await page.evaluate(() => !!document.querySelector('xbb-fast').shadowRoot.querySelector('.ntf [data-nt="native"]')), n);
  await page.keyboard.press('Escape');
  const st = await page.evaluate(() => ({ broken: XBB.fast.isBroken('home'), ss: sessionStorage.getItem('xbb-fast-broken'), home: XBB.gql.breaker.isOpen('HomeTimeline') }));
  await page.evaluate(() => XBB.fast.go('/home'));
  await waitFor(page, `document.documentElement.getAttribute('data-xbb-fast') === 'home' && !!${S}.querySelector('.vlist article.tweet[data-id="1001"]')`, 3000);
  check('missing ops: Home is never failed (no broken route, its breaker closed) and Home is still Fast UI', !st.broken && !st.ss && !st.home && (await owner(page)).attr === 'home', { st, o: await owner(page) });
  await page.evaluate(() => XBB.fast.go('/i/bookmarks'));
  await waitFor(page, `!!${S}.querySelector('.feed.bookmarks-view .fd-banner [data-fd-native]')`, 3000);
  await page.locator(sr('.feed.bookmarks-view .fd-banner [data-fd-native]')).click();
  await page.waitForTimeout(200);
  const sb = await page.evaluate(() => __setBlock.slice());
  check('zero-js: "Open on X" turns the blocker off and reloads on that page with ?xbb=native (XBB.ext.setBlock(false, { url }))', sb.length === 1 && sb[0][0] === false && /\/i\/bookmarks\?xbb=native$/.test(sb[0][1].url) && sb[0][1].reload === true && sb[0][1].reason === 'to-native', sb);
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

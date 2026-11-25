// Offline test for the X Fast UI engine, Milestone 1 (x/src/main-world-api.js, content/api.js, content/model.js):
// loads dist/better-browsing-x.user.js into plain Chromium (or Firefox with BROWSER=firefox) and answers every x.com request
// from fixtures below, so it never touches live X. The fixtures: a page with a fake webpack runtime and chunks that carry
// GraphQL operation modules (the real thing's shape, made-up query IDs), a fake `/i/api/graphql/<qid>/<op>` backend, and
// realistic GraphQL payloads (tweets of every kind, timelines with cursors, modules and ads, malformed data).
// Run: npm run test:x:api
import { chromium, firefox } from 'playwright';
import path from 'path';
import { idleMutations } from './lib/perf.mjs';

const usFile = path.resolve(process.argv[2] || process.env.US_FILE || 'dist/better-browsing-x.user.js');
const FF = process.env.BROWSER === 'firefox';
const browser = await (FF ? firefox : chromium).launch();
const logs = [], ok = {}, r = {};
const check = (name, cond, detail) => { ok[name] = !!cond; r[name] = detail; };

// ---------- GraphQL payload fixtures ----------
const U = {
  alice: { __typename: 'User', id: 'VXNlcjoxMDA=', rest_id: '100', is_blue_verified: true,
    avatar: { image_url: 'https://pbs.twimg.com/profile_images/100/alice_normal.jpg' },
    core: { created_at: 'Mon Jan 02 15:04:05 +0000 2012', name: 'Alice', screen_name: 'alice' },
    verification: { verified_type: 'Business' }, relationship_perspectives: { following: true, followed_by: true },
    location: { location: 'Berlin' }, privacy: { protected: false },
    legacy: { description: 'Builds things &amp; breaks them', followers_count: 1234, friends_count: 56, statuses_count: 7890, favourites_count: 321, media_count: 12,
      profile_banner_url: 'https://pbs.twimg.com/profile_banners/100/1', entities: { url: { urls: [{ expanded_url: 'https://alice.example.test' }] } }, pinned_tweet_ids_str: ['555'] } },
  // the older shape: name, screen_name and avatar inside legacy
  bob: { __typename: 'User', rest_id: '200', is_blue_verified: false,
    legacy: { name: 'Bob', screen_name: 'bob', profile_image_url_https: 'https://pbs.twimg.com/profile_images/200/bob_normal.png', verified: true, followers_count: 9, friends_count: 8, statuses_count: 7,
      description: '', location: 'Paris', created_at: 'Tue Mar 03 03:03:03 +0000 2015', following: false, follow_request_sent: true, protected: true } },
  carol: { __typename: 'User', rest_id: '300', core: { name: 'Carol', screen_name: 'carol', created_at: 'Wed Apr 04 04:04:04 +0000 2018' }, avatar: { image_url: 'https://pbs.twimg.com/profile_images/300/c_normal.jpg' }, legacy: {} },
  dave: { __typename: 'User', rest_id: '400', core: { name: 'Dave', screen_name: 'dave', created_at: 'Thu May 05 05:05:05 +0000 2019' }, avatar: { image_url: 'https://pbs.twimg.com/profile_images/400/d_normal.jpg' }, legacy: {} },
};
const tw = (id, user, legacy = {}, top = {}) => ({
  __typename: 'Tweet', rest_id: id, core: { user_results: { result: user } }, unmention_data: {}, is_translatable: false,
  views: { count: '4521', state: 'EnabledWithCount' }, source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
  legacy: { bookmark_count: 3, bookmarked: false, created_at: 'Thu Nov 20 10:30:00 +0000 2025', conversation_id_str: id, entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
    favorite_count: 10, favorited: false, full_text: 'hi', is_quote_status: false, lang: 'en', quote_count: 1, reply_count: 2, retweet_count: 3, retweeted: false, user_id_str: user.rest_id, id_str: id, ...legacy },
  ...top,
});
const T = {};
T.std = tw('1001', U.alice, { full_text: 'Hello &amp; welcome #hello https://t.co/abc123', display_text_range: [0, 42], favorited: true, bookmarked: true,
  entities: { hashtags: [{ text: 'hello', indices: [17, 23] }], symbols: [], user_mentions: [], urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.test/page', display_url: 'example.test/page', indices: [24, 43] }] } });
T.reply = tw('1002', U.bob, { full_text: '@alice thanks for this! https://t.co/img111', display_text_range: [7, 23], in_reply_to_status_id_str: '1001', in_reply_to_screen_name: 'alice', in_reply_to_user_id_str: '100', conversation_id_str: '1001',
  entities: { user_mentions: [{ id_str: '100', name: 'Alice', screen_name: 'alice', indices: [0, 6] }], urls: [], hashtags: [], symbols: [] } });
T.note = tw('1003', U.alice, { full_text: 'This is a long-form post. This is a long-form post. This is a lon… https://t.co/long1' },
  { note_tweet: { is_expandable: true, note_tweet_results: { result: { id: 'Tm90ZVR3ZWV0OjE', text: 'This is a long-form post. '.repeat(20).trim(),
    entity_set: { hashtags: [{ text: 'long', indices: [0, 4] }], urls: [{ url: 'https://t.co/n1', expanded_url: 'https://example.test/n', display_url: 'example.test/n', indices: [10, 25] }], user_mentions: [{ id_str: '200', name: 'Bob', screen_name: 'bob', indices: [30, 34] }] } } } } });
T.tomb = { __typename: 'TweetTombstone', tombstone: { __typename: 'TextTombstone', text: { rtl: false, text: 'This Post is from an account that no longer exists.', entities: [] } } };
T.unavail = { __typename: 'TweetUnavailable', reason: 'Suspended' };
T.quote = tw('1004', U.carol, { full_text: 'quoting this https://t.co/q1', is_quote_status: true }, { quoted_status_result: { result: T.std } });
T.quoteTomb = tw('1005', U.carol, { full_text: 'quoting a ghost', is_quote_status: true }, { quoted_status_result: { result: T.tomb } });
T.rt = tw('3001', U.dave, { full_text: 'RT @alice: Hello &amp; welc…', created_at: 'Thu Nov 20 11:00:00 +0000 2025', retweeted_status_result: { result: T.std } });
const photo = (n, extra = {}) => ({ type: 'photo', id_str: 'ph' + n, media_url_https: `https://pbs.twimg.com/media/p${n}.jpg`, url: `https://t.co/p${n}`, original_info: { width: 1200, height: 800, focus_rects: [] }, ext_alt_text: 'cat ' + n, ...extra });
T.photos = tw('1006', U.alice, { full_text: 'three photos https://t.co/p1', extended_entities: { media: [photo(1), photo(2), photo(3, { ext_alt_text: undefined })] }, entities: { media: [photo(1)] }, possibly_sensitive: true });
T.video = tw('1007', U.alice, { full_text: 'a video https://t.co/v1', extended_entities: { media: [{ type: 'video', id_str: 'v1', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/poster.jpg', url: 'https://t.co/v1', original_info: { width: 1280, height: 720 },
  video_info: { aspect_ratio: [16, 9], duration_millis: 15041, variants: [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8?tag=12' },
    { bitrate: 256000, content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/320x180/a.mp4' },
    { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4' },
    { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/640x360/c.mp4' }] } }] } });
T.gif = tw('1008', U.alice, { full_text: 'gif https://t.co/g1', extended_entities: { media: [{ type: 'animated_gif', id_str: 'g1', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg', url: 'https://t.co/g1', original_info: { width: 400, height: 400 },
  video_info: { aspect_ratio: [1, 1], variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/g.mp4' }] } }] } });
const bv = (key, value) => ({ key, value });
const sv = (key, s) => bv(key, { string_value: s, type: 'STRING' });
T.poll = tw('1009', U.alice, { full_text: 'vote' }, { card: { rest_id: 'card://1', legacy: { name: 'poll3choice_text_only', url: 'card://1', binding_values: [
  sv('choice1_label', 'Red'), sv('choice2_label', 'Green'), sv('choice3_label', 'Blue'), sv('choice1_count', '10'), sv('choice2_count', '30'), sv('choice3_count', '60'),
  bv('counts_are_final', { boolean_value: true, type: 'BOOLEAN' }), sv('end_datetime_utc', '2025-11-21T10:30:00Z')] } } });
T.link = tw('1010', U.alice, { full_text: 'read this https://t.co/card1' }, { card: { rest_id: 'card://2', legacy: { name: 'summary_large_image', url: 'https://t.co/card1', binding_values: [
  sv('title', 'Example title'), sv('description', 'Example desc'), sv('vanity_url', 'example.test'), sv('card_url', 'https://t.co/card1'),
  bv('thumbnail_image_original', { image_value: { url: 'https://pbs.twimg.com/card_img/1/a?format=jpg&name=orig', width: 800, height: 418 }, type: 'IMAGE' })] } } });
T.cnote = tw('1011', U.alice, { full_text: 'disputed claim' }, { birdwatch_pivot: { destinationUrl: 'https://twitter.com/i/birdwatch/n/999', note: { rest_id: '999' }, subtitle: { text: 'Context &amp; sources', entities: [] },
  title: 'Readers added context', shorttitle: 'Context', visualStyle: 'Default', iconType: 'BirdwatchV1_RoundedFilledBlue' } });
T.vis = { __typename: 'TweetWithVisibilityResults', tweet: tw('1012', U.bob, { full_text: 'limited reply' }),
  tweetInterstitial: { __typename: 'ContextualTweetInterstitial', displayType: 'EntireTweet', text: { rtl: false, text: 'The author limited who can reply.', entities: [] } }, limitedActionResults: { limited_actions: [] } };

const itemOf = (result, extra = {}) => ({ itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result }, tweetDisplayType: 'Tweet', ...extra });
const tEntry = (id, result, extra) => ({ entryId: 'tweet-' + id, sortIndex: '18' + id, content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: itemOf(result, extra) } });
const cEntry = (type, v) => ({ entryId: 'cursor-' + type.toLowerCase() + '-' + v, sortIndex: '1', content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: v, cursorType: type } });
const mEntry = (id, results) => ({ entryId: 'conversationthread-' + id, sortIndex: '18' + id, content: { entryType: 'TimelineTimelineModule', __typename: 'TimelineTimelineModule', displayType: 'VerticalConversation',
  items: results.map(res => ({ entryId: 'conversationthread-' + id + '-tweet-' + res.rest_id, item: { itemContent: itemOf(res) } })) } });
const FX = {
  home: { data: { home: { home_timeline_urt: { responseObjects: {}, instructions: [
    { type: 'TimelineClearCache' },
    { type: 'TimelineAddEntries', entries: [
      tEntry('1001', T.std), tEntry('1004', T.quote),
      { entryId: 'promoted-tweet-9001-abc', sortIndex: '9', content: { entryType: 'TimelineTimelineItem', itemContent: itemOf(tw('9001', U.carol, { full_text: 'buy now' }), { promotedMetadata: { advertiser_id: '1' } }) } },
      mEntry('77', [T.reply, T.photos, T.video]),
      tEntry('3001', T.rt),
      cEntry('Top', 'TOPCUR1'), cEntry('Bottom', 'BOTCUR1'),
      { entryId: 'who-to-follow-1', sortIndex: '3', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineMessagePrompt' } } },
      { entryId: 'broken-1', sortIndex: '2', content: null },
    ] },
    { type: 'TimelinePinEntry', entry: tEntry('1003', T.note) },
  ] } } } },
  detail: { data: { threaded_conversation_with_injections_v2: { instructions: [
    { type: 'TimelineAddEntries', entries: [tEntry('1001', T.std), mEntry('1', [T.reply]), cEntry('Bottom', 'DETAILBOT')] },
    { type: 'TimelineAddToModule', moduleEntryId: 'conversationthread-1', prepend: false, moduleItems: [{ entryId: 'conversationthread-1-tweet-1012', item: { itemContent: itemOf(T.vis) } }] },
  ] } } },
  search: { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [
    { type: 'TimelineAddEntries', entries: [tEntry('1006', T.photos), cEntry('Bottom', 'B0'), { entryId: 'user-100', sortIndex: '5', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineUser', user_results: { result: U.alice } } } }] },
    { type: 'TimelineReplaceEntry', entry_id_to_replace: 'cursor-bottom-B0', entry: cEntry('Bottom', 'REPL') },
  ] } } } } },
  profile: { data: { user: { result: U.alice } } },
};

// ---------- the page and its backend ----------
// A fake webpack runtime the way X's bundle sets it up (chunk array, runtime callback replacing `push`, module cache),
// then one chunk with operation modules in different shapes. __mkop builds a module whose source has the literal object.
const PAGE = `<!doctype html><html><head><title>x</title></head><body><main>app</main><script>
(function () {
  var KEY = 'webpackChunk_twitter_responsive_web', m = {}, c = {};
  function req(id) { if (c[id]) return c[id].exports; var mod = c[id] = { exports: {} }; m[id].call(mod.exports, mod, mod.exports, req); return mod.exports; }
  req.m = m; req.c = c;
  window.__chunkRuns = 0;
  function cb(parent, data) { if (parent) parent(data); var mods = data[1]; for (var id in mods) m[id] = mods[id]; if (data[2]) { window.__chunkRuns++; data[2](req); } }
  var arr = self[KEY] = self[KEY] || [];
  arr.forEach(cb.bind(null, 0));
  arr.push = cb.bind(null, arr.push.bind(arr));
  window.__wp = req;
})();
var mk = window.__mkop;
var mods = {
  200: new Function('e', 'e.exports={metadata:{featureSwitches:["feat_a","feat_c"]},operationType:"query",operationName:"TweetDetail",queryId:"QIDDETAILBUNDLE001"}'),
  201: mk('QIDUSERBYNAME00001', 'UserByScreenName', 'query', ['feat_a'], ['withAuxiliaryUserLabels']),
  202: mk('QIDFAVORITE0000001', 'FavoriteTweet', 'mutation', ['feat_a'], []),
  203: mk('QIDGONE0000000001', 'Gone', 'query', ['feat_a']), 204: mk('QIDBAD00000000001', 'Bad', 'query', []), 205: mk('QIDFORBID000000001', 'Forbid', 'query', []),
  206: mk('QIDLIMITED00000001', 'Limited', 'query', []), 207: mk('QIDBOOM000000000001', 'Boom', 'query', []), 208: mk('QIDHANG0000000001', 'Hang', 'query', []),
  209: mk('QIDVALERR000000001', 'ValErr', 'query', []), 210: mk('QIDPARTIAL000000001', 'Partial', 'query', []),
  211: function (e) { var o = { queryId: 12345, operationName: null }; var s = "queryId"; e.exports = o; },
  212: function (e) { e.exports = { queryId: "DECOYQIDDECOY0001" }; },
  213: { queryId: 'OBJFACTORYQID00001', operationName: 'ObjFactoryOp' },
  214: null, 215: 42, 216: 'a string',
  217: function (e) { e.exports = {}; e.exports[['query', 'Id'].join('')] = 'EXPORTSQID0000001'; e.exports[['operation', 'Name'].join('')] = 'Likes'; e.exports.metadata = { featureSwitches: ['feat_x'] }; },
  218: function (e) { Object.defineProperty(e.exports, 'queryId', { enumerable: true, get: function () { throw new Error('boom'); } }); },
  219: mk('QIDUSERTWEETS00001', 'UserTweets', 'query', ['feat_a']),
  220: mk('QIDSEARCH0000000001', 'SearchTimeline', 'query', ['feat_a'])
};
(self.webpackChunk_twitter_responsive_web = self.webpackChunk_twitter_responsive_web || []).push([['late'], mods, function (req) { window.__lateRuntime = typeof req; }]);
try { __wp(217); } catch (e) {}
try { __wp(218); } catch (e) {}
window.__tapEvents = [];
document.addEventListener('xbb-api-tap', function (e) { window.__tapEvents.push(typeof e.detail); });
var HEADERS = { authorization: 'Bearer TESTBEARER', 'x-csrf-token': 'csrf-live', 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-client-language': 'en', 'x-xp-forwarded-for': 'xpf123' };
var FEATS = encodeURIComponent(JSON.stringify({ feat_a: true, feat_b: false, live_only: true }));
// what X's own client does: GET with variables + features, headers from its session
window.xFetch = function (qid, op, headers) {
  return fetch('/i/api/graphql/' + qid + '/' + op + '?variables=' + encodeURIComponent(JSON.stringify({ count: 20 })) + '&features=' + FEATS, { headers: headers || HEADERS, credentials: 'include' })
    .then(function (res) { return res.json().then(function (j) { return { status: res.status, json: j }; }); });
};
window.xXhr = function (qid, op) {
  return new Promise(function (done) {
    var x = new XMLHttpRequest();
    x.open('GET', '/i/api/graphql/' + qid + '/' + op + '?variables=' + encodeURIComponent('{"count":5}') + '&features=' + FEATS);
    for (var k in HEADERS) x.setRequestHeader(k, HEADERS[k]);
    x.onload = function () { done({ status: x.status, json: JSON.parse(x.responseText) }); };
    x.send();
  });
};
</script></body></html>`;
const MKOP = `window.__mkop = function (q, n, t, fs, ft) { return new Function('e', 'e.exports={queryId:"' + q + '",operationName:"' + n + '",operationType:"' + t + '",metadata:{featureSwitches:' + JSON.stringify(fs || []) + ',fieldToggles:' + JSON.stringify(ft || []) + '}}'); };`;
const PRE = MKOP + `window.webpackChunk_twitter_responsive_web = [[['pre'], { 100: __mkop('QIDHOMEBUNDLE0001', 'HomeTimeline', 'query', ['feat_a', 'feat_b'], ['withArticlePlainText']) }]];`;
const BODY = { HomeTimeline: FX.home, TweetDetail: FX.detail, SearchTimeline: FX.search, UserByScreenName: FX.profile };

async function open({ pre = false, seed = null, init = '', cookie = false, url = '/home' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const srv = { reqs: [], status: {}, badQid: new Set(), delay: {} };
  await ctx.route(/x\.com/, async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname === '/home') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    if (u.pathname === '/bare') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>b</title></head><body>bare</body></html>' });
    const m = /^\/i\/api\/graphql\/([\w-]+)\/(\w+)/.exec(u.pathname);
    if (!m) return route.fulfill({ status: 404, body: '' });
    const q = { qid: m[1], op: m[2], method: req.method(), headers: req.headers(), search: u.searchParams, body: req.postData() };
    q.vars = JSON.parse(q.search.get('variables') || (q.body ? JSON.stringify(JSON.parse(q.body).variables) : 'null'));
    q.features = JSON.parse(q.search.get('features') || (q.body ? JSON.stringify(JSON.parse(q.body).features) : 'null'));
    q.toggles = JSON.parse(q.search.get('fieldToggles') || 'null');
    srv.reqs.push(q);
    try {
      if (srv.delay[q.op]) await new Promise(res => setTimeout(res, srv.delay[q.op]));
      const status = srv.badQid.has(q.qid) ? 404 : srv.status[q.op] || 200;
      let body = BODY[q.op] || { data: { ok: q.op } };
      if (q.op === 'ValErr' && status === 200) body = { errors: [{ message: 'Variable "$tweetId" of required type "String!" was not provided.', code: 366 }], data: null };
      if (q.op === 'Partial' && status === 200) body = { data: { user: {} }, errors: [{ message: 'Not found', code: 34 }] };
      await route.fulfill({ status, contentType: 'application/json', headers: status === 429 ? { 'x-rate-limit-reset': '1999999999' } : {}, body: JSON.stringify(body) });
    } catch {}
  });
  if (cookie) await ctx.addCookies([{ name: 'ct0', value: 'cookiecsrf', url: 'https://x.com' }]);
  if (seed) await ctx.addInitScript(`localStorage.setItem('xbb-userscript-settings', ${JSON.stringify(JSON.stringify({ settings: seed }))});`);
  await ctx.addInitScript(pre ? PRE : MKOP);
  if (init) await ctx.addInitScript(init);
  await ctx.addInitScript({ path: usFile });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || /XBB/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto('https://x.com' + url);
  return { ctx, page, srv };
}
const call = (page, op, vars, opts) => page.evaluate(([o, v, p]) => XBB.gql.call(o, v, p), [op, vars || {}, opts || {}]);
const status = (page, scan = true) => page.evaluate(s => XBB.gql.status({ scan: s }), scan);
const hits = (srv, op) => srv.reqs.filter(q => q.op === op);
const errsOf = () => logs.filter(l => l.startsWith('[pageerror]'));

// ---------- 1. harvesting from webpack chunks ----------
{
  const { ctx, page } = await open({ pre: true });
  const s0 = await status(page, false);
  check('main-world half installed, API reachable from the content script', s0.ok && s0.main === true && await page.evaluate(() => XBB.gql.available()), s0);
  const s = await status(page, true);
  const names = new Set(s.opNames);
  check('harvest: chunk array that existed before the script (pre-pushed chunk) is scanned', names.has('HomeTimeline'), s.opNames);
  check('harvest: chunk pushed after the script: ops in other key order, mutations and toggles', ['TweetDetail', 'UserByScreenName', 'FavoriteTweet', 'UserTweets', 'SearchTimeline'].every(n => names.has(n)), s.opNames);
  check('harvest: webpack require captured and the module cache scanned (exports built at run time)', s.webpack.require && names.has('Likes'), s.webpack);
  check('harvest: module that is a plain object is read too', names.has('ObjFactoryOp'), s.opNames);
  check('harvest: decoys (non-string ids, no operation name, throwing getters, null/number factories) are ignored without errors', !names.has('DECOYQIDDECOY0001') && s.ops >= 15 && errsOf().length === 0, { ops: s.ops, errs: errsOf() });
  const probe = await page.evaluate(() => ({ runs: window.__chunkRuns, late: window.__lateRuntime, hasMod: typeof __wp.m[200], pushIsOurs: Array.isArray(self.webpackChunk_twitter_responsive_web) }));
  check("X's own webpack keeps working (runtimes run, modules registered, array intact)", probe.runs >= 1 && probe.late === 'function' && probe.hasMod === 'function' && probe.pushIsOurs, probe);
  await page.waitForTimeout(1900);
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('xbb-gql-ops-v1') || 'null'));
  check('ops cached in localStorage[xbb-gql-ops-v1] with their feature switches and field toggles',
    cache?.v === 1 && cache.ops.HomeTimeline?.queryId === 'QIDHOMEBUNDLE0001' && cache.ops.HomeTimeline.featureSwitches.join() === 'feat_a,feat_b' && cache.ops.HomeTimeline.fieldToggleNames.join() === 'withArticlePlainText'
      && cache.ops.TweetDetail?.queryId === 'QIDDETAILBUNDLE001' && cache.ops.Likes?.queryId === 'EXPORTSQID0000001', cache && Object.keys(cache.ops || {}));
  // a page without any chunk: last session's cache gives the ops back
  await page.goto('https://x.com/bare');
  const s2 = await status(page, true);
  check('cache: a fresh load without chunks still knows the ops from last time', s2.opNames.includes('HomeTimeline') && s2.opNames.includes('TweetDetail'), s2.opNames);
  await ctx.close();
}
{
  // no chunk array before the script: the global is created by X's first chunk and hooked through the property setter
  const { ctx, page } = await open();
  const s = await status(page, true);
  check('harvest: array created after the script (setter hook) is scanned, bundle query IDs used as they are',
    s.opNames.includes('TweetDetail') && !s.opNames.includes('HomeTimeline') && s.webpack.hooked, s);
  const r1 = await call(page, 'Likes');
  check('no session yet: a call says so (auth), nothing is sent and the breaker stays closed', r1.ok === false && r1.kind === 'auth' && await page.evaluate(() => !XBB.gql.breaker.isOpen('Likes')), r1);
  await ctx.close();
}

// ---------- 2. live learning, session headers, calls ----------
{
  const { ctx, page, srv } = await open({ pre: true });
  await page.evaluate(() => window.__tapOff = true);
  const live = await page.evaluate(() => xFetch('QIDLIVEHOME0000001', 'HomeTimeline'));
  check("X's own response is untouched by the tap wrapper", live.status === 200 && live.json.data.home.home_timeline_urt.instructions.length === 3, live.status);
  const xhr = await page.evaluate(() => xXhr('QIDLIVEUSERTW000001', 'UserTweets'));
  check("X's own XMLHttpRequest is untouched", xhr.status === 200 && xhr.json.data.ok === 'UserTweets', xhr);
  const s = await status(page, false);
  check('session: authorization, csrf and the x-twitter-* headers captured from X\'s own requests', s.auth && s.csrf && ['authorization', 'x-csrf-token', 'x-twitter-auth-type', 'x-twitter-client-language', 'x-xp-forwarded-for'].every(k => s.captured.includes(k)), s.captured);
  check('tap is off by default: nothing is parsed or sent to the content script', (await page.evaluate(() => window.__tapEvents.length)) === 0 && (await page.evaluate(() => XBB.gql.getTapped('HomeTimeline'))) === undefined, null);

  const a = await call(page, 'UserByScreenName', { screen_name: 'alice' });
  const h = hits(srv, 'UserByScreenName')[0];
  check('call: round trip across the bridge returns X\'s JSON', a.ok && a.kind === 'ok' && a.status === 200 && a.data.data.user.result.rest_id === '100' && a.queryId === 'QIDUSERBYNAME00001', a);
  check('call: GET with the harvested queryId and the variables', h && h.method === 'GET' && h.qid === 'QIDUSERBYNAME00001' && h.vars.screen_name === 'alice', h && { m: h.method, qid: h.qid, v: h.vars });
  check('call: features built from the op\'s switch list with values X was seen to send (feat_a true), field toggles included', h?.features.feat_a === true && h?.toggles?.withAuxiliaryUserLabels === false, h && { f: h.features, t: h.toggles });
  check('call: captured session headers attached, no transaction id when there is no generator',
    h?.headers.authorization === 'Bearer TESTBEARER' && h.headers['x-csrf-token'] === 'csrf-live' && h.headers['x-twitter-auth-type'] === 'OAuth2Session' && h.headers['x-twitter-client-language'] === 'en' && h.headers['x-xp-forwarded-for'] === 'xpf123' && !h.headers['x-client-transaction-id'],
    h && h.headers);
  const home = await call(page, 'HomeTimeline', { count: 5 });
  const hh = hits(srv, 'HomeTimeline').pop();
  check("live queryId beats the bundle's, and the live feature flags are used (live_only)", home.ok && hh.qid === 'QIDLIVEHOME0000001' && hh.features.live_only === true && hh.features.feat_a === true, hh && { qid: hh.qid, f: hh.features });
  const ut = await call(page, 'UserTweets', { userId: '100' });
  check('learned from a live XMLHttpRequest too', ut.ok && hits(srv, 'UserTweets').pop().qid === 'QIDLIVEUSERTW000001', hits(srv, 'UserTweets').pop()?.qid);

  const fav = await call(page, 'FavoriteTweet', { tweet_id: '1001' });
  const fh = hits(srv, 'FavoriteTweet')[0];
  const fb = fh?.body && JSON.parse(fh.body);
  check('call: a mutation is a POST with {variables, features, queryId} as JSON', fav.ok && fh.method === 'POST' && fb.queryId === 'QIDFAVORITE0000001' && fb.variables.tweet_id === '1001' && fb.features && /json/.test(fh.headers['content-type']), fh && { m: fh.method, b: fb });
  await call(page, 'UserByScreenName', { screen_name: 'x' }, { method: 'POST', headers: { 'x-extra-test': 'yes' } });
  const ph = hits(srv, 'UserByScreenName').pop();
  check('call: method override and extra headers', ph.method === 'POST' && ph.headers['x-extra-test'] === 'yes', ph && { m: ph.method, h: ph.headers['x-extra-test'] });
  await page.evaluate(() => { window.__xbbApiTxid = async (p, m) => 'T'.repeat(48) + m; });
  const tx = await call(page, 'UserByScreenName', { screen_name: 'tx' });
  const th = hits(srv, 'UserByScreenName').pop();
  check('call: x-client-transaction-id from a supplied generator', tx.ok && tx.txid === true && th.headers['x-client-transaction-id'] === 'T'.repeat(48) + 'GET', th.headers['x-client-transaction-id']);
  const s2 = await status(page, false);
  check('status reports txid readiness', s2.txid.ready === true, s2.txid);
  const idle = await idleMutations(page, 1500);
  check('idle: the API adds no DOM churn of its own', idle <= 10, idle);
  await ctx.close();
}
{
  // csrf falls back to the ct0 cookie when X's own request never carried the header
  const { ctx, page, srv } = await open({ pre: true, cookie: true });
  await page.evaluate(() => xFetch('QIDLIVEHOME0000001', 'HomeTimeline', { authorization: 'Bearer ONLYAUTH' }));
  await call(page, 'UserByScreenName', { screen_name: 'a' });
  const h = hits(srv, 'UserByScreenName')[0];
  check('csrf: falls back to the ct0 cookie', h?.headers.authorization === 'Bearer ONLYAUTH' && h.headers['x-csrf-token'] === 'cookiecsrf', h && h.headers);
  await ctx.close();
}

// ---------- 3. passive taps ----------
{
  const { ctx, page, srv } = await open({ pre: true });
  await page.evaluate(() => { XBB.gql.enableTap(); window.__got = []; XBB.gql.onTap('HomeTimeline', t => window.__got.push(t.queryId)); });
  check('tap switch is on the page (data-xbb-api-tap)', await page.evaluate(() => document.documentElement.hasAttribute('data-xbb-api-tap')), null);
  const live = await page.evaluate(() => xFetch('QIDLIVEHOME0000001', 'HomeTimeline'));
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => XBB.gql.getTapped('HomeTimeline'));
  check('tap: home timeline response reaches the content script, queryId and variables with it', t && t.op === 'HomeTimeline' && t.queryId === 'QIDLIVEHOME0000001' && t.status === 200 && t.variables.count === 20 && t.data.data.home.home_timeline_urt.instructions.length === 3, t && { op: t.op, q: t.queryId, v: t.variables });
  check('tap: onTap subscriber called', (await page.evaluate(() => window.__got)).join() === 'QIDLIVEHOME0000001', null);
  check('tap: only strings cross the boundary (CustomEvent detail is JSON text)', (await page.evaluate(() => window.__tapEvents)).every(x => x === 'string') && (await page.evaluate(() => window.__tapEvents.length)) === 1, await page.evaluate(() => window.__tapEvents));
  check("tap: X still reads its own response", live.status === 200 && live.json.data.home.home_timeline_urt.instructions.length === 3, live.status);
  await page.evaluate(() => xXhr('QIDLIVEUSERTW000001', 'UserTweets'));
  await page.waitForTimeout(200);
  check('tap: XMLHttpRequest responses too', await page.evaluate(() => XBB.gql.getTapped('UserTweets')?.queryId === 'QIDLIVEUSERTW000001'), null);
  await page.evaluate(() => { xFetch('QIDFAVORITE0000001', 'FavoriteTweet'); xFetch('QIDLIVEHOME0000001', 'SomethingElse'); });
  await page.waitForTimeout(300);
  check('tap: only the core operations', await page.evaluate(() => XBB.gql.getTapped('FavoriteTweet') === undefined && XBB.gql.getTapped('SomethingElse') === undefined), null);
  const items = await page.evaluate(() => XBB.model.extractTimeline(XBB.gql.getTapped('HomeTimeline').data).items.length);
  check('tap -> model: the tapped home timeline parses into items', items === 7, items);
  for (let i = 0; i < 6; i++) await page.evaluate(() => xFetch('QIDLIVEHOME0000001', 'HomeTimeline'));
  await page.waitForTimeout(300);
  check('tap: ring buffer keeps the latest few per op', (await page.evaluate(() => XBB.gql.getTapped('HomeTimeline', { all: true }).length)) === 4, null);
  // a drifted op trips the breaker; X itself then works with a new queryId, which lets us try again
  srv.badQid.add('QIDLIVEHOME0000001');
  const bad = await call(page, 'HomeTimeline', {});
  check('breaker: tripped by a 404 on the queryId in use', bad.kind === 'drift' && await page.evaluate(() => XBB.gql.breaker.isOpen('HomeTimeline')), bad);
  await page.evaluate(() => xFetch('QIDHOMENEW0000001', 'HomeTimeline'));
  await page.waitForTimeout(300);
  check('breaker: closes by itself when a tapped X request shows another queryId', await page.evaluate(() => !XBB.gql.breaker.isOpen('HomeTimeline')), await page.evaluate(() => XBB.gql.breaker.get('HomeTimeline')));
  const again = await call(page, 'HomeTimeline', {});
  check('breaker: the next call goes out with the new queryId', again.ok && hits(srv, 'HomeTimeline').pop().qid === 'QIDHOMENEW0000001', again);
  await ctx.close();
}
{
  const { ctx, page } = await open({ pre: true, seed: { fastUi: true } });
  await page.evaluate(() => XBB.ready);
  check('tap follows the fastUi setting', await page.evaluate(() => document.documentElement.hasAttribute('data-xbb-api-tap')), null);
  await page.waitForTimeout(600);
  const s = await status(page, false);
  check('with tapping on, chunks are scanned in the background (no call needed)', s.tap && s.ops >= 15, s);
  await ctx.close();
}

// ---------- 4. circuit breaker ----------
{
  const { ctx, page, srv } = await open({ pre: true });
  await page.evaluate(() => xFetch('QIDLIVEHOME0000001', 'HomeTimeline'));
  const state = op => page.evaluate(o => XBB.gql.breaker.get(o), op);
  srv.status.Gone = 404;
  const g = await call(page, 'Gone');
  const gs = await state('Gone');
  check('breaker: 404 is drift and trips the route, with what failed on record', g.ok === false && g.kind === 'drift' && g.status === 404 && gs.state === 'open' && gs.status === 404 && gs.queryId === 'QIDGONE0000000001' && gs.kind === 'drift', { g, gs });
  const g2 = await call(page, 'Gone');
  check('breaker: open means no request goes out', g2.kind === 'breaker-open' && hits(srv, 'Gone').length === 1, { kind: g2.kind, hits: hits(srv, 'Gone').length });
  const drift = await page.evaluate(() => XBB.gql.getDrift());
  check('breaker: drift log keeps op, status and queryId', drift.length === 1 && drift[0].op === 'Gone' && drift[0].queryId === 'QIDGONE0000000001' && drift[0].status === 404, drift);
  srv.status.Gone = 200;
  await page.evaluate(() => XBB.gql.breaker.reset('Gone'));
  const g3 = await call(page, 'Gone');
  check('breaker: reset lets the route work again', g3.ok && !(await state('Gone')), g3);

  const missing = await call(page, 'NopeOp');
  const ms = await state('NopeOp');
  check('breaker: an operation the harvester does not know trips it (kind missing-op), nothing is sent', missing.kind === 'missing-op' && ms?.state === 'open' && hits(srv, 'NopeOp').length === 0, { missing, ms });

  srv.status.Bad = 400; srv.status.Forbid = 403;
  const b = await call(page, 'Bad'), f = await call(page, 'Forbid');
  check('breaker: 400 and 403 trip it', b.kind === 'drift' && f.kind === 'drift' && (await state('Bad')).state === 'open' && (await state('Forbid')).state === 'open', { b: b.kind, f: f.kind });

  srv.status.Limited = 429;
  const l = await call(page, 'Limited');
  check('429 is a rate limit: reported, not tripped', l.kind === 'rate-limit' && l.rateLimitReset === 1999999999 && !(await state('Limited')), l);

  srv.status.Boom = 500;
  const kinds = [];
  for (let i = 0; i < 5; i++) kinds.push((await call(page, 'Boom')).kind);
  const bs = await state('Boom');
  check('5xx counts but only five in a row open it (kind unstable)', kinds.join() === 'server,server,server,server,server' && bs?.state === 'open' && bs.kind === 'unstable', { kinds, bs });

  srv.delay.Hang = 2500;
  const hang = await call(page, 'Hang', {}, { timeout: 500 });
  check('timeout: classified, one is not enough to trip', hang.kind === 'timeout' && !(await state('Hang')), hang);

  const ve = await call(page, 'ValErr');
  check('200 with only a GraphQL validation error is drift and trips it', ve.kind === 'drift' && (await state('ValErr'))?.state === 'open', { kind: ve.kind });
  const pa = await call(page, 'Partial');
  check('200 with data and errors is a normal answer', pa.ok && pa.kind === 'ok' && !(await state('Partial')), pa.kind);

  // cooldown: after ten minutes one probe goes through; it closes the route if it works
  srv.status.Forbid = 200;
  await page.evaluate(() => { const o = Date.now; Date.now = () => o() + 11 * 60 * 1000; });
  const half = await page.evaluate(() => XBB.gql.breaker.state('Forbid'));
  const probe = await call(page, 'Forbid');
  check('breaker: cooled down it is half-open, a working probe closes it', half === 'half-open' && probe.ok && !(await state('Forbid')), { half, probe: probe.kind });
  const seen = []; await page.evaluate(() => XBB.gql.breaker.onChange((op, st) => (window.__bc = window.__bc || []).push(op + ':' + (st ? st.state : 'closed'))));
  await page.evaluate(() => XBB.gql.breaker.reset('Bad'));
  check('breaker: change listener', (await page.evaluate(() => window.__bc)).join() === 'Bad:closed', await page.evaluate(() => window.__bc));
  await ctx.close();
}

// ---------- 5. the model ----------
{
  const { ctx, page } = await open();
  const M = await page.evaluate(([T, U, FX]) => {
    const m = XBB.model, o = {};
    const safe = (k, f) => { try { o[k] = f(); } catch (e) { o[k] = { threw: String(e) }; } };
    safe('std', () => m.normalizeTweet({ result: T.std }));
    safe('stdWrapper', () => m.normalizeTweet(T.std));
    safe('vis', () => m.normalizeTweet({ result: T.vis }));
    safe('note', () => m.normalizeTweet({ result: T.note }));
    safe('reply', () => m.normalizeTweet({ result: T.reply }));
    safe('quote', () => m.normalizeTweet({ result: T.quote }));
    safe('quoteTomb', () => m.normalizeTweet({ result: T.quoteTomb }));
    safe('rt', () => m.normalizeTweet({ result: T.rt }));
    safe('photos', () => m.normalizeTweet({ result: T.photos }));
    safe('video', () => m.normalizeTweet({ result: T.video }));
    safe('gif', () => m.normalizeTweet({ result: T.gif }));
    safe('poll', () => m.normalizeTweet({ result: T.poll }));
    safe('link', () => m.normalizeTweet({ result: T.link }));
    safe('cnote', () => m.normalizeTweet({ result: T.cnote }));
    safe('tomb', () => m.normalizeTweet({ result: T.tomb }));
    safe('unavail', () => m.normalizeTweet({ result: T.unavail }));
    safe('alice', () => m.normalizeUser({ result: U.alice }));
    safe('bob', () => m.normalizeUser(U.bob));
    safe('ghost', () => m.normalizeUser({ result: { __typename: 'UserUnavailable', reason: 'Suspended' } }));
    safe('profile', () => m.extractUser(FX.profile));
    safe('home', () => m.extractTimeline(FX.home));
    safe('homeAds', () => m.extractTimeline(FX.home, { keepPromoted: true }));
    safe('detail', () => m.extractTimeline(FX.detail));
    safe('search', () => m.extractTimeline(FX.search));
    // garbage: nothing may throw, whatever X sends
    const junk = [undefined, null, 0, 42, '', 'tweet', true, [], [[]], {}, { result: null }, { result: {} }, { legacy: null }, { legacy: 'x' }, { rest_id: '1' }, { rest_id: 1, legacy: { full_text: 5, entities: 'x', extended_entities: { media: 'no' }, created_at: {}, display_text_range: 'a', retweeted_status_result: null } },
      { __typename: 'Tweet', rest_id: '7', core: { user_results: null }, legacy: { full_text: 'only text' }, views: { count: 'many' }, card: 'x', birdwatch_pivot: 3, quoted_status_result: { result: null }, note_tweet: { note_tweet_results: 7 } },
      { __typename: 'TweetWithVisibilityResults' }, { __typename: 'TweetWithVisibilityResults', tweet: { __typename: 'TweetWithVisibilityResults', tweet: null } }, { __typename: 'TweetTombstone' }];
    o.junkThrew = [];
    junk.forEach((j, i) => {
      for (const [n, f] of [['tweet', m.normalizeTweet], ['user', m.normalizeUser], ['timeline', m.extractTimeline], ['extractUser', m.extractUser]]) { try { f(j); } catch (e) { o.junkThrew.push(n + i + ': ' + e); } }
    });
    o.junkTimelines = [null, {}, { data: null }, { data: { home: { home_timeline_urt: { instructions: 'x' } } } }, { data: { x: { instructions: [null, 1, 'a', {}, { type: 'TimelineAddEntries' }, { type: 'TimelineAddEntries', entries: [null, 5, {}, { content: 1 }, { entryId: 'x', content: { itemContent: 3 } }] }] } } }]
      .map(j => { const t = m.extractTimeline(j); return t.items.length + '/' + t.rawEntryCount; });
    safe('junkTweet', () => m.normalizeTweet(junk[16]));
    // a self-referencing quote chain must stop
    const loop = { __typename: 'Tweet', rest_id: '9', legacy: { full_text: 'loop' } }; loop.quoted_status_result = { result: loop };
    safe('loop', () => { const t = m.normalizeTweet(loop); let d = 0, q = t; while (q && q.quote && d < 20) { q = q.quote; d++; } return d; });
    safe('date', () => [m.toMs('Wed Oct 10 20:19:24 +0000 2018'), m.toMs('Wed Oct 10 20:19:24 -0130 2018'), m.toMs('2025-11-21T10:30:00Z'), m.toMs('nope'), m.toMs(null)]);
    safe('avatar', () => m.avatarSize('https://pbs.twimg.com/profile_images/1/a_normal.jpg', '400x400'));
    return o;
  }, [T, U, FX]);

  const s = M.std;
  check('model: standard tweet (id, text without HTML escapes, ISO date, url, conversation)', s.type === 'tweet' && s.id === '1001' && s.text === 'Hello & welcome #hello https://t.co/abc123' && s.createdAt === '2025-11-20T10:30:00.000Z' && s.url === 'https://x.com/alice/status/1001' && s.conversationId === '1001' && s.lang === 'en' && s.source === 'Twitter Web App', s);
  check('model: author from the new core/avatar shape (verified, Business)', s.author.id === '100' && s.author.name === 'Alice' && s.author.screenName === 'alice' && s.author.avatar.endsWith('alice_normal.jpg') && s.author.verified === true && s.author.verifiedType === 'Business', s.author);
  check('model: entities, stats (views as a number) and the viewer\'s own state', s.entities.urls[0].expandedUrl === 'https://example.test/page' && s.entities.urls[0].displayUrl === 'example.test/page' && s.entities.hashtags[0].text === 'hello' && s.stats.views === 4521 && s.stats.likes === 10 && s.stats.replies === 2 && s.stats.retweets === 3 && s.stats.bookmarks === 3 && s.stats.quotes === 1
    && s.viewer.liked === true && s.viewer.bookmarked === true && s.viewer.retweeted === false, { e: s.entities, st: s.stats, v: s.viewer });
  check('model: a tweet_results wrapper and the bare result give the same record', M.stdWrapper?.id === '1001' && M.stdWrapper.text === s.text, M.stdWrapper?.id);
  check('model: TweetWithVisibilityResults is unwrapped, interstitial kept', M.vis.type === 'tweet' && M.vis.id === '1012' && M.vis.text === 'limited reply' && M.vis.interstitial === 'The author limited who can reply.' && M.vis.author.screenName === 'bob' && M.vis.author.avatar.endsWith('bob_normal.png') && M.vis.author.verified === true, M.vis);
  check('model: long-form note_tweet text wins over the truncated legacy text, with its own entities', M.note.isLongform === true && M.note.text.length > 400 && !M.note.text.includes('…') && M.note.entities.mentions[0].screenName === 'bob' && M.note.entities.urls[0].expandedUrl === 'https://example.test/n' && M.note.entities.hashtags[0].text === 'long', { len: M.note.text.length, e: M.note.entities });
  check('model: reply (replyTo, display range drops the leading mention and the media link)', M.reply.replyTo.tweetId === '1001' && M.reply.replyTo.screenName === 'alice' && M.reply.replyTo.userId === '100' && M.reply.text === 'thanks for this!' && M.reply.conversationId === '1001', M.reply);
  check('model: quote tweet is normalized recursively', M.quote.quote?.id === '1001' && M.quote.quote.author.screenName === 'alice' && M.quote.quote.text.startsWith('Hello'), M.quote.quote?.id);
  check('model: a tombstone as the quoted tweet', M.quoteTomb.quote?.unavailable === true && M.quoteTomb.quote.kind === 'tombstone' && /no longer exists/.test(M.quoteTomb.quote.reason), M.quoteTomb.quote);
  check('model: a retweet is the original tweet with retweetedBy', M.rt.id === '1001' && M.rt.author.screenName === 'alice' && M.rt.retweetedBy?.screenName === 'dave' && M.rt.retweetedBy.tweetId === '3001' && M.rt.retweetedBy.createdAt === '2025-11-20T11:00:00.000Z', M.rt.retweetedBy);
  check('model: multi photo (url, size, alt text; missing alt is null)', M.photos.media.length === 3 && M.photos.media.every(p => p.type === 'photo' && p.width === 1200 && p.height === 800) && M.photos.media[0].url.endsWith('p1.jpg') && M.photos.media[0].alt === 'cat 1' && M.photos.media[2].alt === null && M.photos.sensitive === true, M.photos.media);
  const v = M.video.media[0];
  check('model: video (best MP4 by bitrate, HLS url, duration, poster, aspect ratio)', v.type === 'video' && v.url.endsWith('1280x720/b.mp4') && v.bitrate === 2176000 && v.hls.includes('.m3u8') && v.duration === 15041 && v.poster.endsWith('poster.jpg') && Math.abs(v.aspectRatio - 16 / 9) < 1e-6 && v.width === 1280, v);
  const gf = M.gif.media[0];
  check('model: animated GIF is its own media type with the MP4', gf.type === 'gif' && gf.url.endsWith('tweet_video/g.mp4') && gf.hls === null && gf.aspectRatio === 1, gf);
  check('model: poll card (labels, counts, total, end time, final)', M.poll.card.kind === 'poll' && M.poll.card.choices.map(c => c.label + c.count).join() === 'Red10,Green30,Blue60' && M.poll.card.total === 100 && M.poll.card.endTime === '2025-11-21T10:30:00.000Z' && M.poll.card.final === true, M.poll.card);
  check('model: link card (title, description, domain, url, thumbnail)', M.link.card.kind === 'link' && M.link.card.title === 'Example title' && M.link.card.description === 'Example desc' && M.link.card.domain === 'example.test' && M.link.card.url === 'https://t.co/card1' && M.link.card.thumb.width === 800 && M.link.card.thumb.url.includes('card_img'), M.link.card);
  check('model: community note (birdwatch_pivot)', M.cnote.communityNote.noteId === '999' && M.cnote.communityNote.title === 'Readers added context' && M.cnote.communityNote.text === 'Context & sources' && M.cnote.communityNote.url.includes('birdwatch'), M.cnote.communityNote);
  check('model: TweetTombstone and TweetUnavailable become unavailable records', M.tomb.unavailable === true && M.tomb.kind === 'tombstone' && M.tomb.reason.includes('no longer exists') && M.unavail.unavailable === true && M.unavail.reason === 'Suspended' && M.unavail.kind === 'unavailable', { t: M.tomb, u: M.unavail });
  check('model: user (new shape): counts, verified type, relationship, bio unescaped, banner, location, url, pinned', M.alice.id === '100' && M.alice.name === 'Alice' && M.alice.screenName === 'alice' && M.alice.bio === 'Builds things & breaks them' && M.alice.followers === 1234 && M.alice.following === 56 && M.alice.tweetsCount === 7890
    && M.alice.verified === true && M.alice.verifiedType === 'Business' && M.alice.followingState === 'following' && M.alice.followedBy === true && M.alice.location === 'Berlin' && M.alice.url === 'https://alice.example.test' && M.alice.banner.includes('profile_banners') && M.alice.createdAt === '2012-01-02T15:04:05.000Z' && M.alice.pinnedTweetIds[0] === '555', M.alice);
  check('model: user (old legacy shape) and follow request state', M.bob.name === 'Bob' && M.bob.screenName === 'bob' && M.bob.avatar.endsWith('bob_normal.png') && M.bob.verified === true && M.bob.verifiedType === 'Legacy' && M.bob.followingState === 'requested' && M.bob.protected === true && M.bob.location === 'Paris', M.bob);
  check('model: unavailable user and extractUser on a profile response', M.ghost.unavailable === true && M.ghost.reason === 'Suspended' && M.profile?.screenName === 'alice', { g: M.ghost, p: M.profile?.screenName });

  const h = M.home;
  check('timeline: tweets, thread members, the pinned entry and a retweet come out in order; ads are skipped', h.items.map(i => i.tweet.id).join() === '1001,1004,1002,1006,1007,1001,1003' && h.skippedPromoted === 1 && h.items.every(i => !i.promoted), h.items.map(i => i.entryId));
  check('timeline: top and bottom cursors', h.cursors.top === 'TOPCUR1' && h.cursors.bottom === 'BOTCUR1', h.cursors);
  check('timeline: conversation module members carry moduleId/moduleIndex, the pin is marked', h.items.slice(2, 5).every((i, k) => i.moduleId === 'conversationthread-77' && i.moduleIndex === k) && h.items[6].pinned === true && h.items[0].moduleId === null, h.items.map(i => [i.moduleId, i.moduleIndex, i.pinned]));
  check('timeline: rawEntryCount counts every entry, junk included', h.rawEntryCount === 13, h.rawEntryCount);
  check('timeline: keepPromoted keeps the ad and marks it promoted: true', M.homeAds.items.length === 8 && M.homeAds.items.filter(i => i.promoted).length === 1 && M.homeAds.items.find(i => i.promoted).tweet.id === '9001' && M.homeAds.skippedPromoted === 0, M.homeAds.items.map(i => [i.tweet.id, i.promoted]));
  check('timeline: conversation response (TweetDetail shape) with TimelineAddToModule', M.detail.items.map(i => i.tweet.id).join() === '1001,1002,1012' && M.detail.items[2].moduleId === 'conversationthread-1' && M.detail.cursors.bottom === 'DETAILBOT' && M.detail.items[2].tweet.interstitial, M.detail);
  check('timeline: search response (other depth), user items, cursor replaced by TimelineReplaceEntry', M.search.items.map(i => i.kind).join() === 'tweet,user' && M.search.cursors.bottom === 'REPL' && M.search.items[1].user.screenName === 'alice', M.search);
  check('model: malformed input never throws (tweet, user, timeline, user extraction)', M.junkThrew.length === 0, M.junkThrew);
  check('model: odd timelines give empty results, not errors', M.junkTimelines.join() === '0/0,0/0,0/0,0/0,0/5' || M.junkTimelines.join() === '0/0,0/0,0/0,0/0,0/6', M.junkTimelines);
  check('model: a half-broken tweet keeps what it has', M.junkTweet?.id === '7' && M.junkTweet.text === 'only text' && M.junkTweet.stats.views === 0 && M.junkTweet.card === null && M.junkTweet.communityNote === null && M.junkTweet.author.screenName === '', M.junkTweet);
  check('model: a quote that quotes itself stops', typeof M.loop === 'number' && M.loop <= 3, M.loop);
  check('model: dates parse X\'s format by hand, with offsets', M.date[0] === 1539202764000 && M.date[1] === 1539202764000 + 90 * 60000 && M.date[2] === 1763721000000 && M.date[3] === null && M.date[4] === null, M.date);
  check('model: avatar size helper', M.avatar === 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', M.avatar);
  await ctx.close();
}

// ---------- 6. Violentmonkey-style content realm with a nonce CSP ----------
// The page hooks arrive as an injected <script> with the page's nonce (window.wrappedJSObject marks that realm). The bridge
// must work through it, and without a nonce to borrow the API must say so quickly instead of hanging.
{
  const csp = "default-src 'self'; script-src 'nonce-n0nce' 'unsafe-inline'; style-src 'unsafe-inline'";
  for (const withNonce of [true, false]) {
    const ctx = await browser.newContext();
    await ctx.route(/x\.com/, route => route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': csp },
      body: `<!doctype html><html><head><title>csp</title>${withNonce ? '<script nonce="n0nce">window.__pageOk = 1</script>' : ''}</head><body><main>hi</main></body></html>` }));
    await ctx.addInitScript('window.wrappedJSObject = window;');
    await ctx.addInitScript({ path: usFile });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('https://x.com/csp');
    await page.waitForTimeout(1200);
    const st = await status(page, false);
    const c = await call(page, 'HomeTimeline');
    const tag = withNonce ? 'nonce CSP, content realm' : 'CSP without a nonce script, content realm';
    if (withNonce) check(tag + ': the API half is injected with the nonce and answers over the bridge', st.ok && st.main === true && await page.evaluate(() => !!window.__xbbApiMainWorld), { st, errs });
    else check(tag + ': API reports no-main-world at once, breaker untouched, no errors', st.ok === false && st.error === 'no-main-world' && c.kind === 'no-main-world' && await page.evaluate(() => !XBB.gql.breaker.isOpen('HomeTimeline')) && errs.length === 0, { st, c, errs });
    await ctx.close();
  }
}

let fails = 0;
for (const [k, v] of Object.entries(ok)) {
  if (!v) fails++;
  console.log(`${v ? 'PASS' : 'FAIL'}  ${k}${v ? '' : '  ' + JSON.stringify(r[k])}`);
}
if (logs.length) console.log('\nconsole:\n' + logs.join('\n'));
await browser.close();
process.exit(fails ? 1 : 0);

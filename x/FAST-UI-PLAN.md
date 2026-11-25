# X Fast UI: plan

An opt-in mode of **Better Browsing for X** that replaces X's own timeline UI with a light one of our own, on the
routes where that is safe, and leaves everything else to X. Plain JavaScript, no framework, no runtime
dependency, inlined into `dist/better-browsing-x.user.js` like the rest of the X part (see `CLAUDE.md`,
`x/README.md`). Visual target: `x/fast-ui-mock.html` (open it in a browser; no server needed).

Status: design. Nothing here is built yet. Off by default (`fastUi: false`), and every milestone ships behind it.

## 1. Goals and non-goals

Goals:

- **Feels instant**: first paint of Home with no request beyond what X itself makes on load; 60 fps scrolling
  through 1,000+ tweets on a mid-range laptop; stepping between Home and a thread in under 50 ms from cache.
- **Survives X's deploys**: no hard-coded GraphQL query ids or feature flags; anything unknown degrades to an
  "Open on X" card, never to a blank page.
- **Never traps the user**: a "Native X" button on every screen, automatic fallback on errors, and X's own UI
  for everything we do not own.
- **Keeps today's QoL rules**: the same audio, one-at-a-time, pause-on-hide/offscreen behaviour as the native
  mode, the same one-click retweet, Like + Retweet and embed-link buttons, the same settings key.

Non-goals: Settings, Spaces, DMs (encrypted chats especially), Premium/Billing, login/2FA/account recovery,
Grok, ads management, Communities admin, Lists editing, analytics. These stay on X, always.

## 2. Execution model: headless host + route takeover

The userscript already runs at `document-start` with `@grant none` in the page (or, in Violentmonkey on
Firefox, the content realm with `runMain` handing page hooks over with a nonce). Fast UI keeps X's app alive
underneath and only takes over what the user sees:

```
<html data-xbb-fast="home">            set before first paint from the snapshot, so X never flashes
  <body>
    <div id="react-root">              X's app: keeps running (auth, cookies, service worker, router,
                                       txid generation, its own first fetches). Hidden while we own the
                                       route: html[data-xbb-fast] #react-root { display:none }
    <xbb-fast>  #shadow-root (open)    our UI; the only thing painted on owned routes
```

- **Why keep X running**: its boot does the expensive, fragile parts for us (session checks, guest/auth tokens,
  `ct0`, the transaction-id generator, the first `HomeTimeline` request) and lets the escape hatch be a CSS flip
  instead of a reload. `display:none` means React still reconciles but there is no layout or paint, and X's
  own IntersectionObservers (infinite scroll, impression pings, autoplay) never fire.
- **Route table** (`router.js`), matched on `location.pathname`:

  | Route | Pattern | Owner |
  |---|---|---|
  | Home | `/home`, `/` (logged in) | Fast UI |
  | Tweet detail / thread | `/:user/status/:id` (not `/photo/`, `/video/`, `/analytics`, `/quotes` → M3+) | Fast UI |
  | Profile | `/:user`, `/:user/with_replies`, `/:user/media` | Fast UI |
  | Bookmarks | `/i/bookmarks` | Fast UI |
  | Search | `/search?q=` | Fast UI |
  | Explore | `/explore` (trends list only) | Fast UI |
  | Everything else (`/settings/*`, `/i/spaces/*`, `/messages*`, `/i/chat*`, `/i/premium*`, `/i/grok*`, `/i/flow/*` login/2FA, `/i/verified-*`, `/compose/*` drafts, `/i/lists/*`, `/i/communities/*`, `/notifications` until M4) | | **X** |

  Unknown routes are X's. A route is ours only while its `fastUi.routes.<name>` setting is on and its circuit
  breaker is closed.
- **Navigation**: one capture-phase `click` listener on our shadow root handles `<a href>` inside our UI
  (`history.pushState`, render). Links to X-owned routes call `XBB.fast.native(url)`: set
  `html[data-xbb-fast="native"]`, then drive X's own router with `history.pushState(null, '', url)` +
  `dispatchEvent(new PopStateEvent('popstate'))` (React Router listens to `popstate`; works the same in Chrome and
  Firefox), so X renders the page without a reload. Coming back (X's own link or Back to an owned route) is seen
  by a `popstate` listener and a wrapped `history.pushState`/`replaceState` in `fast-main.js` that posts the new
  path to `router.js`.
- **Mirror navigation**: when we navigate to an owned route we also let X's hidden router follow (same
  `pushState` + `popstate`). X then makes its own request for that route (thread, profile timeline...), which
  the fetch tap (§3) hands us, so the first screen of every route costs X's request only, never a second one.
  Pagination is ours (§3), since a hidden timeline never scrolls.
- **Native escape hatch**: "Native X" in our top bar, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>, and
  `?xbb=native` in any URL. It flips the attribute; X is already on the same URL thanks to mirror navigation, so
  the switch is one frame. "Fast UI" in X's sidebar (cloned like today's gear) flips back.
- **Circuit breaker** (`flag.js`): every view and every API op reports `ok()` / `fail(reason)`. Three failures of
  one op within 5 minutes, any normalizer schema guard failing on a whole response, or an uncaught error during
  a view's render opens the breaker for that route for the rest of the session (`sessionStorage
  xbb-fast-broken`), shows a toast ("X changed something; showing X's own page for Home") and hands the route to
  X. Two routes broken → the whole mode is off for the session. `console.warn('[XBB fast]', op, reason,
  sample)` once per op so a bug report has the data. A breaker never closes on its own within the session; the
  next page load tries again.

## 3. Update resilience: talking to X's API without hard-coding it

All of this lives in `fast-main.js` (page world; the API needs the page's cookies, headers and X's own
functions) and `content/fast/ops.js` / `api.js`. The page world posts to our code with
`dispatchEvent(new CustomEvent('xbb-fast', { detail: JSON.stringify(msg) }))` on `document` (a string crosses
the Firefox Xray boundary without `cloneInto`), and listens for `xbb-fast-req` the other way.

### 3.1 Passive fetch tap (first paint with zero extra requests)

- Wrap `window.fetch` and `XMLHttpRequest.prototype.open/send/setRequestHeader` once, at document-start, before
  X's bundle runs. For every request to `/i/api/graphql/<queryId>/<OperationName>`:
  - record `{ queryId, operationName, features, fieldToggles, variables }` from the URL (GET) or body (POST);
  - record the request headers X sent (`authorization` bearer, `x-twitter-*`, `x-client-transaction-id`
    presence, `x-csrf-token` comes from the `ct0` cookie at call time anyway);
  - clone the response (`res.clone().text()` / `xhr.responseText` on `load`), and if Fast UI wants that op, post
    `{ op, variables, body }`. Never modify, delay or retry X's own request.
- The tap is cheap when Fast UI is off: an early `if (!wanted(op)) return` on the parsed path, no body reads.
- Ops we expect to see on owned routes: `HomeTimeline`, `HomeLatestTimeline`, `TweetDetail`,
  `UserByScreenName`, `UserTweets`, `UserTweetsAndReplies`, `UserMedia`, `Bookmarks`, `SearchTimeline`,
  `ExplorePage` / `GenericTimelineById`, and the mutations `FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`,
  `DeleteRetweet`, `CreateBookmark`, `DeleteBookmark`, `CreateTweet`. The list is data in `ops.js`; an op
  renamed by X is a one-line fix and, until then, an open breaker for that route.

### 3.2 Query id / feature harvesting

Priority order, first hit wins, all cached in `localStorage['xbb-fast-ops']` keyed by the hash in X's
`main.<hash>.js` URL (so a deploy invalidates it):

1. **Tapped requests** (§3.1): exact query id, features and field toggles X used minutes ago.
2. **Webpack chunks**: X's bundle registers modules through `self.webpackChunk_twitter_responsive_web.push`.
   `fast-main.js` wraps `push` (and scans the array already there) and, for each module factory, matches its
   source text (`fn.toString()`, done lazily in an idle callback, never on the boot path) against
   `/queryId:"([\w-]+)",operationName:"(\w+)",operationType:"(\w+)",metadata:\{featureSwitches:\[([^\]]*)\],fieldToggles:\[([^\]]*)\]/g`.
   That gives the id and the *names* of the feature switches for every op, including ones X has not called yet
   (mutations, `SearchTimeline` before the first search).
3. **Feature values**: the names from (2) are looked up in X's feature-switch config
   (`window.__INITIAL_STATE__.featureSwitch.defaultConfig` / `.user.config`, each `{ value }`); a switch missing
   from both is sent as `false`. If the tap has seen that op, its own `features` object wins.
4. **Last good cache** from a previous deploy, used only if (1)–(3) found nothing, and marked so a failure opens
   the breaker at once instead of after three tries.

`XBB.fast.ops.get('HomeTimeline')` returns `{ queryId, features, fieldToggles, source }` or `null`; `null`
means the route is X's.

### 3.3 Requests and the transaction-id bridge

- `api.js` builds requests exactly the way the tapped one looked: same path, same `features`/`fieldToggles`,
  variables merged over the tapped variables (so we only change `cursor`, `count`, `focalTweetId`...), the
  bearer and `x-twitter-*` headers seen on the tap, `x-csrf-token` from `document.cookie` `ct0`,
  `credentials: 'include'`. Pagination re-sends the tapped variables with the bottom cursor.
- **`x-client-transaction-id`**: X computes it per request from page state (the `twitter-site-verification`
  meta and the `ondemand.s` chunk). We never re-implement it. The bridge, tried in order:
  1. During the webpack scan, find the module that builds that header (its source contains
     `"x-client-transaction-id"`) and keep a reference to the exported generator; call it with
     `(method, path)` the same way X does. A self-test at startup compares one generated id's shape (length,
     base64 charset) and marks the bridge `ok` or `missing`.
  2. If missing: send without the header. Most queries still answer; if an op answers 404/403 without it, that
     op is marked `needsTxid` and the action falls back to X (below).
  3. Mutations with no working txid fall back to **delegated actions**: route the click to X's hidden DOM if
     that tweet's article is mounted there (mirror navigation keeps the same route mounted), else open the
     tweet on X for that one action. Never fake the header.
- Rate limits: honour `x-rate-limit-remaining/reset`; at most 2 requests in flight; pagination is triggered by
  the virtual list's "within 3 screens of the end", never by a timer. Failed responses are never cached.

### 3.4 Domain model, normalised defensively

`model.js` turns X's timeline instructions into plain frozen objects the views render. It is the only file that
knows X's JSON shapes; every field read goes through small accessors with fallbacks, and every response passes a
**schema guard** (has `instructions` array, entries have `entryId`, tweets have `rest_id`) before parsing.

```js
Tweet  = { id, kind: 'tweet' | 'tombstone' | 'unknown', author: UserRef, createdAt, text, segments[],
           note: { text, segments } | null,             // note_tweet (long form), expanded on click
           lang, media: Media[], card: Poll | LinkCard | null, quoted: Tweet | null,
           retweetedBy: UserRef | null, replyTo: { id, user } | null, communityNote: { text } | null,
           counts: { reply, retweet, like, quote, bookmark, view }, me: { liked, retweeted, bookmarked },
           conversationId, sensitive, raw: null }       // raw kept only with localStorage xbb-fast-debug
User   = { id, handle, name, avatar, verified: 'blue' | 'gold' | 'grey' | null, protected, bio, counts, ... }
Media  = { type: 'photo' | 'video' | 'gif', thumb, w, h, alt, variants: [{ url, type, bitrate }] }
Timeline = { entries: [{ key, tweetId | moduleItems | cursor }], top, bottom }
```

Rules that keep it alive across X's changes:

- Unwrap `TweetWithVisibilityResults.tweet`, treat `TweetTombstone` / `TweetUnavailable` as `kind: 'tombstone'`.
- Author fields: X moved `screen_name`/`name` from `user_results.result.legacy` to `.core` (2025) and avatars to
  `.avatar.image_url`; read new first, then old. Same pattern for every field X has moved before.
- Long-form text from `note_tweet.note_tweet_results.result.text` with its own entity ranges; `legacy.full_text`
  otherwise. Ranges are UTF-16 code-unit offsets on the *display* text (`display_text_range`); build `segments`
  (`text`, `mention`, `hashtag`, `url` with `expanded_url`/`display_url`, `media` link stripped) on those, never
  via HTML strings.
- Media from `extended_entities.media`; video variants sorted by bitrate, `video/mp4` preferred.
- Unknown entry types (ads `promotedMetadata`, "who to follow" modules, Grok prompts, "subscribe" upsells) are
  dropped by an allowlist of entry types, not by a blocklist: new junk never shows up.
- A tweet that fails to normalise becomes `kind: 'unknown'` with its id: rendered as a one-line "Open on X"
  card. One unknown counts toward nothing; a whole response failing the guard opens the breaker.
- `store.js`: `Map<id, Tweet>`, `Map<id, User>`, timelines as id arrays. Actions apply optimistic patches
  (`store.patch(id, { me: { liked: true }, counts: {...} })`) and roll back on failure. Views subscribe per id,
  so a like re-renders one action bar, not the list.

## 4. Performance architecture

### 4.1 Shell and styles

- One custom element host `<xbb-fast>` appended to `<body>`, open shadow root (tests reach in). Inside: the
  3-column grid from the mock (nav rail 88/275 px, feed 600 px, sidebar 350 px), collapsing at 1000 px (no right
  rail) and 700 px (bottom bar instead of the rail).
- **Constructable Stylesheets**: `new CSSStyleSheet()` + `replaceSync(XBB.FAST_CSS)` once, plus one small theme
  sheet swapped on theme change, `root.adoptedStyleSheets = [base, theme]`. Firefox content realm: a sheet built
  in the content realm cannot be adopted by a page-owned shadow root, so build it with the page's constructor
  (`window.wrappedJSObject.CSSStyleSheet` when present) and, if `adoptedStyleSheets` still throws, fall back to
  one `<style>` in the shadow root. Same CSS either way.
- Themes as custom properties on `:host([data-theme])`, matching X: Lights Out (black), Dim (slate), Light.
  Default follows X's own `night_mode` cookie so switching looks like nothing changed.
- CSS containment on every row: `.row { contain: layout style paint; }`; media boxes get explicit `aspect-ratio`
  from the API's `w/h`, so nothing reflows when an image loads. No `backdrop-filter` anywhere (same reason as
  `lighterPage`).

### 4.2 Windowed, virtualised feed (`vlist.js`)

- Document scroll (the window), not an inner scroller: keyboard, Space/PgDn, scroll restoration and the
  browser's own find bar keep working. The list is a `position: relative` box whose height is the sum of all
  row heights; visible rows are `position: absolute; transform: translateY(top)`.
- **Height table**: a Fenwick (binary indexed) tree over row heights gives `offsetOf(i)` and `indexAt(y)` in
  O(log n) and point updates in O(log n), so 5,000 rows cost nothing to re-measure. Rows start at an estimate per
  kind (text 120, photo 420, video 420, quote 260, poll 240) and are corrected by a single shared
  `ResizeObserver` on mounted rows (`borderBoxSize`).
- **Window**: viewport ± 1.5 screens mounted (about 15–25 rows); a `scroll` listener (passive, rAF-coalesced)
  recomputes `[first, last]` and only adds/removes the rows at the edges. Unmounted rows go to a **node pool
  per kind** and are refilled by `render.update(node, tweet)`: no `innerHTML`, no new nodes while scrolling.
  Templates are built once with `XBB.h` and `cloneNode(true)`.
- **Scroll-anchor lock**: before applying height changes, note the first visible row index and its offset from
  the viewport top; after, set `scrollTop` so that row stays put. Covers images resolving, "Show more" on a long
  tweet, new tweets inserted on top ("Show 12 posts" pill, never auto-inserted while the user is scrolled down)
  and a row above the viewport changing size. Native `overflow-anchor: none` on the list so the browser's own
  anchoring does not fight ours.
- Going back to Home from a thread restores the same timeline object, height table and anchor; no re-fetch if it
  is less than 90 s old (same freshness rule as Reddit's thread cache).
- `test/lib/perf.mjs` guards apply: an idle Fast UI page makes no DOM changes and runs no timers; scrolling the
  fixture feed stays within the existing budget.

### 4.3 Overlays: Popover API and `<dialog>`

- Menus (retweet/quote when Shift is held, "more", share, theme picker) are `popover="auto"` elements: top
  layer, light-dismiss and Esc for free, no z-index fights, both browsers (Firefox 125+).
- Lightbox and compose are `<dialog>` opened with `showModal()`: focus trap, `inert` background, `::backdrop`,
  Esc closes. Lightbox: one dialog reused for every open, left/right steps through the tweet's media, wheel or
  `+`/`-` zooms, `F` fullscreen. It pushes a history entry (Back closes it), like Reddit's viewer.

### 4.4 Routing

- History API only (`pushState`, `popstate`, `history.state = { xbb: 1, route, anchor }`). Scroll position per
  entry is ours (`history.scrollRestoration = 'manual'` while Fast UI owns the page, restored to `'auto'` when
  handing to X). Works identically in Chrome and Firefox; no Navigation API (Firefox lacks a stable one).
- Route change = swap the view component inside the shell (nav and sidebar stay mounted).

### 4.5 Video and audio

- Our videos are native `<video controls preload="none">` with `poster` from the media thumb, source = the best
  `video/mp4` variant at or under 720p (1080p when the player is wider than 900 px). X's mp4 variants carry
  audio, so most tweets need no HLS at all.
- `application/x-mpegURL`-only media (live broadcasts, some long videos): lazy hls.js, built into the X bundle
  the way Reddit's is (`XBB_LOAD_HLS`, a function wrapper `build.js` adds; no URL import). Only added once M4 shows
  enough tweets need it; until then such a video gets "Play on X".
- Same rules as today: `video.js`'s pick logic (one at a time, pause offscreen, pause on hide/blur, user pause
  sticks) is split out as `XBB.videoPolicy` and fed our videos via `XBB.videoPolicy.add(v)` /
  `.remove(v)` (it cannot find them with `document.querySelectorAll` inside a shadow root). `main-world.js`
  patches apply to our elements too: our `play()` carries `data-xbb-pick`, `canSound()` guards unmutes, our
  volume writes go through the same `setAudio`-style record. `XBB.destroyVideos(row)` before a row node goes
  back to the pool (pause, `removeAttribute('src')`, `load()`).
- GIFs: muted `loop playsinline autoplay` while in view, paused outside, never part of the pick.

## 5. Features per view

- **Tweet row**: avatar, name + badge + handle + relative time, reply context, rich text (mentions, tags,
  expanded URLs), long-form "Show more" inline, media grid (1 / 2 / 3 / 4 layouts, `aspect-ratio` from data,
  `alt` text), video, quote card, poll card (read-only until M4: bars + "Final results"), link card, community
  note box, retweeted-by line, sensitive-media blur with a click to reveal.
- **Action bar** (Better Browsing QoL, same settings as native mode): Reply, Retweet (one click;
  <kbd>Shift</kbd>+click = popover with Quote), Like, Like + Retweet (undo both), Bookmark, Copy embed link
  (`XBB.embedUrl`, vxtwitter by default), counts with optimistic updates.
- **Thread view**: ancestors above the focal tweet (thin connector line), focal tweet large with full date and
  counts, reply box, replies with "Show more replies" cursors, same vlist.
- **Profile**: header (banner, avatar, bio, counts, follow button), tabs Posts / Replies / Media.
- **Bookmarks**, **Search** (Top / Latest / People / Media tabs), **Explore** (trends list only; no "For you"
  modules).
- **Right sidebar**: search box, trends (5), who to follow (3). No Premium, Grok, "Subscribe", "Live on X".
- **Compose** (M3): `<dialog>` with text, counter, reply-to, image paste/drop (`media/upload` INIT/APPEND/FINALIZE
  if the bridge allows; else "Compose on X").

## 6. Settings

New keys in `XBB.DEFAULTS` (same storage key `xbb-userscript-settings`, so nothing is lost):

```js
fastUi: false,                // the whole mode (opt-in)
fastUiRoutes: { home: true, thread: true, profile: true, bookmarks: true, search: true, explore: true },
fastUiTheme: 'auto',          // auto (follows X) | black | dim | light
fastUiKeys: true,             // j/k, l, t, b, r, o, Enter, Esc, g h, /, .
fastUiNativeButton: true      // "Native X" in our top bar
```

`popup.html` gets a "Fast UI (beta)" section with the switch, the route list, theme and a line that the native
X button and Alt+Shift+X are always there. `core.js`'s snapshot already makes `fastUi` known before first paint,
so `flag.js` can set `html[data-xbb-fast]` at document-start and X never flashes.

## 7. File layout

```
x/
  manifest.base.json          main-world list: main-world.js, fast-main.js; content list adds content/fast/*
                              in the order below; new "shadow_css": ["content/fast/fast.css"]
  FAST-UI-PLAN.md             this file
  fast-ui-mock.html           visual target, not shipped
  src/
    main-world.js             (unchanged, plus history pushState/replaceState notify)
    fast-main.js              PAGE WORLD: fetch/XHR tap, header capture, webpack scan (ops + txid
                              generator), history wrap, xbb-fast / xbb-fast-req messaging
    content/
      defaults.js             + fastUi* keys
      core.js  video.js  tweet.js  settings.js   (video.js exposes XBB.videoPolicy; tweet.js exposes
                              embedUrl and the like/retweet helpers the native mode already has)
      fast/
        flag.js               opt-in check, html[data-xbb-fast], route table, circuit breaker, escape keys
        ops.js                op registry: tapped > webpack > feature config > cache
        api.js                request builder, headers, txid bridge, rate limit, pagination
        model.js              schema guards + normalisers → Tweet/User/Media/Timeline
        store.js              entity maps, per-id subscribers, optimistic patch/rollback
        router.js             History API router, link interception, mirror navigation, native hand-off
        shell.js              <xbb-fast> host, adoptedStyleSheets, 3-col layout, nav rail, sidebar, top bar
        vlist.js              virtual list: Fenwick height table, ResizeObserver, node pools, anchor lock
        render.js             row templates, rich text segments, media grid, quote/poll/link/note cards
        media.js              video element setup, variant pick, XBB.videoPolicy hookup, lazy HLS
        actions.js            like/retweet/like+rt/bookmark/copy link, optimistic updates, delegated fallback
        lightbox.js           <dialog> media viewer
        compose.js            <dialog> composer (M3)
        keys.js               keyboard map
        views/
          home.js  thread.js  profile.js  bookmarks.js  search.js  explore.js
        fast.css              shadow-root CSS (build.js inlines it as XBB.FAST_CSS, not as a document <style>)
```

`build.js`: add the `shadow_css` manifest key (read, minify whitespace, emit `XBB.FAST_CSS = "…"` before the
content scripts). Nothing else changes in the bundle layout. Size budget for the whole Fast UI: ≤ 90 KB unminified
source, so the X script stays well under Reddit's.

## 8. Milestones

Each milestone is a version bump of the X part (`x/manifest.base.json`), a passing `npm run test:all`, and a check
by hand on real x.com in Chrome and Firefox (Violentmonkey + Tampermonkey) with `fastUi` on and off.

### M1: API and model (no UI) — about 2 days

- `fast-main.js` tap + webpack scan + history wrap; `ops.js`, `api.js`, `model.js`, `store.js`, `flag.js`
  (breaker logic, no hiding yet).
- Debug surface: `XBB.fast.debug()` in the console prints the harvested ops (with source), the bridge state and
  the last normalised Home page.
- Tests (`test/x-offline.mjs`, new fixtures `test/fixtures/x-graphql/*.json` recorded by hand and scrubbed):
  normaliser on HomeTimeline / TweetDetail / UserTweets / SearchTimeline fixtures, including tombstones,
  `TweetWithVisibilityResults`, old and new author shapes, a note tweet, a poll, a quote, ads dropped; op
  harvesting from a fake `webpackChunk_twitter_responsive_web`; tap does not alter X's own responses; breaker
  opens after three failures.
- Done when: with `fastUi` on, real x.com loads exactly as before and `XBB.fast.debug()` shows Home normalised
  from the tapped response, with zero extra requests in the network panel.

### M2: Shell + Home feed — about 3 days

- `shell.js`, `fast.css`, themes, `vlist.js`, `render.js` (text, photos, quote, retweeted-by, long-form expand),
  `router.js` for Home only, `views/home.js` (For you / Following tabs from `HomeTimeline` /
  `HomeLatestTimeline`), "Native X" button, Alt+Shift+X, settings section.
- Video rows with mp4 variants through `XBB.videoPolicy`.
- Tests: Home renders from fixtures in both browsers, scroll 500 rows keeps ≤ 30 mounted nodes, anchor holds when
  a row above grows, the escape hatch shows X's root, breaker hands Home to X on a bad fixture, perf guards.
- Done when: daily use of Home on real x.com feels faster than X's own (measure: time to first tweet, long tasks
  over 50 ms while scrolling, both from the Performance panel; numbers go in this file).

### M3: Thread, Profile, Bookmarks, Search, Explore + actions and compose — about 4 days

- `views/thread.js` (mirror navigation, ancestors/focal/replies, reply cursors), `profile.js`, `bookmarks.js`,
  `search.js`, `explore.js`; right-sidebar trends and who to follow.
- `actions.js` with the txid bridge and the delegated fallback; poll and community note cards; `compose.js`
  (text + reply; media upload only if the bridge works).
- Tests: each view from fixtures, Back/Forward across views restores scroll, optimistic like rolls back on a 403,
  link interception leaves X-owned routes to X.

### M4: Lightbox, keyboard, perf and polish — about 3 days

- `lightbox.js` (`<dialog>`, history entry, zoom, steps), `keys.js` (j/k move a focus ring, l like, t retweet,
  b bookmark, r reply, o / Enter open, Esc back, `g h` home, `/` search, `.` load new posts), sensitive-media
  blur, polls voting (if the bridge works), notifications list (read-only) if the API proves stable.
- Lazy hls.js if M2/M3 data shows enough HLS-only media.
- Perf pass with `localStorage['xbb-fast-perf'] = '1'` + `XBB.fast.perf()` (per-view render ms, rows mounted,
  pool hits, long tasks), the way Pinterest's `PIN.perf()` works. Targets: Home first tweet ≤ 300 ms after X's
  `HomeTimeline` response, no long task > 50 ms while scrolling, ≤ 2 MB extra heap per 1,000 tweets.
- README: "Fast UI (beta)" section in `x/README.md` and the main README feature list.

## 9. Risks

| Risk | Mitigation |
|---|---|
| X renames an op or a field | Harvesting (§3.2), accessor fallbacks (§3.4), breaker → X's own page; fix is data, not code |
| Transaction id generator not found | Queries still work; actions delegate to X (§3.3); never forge it |
| X detects automated-looking traffic | We only add pagination and actions the user triggers, at X's own rate; same headers, cookies and txid as X |
| Firefox content realm (Xray) | `fast-main.js` runs through `runMain`; messages are strings; stylesheet built with the page constructor |
| Two UIs out of sync after an action in ours | Mirror navigation keeps X on the same route; after an action we post nothing to X's cache, so switching to native reloads that route's data (`popstate` to the same URL) |
| Tests touching x.com | Never. Fixtures only (`CLAUDE.md` rule) |

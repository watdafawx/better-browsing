# Pinterest Fast UI: plan

An opt-in mode of **Better Browsing for Pinterest** that replaces Pinterest's own grid, search, board and profile
pages with a light UI of our own, and leaves everything else to Pinterest. Plain JavaScript, no framework, no
runtime dependency, same shape as X Fast UI (`x/FAST-UI-PLAN.md`, `x/src/content/fast/`). Visual target:
`pinterest/fast-ui-mock.html` (open it in a browser; no server needed).

Status: design. Nothing here is built. Off by default (`fastUi: false`); every milestone ships behind it. The
existing viewer (`content/lightbox.js`) stays the default experience and keeps working with Fast UI off.

Two hosts, one code path:

| Host | Pinterest's app | First paint from | Escape hatch |
|---|---|---|---|
| MV3 extension (`EXT-PLAN.md`) with Zero-JS on | **never loads**: DNR blocks `s.pinimg.com/webapp/*.js` | the SSR JSON in the HTML, else one call at `document_start` | unblock the tab + reload |
| Userscript, or extension with Zero-JS off | boots hidden underneath (`display:none`, no layout, no paint) | Pinterest's own first `/resource/` response (tap) | CSS flip, one frame |

Pinterest is easier than X here: the resource API is addressed by **name** (`/resource/<Name>/<action>/`), not by
rotating query ids, and it needs no transaction id. Cookies + `csrftoken` + two headers are the whole session
(README, "Pin data"). So Zero-JS needs no runtime harvested from Pinterest's bundle, only learned option templates.

## 1. Goals and non-goals

Goals:

- **No layout shift, ever**: every card's box is known from the API before it is painted.
- **Constant DOM**: ≤ 50 mounted cards with 5,000+ pins loaded; 60 fps scroll (120/144 where the screen allows)
  in Chrome and Firefox, including Firefox's content realm under Violentmonkey.
- **Overlay-first**: a pin opens in our `<dialog>`; Esc/Back returns to the exact scroll pixel; the feed never
  re-renders.
- **No ads, no upsell**: promoted pins dropped at the data level; no shopping modules, "shop the look", app
  banners, "create" nags.
- **Never traps the user**: Native Pinterest button, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, `?pin=native`,
  and a circuit breaker that hands the route back on its own.

Non-goals (always Pinterest's): pin creation / Pin Builder, analytics, business hub, ads manager, messages,
notifications, settings, login/signup, shopping/catalogs, board editing beyond "create board", collaborators,
sections management.

## 2. Execution model

### 2.1 Page ownership (`fast/flag.js`)

```
<html data-pin-fast="home">     set at document_start from the settings snapshot, before first paint
  <body>
    …Pinterest's SSR markup / app root…   hidden: html[data-pin-fast]:not([data-pin-fast="native"]) body > :not(pin-fast)
    <pin-fast>  #shadow-root (open)       our UI, the only thing painted on owned routes
```

- `data-pin-fast` = route key while we own it, `"native"` after an escape, absent when not ours. The hide rule is
  generic (`body > :not(pin-fast)`), so it does not depend on Pinterest's root id.
- **Route table** (on `location.pathname`; first segment checked against `RESERVED`):

  | Route | Pattern | Data |
  |---|---|---|
  | `home` | `/`, `/homefeed/` | `UserHomefeedResource/get` |
  | `search` | `/search/pins/?q=` (`/search/videos/`, `/search/boards/` stay Pinterest's in M2) | `BaseSearchResource/get` |
  | `profile` | `/<user>/`, `/<user>/_created/`, `/<user>/_saved/` | `UserResource/get` + `UserPinsResource/get` + `BoardsResource/get` |
  | `board` | `/<user>/<board>/` (not `_created`/`_saved`/`_boards`) | `BoardResource/get` + `BoardFeedResource/get` |
  | overlay | `/pin/<id>/` **only as an overlay entry over one of the above** | `PinResource/get` |
  | everything else | `/pin/<id>/` loaded directly (M1–M2), `/pin-builder/`, `/settings/`, `/business/`, `/ideas/`, `/today/`, `/notifications/`, `/messages/`, `/_/…`, login/signup, … | **Pinterest** |

  `RESERVED` (first segments that are never a username): `pin`, `search`, `ideas`, `today`, `settings`,
  `business`, `pin-builder`, `pin-creation-tool`, `notifications`, `messages`, `explore`, `login`, `logout`,
  `signup`, `password`, `about`, `_`, `oauth`, `shopping`, `homefeed`, `news_hub`. Add to it before Pinterest
  ships a new top-level page, or Fast UI takes it for a profile.
- **Navigation**: one capture `click` on our shadow root. Owned routes: `history.pushState` + render
  (`PIN.fast.go(url)`); in userscript mode we also mirror to Pinterest's router (`pushState` + `popstate`) so its
  own request is tapped. Anything else: `PIN.fast.toNative(url)` (§2.4).
- **Overlay history** (`PIN.fast.ov`, same design as X's `XBB.fast.ov`): each open pin is one entry
  `{ pin: 1, overlay: 'pin', base: '<route>', ov: '<JSON string: {stack:[ids], i, y}>' }` (a string, for Firefox
  Xray). A window capture `popstate` listener `stopImmediatePropagation`s every popstate into or out of an overlay
  entry while we own the page, so Pinterest's router never renders the close-up underneath. `ov.back` is one
  `history.go(-1)` at a time.

### 2.2 Zero-JS mode (extension only, M3)

DNR rule table entry in the shared worker (`EXT-PLAN.md` §2, Pinterest range 2000–2099), **session rules scoped to
`tabIds`** (Chrome only allows `tabIds` in session rules; Firefox 128+):

| id | condition | why |
|---|---|---|
| 2001 | `urlFilter: '\|\|s.pinimg.com/webapp/'`, `resourceTypes: ['script']`, `initiatorDomains: ['pinterest.com']` | the app bundles (React, Redux, router, player) |
| 2002 | same, `resourceTypes: ['stylesheet']` | its CSS: nothing of it is painted |
| 2003+ | telemetry/logging endpoints | **captured, not guessed**: M3 records a real logged-in page; no rule is committed for a URL nobody saw |

Never blocked: `i.pinimg.com` (images), `v1.pinimg.com` (video), `/resource/*` (our data), the document itself.

Who turns rules on, per navigation:

1. The worker keeps `pinFastTabs: { [tabId]: true }` in `storage.session` and a copy of the route table (plain
   regexes, generated from `flag.js`'s table by the build so they never disagree).
2. `webNavigation.onBeforeNavigate` (frameId 0, `*.pinterest.com`) → owned route **and** `pin-ops-v1.ready` **and**
   no `pin-fast-broken` for that tab → add the tab's session rules; otherwise remove them. The update finishes
   long before the HTML arrives and references its bundles. (Adds the `webNavigation` permission to `EXT-PLAN.md`.)
3. Safety net: if a page with rules on is not owned at `DOMContentLoaded` (route not ours, settings off), the
   content script asks `bb-ext-set {site:'pinterest', block:false}` and reloads once
   (`sessionStorage['pin-fast-reloaded']` stops a loop).

**Learn before blocking** (same idea as X's `hasCachedHome`): blocking starts only after a normal (unblocked) load
has (a) tapped or made one successful `UserHomefeedResource/get`, (b) recorded the option templates and headers
(§3.2) in `localStorage['pin-ops-v1']`, and (c) read the signed-in user. Until then the extension behaves like the
userscript.

**First paint without the app**: Pinterest server-renders the page and ships its initial state as JSON in a
`<script type="application/json">` (`__PWS_INITIAL_PROPS__` / `__PWS_DATA__`; exact id and path to the feed
**to be confirmed in the M1 recon**). The content script reads it from the DOM (no page world needed) as soon as
the element is parsed: 0 extra requests. If it is missing or unreadable, `api.js` calls the route's resource at
`document_start` (in parallel with the HTML) with the cached template: 1 request.

### 2.3 Userscript mode (and extension with Zero-JS off)

Pinterest's app boots hidden. `pinterest/src/main-world-api.js` (page world, after `main-world.js`) wraps
`fetch` and `XMLHttpRequest` once (`indexOf('/resource/')` when idle, everything in try/catch, Pinterest's own
promise returned unchanged) and, while `<html data-pin-api-tap>` is set:

- records per resource the `options` Pinterest sent and the headers (`x-pinterest-pws-handler`,
  `x-pinterest-source-url`, `X-APP-VERSION`, `X-Pinterest-AppState`), into `pin-ops-v1`;
- clones responses of the route resources and hands them over as `CustomEvent('pin-api-tap', {detail: JSON
  string})` on `document`. Our own calls use the original `fetch`, so they are never tapped.

First page of a route = a fresh tapped response for the same options, else wait 700 ms for Pinterest's own call,
else call ourselves (X's `feed.js` rule).

### 2.4 Escape hatches and circuit breaker

- **Native Pinterest**: top-bar button, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, `?pin=native` on any URL
  (`?pinbb=native` from `EXT-PLAN.md` is accepted as an alias). Userscript: set `data-pin-fast="native"` (Pinterest
  is already on the same URL thanks to mirroring). Zero-JS: `PIN.ext.setBlock(false)` → wait for the worker's ack
  → `location.reload()`; `sessionStorage['pin-fast-native']` keeps the tab native until a "Fast UI" entry
  (cloned into Pinterest's left nav like today's settings entry) flips it back.
- **Breaker** (`PIN.api.breaker`, per resource): HTTP 400/403/404, `resource_response.status === 'failure'`, an
  "Invalid Request" message, or a 200 whose `data` fails the schema guard (not an array of objects with `id`)
  opens it; five transient failures in a row open it too; 401/429 do not (401 = session expired: show a "Sign in
  on Pinterest" banner that goes native).
- A route whose **primary** resource is open fails hard (`PIN.fast.fail(route)`, sessionStorage
  `pin-fast-broken`), toast "Pinterest changed something; showing its own page", and hands the route back
  (Zero-JS: unblock + reload). Three soft failures (render error, empty page twice) within 5 min do the same.
- Secondary resources never fail a route: comments, related pins, boards list, save → an inline note with
  "Open on Pinterest". Two routes broken → the whole mode is off for the session.

## 3. API layer (`fast/api.js`, extends `PIN.resource`)

### 3.1 `PIN.resource` grows three options

```js
PIN.resource(name, options, { source, handler, method = 'GET', signal, raw = false })
```

- `method: 'POST'`: body `source_url=…&data={"options":…,"context":{}}` form-encoded, header `X-CSRFToken` =
  `csrftoken` cookie (to confirm on a real Save in the M2 recon).
- `raw: true` returns the whole `resource_response` (`data`, `bookmark`, `status`, `code`, `message`), needed for
  paging and the breaker.
- Headers learned in `pin-ops-v1` (`X-APP-VERSION`) are added when present. In a Firefox content realm the
  request goes through `content.fetch` like today.
- At most 2 requests in flight (queue), pagination only from the grid's "near the end" signal, never a timer,
  failures never cached. Results feed `PIN.pinData`'s cache so the lightbox reuses grid data.

### 3.2 Resource registry

Option shapes are **templates**: the tapped/learned one wins (`pin-ops-v1[name].options`, we only override
`bookmarks`, ids and query); the defaults below are the fallback and are marked *to confirm* in the recon. Paging:
`options.bookmarks = [bookmark]` from the previous `resource_response.bookmark`; `'-end-'` means no more.

| Op | Resource | Options (fallback template) | `source` / handler |
|---|---|---|---|
| Home | `UserHomefeedResource/get` | `{ field_set_key: 'hf_grid', in_nux: false, static_feed: false, bookmarks }` | `/` · `www/index.js` |
| Search | `BaseSearchResource/get` | `{ query, scope: 'pins', rs: 'typed', page_size: 25, redux_normalize_feed: true, bookmarks }` | `/search/pins/?q=…` · `www/search/[scope].js` |
| Board | `BoardResource/get` | `{ username, slug, field_set_key: 'detailed' }` | `/<u>/<b>/` · `www/[username]/[slug].js` |
| Board pins | `BoardFeedResource/get` | `{ board_id, board_url, page_size: 25, field_set_key: 'react_grid_pin', bookmarks }` | same |
| Profile | `UserResource/get` | `{ username, field_set_key: 'profile' }` | `/<u>/` · `www/[username].js` |
| Created pins | `UserPinsResource/get` | `{ username, page_size: 25, field_set_key: 'grid_item', bookmarks }` | `/<u>/_created/` |
| Boards | `BoardsResource/get` | `{ username, page_size: 50, privacy_filter: 'all', sort: 'last_pinned_to', field_set_key: 'profile_grid_item', bookmarks }` | `/<u>/_saved/` |
| Related | `RelatedModulesResource/get` | `{ pin_id, context_pin_ids: [], search_query: '', source: 'deep_linking', top_level_source: 'deep_linking', bookmarks }` | `/pin/<id>/` · `www/pin/[id].js` |
| Pin | `PinResource/get` | `{ id, field_set_key: 'auth_web_main_pin', noCache: true }` (**verified**, `PIN.getPin`) | `/pin/<id>/` · `www/pin/[id].js` |
| Comments | `UnifiedCommentsResource/get` | `{ aggregated_pin_id, page_size: 10, … }` (**verified**, `PIN.comments`) | same |
| Save | `RepinResource/create` (POST) | `{ pin_id, board_id, section_id: null, description: '', is_buyable_pin: false, carousel_slot_index: 0 }` | `/pin/<id>/` |
| New board | `BoardResource/create` (POST) | `{ name, description: '', privacy: 'public' \| 'secret', collab_board_email: false }` | `/` |

The signed-in user (needed for "my boards" in the picker) comes from the SSR JSON / tap
(`context.user.username`, to confirm), cached in `pin-ops-v1.me`.

### 3.3 Model (`fast/model.js`): pure, defensive, never throws

```js
Pin   = { id, kind: 'image' | 'video' | 'story', title, desc, link, domain, color,   // dominant_color → placeholder
          w, h,                                   // of the rendition the grid uses: exact layout input
          img: { s236, s474, s736, s1200, orig }, // URLs, any may be ''
          video: { src, w, h, dur } | null,       // V_720P mp4 (AAC audio), else any V_* .mp4; never HLS
          pages: [{ video, image, candidates, full }] | null,   // idea pin: story_pin_data.pages
          author: { id, username, name, avatar }, board: { id, name, url } | null,
          counts: { saves, comments, reactions }, aggId }
Board = { id, name, url, cover, pins, privacy, owner }
User  = { id, username, name, avatar, bio, followers, following, monthlyViews }
```

- `w/h`: `images['236x']` (or `474x`) `width`/`height`; video pins `video_list.V_720P.width/height` when the image
  is missing; idea pins the first page's image; nothing usable → the pin is dropped (it cannot be laid out
  exactly, and a shifting card is worse than a missing one).
- Video by `videos.video_list` (never `is_video`). `dur` = `V_720P.duration` (ms) → the badge.
- Media selection (`sizes()`, the `originals` 403 fallback chain, `toItem()`) moves out of `content/lightbox.js`
  into a new **`content/pinmedia.js`** (`PIN.media`), shared by today's viewer and Fast UI. No copy.
- **Feed allowlist, not blocklist**: keep only objects with `type === 'pin'` (or no `type` and an `images` map).
  Modules, story carousels, shopping units, "more ideas" banners, search guides are dropped.
- **Promoted pins at the data level**: `PIN.isPromotedData(p)` = `p.is_promoted === true` ‖
  `p.promoted_is_removable != null` ‖ `p.ad_match_reason != null` ‖ `p.promoter` ‖ `p.sponsorship` ‖ the label
  fallback (`AD_LABEL` from `core.js`) on `p.grid_title_label` / `p.attribution?.title`. Dropped before layout,
  so they never take a slot. Refine with a captured ad (README open question) and add it to the fixtures.
- Every new field read goes through safe getters; every resource gets a malformed-payload case in the test.

## 4. Virtualized masonry engine

Two files: `fast/masonry.js` (pure layout + index, no DOM, unit-testable in Node) and `fast/grid.js` (the DOM side:
window, pool, scroll).

### 4.1 Layout: exact, before paint (`masonry.js`)

```js
const m = PIN.masonry({ gap: 16, minCol: 180, maxCols: 6, minCols: 2, footer: pin => pin.title ? 44 : 0 });
m.setWidth(contentWidth);          // → { cols, colW }  cols = clamp(floor((W + gap) / (minCol + gap)), 2, 6)
m.append(pins);                    // O(cols) each: shortest column, ties → leftmost
m.rect(i)                          // → { col, x, y, w, h }   integers, from Float64Array/Int32Array storage
m.visible(top, bottom)             // → indices intersecting [top, bottom]
m.height()                         // tallest column bottom = the grid's height
m.shortest()                       // shortest column bottom = the paging trigger
m.anchor(scrollTop) / m.yOf(i)     // resize anchoring
```

- Card height = `round(colW * h / w) + footer(pin)`. The footer is a fixed-height block (one clamped title line +
  one meta line, `44px`, or `0`), set by the same numbers the CSS uses (`--pf-footer`), so the computed box *is*
  the painted box. Images are `object-fit: cover` in a box of that exact size; `dominant_color` fills it until
  the image decodes. No `ResizeObserver`, no measuring, no reflow: nothing on the card can change its size.
- Storage: struct-of-arrays (`x`, `y`, `w`, `h`, `col` as typed arrays grown ×2), plus per column a sorted
  `Int32Array` of item indices and their `top`/`bottom` (monotonic: a column only grows downward).
- **Window query** `visible(top, bottom)`: per column, binary search the first item with `bottom ≥ top`, walk until
  `top > bottom`: O(cols · log n + k). 5,000 pins: ~13 comparisons per column.
- Append is incremental (paging never re-lays-out what exists). Filtering (type chips) or a column-count change
  re-runs the whole layout: O(n), ~1 ms for 5,000 pins.

### 4.2 Rendering (`grid.js`)

- Document scroll (keyboard, PgDn, find bar, scroll restoration keep working). The grid is `position: relative;
  height: m.height()px; contain: layout size; overflow-anchor: none`.
- Each card: `position: absolute; transform: translate3d(x, y, 0); width; height; contain: layout style paint`.
  No `content-visibility`: off-screen cards are never mounted in the first place.
- **Window** = viewport ± 0.5 screen (overscan), recomputed on a passive `scroll` listener coalesced in rAF. An
  early-exit fast path compares the visible index range to the last one and returns without touching the DOM.
  Overscan shrinks so that **≤ 50 cards** are mounted (6 columns × ~4 rows on a 1440p screen ≈ 30).
- **Node pool**: unmounted cards go back to one pool and are refilled by `render.update(node, pin)`: text nodes and
  attributes only, no `innerHTML`, no new nodes while scrolling. Templates are built once with `PIN.h` and
  `cloneNode(true)`.
- Images: `<img decoding="async" srcset="236x 236w, 474x 474w, 736x 736w" sizes="<colW>px">`; during a fast fling
  (> 3 screens/s) `src` is assigned only when the card is still visible at the next idle frame. Before a node is
  pooled its `img.src` is cleared so the request is cancelled.
- **Resize** (rAF-debounced): note the top-visible pin (first index whose `y + h > scrollY` in the leftmost
  column with content) and its offset from the viewport top; `setWidth` + full layout; `scrollTo(0, yOf(pin) -
  offset)`. Same pin stays under the user's eye across 1280 → 728 px and back.
- Paging: when `scrollY + 2 × innerHeight > m.shortest()`, fetch the next page (one in flight).
- Chrome and Firefox behave the same: no `ResizeObserver`, no `IntersectionObserver` for layout, no scroll-linked
  CSS features, no anchor positioning.

### 4.3 Video in the grid

A video pin shows its poster image + a duration badge. It plays muted on hover only when `fastUiHoverPlay` is on
(default off), through `PIN.videoPolicy.add(v)` (our videos are in a shadow root, where media events never reach
`video.js`'s document listeners: same lesson as X). `PIN.destroyVideos(node)` before a card is pooled.

## 5. Overlay-first UX

### 5.1 Lightbox (`fast/lightbox.js`)

One native `<dialog>` (`showModal`) in the shadow root, reused for every pin:

```
┌───────────────────────────────────────────┬──────────────────────┐
│  ‹   STAGE (image / video / idea pages)  › │  Save ▾  [board]  ⋯  │
│      click = zoom (orig), drag = pan       │  title, link domain   │
│      idea pin: page bars 1/4, ↑ ↓          │  author · Follow      │
│                                            │  description          │
│                                            │  ♥ saves · comments   │
│                                            │  comment list (10)    │
├───────────────────────────────────────────┴──────────────────────┤
│  More like this: Related Pins (same masonry engine, 2–4 cols)     │
└───────────────────────────────────────────────────────────────────┘
```

- Paints at once from the grid's `Pin` (the `474x` thumb, already decoded, scaled up), then the `1200x`
  rendition, then `orig`/`originals` only on zoom (the existing fallback chain). Full `PinResource/get` fills the
  side panel; the next pin's data and `1200x` image are prefetched.
- Steps: ← → / wheel / buttons through the route's own ordered id list (the grid model, not the DOM); an idea pin
  steps its pages first (↑ ↓ or ← → at the page ends), like today's viewer.
- Video: `V_720P` in our own `<video>` (AAC audio, no hls.js), `PIN.setupOwnVideo`, the user's volume/mute/autoplay
  settings, `PIN.videoPolicy.scope(dialog)` so only the dialog's video may play.
- Related Pins: `RelatedModulesResource/get` when the dialog opens (not on prefetch), allowlist + promoted filter
  as in §3.3, laid out by a second `PIN.masonry` sized to the dialog. Clicking one pushes onto the overlay stack
  (`ov.stack`); Back pops one level; Esc closes all.
- Comments: `PIN.comments(pin)` (first page) and "More on Pinterest".
- Closing: `ov.back` / `closeAll`; the feed was never unmounted, so `scrollY` is restored to the exact pixel
  recorded in `ov.y` (and the grid's window is already correct for it).

### 5.2 Save to board (`fast/save.js`)

- Hover a card: a **Save** pill (top-right) and a board chip (top-left: last-used board, ▾ opens the picker).
  One click on Save → `RepinResource/create` to the last-used board (`localStorage['pin-fast-last-board']`);
  optimistic "Saved to <board>" state, rolled back with a toast on failure.
- Picker: `popover="auto"` (top layer, light dismiss, Esc; positioned by JS from the anchor rect, no CSS anchor
  positioning, so Firefox matches), search field, recent boards first, then all (`BoardsResource/get` for `me`,
  cached 5 min), **Create board** inline (name + secret toggle → `BoardResource/create` → save to it).
- Same picker inside the lightbox (the popover is created inside the dialog so it stacks above it).
- Save failures never trip the route breaker; an open `RepinResource` breaker turns Save into "Save on Pinterest".

### 5.3 Shell (`fast/shell.js`, `fast/fast.css`)

- `<pin-fast>` with an open shadow root; CSS from the manifest's `shadow_css` (build.js already inlines it for X as
  `XBB.FAST_CSS`; Pinterest gets `PIN.FAST_CSS`), adopted via Constructable Stylesheets with the page-constructor
  and `<style>` fallbacks X uses.
- Left icon rail (Home, Explore → Pinterest, Boards, Profile, Settings), sticky top bar: pill search, type chips
  (All / Images / Videos / Idea Pins: a client-side filter that re-runs the layout), board chips on board and
  profile views, theme switch (Lights Out / Dim / Light; `auto` follows `prefers-color-scheme`), **Native
  Pinterest** button. Under 760 px the rail narrows to 56 px and the chips scroll horizontally.
- Text from Pinterest goes in as text nodes only; icons are our own constant SVG markup.

## 6. Settings (`content/defaults.js`, same key `pin-userscript-settings`)

```js
fastUi: false,                 // the whole mode (opt-in)
fastUiRoutes: { home: true, search: true, board: true, profile: true },
fastUiTheme: 'auto',           // auto | black | dim | light
fastUiKeys: true,
fastUiZeroJs: true,            // extension only: block Pinterest's bundles once learned
fastUiCardText: true,          // title + author under each card (changes the footer height: a full re-layout)
fastUiHoverPlay: false,
```

`popup.html` gets a "Fast UI (beta)" section. `core.js`'s snapshot makes `fastUi` known synchronously, so
`flag.js` sets `data-pin-fast` at document_start and Pinterest never flashes.

## 7. File layout

```
pinterest/
  FAST-UI-PLAN.md            this file
  fast-ui-mock.html          visual target, not shipped
  manifest.base.json         MAIN: main-world.js, main-world-api.js
                             content: defaults, core, pinmedia, video, hide, lightbox, settings,
                                      fast/flag, fast/api, fast/model, fast/store, fast/masonry, fast/grid,
                                      fast/render, fast/shell, fast/save, fast/lightbox, fast/keys,
                                      fast/views/home, fast/views/search, fast/views/board, fast/views/profile,
                                      fast/router
                             "shadow_css": ["content/fast/fast.css"]
  src/
    main-world-api.js        PAGE WORLD: fetch/XHR tap on /resource/, option + header learning, pin-api-* events
    content/
      pinmedia.js            PIN.media: renditions, originals fallback chain, toItem (shared with lightbox.js)
      fast/
        flag.js              route table, RESERVED, data-pin-fast, overlay history (ov), breaker, escape hatches
        api.js               resource registry, templates (pin-ops-v1), paging, POST + csrf, queue, tap consumer,
                             SSR JSON reader, PIN.ext bridge use
        model.js             normalisers, feed allowlist, isPromotedData, schema guards
        store.js             Map<id, Pin|Board|User>, route lists as id arrays, optimistic patch/rollback
        masonry.js           pure layout + column index (§4.1)
        grid.js              window, pool, scroll fast path, resize anchor, paging trigger (§4.2)
        render.js            card template + update(node, pin), badges, hover actions
        shell.js  fast.css   <pin-fast> host, rail, top bar, chips, themes
        save.js              Save pill, board picker popover, create board
        lightbox.js          <dialog> viewer, related pins, comments
        keys.js              keyboard map (M3)
        router.js            go/back, mirror navigation, views kept alive (home paused, scroll kept)
        views/home.js  search.js  board.js  profile.js
ext/background.js            (EXT-PLAN) DNR table entry `pinterest` (ids 2000–2099), webNavigation route check
test/pinterest-fast-offline.mjs   npm run test:pinterest:fast (in test:all, Chromium + Firefox)
test/pinterest-masonry.mjs        node only: layout + index unit tests
```

Size budget: ≤ 70 KB unminified source for all of `fast/`.

## 8. Milestones

Each one: a Pinterest part version bump (`pinterest/manifest.base.json`), green `npm run test:all`, a check by
hand on real pinterest.com in Chrome and Firefox (Violentmonkey) with `fastUi` on and off, then
`npm run release:userscript`. Tests never touch live Pinterest: fixtures only (CLAUDE.md).

### M0: recon (one logged-in session, by hand, ~1 h)

Write the answers into `pinterest/README.md`: the SSR JSON element id and the path to the home feed in it; the
real `options` of `UserHomefeedResource`, `BaseSearchResource`, `BoardFeedResource`, `UserPinsResource`,
`BoardsResource`, `RelatedModulesResource`; the `x-pinterest-pws-handler` per route; whether `X-APP-VERSION` is
sent and needed; one Save and one Create board request (method, body, `X-CSRFToken`); a promoted pin's fields;
where `context.user` lives.

### M1: API + virtualized masonry Home + lightbox (~3 days)

- `pinmedia.js` extraction (today's viewer unchanged in behaviour), `main-world-api.js` tap, `api.js`,
  `model.js`, `store.js`, `flag.js` (route `home` only, breaker, Native button, Alt+Shift+P, `?pin=native`),
  `masonry.js`, `grid.js`, `render.js`, `shell.js`, `fast.css`, `fast/lightbox.js` (stage, zoom, steps, idea pages,
  video, comments, related), `views/home.js`, `router.js` (home + overlay entries).
- Tests: `pinterest-masonry.mjs` (shortest-column placement matches a brute-force reference; `visible()` equals a
  linear scan for random windows; resize keeps the anchor pin within 1 px); `pinterest-fast-offline.mjs`: Home
  mounts from a tapped fixture with 0 extra requests, promoted + module entries dropped, 5,000 fixture pins →
  ≤ 50 mounted cards at any scroll position, no card moves after its image loads (rects before/after equal),
  paging with bookmarks until `-end-`, lightbox open/step/close restores `scrollY` exactly, Back closes it,
  Pinterest never sees overlay popstates, breaker on an "Invalid Request" fixture hands Home back, perf guards
  (`test/lib/perf.mjs`: idle page does nothing, scrolling stays in budget).
- Done when: daily use of Home on real pinterest.com feels faster than Pinterest's own; record time to first
  card and long tasks while scrolling (Performance panel) in this file.

### M2: Search + Boards/Profiles + Save to board (~3 days)

- `views/search.js` (pins scope, query in the top bar, type chips), `views/board.js` (header: name, owner,
  pin count; board feed), `views/profile.js` (header, Created / Saved tabs, boards grid of covers), `save.js`
  (pill, picker, create board, optimistic + rollback), `RESERVED` list, secondary-resource banners.
- Tests: each view from fixtures; route links inside our UI never reload; reserved paths stay Pinterest's; save
  success/rollback on a 403 fixture; create board then save; a missing op is a banner, never `fast.fail` of Home.

### M3: Zero-JS DNR + keyboard + perf polish (~3 days)

- Network capture of a real page → the telemetry rule list (2003+). Worker table entry, session rules with
  `tabIds`, `webNavigation` routing, learn-before-block, the reload safety net, unblock on every escape hatch.
  SSR JSON first paint (and the `document_start` call fallback).
- `keys.js`: `j`/`k` (down/up in the focused column, via the column index), `h`/`l` (neighbouring column, nearest
  `y`), `Enter`/`o` open, `s` save to last board, `S` picker, `Esc` back, `/` search, `g h` home, `.` refresh,
  `Alt+Shift+P` native; never while typing or with the settings panel open; swallows Pinterest's single-key
  shortcuts while owned (X's keys.js rule).
- Perf pass with `localStorage['pin-perf'] = '1'` + `PIN.perf()` (now also: mounted cards, pool hits, layout ms,
  long tasks). Targets: first card ≤ 150 ms after the SSR JSON is parsed (Zero-JS) / after Pinterest's first
  response (userscript); no long task > 50 ms while scrolling 5,000 pins; ≤ 2 MB heap per 1,000 pins.
- Tests: `test/ext-smoke.mjs` (EXT-PLAN P2) gains Pinterest: rules present only on owned routes for that tab, gone
  after Native, never present before `pin-ops-v1.ready`; `pinterest-fast-offline.mjs` gains the SSR-JSON boot
  with the app scripts unreachable.
- README: "Fast UI (beta)" in `pinterest/README.md` and the main README; CLAUDE.md section like X's.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Resource options change | Templates learned from Pinterest's own requests win over our defaults; breaker per resource; banners for secondary ones |
| SSR JSON shape changes | It only feeds the first paint: unreadable → one call at `document_start`; the route is not failed for it |
| Zero-JS blocks a page we do not own | Per-navigation routing in the worker + `DOMContentLoaded` safety net with a one-shot reload |
| A pin without dimensions | Dropped before layout; counted in `PIN.perf()` so a format change shows up |
| Promoted pins slip through | Data-level checks + label fallback; captured ad in fixtures once seen |
| Firefox content realm (Xray) | Strings across the bridge, page-constructor stylesheets, `content.fetch` for requests |
| Writes look automated | Only user-initiated saves/boards, at human rate, with Pinterest's own headers and cookies |
| Tests touching pinterest.com | Never; fixtures only |

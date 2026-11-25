# CLAUDE.md

Four userscripts, one per site (`dist/better-browsing-<reddit|instagram|x|pinterest>.user.js`, auto-updating), plus the old combined `dist/better-browsing.user.js` for the transition, and one unified MV3 extension (`dist/better-browsing-ext/`, Chrome + Firefox 128+), all built from one source tree in four parts, plain JavaScript with no framework, no bundler and no runtime dependencies: Reddit in `src/`, Instagram in `instagram/src/`, X in `x/src/`, Pinterest in `pinterest/src/`, plus code all four share in `userscript/` and the extension glue in `ext/`. README.md has the user-facing feature list and the file layout.

## Commands

- `npm run build`: writes every bundle and its `.meta.js` to `dist/` and prints each version and size.
- `npm test`, `npm run test:instagram`, `npm run test:x`, `npm run test:pinterest`: build, then the offline Playwright test of that site (`test/offline.mjs`, `test/instagram-offline.mjs`, `test/x-offline.mjs`, `test/pinterest-offline.mjs`) against that site's own bundle (`US_FILE=dist/….user.js` picks another, e.g. the combined one). Needs `npm install` and `npx playwright install chromium firefox` once. `BROWSER=firefox` runs a test in Firefox (Reddit and Instagram: only their second part; the first always runs in Chromium).
- `npm run test:x:api` (`test/x-api-offline.mjs`): the X Fast UI engine (harvester, fetch/XHR tap, bridge, circuit breaker, model) against a fake webpack runtime, a fake GraphQL backend and payload fixtures; `BROWSER=firefox` for Firefox. Part of `test:all`.
- `npm run test:x:fast` (`test/x-fast-home-offline.mjs`): the X Fast UI shell and Home view (M2) on a mock x.com whose fake X app fetches its own HomeTimeline: mount/hide, 0 extra boot requests, tabs, pagination, card shapes, scroll anchor, video policy, actions with rollback, every escape hatch, breaker and schema guard, the 250-row DOM cap, CPU guards; `BROWSER=firefox` for Firefox. Part of `test:all`.
- `npm run test:x:overlay` (`test/x-fast-overlay-offline.mjs`): the X Fast UI overlays (M3): lightbox (4 photos, wheel/keys, zoom, video, actions), thread drawer (instant paint, Relay TweetDetail ancestors/replies, more, stack, Back/Esc/backdrop with the scroll kept, the tap, X never told), the missing-op fallback that never fails Home, and the keys; `BROWSER=firefox` for Firefox. Part of `test:all`.
- `npm run test:x:m4` (`test/x-fast-m4-offline.mjs`): the X Fast UI views (M4) on the same kind of mock x.com plus a fake REST backend: the notifications popout (REST legacy shape, GraphQL Relay fallback, tapped badge, a post opens the drawer with the scroll kept), the messages drawer (inbox, conversation, optimistic send with rollback, encrypted banner, XChat button), profile (header, tabs, Follow with rollback, Back), search (tabs, People cards, drawer), bookmarks (pagination), and one Zero-JS run without the optional ops (banners, 0 ms fetches, `XBB.ext.setBlock` on Open on X, Home never failed); `BROWSER=firefox` for Firefox. Part of `test:all`.
- `npm run test:pinterest:fast` (`test/pinterest-fast-offline.mjs`): Pinterest Fast UI (M1): the masonry engine against a brute-force reference in Node, then a mock pinterest.com whose fake app asks for its own homefeed: off never mounts; on mounts and hides Pinterest's page, Home from the tap (0 requests of ours) or the SSR state, promoted pins and modules dropped, pagination with the learned template and headers, ≤50 cards with 500 pins, resize keeps the anchor card, the viewer (full viewport, zoom to the pointer + drag to pan with no scrollbars, the wheel steps pins, the collapsible panel and its "More like this" tab, idea pages, V_720P, comments, related, Esc/Back to the exact pixel, Pinterest's router never sees our popstates), Alt+Shift+P / Native / sidebar entry / `?pin=native`, the drift and 401 fallbacks; `BROWSER=firefox` for Firefox. Part of `test:all`.
- `npm run test:pinterest:m2` (`test/pinterest-fast-m2-offline.mjs`): Pinterest Fast UI (M2) on the same kind of mock pinterest.com plus a fake read/write backend: the routes and reserved segments, search from the top bar (no reload, BaseSearchResource headers, promoted dropped, paging, chips), a tapped search with 0 first-page requests, the board picker in the viewer (`s`, search + Enter, RepinResource POST with X-CSRFToken, Saving…/Saved, toast, last board), the card's quick Save, Create board, a 403 rollback that fails nothing, keys (`/`, Esc, j/k, Enter, z, s), Back to Home on the exact pixel with no request, profile (tabs), board (header, paging, owner link), author links in cards and the viewer, the rail, a failing search's banner and `?pin=native`; `BROWSER=firefox` for Firefox. Part of `test:all`.
- `npm run build:ext` (`ext/build.js`, flags: `--dev`, `--firefox`, `--out=<dir>`): writes the unpacked MV3 extension to `dist/better-browsing-ext/` (all four sites; see **Extension** below). Default is Chrome (`background.service_worker`); `--firefox` emits `background.scripts` + `browser_specific_settings.gecko` (with `data_collection_permissions: { required: ["none"] }` for AMO). `npm run dev:ext` (`ext/dev-server.js`): watches every source tree, rebuilds in `--dev` mode, hot-reloads the extension and active covered tabs, writes `dist/bb-ext-dev.log` (`HH:MM:SS.mmm [level] [site] args (url)`); set `BB_EXT_MIRROR=<dir>` when running from a worktree to mirror builds into the folder loaded in Chrome (e.g. `X:\Dev\reddit better\dist\better-browsing-ext`). It is a long-lived node process — stop it when done (`BB_DEV_PORT` moves it off 47910, for tests only). `build:x:ext` / `dev:x:ext` are aliases of these two (the old `x/ext/` is gone). `npm run test:ext` (`test/ext-smoke.mjs`): loads the real built extension into Chromium (`--load-extension`, `channel: 'chromium'`) on fixture pages: each site is claimed (`data-bb-by="ext"`), the `bb-open-settings` message opens its panel, the popup hub lists four sites, X's and Pinterest's DNR rules toggle (and the `xbb-ext-*`/`pin-ext-*` aliases), hls.js injects into the content world. Not in `test:all` yet.
- `npm run test:headers` (`test/headers.mjs`, no browser): each @match host is served by exactly one per-site bundle and by the combined one, nothing else (old.reddit.com) is, each `.meta.js` is its `.user.js` header with the same @version, update URLs and header keys are right.
- `npm run test:double` (`test/double-install.mjs`): the combined and a per-site bundle on the same fixture page, both orders; the site runs once, the hand-over and the notice work.
- `npm run test:all`: build, headers, double install, every site in Chromium and Firefox against its own bundle, X once against the combined one (`test/all.mjs`). Run it before a release. It includes the CPU guards in `test/lib/perf.mjs` (nothing changes on an idle page by itself; the script adds little work on a page that keeps changing); keep them passing when adding a subscriber, timer or observer.
- Syntax check without a browser: `for f in src/*.js src/*/*.js instagram/src/*.js instagram/src/*/*.js x/src/*.js x/src/*/*.js pinterest/src/*.js pinterest/src/*/*.js userscript/*.js; do node --check "$f"; done`

## Rules

- Edit the sources only. `dist/` is generated and gitignored.
- Never send automated traffic to live Reddit, Instagram or X from tests. Reddit blocks headless browsers; don't spoof user agents or otherwise get around that. Extend the fixtures in the site's test instead.
- Each part's `manifest.base.json` is its script list (load order: the `world: "MAIN"` entry first, then content scripts and CSS) and its `version`. A change to a part bumps that part's version (and so its script's and the combined one's); Reddit's goes in `manifest.base.json` and `package.json` together. A new content script only needs adding to its manifest.

## Userscripts (`build.js`)

- **Bundles**: `BUNDLES` in `build.js`, one entry per published script; `SITES` holds each site's code, @match/@exclude, host test and description. Adding a site is one entry in each. Every bundle inlines `userscript/*.js` (no @require, no URL imports) and only its sites' code:
  - `better-browsing-reddit`: **Better Browsing for Reddit**, `https://*.reddit.com/*` minus `old.reddit.com`
  - `better-browsing-instagram`: **Better Browsing for Instagram**, `https://www.instagram.com/*`
  - `better-browsing-x`: **Better Browsing for X**, `https://x.com/*`
  - `better-browsing-pinterest`: **Better Browsing for Pinterest**, `https://*.pinterest.com/*`
  - `better-browsing`: the combined **Better Browsing (Reddit + Instagram)**, all four (legacy, see below).
- Do not change any script's `@name` or the shared `@namespace` (`better-browsing-watdafawx`): managers key a script on the two, and a new name would install next to the old one instead of updating it. Each per-site script has its own name so it installs next to the combined one.
- Layout of a bundle: `userscript/run-main.js`, `store.js`, `panel.js` and `claim.js` once at the top, then one block per site behind its host test and `bbClaim`. Per site: its main-world files inside `runMain(...)`, its content scripts in manifest order with `<site>.api = bbStore(key)` right after `defaults.js`, its `popup/popup.js`, the panel (`bbPanel`), then its CSS in a `<style>`.
- **Versions**: a per-site script is `<part version>.<revision>` (Reddit 1.3.21.0); the combined one keeps its old scheme `<reddit>.<instagram>.<x>.<pinterest>.<revision>`, so it stays above everything it published. `userscriptRevision` in `package.json` is an object with one revision per bundle (`reddit`, `instagram`, `x`, `pinterest`, `combined`): bump the affected bundles' revisions for a change to the scripts alone (header, `userscript/*`, `build.js` output; a shared change bumps all five), and set a bundle's back to 0 when a part in it changes version.
- **Updates, and the meta.js rule**: every bundle is written twice, `<file>.user.js` and `<file>.meta.js` (the header alone, ~1.5 KB). `@updateURL` is the `.meta.js` and `@downloadURL` the `.user.js`, both assets of the fixed GitHub release `userscript` at `https://github.com/watdafawx/better-browsing/releases/download/userscript/`. Tampermonkey and Violentmonkey read the version from `@updateURL` when it is set and download `@downloadURL`, so a daily check costs the meta file, not the ~600 KB Reddit script. The two are always published together with the same `@version` (`test/headers.mjs` checks the build; `release.mjs` uploads every `.user.js` before its `.meta.js`, so a new version in a meta file always has its script, and it re-uploads a `.meta.js` whose published `@version` no longer matches its script's — that is what an interrupted release leaves behind, and installed copies would never see the change).
- **Repo name**: the URLs are written for `watdafawx/better-browsing` (renamed from `reddit-better-browsing`). Copies installed before the rename have the old URL in their header; GitHub redirects old release URLs, so they update, and from that update on they carry the new URLs.
- **Icons**: every script has its own `@icon`, from `userscript/icons/<site>.svg` (`combined.svg` for the legacy bundle), inlined by `build.js` as an SVG data URI. They exist so four installed scripts are told apart in the manager's list and menu, where Violentmonkey shows the icon. Keep them small: the icon is repeated in the `.meta.js`, which is the daily update check. `test/headers.mjs` checks each one is an inline SVG and that no two scripts share one.
- **Release**: `npm run release:userscript` (`release.mjs`) refuses with a reason and a non-zero exit when the tree is dirty, the checkout's repo is not `watdafawx/better-browsing`, `test:all` fails, a script's version is below the published one, or a script changed while its version equals the published one. Unchanged scripts are skipped; changed ones go up with `gh release upload … --clobber`. Run it after every change to any part, or installed scripts won't see it.
- **One copy per page** (`userscript/claim.js`). While the combined script is still installed next to a per-site one, both match the same pages. Each site block first calls `bbClaim(site, mode)` (`mode`: `false` per-site script, `true`/`'combined'` the combined one, `'ext'` the extension):
  - The first copy to run sets `<html data-bb-site="<site>" data-bb-by="<site>|combined">` and runs; any later copy sees the attribute and exits. One page never runs a site twice, whatever the order.
  - A per-site script that finds the page claimed by the combined one sets `localStorage['bb-split-<site>'] = '1'` (it also sets it whenever it runs). The combined script exits before claiming when that mark is set, so from the next load on the per-site script runs, even though managers run the older (combined) script first.
  - If the combined script stood aside because of the mark but no copy has claimed the page by `DOMContentLoaded`, the per-site script is gone (removed or disabled): the combined one drops the mark and runs again from the next load. That one load has no Better Browsing.
  - The combined script, when it runs on Instagram, X or Pinterest, shows once per site (`localStorage['bb-split-notice']`) a note in a manual popover in a shadow root, with the install link for that site's script and a link to the README. On Reddit it says nothing: it does the Reddit script's job there.
  - **The extension beats every userscript.** `bbClaim(site, 'ext')` sets `localStorage['bb-ext-<site>'] = '1'` and `data-bb-by="ext"` (the extension's page-world `<site>/main.js` already sets the attribute, so a userscript that runs after it stands aside; the content script counts that attribute as its own). A userscript (per-site or combined) exits when `data-bb-by="ext"` is set or the mark exists, in any install order; if a userscript got to the page first, the extension leaves it that one load and the mark makes it stand aside from the next. A stale mark (extension removed or disabled, so nobody claims by `DOMContentLoaded`) is dropped by the userscript the same way as `bb-split-<site>`.
  - `test/double-install.mjs` covers both orders, the hand-over, the stale mark and the notice on all four sites.
- **End of the transition** (after 2–3 releases): delete the `combined` entry from `BUNDLES` and stop uploading `better-browsing.user.js`/`.meta.js`. Leave the last published ones in place: copies still installed stay on that version, keep standing aside wherever a per-site script runs, and keep the notice. Keep the per-site side of `bbClaim` (the mark) for as long as such copies may exist.
- **Settings storage** (`userscript/store.js`): the page's localStorage, one key per site: `rbe-userscript-storage` (nested `{ sync, local }`), `igb-userscript-settings` and `xbb-userscript-settings` (flat sync area). Keep those keys and layouts, or users lose their settings. Each site's `core.js` also keeps a `<prefix>-settings-snapshot` so the theme applies on the first paint instead of after the async read.
- **Settings panel** (`userscript/panel.js`): each site's `popup/popup.html` (from `<header>` to `</main>`) and `popup.css` (`:root` → `:host`) in a shadow-DOM panel; `popup.js` mounts its form on that shadow root (`<site>.mountSettings(root)`). Look things up in `popup.js` through the root (`$`/`$$`), never `document`. Reddit's gear and quick bar ⚙️ call `RBE.openSettingsInPage`; Instagram and X use `<site>.openSettings` (sidebar gear, Alt+W). The panel handles Esc and keeps the site's key handlers away from its fields.
- Every header says `@inject-into auto`, not `page`. Violentmonkey on Firefox cannot inline a `<script>` into a page whose CSP has a nonce (X, Reddit: `'unsafe-inline'` is ignored once a nonce is present), so `page` ended in "Could not inject some scripts" and the script never ran. With `auto` it falls back to its content realm, where `runMain` hands the main-world hooks to the page as a `<script>` with a nonce read from one of the page's own scripts (`window.wrappedJSObject` marks that realm; in the page world the hooks just run). Checked in the real Zen 1.24 + Violentmonkey 2.50 with a throwaway profile (geckodriver, `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, install through the confirm page's Install button, probe scripts in `page`/`content`/`auto` mode): only `page` failed. `test/x-offline.mjs` fakes that realm and checks the nonce path.
- `videoPauseOnHide` (Reddit, Instagram and X, default on): `document.hidden` (visibilitychange) or a window `blur` that leaves `document.hasFocus()` false pauses what plays; a `blurred` flag (set on blur, cleared on focus) stops anything starting meanwhile. A window that merely loaded unfocused plays as usual, since no blur event was seen. Reddit and Instagram do not resume afterwards; X's own pick logic does. The tests fake hidden/unfocused (`document.hidden`, `document.hasFocus`, events) in `test/lib/away.mjs` and `x-offline.mjs`.
- Firefox never shows the page a click on a video's own controls (no pointerdown/mousedown/click; only `focusin`, keys and user activation), and Chrome's native bar sends the page nothing at all. Neither is a click on the page, so do not read "pointer over that video + `navigator.userActivation.isActive`" as one: in a feed the pointer rests over a video most of the time, so X's own autoplay and mutes counted as the user's (two videos playing, and a video muted for good). X tells them apart the other way round: a pause with no page `pause()` before it is the user's, a play with no page `play()` counts only when that video has focus (using the bar focuses it), and a `volumechange` that is neither our level nor a page write is the user's (see X in this file).
- Never unmute a *playing* muted video while the browser would still refuse it sound: the browser pauses it, the site restarts it muted, and you get play, stop, play silent. `canSound()` (`navigator.getAutoplayPolicy`, Firefox) guards every unmute path in Reddit's, Instagram's and X's `main-world.js`, and a video held that way stays in the `waiting` set for the first click.
- Ask the browser, not just activation, whether a video may make sound: Firefox also says "allowed" on a site the user put on its autoplay allow list, where sound works on a fresh page with no click yet. Gating unmutes on `navigator.userActivation.hasBeenActive` alone kept x.com (and reddit.com, instagram.com — all on real users' allow lists) muted until the first click, and a video a site starts by itself before our settings arrive never got our level at all. `canSound()` falls back to `hasBeenActive` where the browser has no answer (Chrome).
- Never let a `play()` through "for a while after any click" and remember it: X calls `play()` on its other videos after a click or key press, and a remembered allowance made X and our own pausing take turns in a tight loop (CPU spikes in Firefox). Allow only the pick or the video you are acting on.
- **Reddit's own player in the lightbox** (`⧉` in the bar, `O`): for a Reddit-hosted video (`rvideo`) it swaps our `<video>`+hls.js for Reddit's embed player of that post, and back. The iframe URL comes from `RBE.redditEmbedSrc()` (`media.js`): `https://embed.reddit.com<permalink>?embed=true&showmedia=true&ref_source=embed&…`, the URL Reddit's own `widgets.js` builds. Do not build it from `/oembed`: for many posts that `html` is a blockquote plus `widgets.js`, so the first `src="…"` is the script and the iframe loads a `.js` file. It is the escape hatch for streams our player cannot handle (hls.js missing in the content realm, a video Reddit only serves to its own player). GIF uploads (`is_gif`) are silent by design — their HLS master and DASH MPD contain video only — so don't chase audio on those. `⧉` shows only when the item has a permalink. In strip mode each post gets its own `⧉` beside its meta line.

## Extension (`ext/`, `build-lib.js`)

One MV3 extension for all four sites, `dist/better-browsing-ext/` (Chrome by default with `background.service_worker`; `--firefox` builds for Firefox 128+ with `background.scripts` and `browser_specific_settings.gecko`, id `better-browsing@watdafawx`, `data_collection_permissions: { required: ["none"] }`). Plan and phases: `EXT-PLAN.md`. Same source as the userscripts, nothing copied: `build-lib.js` (the `SITES` table, `siteCode`, `scripts`/`panel` helpers) is shared by `build.js` and `ext/build.js`; `build.js`'s output did not change when it was extracted (compare `sha1sum dist/*` before/after when touching it).

- **Firefox packaging & install**: build with `node ext/build.js --firefox --out=<dir>`, zip the folder's *contents* (not the parent folder, using POSIX `/` paths) as `.xpi`. Temporary test: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json`. Permanent: Zen / Dev Edition / Nightly (`xpinstall.signatures.required = false`), or regular Firefox Release via free unlisted self-signing on `addons.mozilla.org/developers/` ("On your own", "No" for source code). After install, open `about:addons` → Better Browsing → **Permissions** and toggle host permissions ON (Firefox defaults MV3 host permissions off).

- Per site `<site>/main.js` (the manifest's `world: "MAIN"` files, no `runMain`), `<site>/content.js` (store, panel, claim, `ext/prelude.js`, the claim, defaults, `<ns>.api`, `ext/bridge.js` [+ `ext/bridge-x.js` for X], the rest of the scripts, `popup/popup.js`, the panel), `<site>/content.css`. No `'use strict'` (the userscripts are sloppy too). Reddit skips `/media` (match exclude + a runtime check) and `/login` (page-world hooks only).
- **Hosts**: from `SITES` (Reddit `https://*.reddit.com/*` minus `old.reddit.com` and `/media*`, Instagram `www`, X `x.com`, Pinterest `*.pinterest.com`) plus `api.x.com`, `abs.twimg.com`; `--dev` adds `http://127.0.0.1:47910/*` and `alarms`. Permissions: `declarativeNetRequest`, `scripting`, `storage`, `activeTab` (no `tabs`).
- **Settings**: the four localStorage keys and layouts are unchanged (`bbStore`), so nothing to migrate. A `chrome.storage` mirror is P2.
- **hls.js (Reddit)** is its own file, `reddit/hls.js` (same UMD shim as the userscript, ~400 KB, not in `content.js`). `RBE_LOAD_HLS` in the extension build is async: it sends `{type:'bb-load-hls'}`, the worker runs `scripting.executeScript({files:['reddit/hls.js'], world:'ISOLATED'})` in that frame, and the loader throws if `globalThis.Hls` is still missing. `RBE.loadHls` (`video.js`) already wraps the loader in `Promise.resolve().then(...)` and falls back to native HLS / the silent MP4 on a rejection, so `video.js` is unchanged and the userscript keeps its sync inline loader.
- **Worker** (`ext/background.js`): a per-site DNR table (X 1001..1003 as in the old `x/ext/`; Pinterest 2001..2002 block `||s.pinimg.com/webapp/` scripts and stylesheets for Pinterest initiators, 2003 reserved; Reddit and Instagram none); state per site in `storage.local` `bb:block:<site>`; messages `bb-ext-get`/`bb-ext-set` (`site` field; the old `xbb-ext-get/set` are aliases for X, `pin-ext-get/set` for Pinterest), `bb-load-hls`, `bb-open-site-settings`, `bb-dev-log`. X's auto-enable / auto-learn / reload behaviour lives in `ext/bridge-x.js` (`XBB.ext.blocking/setBlock/hasCachedHome`, same API as before); Pinterest's in `ext/bridge-pinterest.js` (`PIN.ext.blocking/setBlock/hasLearnedHome`, localStorage `pin-ext-blocking`, a DOMContentLoaded safety net that drops the rules and reloads once, `sessionStorage['pin-fast-reloaded']`, on a page Fast UI does not own). DNR rules are not tab-scoped yet (`tabIds`: P3).
- **Toolbar popup** (`ext/popup.*` becomes `popup/`): on a covered site it sends `bb-open-settings` to the tab (the content script calls `<ns>.openSettings`, Reddit `RBE.openSettingsInPage`) and closes; if the tab has no content script yet it shows a reload note; elsewhere it is a four-site hub (status dot, Open, Settings = open the site, then its panel, Allow = `permissions.request` where the browser did not grant the host).
- The extension version is `ext/manifest.base.json` (`version`, `gecko`). Bump the patch for any change to a part, the minor for a permission or storage change.

## Fast UI themes (`userscript/themes.js`, `bbThemes`)

Shared by X and Pinterest Fast UI only: `SITES.<site>.themes` in `build-lib.js` inlines it at the top of that site's block (userscripts, combined bundle) and `ext/build.js` after the claim in that site's `content.js`; Reddit and Instagram do not carry it. `fast.themes` exposes it to tests.

- Registry: Lights Out/Dim/Light ("classic": `black`, `dim`, `light`, still defined by each site's fast.css, so the picker sets only `data-theme` and clears inline variables) plus Hopper's palettes, hex for hex from `X:Devhoppersrcgpui	heme.rs` (13 dark incl. Hopper Dark, 6 light incl. Hopper Light). `auto` is not a theme: the site passes what it means (X's night_mode cookie, Pinterest's prefers-color-scheme). Setting `fastUiTheme` holds `auto`, a classic id, a Hopper id or `custom-<slug>`.
- `bbThemes.apply(host, id, {auto, site, page})`: a Hopper/imported theme sets both sites' variables inline on the host (`--bg --bg-2 … --accent-soft` for X, `--bg2 --bg3 --fg --fg2 --fg3 --card --accent-h …` for Pinterest) and `data-theme` = black|light by mode, `data-bb-theme` = the id; with `page` it also sets `--bb-page-bg` + `data-bb-page` on `<html>`, which a rule in each site's content.css reads only while Fast UI owns the page (no flash outside the shadow root). A classic theme removes all of that.
- `importJson(text)`: Hopper/gpui-component/Zed theme JSON (`{themes:[…]}`, an array or one theme; needs `colors.background` + `foreground`), stored in `localStorage['bb-custom-themes']` (max 24). Missing colours are derived.
- The picker (`mountPicker`) is a `popover="auto"` inside the shell's shadow root; its styles are `bbThemes.CSS`, added to the shadow stylesheet by each shell's `style()`, so nothing of it is in fast.css. It handles its own clicks (`data-bt-*`, `data-theme-pick` on theme buttons, `aria-pressed` marks the active one); tests open it with `[data-bt-open]` first.
- Changing the palettes: keep them equal to Hopper's theme.rs; the settings form's `<select data-key="fastUiTheme">` is filled from the registry by each `popup.js`.

## Reddit (`src/`)

**Load order** is the `content_scripts` list in `manifest.base.json`. Every content script is an IIFE that hangs its API on the shared `RBE` global created in `defaults.js`. Later files may call earlier ones at load time; calls the other way must happen at runtime (for example `RBE.openLightbox?.()`).

**Settings**: `storage.sync` key `settings` (merged over `RBE.DEFAULTS`), plus `storage.local` key `customCss`. `core.js` keeps `RBE.settings` current and calls every `RBE.onSettings(fn)` subscriber on load and on change. Code that writes settings reads `settings` from sync, changes it, and writes it back (see `patch()` in `quickbar.js`).

**Reacting to Reddit's DOM**: use `RBE.onDomChange(fn, delayMs)` from `core.js`. It is one shared `MutationObserver`, throttled per subscriber. Don't add new whole-document observers.

**Fetching**: always `RBE.getJSON(path)`. In a Firefox content realm it uses the page's `content.fetch` so cookies and CORS behave like Reddit's own requests.
- Post data: `RBE.getPosts(ids)` / `RBE.getPost(id)` in `media.js`. Batches up to 50 ids through `/api/info.json`, falls back to `/by_id/`, then to one `/comments/<id>.json` per post, three at a time. Results are cached per page.
- Threads: `loadThread()` in `viewer.js`. A 90 s cache shared by the viewer, the inline view and the image viewer's comment panel. Failed requests are never cached. Hovering a post for 300 ms, or pressing on it, prefetches its thread, with at most one hover prefetch in flight to stay clear of Reddit's rate limit. If you change the thread URL (`jsonUrl()`), prefetch and viewer must keep building it the same way or the cache stops hitting.
- Avatars: user pictures are batched (`/api/user_data_by_account_ids.json`, 100 per request); subreddit icons come from post data (`sr_detail`) or a cached `about.json`.

**Untrusted HTML**: anything from Reddit's API goes through `RBE.sanitize()` (allowlisted tags and attributes, image hosts limited to Reddit/imgur/giphy, link schemes parsed with `new URL()` by `RBE.safeUrl`: only http/https/mailto hrefs and http/https image sources stay) before it touches `innerHTML`. An unwrapped tag's children are cleaned after they move (`<font><img onerror></font>` once kept its attributes); don't go back to a children snapshot taken before the loop. An embed's iframe src from API markup (`media_embed.content`) must pass `RBE.safeFrameSrc` (http/https), in `extractMedia` and again where the frame is built (`lightbox.js`, `viewer.js`). Build other DOM with `RBE.h(tag, props, ...children)`.

**Video** is split across two worlds:
- `main-world.js` runs in the page's JS world and patches `HTMLMediaElement` `play`, `muted`, `volume` and `autoplay` so Reddit's own players follow the user's setting. It reads settings from the `<html data-rbe-video>` attribute, which `video.js` writes, and re-parses it only when the attribute changes.
- `video.js` handles offscreen pause and our own players. Reddit videos are HLS, with the sound in a separate audio rendition (so hls.js's light build, which drops alternate audio, would play them silent). hls.js (about 400 KB, `src/vendor/hls.min.js`) sits in the function `RBE_LOAD_HLS` (added by `build.js`), run by `RBE.loadHls()` on first use; the viewer and image viewer warm it up when they open. If that fails, playback falls back to native HLS, then to the silent MP4 `fallback_url` (marked `data-rbe-silent`, with a console warning and a one-time toast, because that path has no sound). Call `RBE.destroyVideos(root)` before removing any of our UI that might hold videos.
- **Offscreen pause and resume**: Reddit and Pinterest pause a video as it leaves the viewport (`videoPauseOffscreen`) and play it again when it returns. The sites usually pause feed videos *themselves*, so the resume cannot rely on our own pause: `video.js` marks any video that was playing when it left (`_rbePlaying`, set on `playing` or by still playing as it leaves, cleared by a pause right after a click/key on that player — `userOn`, which must not walk up as far as `<body>`, or every earlier click counts) and plays it on re-entry. The user-pause mark (`rbeUserPaused`) is dropped on the next `playing`, or a video the user paused once would never come back again. Instagram's own player restarts its videos, so its `video.js` does not resume them.
- **Nothing plays while wholly outside the viewport** (Reddit, `videoPauseOffscreen` on), whoever starts it, unless the user started it on that player. The observer only fires on edge crossings, so every *start* is checked too: `main-world.js` holds a page video's `play()` made out of view (rect test, `off` in `data-rbe-video`) and plays it when its own observer sees it come in — this covers closed shadow roots and players video.js never scanned, and holding the call (not pausing after it) keeps a player that restarts on every pause from looping with us. Starts without `play()` (autoplay attribute once a source arrives) are paused by video.js's `play` listener and marked `rbePausedOffscreen` for re-entry; the same listener keeps shadow-DOM players paused behind the lightbox, since media events never leave a shadow root. Our own players use `outOfView()` (observer verdict, or the rect before its first report) for every autoplay path: the `play`/`playing` checks after the initial `tryPlay` (made while still detached, inside the click), hls.js `MANIFEST_PARSED`, the MP4 fallback. `test/offline.mjs` covers each start path with a real clip in both browsers.
- Sound on our own players: `RBE.setupOwnVideo` sets the level through `setAudio`, which records `[muted, volume]` in a WeakMap so the `volumechange` our own write causes is never taken for the user's choice (`isMineAudio`). Without that, a start the browser refused (muted fallback in `tryPlay`) looked like the user muting the video and the unmute on the next click never happened: the lightbox stayed silent for good. `.mp4` items are muted only when they are gifs (`silent: true` in `media.js`: AnimatedImage, gifv, gif→mp4); a plain `.mp4` link goes through `setupOwnVideo` and plays with sound, like the post viewer already did.
- **External video posts** (redgifs, YouTube, …) must use the provider's own player, never a Reddit preview. `extractMedia` prefers `secure_media_embed.content` / `media_embed.content`; `preview.reddit_video_preview` is only a last resort (it is Reddit's silent preview: video track only, no audio), and when the API gives us nothing, `domItems` builds the provider player from the post's `content-href` with `RBE.embedFromUrl()` — the feed's `<shreddit-player>` is that same silent preview, so using it made redgifs posts play with no sound. Redgifs' CDN answers **403** for its MP4 when the request comes from a reddit.com page (hotlink protection, Referer or not), so never try to play redgifs directly; their `/ifr/` iframe is the only player, and unmuting has to happen *inside* it (that is what the Redgifs Embed Tweaks userscript does, and why the post page has sound and we cannot reach it from here). `attach()` checks the HLS manifest for an audio rendition and marks `data-rbe-silent` + toasts once when there is none.

**Viewer history**: opening the side panel or modal pushes a history entry, so the browser Back button closes it (the `popstate` handler in `viewer.js`). Closing it any other way pops that entry again.

**Testing**: `test/offline.mjs` answers every reddit.com request from fixtures: a small feed page, thread JSON with 61 comments and a "load more", and a video post. It checks the theme, quick bar, header gear, prefetch and cache behaviour, sanitizer output, load more, collapse, sort, `J`, `Esc`, video volume, live settings changes and the settings panel, and prints PASS/FAIL per check. When you add a feature, add a check here. What it can't cover: Reddit's real markup (feed web components, shadow DOM players, header layout). After changes to selectors in `main.js`, `theme.js`, `navgear.js` or `spoilers.js`, check by hand on www.reddit.com in both browsers.

## Instagram (`instagram/`)

Same shape as Reddit, with global `IGB` instead of `RBE`. `instagram/README.md` describes the features and how they work.

- Instagram's class names are generated and change often. Find things by structure, ARIA attributes and geometry (`article`, `a[href*="/p/"]`, `aria-current="step"`, `elementsFromPoint`), never by class name or by English `aria-label` text.
- Feed videos sit inside an `<a href="/reels/…">` inside an `<article>`; grid previews are videos or images inside a link outside any `article`. `main-world.js`, `video.js` and `lightbox.js` all rely on that difference.

## X (`x/`)

Same shape, global `XBB`. `x/README.md` describes the features and how they work.

- Find things by `data-testid` and structure (`article[data-testid="tweet"]`, `[role="group"]`, `videoPlayer` > `videoComponent`), never by X's generated class names or English labels. The testids were checked against real x.com on 2026-11-11; the offline fixtures copy that shape.
- The script runs in the page's own JS world, so its own calls to `play()`, `muted` and `volume` go through the `main-world.js` patches too: a video it starts must carry `data-xbb-pick`, and `muted`/`volume` writes from it are ignored while native controls are on.
- **Whose play/pause/mute is it** (the bug that made X take videos over): the browser's own controls — the video's native bar, the media keys — send the page no click at all in Chrome (Firefox reports the focus) and never call `play()`/`pause()` or the setters. `main-world.js` marks page calls (`_xbbPagePlay`/`_xbbPagePause`/`_xbbPageWrite`); `video.js` then counts a pause with no page call as the user's, a play from the bar as one only when that video has focus, and a `volumechange` that is neither our level nor a page write as the user's. Never judge by the pointer resting on a video: with the mouse parked over the feed, X's own autoplay counted as the user's, so X took the pick (two videos played) and its mute stuck for good. Do not count every play with no page call as the user's either: Firefox restarts an ended video by itself, which then replayed it instead of handing over to the next. A user mute is remembered with the media it was made on (`data-xbb-user-audio-src`), so it does not silence the next tweet in a recycled `<video>`.
- GIFs are videos in the same `videoPlayer`; they are skipped by their `/tweet_video/` source or `loop` at first sight.

### X Fast UI engine (opt-in, Milestone 1: no UI yet)

`x/src/main-world-api.js` (page world, after `main-world.js`), `x/src/content/model.js` and `x/src/content/api.js` (after `core.js`). The `fastUi` setting (default off) turns the passive tap on; everything else is lazy.

- **Never hardcode a GraphQL query ID**, X rotates them every deploy. `main-world-api.js` harvests `{queryId, operationName, operationType, metadata:{featureSwitches, fieldToggles}}` from `window.webpackChunk_twitter_responsive_web` (the array that exists, the setter for one created later, `push`, and webpack's own `require` (`.m`, `.c`) obtained by pushing a chunk with a runtime callback). It reads module *source* (`Function.prototype.toString`, brace matching around `queryId`), and the exports of modules that already ran; it never executes a module itself. Scanning is lazy (first `call`/`status({scan:true})`, or in the background while tapping is on). Priority of a queryId: live request > webpack > `localStorage['xbb-gql-ops-v1']`.
- **The tap** wraps `fetch` and `XMLHttpRequest` (one `indexOf('/i/api/')` when idle): learns the session headers (authorization, csrf, `x-twitter-*`, `x-xp-forwarded-for`), the live `{queryId, features, fieldToggles}`, and with `<html data-xbb-api-tap>` clones core timeline/detail/profile/search/bookmark responses to the content script. All of it is in try/catch and X's own promise is returned unchanged. Our own calls use the original `fetch`, so they are never tapped.
- **Bridge**: `CustomEvent`s on `document`, `detail` always a JSON *string* (`xbb-api-req` / `xbb-api-res` / `xbb-api-tap`), because objects made in the other realm do not cross Firefox's Xray wrappers. `XBB.gql.call(op, variables, opts)` never throws; it resolves `{ok, kind, status, data, ...}`.
- **Circuit breaker** (`XBB.gql.breaker`, per operation): 400/403/404, a missing queryId, or a 200 holding only a GraphQL validation error opens it (`XBB.gql.getDrift()` has what failed); five transient failures in a row open it too; 401/429 do not. UI code asks `breaker.ok(op)` and falls back to native X when it is open. It closes by itself when a tapped X request shows another queryId, after a cooldown (half-open probe), or on `reset`.
- **Model** (`XBB.model`): pure and defensive, never throws. A retweet normalizes to the original tweet with `retweetedBy`; long-form text comes from `note_tweet`; `extractTimeline` finds `instructions` at any depth and skips promoted entries (`keepPromoted` keeps them marked). Keep every new field read behind the safe getters, and add a malformed-payload case to `test/x-api-offline.mjs` for it.
- `x-client-transaction-id` is best effort: `window.__xbbApiTxid(path, method)` if supplied, else a conservative probe for a pure generator in modules that mention the header; calls go out without it otherwise.

### X Fast UI, Milestone 2 (shell + Home)

`x/src/content/fast/`: flag.js (who owns the page), store.js, vlist.js, render.js, shell.js + fast.css (`build.js` inlines the manifest's `shadow_css` as `XBB.FAST_CSS`), views/home.js, router.js.

- `<html data-xbb-fast="home">` while Fast UI owns the route: content.css hides `#react-root` (X keeps running underneath, unpainted) and shows `<xbb-fast>` (open shadow root). `"native"` = the user escaped (Native X button, Alt+Shift+X, `?xbb=native`); absent = not ours. Links to other routes go to X's router by `pushState` + a `popstate` event (`XBB.fast.navigateX`), never a reload.
- The Home view renders from the passive tap (X's own HomeTimeline response): booting costs 0 requests. Only Following, pagination and the 5 s fallback call `XBB.gql.call`.
- A drift/missing-op breaker on HomeTimeline/HomeLatestTimeline, a 200 with no timeline (schema guard), or a mount error fails the route hard (`XBB.fast.fail`, sessionStorage `xbb-fast-broken`): X gets Home back for the session. Three soft failures in 5 min do the same.
- Our videos live in a shadow root, where media events never reach document listeners: `XBB.videoPolicy.add(v)` after the node is connected, `destroy(node)` before it is pooled. Gesture checks use `composedPath()[0]` and the deep active element.
- Shadow-root attributes must not reuse names video.js puts on videos (`data-xbb-native` is a video mark; the shell button is `data-xbb-to-native`).
- Text from X goes in as text nodes only; icons are our own constant markup.

### X Fast UI, Milestone 3 (overlays: lightbox, thread drawer, keys)

`x/src/content/fast/lightbox.js`, `drawer.js`, `keys.js` (after views/home.js, before router.js). `npm run test:x:overlay` (`test/x-fast-overlay-offline.mjs`, TweetDetail fixtures in the 2026 Relay shape, one run with no TweetDetail op).

- **Overlays live in the history** (`XBB.fast.ov` in flag.js): each level (the lightbox, each post on the drawer's stack) is one entry `{xbb:1, overlay, base:'home', ov: JSON string {drawer:[ids], lb:{id,i}|null, depth, y}}` (a string, for Firefox's Xray wrappers). flag.js takes the route from `base`, so Home stays owned while the URL is `/<user>/status/<id>`. lightbox.js and drawer.js only follow `ov.onChange`; open = `ov.push`/`replace`, close = `ov.back`/`closeAll`. `ov.back` is one `history.go` at a time (Esc's keydown plus the dialog's cancel once went back past `/home`). Closing restores the feed's exact `scrollY`.
- **X never sees overlay popstates**: a window capture `popstate` listener in flag.js updates and `stopImmediatePropagation`s any popstate into or out of an overlay entry while Fast UI owns the page; otherwise X's router renders the status page underneath and fetches it. `navigateX`'s own mirrored popstate goes through.
- Both overlays are native `<dialog>`s (`showModal`) in the shadow root. Esc is handled on keydown (preventDefault, so no cancel); `cancel` and an unasked `close` are only fallbacks that put the history right.
- `XBB.videoPolicy.scope(el)` (`fast.rescope()`): while an overlay is open only its videos may play; the feed's are paused and held.
- The drawer paints the clicked post from the store at once, then TweetDetail: a tapped X response for that `focalTweetId` first, a 90 s cache, else `XBB.gql.call`. TweetDetail is not in `ROUTE_OPS`: missing-op/drift there shows "Replies not loaded yet — Open on X once to learn TweetDetail" + Open on X, never `fast.fail`. A missing-op breaker closes when a tapped 2xx teaches the op (api.js). Likewise `HomeLatestTimeline` missing-op is the Following tab's own note (`LEARNABLE` in flag.js), but drift on it still hands Home to X.
- keys.js: one window capture keydown listener, only while owned and `fastUiKeys !== false`, never while typing (deep active element) or with the settings panel open. It also stops every other plain key so X's hidden page never runs its own single-key shortcuts. The ring is `.kfocus`, re-applied by `fast.keys.mark(node)` when vlist mounts a row.
- Don't reuse home.js's click attributes (`data-tab`, `data-pill`, `data-retry`) in overlay markup; the drawer uses `data-dr`, the lightbox `data-lb-act`, media cells `data-lb`.

### X Fast UI, Milestone 4 (views, notifications, messages)

`x/src/content/fast/feed.js` (the tabbed timeline the views share), `views/profile.js`, `views/search.js`, `views/bookmarks.js`, `notifications.js`, `messages.js`. X 1.4.0. `npm run test:x:m4`.

- **Routes** (flag.js): home, bookmarks (`/i/bookmarks`), search (`/search?q=`), profile (`/<handle>`, `/with_replies`, `/media`). `RESERVED` lists first path segments that are never a handle (home, explore, notifications, messages, i, settings, …); add to it before X ships a new top-level page, or Fast UI takes it for a profile. `fast.go(url)` renders an owned route here (X's router follows underneath, so its own fetch for that page is tapped) and hands anything else to X; `fast.back()` is a view's Back. router.js keeps Home alive (paused, scroll kept) and replaces every other view; the same view key with another URL (a tab) is `view.setUrl`.
- **Only Home's ops are in `ROUTE_OPS`.** The new views never call `fast.fail`: an op not learned yet (missing-op, no main world), drift or a 200 without a timeline is the view's own banner ("<X> not learned yet. Open it on X once…" + Open on X), and render errors fail only the home route. Keep it that way, or one unvisited page type turns Fast UI off.
- **First page from the tap**: feed.js and profile.js use a fresh tapped response for the same variables, else wait 700 ms for X's own call, else call themselves; in Zero-JS ext mode (`XBB.ext.blocking()`) no tap will come, so they call at once, and every "Open on X" goes through `fast.toNative` (which turns the blocker off).
- **REST** (`XBB.gql.rest(path, {method, query, body, form})`): same-origin `/i/api/…` or `api.x.com` only, with the session X sent. Notifications: `/i/api/2/notifications/{all,mentions}.json` (legacy `globalObjects`), falling back to `NotificationsTimeline` (Relay) on 404/drift/unreadable; the badge from X's own `badge_count` poll (tapped) or `fetchNotificationBadgeCountsQuery`. DMs: `dm/inbox_initial_state.json`, `dm/conversation/<id>.json`, `dm/new2.json` (JSON body with `request_id`; the optimistic `tmp-<rid>` copy is replaced by X's or removed on failure). Follow: `friendships/create|destroy.json` as a form. `XBB.model.extractNotifications`, `extractDm`, `badgeCounts` parse them; keep reads behind the safe getters.
- The notifications popout is `popover="auto"` (a sheet under 700 px) and never touches the history; the messages drawer is an overlay entry (`ov.dm`: `{c:''}` inbox, `{c:id}` a conversation) like the thread drawer. Encrypted (XChat) conversations are never fetched: a banner opens `/i/chat/<id>`.
- Click attributes of the new markup: `data-fd-tab`, `data-fd-retry`, `data-fd-native` (feed.js), `data-pf` (profile), `data-sr` (search), `data-bk` (bookmarks), `data-nt`, `data-nt-tab`, `data-nt-tw`, `data-nt-user`, `data-nt-url` (notifications), `data-dm`, `data-dm-conv`, `data-dm-native` (messages). Account rows are `article.ucard[data-href]`.

## Pinterest (`pinterest/`)

Same shape, global `PIN`. `pinterest/README.md` holds what a logged-in session showed; `pinterest/PLAN.md` the
milestones. What code must not forget:

- Selectors: pins are `[data-test-id="pin"]` with the id on `data-test-pin-id`; the link sits inside
  `pinWrapper`; the image is `pinrep-image`; idea pins are `pincard-storyPin-*`. Class names are hashed: never
  select on them.
- **The grid is virtualised**: off-screen pins leave the DOM. Anything that steps through pins keeps its own
  ordered list of ids and fetches by id (`PIN.getPin`), then re-anchors the feed when it closes.
- Data: `PIN.resource(name, options, { source, handler })` wraps `/resource/<Name>/<action>/` with the headers
  the site sends. `x-pinterest-source-url` and `x-pinterest-pws-handler` are **required** or the API answers
  "Invalid Request" (pin handler: `www/pin/[id].js`). The envelope is `resource_response.data`.
- Images: `pin.images` is a map — use `orig`, fall back to `1200x`/`736x`. Videos:
  `pin.videos.video_list.V_720P` is a progressive mp4 **with AAC audio**, so Pinterest needs no hls.js; the page's
  MSE player and the HLS renditions are not needed for our own lightbox. `is_video` is unreliable — detect video
  by `videos.video_list`.
- Idea pins: `story_pin_data.pages[]` with blocks and a per-page `video`/`image`; DOM hooks
  `story-pin-page-drag-surface` and `story-pin-image-block`.
- Opening a pin is a navigation to `/pin/<id>/` with `closeup-*` elements, not a modal: closing our overlay must
  return to the feed without fighting the router.
- Settings are flat (`pin-userscript-settings`), the panel is the shared `userscript/panel.js`, opened by the
  entry cloned into Pinterest's left nav (`[data-test-id="vertical-nav-icon"]`, `.pin-nav-entry`), an optional
  floating `.pin-gear` button, or Alt+W.
- The viewer (`lightbox.js`) replaces Pinterest's close-up: it opens on a capture-phase click of a grid card's
  `/pin/<id>/` link, keeps its own ordered id list (the grid is virtualised), fetches each pin with `PIN.pinData`
  and steps with the wheel/arrows/buttons. Idea pins step through `story_pin_data.pages` before moving on, images
  use a screen-sized rendition (`1200x`/`750x`/`736x`; `originals` only on zoom), videos use
  `video_list.V_720P` in our own player (`data-pin-own`), and the side panel shows description/author/stats plus
  the comments from `PIN.comments()` (`UnifiedCommentsResource/get`, keyed by `aggregated_pin_data.id`, returns an
  array). The stage paints the grid thumbnail while the pin loads, the next pin is prefetched, and the filmstrip is
  built once (rebuilding one `<img>` per pin on every step was most of the stepping cost).
- `hide.js` marks promoted cards (`PIN.isPromoted`, a label match) and one class on `<html>`
  (`.pin-hide-promoted`) hides them; the viewer skips them too.
- Video: `main-world.js` owns the sound decision (`play`/`muted`/`volume`/`autoplay`), `video.js` publishes the
  setting to `<html data-pin-video>` as `{mode, volume, feed}`, marks our players `data-pin-own`, pauses offscreen
  and when hidden, and retries a refused audible start muted. `feed` is the "feed videos play with sound" switch:
  when off (the default), `active()` is false for page videos in volume mode, so Pinterest's grid players stay
  muted as the site intends; our viewer is unaffected. Our own video also toggles play/pause on a click on the
  picture (not the control bar), and a click on a video the browser forced to start muted unmutes it instead of
  pausing. Scan `<video>` only (Pinterest's players are light DOM); a whole-document attribute-substring query per
  mutation was the expensive part under Violentmonkey's Xray wrappers. New shadow roots are looked for at most
  every 15s.
- Performance: `localStorage['pin-perf'] = '1'` + reload + `PIN.perf()` reports per-subscriber runs and total ms
  (`video-scan`, `video-interval`, `promoted`, `entry`), node count and long tasks. Keep the per-mutation work
  cheap: judge a promoted card once (WeakMap by child count), never re-read every card's text on each mutation.

### Pinterest Fast UI, Milestone 1 (Home + viewer, opt-in)

`pinterest/src/main-world-api.js` (page world, after `main-world.js`) and `pinterest/src/content/fast/`: model.js, api.js,
flag.js, masonry.js, grid.js, shell.js + fast.css (`shadow_css` → `PIN.FAST_CSS`), lightbox.js, views/home.js, router.js.
Pinterest 1.2.0. Design: `pinterest/FAST-UI-PLAN.md`, look: `pinterest/fast-ui-mock.html`. Settings `fastUi` (default off),
`fastUiTheme`, `fastUiNativeButton`, `fastUiKeys`.

- `<html data-pin-fast="home">` while Fast UI owns the route: content.css hides every other child of `<body>` and shows
  `<pin-fast>` (open shadow root). `"native"` = escaped (Native button, Alt+Shift+P, `?pin=native`); the sidebar "Fast UI"
  entry (`.pin-fast-entry`) switches back. Routes Fast UI does not own (Explore, a pin page, "Open on Pinterest") are a
  normal page load (`fast.toNative(url)`; in Zero-JS mode the rules go off first).
- **The API is addressed by name**, no query ids: main-world-api.js learns per resource the `options` Pinterest sent and
  its headers (`x-pinterest-pws-handler`, `x-pinterest-source-url`, `X-APP-VERSION`) into `localStorage['pin-ops-v1']`,
  and while `data-pin-api-tap` is set hands responses over as `pin-api-tap` (detail a JSON string). `PIN.fast.api.call`
  uses the learned template (per-call keys like `bookmarks`/ids stripped) or the fallback in api.js, never throws, and
  our own calls go through `window.__pinRawFetch` (never tapped) or `content.fetch`.
- **Only UserHomefeedResource can fail Home** (`ROUTE_OPS`): its breaker (400/403/404, a failure envelope / "Invalid
  Request", the schema guard) or a 401 (signed out) hands Home to Pinterest for the session (`pin-fast-broken`). Pin,
  comments and related failures are inline notes in the viewer.
- Home's first page: a fresh tap, else the SSR state (`__PWS_INITIAL_PROPS__`/`__PWS_DATA__`, bounded walk), else our own
  call (at once in Zero-JS mode, else 700 ms after DOMContentLoaded). Promoted pins are dropped by data
  (`PIN.model.isPromotedData`), and only `type: 'pin'` entries reach the grid.
- **The grid** (grid.js) virtualizes on the document scroll: ≤50 cards, translate3d, pooled nodes, `listTop` cached (no
  layout read in the scroll rAF; measured on setItems, resize and resume), a frame with the same visible set returns
  early. Card sizes come from the pin's 474x dimensions before paint (masonry.js, pure and tested in Node), so nothing
  shifts; a pin without dimensions is dropped.
- **The viewer** is a `<dialog>` in the history like X's (`fast.ov` in flag.js: one entry per level, `ov` a JSON string,
  URL `/pin/<id>/`); a window capture popstate listener keeps those popstates from Pinterest's router, and closing puts
  the feed back on its exact `scrollY`. Stepping replaces the entry, a related pin pushes one. Keys are on window
  capture while it is open (a click on the stage can leave focus outside the dialog).
- The viewer fills the viewport: a 48px bar, the stage, a 360px side panel (`i`/the bar button collapse it,
  `localStorage['pin-fast-lb-side']`) with the "Info & Comments" and "More like this" tabs, each pane scrolling on its own.
  The media is sized in JS to fit the stage (a ResizeObserver refits it), so zoom is `translate3d(tx,ty,0) scale(s)` with
  the pan clamped, never overflow scrollbars (`PIN.fast.viewer.zoom()`). The plain wheel over the stage steps (140 ms
  cooldown, |deltaY| < 10 ignored) at 1x and pans when zoomed; Ctrl/Meta+wheel zooms. A wheel anywhere else in the dialog
  is dropped unless a pane can still scroll that way, or it would scroll the page behind.
- `main-world.js` holds Pinterest's own video `play()` while `data-pin-fast` owns the page (`lbOpen`); ours carry
  `data-pin-own` (`PIN.setupOwnVideo`).

### Pinterest Fast UI, Milestone 2 (search, profile, board, save, keys)

`pinterest/src/content/fast/`: save.js, feed.js (what the views share), views/search.js, views/profile.js, views/board.js,
keys.js; router.js swaps views. Pinterest 1.3.0. `npm run test:pinterest:m2`.

- **Routes** (flag.js): home (`/`, `/homefeed/`), search (`/search/pins/?q=`), profile (`/<user>/`, `/_saved/`,
  `/_created/`), board (`/<user>/<slug>/`, never a `_` slug). `RESERVED` lists first segments that are never a user
  (pin, search, settings, ideas, today, business, …): add to it before Pinterest ships a new top-level page, or Fast UI
  takes it for a profile.
- **Navigation**: `fast.go(url)` pushes `{pin:1, nav:1}` for an owned route (Pinterest's router never sees it, nor its
  popstates: the capture listener stops every popstate into or out of an entry of ours) and hands anything else to
  `fast.toNative(url)`; the viewer closes first. `fast.baseUrl()` is the view's URL (an overlay entry keeps it in
  `u`), `fast.onNav(fn)` fires when it changes, `navKind()` is load/push/pop. flag.js tracks `appUrl` (where
  Pinterest's hidden app is): escaping on a URL it never rendered reloads with `?pin=native`. Links in our markup are
  `[data-go]` (the shell delegates them), "Open on Pinterest" is `[data-fv-native]` (`fast.toNative(href)`).
- router.js keeps Home alive (hidden, grid paused, back on its exact `scrollY` on Back with no request); other views
  are destroyed when left and mounted again on Back at the remembered scroll; a profile tab is `view.setUrl`.
- **Only Home's resource is in `ROUTE_OPS`.** Search, profile, board, the picker's boards, Save and Create board never
  call `fast.fail`: a failure is the view's own banner (`fast.banner`, "Open … on Pinterest") or a toast. Keep it so.
- First pages go through `fast.firstPage`: a fresh tap for the same options, else on the landed document up to 700 ms
  after DOMContentLoaded for Pinterest's own request, else our call; in Zero-JS mode and after an in-app navigation
  the call goes out at once.
- `PER_CALL` keys (query, username, slug, board_id, name, …) are stripped from learned *and* fallback templates:
  callers pass them in `overrides`.
- **Save** (save.js): `RepinResource/create` and `BoardResource/create` are form POSTs (`source_url` + `data`) with
  `X-CSRFToken` from the `csrftoken` cookie (`fast.api.call(..., { method: 'POST' })`). Optimistic "Saving…"/"Saved",
  rolled back with a toast; a refused write resets its breaker so the next try goes out. Last board in
  `localStorage['pin-last-board']`, recent ids in `pin-recent-boards`, the signed-in user (`fast.me()`: Pinterest's
  `header-profile` link, the SSR context, `pin-fast-me`). The picker is `popover="auto"` and lives inside the viewer's
  `<dialog>` while it is open (everything outside a modal dialog is inert); the toast (`fast.vtoast`) likewise.
- keys.js: one window capture listener while owned and `fastUiKeys !== false`, never while typing or with
  `.pin-settings` open. It is registered before the viewer's, so Esc closes the picker before the viewer.
- Click attributes of the new markup: `data-go`, `data-fv-native`, `data-fv-retry`, `data-fv-banner`, `data-filter`
  (chips), `data-tab` (profile), `data-board-id` (board cards), `data-save`/`data-save-pick` + `data-save-id`,
  `data-pk-*` (picker), `data-lb-author`/`data-lb-board` (viewer), `data-rail`/`data-act` (rail).

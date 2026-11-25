# EXT-PLAN: one Better Browsing MV3 extension for Reddit, Instagram, X and Pinterest

Status: plan only. Builds on `x/ext/` (build-ext.js, background.js, bridge.js, dev-server.js), which already ships X Fast UI as an MV3 extension with DNR blocking and hot reload.

## 0. What exists, what that implies

| Fact (from the code) | Consequence |
|---|---|
| Each site's `manifest.base.json` is already an MV3-style `content_scripts` list (`world: "MAIN"` entry first, then isolated scripts + CSS). | The extension manifest is *generated from those four files*. No source is copied or forked. |
| `build.js` `siteCode()` already concatenates a site (main-world, `<site>.api = bbStore(key)`, popup.js, panel, CSS). `x/ext/build-ext.js` does the same for X, but emits a MAIN file and an isolated file. | Generalise `build-ext.js` into `ext/build.js` that loops over `SITES`. |
| `bbStore(key)` keeps settings in the page's **localStorage**. A content script in the isolated world shares the page origin's localStorage. | Existing settings are readable by the extension in place. Migration is mostly free (section 3). |
| Per-site `bbClaim` + `runMain` exist for userscript double installs and the Firefox nonce-CSP hack. | In the extension, `world: "MAIN"` replaces `runMain`; `bbClaim` stays so extension and userscripts never both run. |
| X-only: `x/ext/bridge.js` (`XBB.ext`), DNR rules, `xbb-ext-*` messages. | Move to a generic bridge keyed by site; X keeps its rules. |

## 1. Single extension shape

Output: `dist/better-browsing-ext/` (unpacked, load as-is). Name **Better Browsing**, version = new `ext/version` (see "Versioning"). `dist/x-fast-ext/` is retired once P1 lands (script `build:x:ext` becomes an alias).

```
dist/better-browsing-ext/
  manifest.json
  background.js              # service worker (Chrome) / event page (Firefox), shared
  popup.html + popup.js      # 4-site hub (section 3)
  icons/ icon16/32/48/128.png
  reddit/    main.js content.js content.css hls.js   (hls.js lazy, see below)
  instagram/ main.js content.js content.css
  x/         main.js content.js content.css          (+ shadow css inlined into content.js, as today)
  pinterest/ main.js content.js content.css
  rules/     (static DNR rulesets, section 2)
```

### Build (`ext/build.js`, one script)

1. For each site in `SITES` (export `SITES`/`siteCode` pieces from `build.js` into `build-lib.js`; `build.js` keeps working unchanged):
   - `main.js` = the manifest's `world: "MAIN"` files, wrapped in an IIFE. No `runMain` and no nonce hack.
   - `content.js` = `store.js`, `panel.js`, `claim.js`, defaults, `<site>.api = bbStore(...)`, rest of the content scripts in manifest order, `popup/popup.js`, the `bbPanel(...)` line. Same assembly as `siteCode()`, minus the main-world part.
   - `content.css` = the manifest's `css`.
2. Zero source duplication: the only inputs are `src/`, `instagram/src/`, `x/src/`, `pinterest/src/`, `userscript/`, the four manifests. The generated bundles are gitignored like `dist/`.
3. Manifest entries come from `SITES[k].match/exclude`:

```jsonc
"content_scripts": [
  { "matches": ["https://*.reddit.com/*"], "exclude_matches": ["https://old.reddit.com/*"],
    "js": ["reddit/main.js"], "run_at": "document_start", "world": "MAIN" },
  { "matches": ["https://*.reddit.com/*"], "exclude_matches": ["https://old.reddit.com/*"],
    "js": ["reddit/content.js"], "css": ["reddit/content.css"], "run_at": "document_start" },
  // instagram: https://www.instagram.com/*   x: https://x.com/*   pinterest: https://*.pinterest.com/*
]
```
   - Reddit's `!location.pathname.startsWith('/media')` and `/login` checks from `SITES.reddit.test` and `main:` stay as the first lines of the bundle (match patterns cannot express paths excluded for one host cleanly).
   - Each site only ever loads its own two files. X, Instagram and Pinterest tabs never parse Reddit's code.
4. Permissions: `storage`, `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` (only if a dynamic rule needs initiator checks beyond static), `scripting` (hls.js), `tabs` is **dropped** unless the popup needs `tabs.query` (use `activeTab` instead; see section 3). `host_permissions` = the four hosts plus `api.x.com`, `abs.twimg.com`; `127.0.0.1:47910` only in dev builds.

### hls.js for Reddit, without bloating other sites

Today `RBE_LOAD_HLS` inlines about 400 KB into the Reddit userscript and runs on first use (`RBE.loadHls`, `video.js:280`). In the extension:

1. Ship `reddit/hls.js` as a **separate file** (the same vendored `src/vendor/hls.min.js`, with the sourceMappingURL line stripped and the same UMD shim wrapper), not in `content.js`. `reddit/content.js` drops from ~600 KB to ~200 KB, and it is parsed only on Reddit tabs.
2. `RBE_LOAD_HLS` in the extension build becomes a stub that asks the worker to inject the file on demand:
   `chrome.runtime.sendMessage({type:'bb-inject', file:'reddit/hls.js'})` and the worker runs `scripting.executeScript({target:{tabId, frameIds:[frameId]}, files:['reddit/hls.js'], world:'ISOLATED'})`. It resolves when `globalThis.Hls` exists. This works in Chrome and Firefox 128+ and needs no `web_accessible_resources` entry.
3. `RBE.loadHls` already returns a promise and callers already `await` it (`video.js:282`, `lightbox.js:122`, `viewer.js:288` only warms it up), so the sync-vs-async change is local to the stub. `build.js` keeps the inline form for the userscript (a switch: `extra:` string differs per target).
4. Warm-up hooks (lightbox / viewer open) stay as they are, so first video play does not wait for the injection.
5. Fallbacks unchanged: native HLS, then the silent MP4 with toast. If injection is refused, `RBE.loadHls` rejects and that path is taken.

### Coexistence with userscripts

- Extension `content.js` calls `bbClaim(site, false)` first and also sets `localStorage['bb-ext-<site>']='1'`. `claim.js` gets one rule: a userscript (per-site or combined) exits when `<html data-bb-by="ext">` is set **or** the `bb-ext-<site>` mark exists, so install order does not matter (same pattern as `bb-split-<site>`).
- If the extension is removed, the mark goes stale. Reuse the existing recovery: the userscript drops a stale mark if no copy claimed the page by `DOMContentLoaded`. The extension also clears marks on `runtime.onInstalled` for reason `update`/`install`, and on uninstall nothing runs, so the DOMContentLoaded rule is the safety net.
- Userscript builds stay for now as secondary (Violentmonkey users, browsers without extension install). Retire them with the existing "End of the transition" recipe in CLAUDE.md after 2 to 3 extension releases. `release.mjs` keeps working as is.

### Versioning

Extension version = `MAJOR.MINOR.PATCH` in a new `ext/manifest.base.json` (`name`, `version`, `description`, icons). Per-site part versions stay in their manifests and are printed in the build log and shown in the popup. Bump rule: any part change bumps the extension patch; storage or permission changes bump minor.

## 2. Per-site DNR bundle blocking

Rule: **block only while the site's Fast UI owns the page.** Tweak-in-place sites get no rules.

### X (already working, moves into the shared worker)

- Rules 1001-1003 stay: `||abs.twimg.com/responsive-web/client-web/` (script), `||api.x.com/live_pipeline/`, `||ingest.us.sentry.io/`, all with `initiatorDomains: ['x.com']`.
- Convert hardcoded `RULES` to a per-site table in `background.js`: `DNR = { x: {ids:[1001..1003], rules:[...]}, pinterest: {...} }`. Rule ID ranges: X 1000-1099, Pinterest 2000-2099, reserved Reddit 3000, Instagram 4000.
- State is per site in `storage.local` (`bb:block:x`), message types generalised from `xbb-ext-get/set` to `bb-ext-get/set` with a `site` field. Old `xbb-ext-*` kept as aliases for one release so the existing `bridge.js` and tests do not break.
- Auto-learn + escape hatch stay exactly as built: block only once `HomeTimeline` + auth are cached (`hasCachedHome`), un-block and reload once to learn when not, Native X button / `?xbb=native` / breaker trip all call `setBlock(false, {reload:true})`.
- Block state is **tab-scoped** where possible. Dynamic rules are global, so add `tabIds: [tabId]` to the rule condition (supported in Chrome 114+, Firefox 128+) so blocking X in one tab never breaks a second X tab that is in Native mode. Needs per-tab bookkeeping in the worker (`sessionStorage`-like `storage.session`).

### Pinterest Fast UI (future, P3)

Same three-part pattern as X:

1. **Learn**: tap `/resource/<Name>/get/` responses natively once (PIN already wraps `PIN.resource` with the required `x-pinterest-source-url` / `x-pinterest-pws-handler` headers). Cache the feed resource names + options + auth in `localStorage['pin-ops-v1']`.
2. **Block**: when the cache is complete and the route is Home or a board, the worker turns on `PIN` rules scoped with `initiatorDomains: ['www.pinterest.com']` (and the `*.pinterest.com` host): `||s.pinimg.com/webapp/*.js` (main bundles, `resourceTypes:['script']`) plus telemetry (`||widgets.pinterest.com/`, `/_/_/resource/`-independent logging endpoints found in a network capture). The exact list is **captured, not guessed**, in P3 with `read_network_requests`; do not commit a rule that was not seen.
3. **Escape hatch**: same Native button / `?pinbb=native` / breaker. A 200 with no pin list (schema guard) or three soft failures in 5 min un-blocks for the session.
4. Keep the viewer-only mode (today's `lightbox.js`) as the default; Fast UI is opt-in (`fastUi` default off), like X.

### Reddit and Instagram

- Zero DNR rules by default (tweak-in-place: we improve the live page, we never replace it).
- The worker's table is ready for a future opt-in `fastUi` toggle; an entry with `rules: []` and no learn step does nothing. Nothing is added until a Fast UI exists.

## 3. Storage, settings migration, toolbar

### Keys stay, source of truth stays

The extension content script shares the page origin's localStorage, so these keys keep working untouched, with **no code change to `bbStore`**:

| Site | localStorage key | Shape |
|---|---|---|
| Reddit | `rbe-userscript-storage` | `{sync:{settings:{..}}, local:{customCss}}` |
| Instagram | `igb-userscript-settings` | flat |
| X | `xbb-userscript-settings` | flat |
| Pinterest | `pin-userscript-settings` | flat |

Plus the per-site `*-settings-snapshot` keys used for first-paint theme. Same browser + same profile + site data not cleared = zero loss, nothing to migrate. Violentmonkey stores the **same page localStorage** (it never owned a copy), so uninstalling it does not touch the data.

### Mirror, so settings survive and travel

localStorage alone fails in two cases: cleared site data, and moving to another browser/profile (Chrome to Firefox). Add a small mirror in `chrome.storage.local`:

1. New `userscript/mirror.js` (extension build only): on load, read `localStorage[key]` and `storage.local['bb:settings:<site>']`.
   - localStorage has data, mirror empty/older: write mirror (`{v:1, ts, data}`).
   - localStorage empty, mirror present: restore localStorage from mirror, then proceed (this is the "site data cleared" recovery).
   - Both present and different: newest `ts` wins; `ts` is bumped by a wrapper around `bbStore`'s `change()` (one hook, `storage` event also bumps it).
2. Never overwrite a non-empty localStorage with an older mirror.
3. Mirror writes are debounced (500 ms) and size-capped (`storage.local` is 10 MB, settings are KB). `unlimitedStorage` is not requested.
4. Hub popup gets **Export / Import all settings** (one JSON file, 4 keys + `customCss`) for Chrome to Firefox moves. Import validates `v` and key names, writes the mirror, and tells open tabs to reload.

### First-run flow

`runtime.onInstalled(install)`: open nothing. On the first page of a covered site, if the page has a legacy key, show nothing either (it just works). If a userscript for that site is also running (`bb-split-<site>`/claim), the extension wins per section 1.

### Toolbar icon

- No `default_popup` on a covered site would need the action to be both a click and a popup, so use one rule: **`action.default_popup = popup.html`**, and the popup decides.
- On click the popup runs `tabs.query({active:true, currentWindow:true})` (needs `activeTab`, granted by the click, so `tabs` permission is not needed) and matches the URL against the four host patterns:
  - On a covered site: popup sends `{type:'bb-open-settings'}` to that tab, then `window.close()` (the settings panel opens in the page via the existing `<site>.openSettings` / `RBE.openSettingsInPage`). Panel stays the shared `userscript/panel.js` shadow root; nothing duplicated.
  - Anywhere else: popup stays open as a **tiny hub**, four rows (Reddit, Instagram, X, Pinterest), each: logo, "Open" (new tab to the site), status dot (enabled / Fast UI blocking on / part version), plus Export/Import. About 150 lines, no framework, system colours, 280 px wide.
- Firefox: `browser.action` is the same; `activeTab` works. Keep the existing in-page entry points (gear, Alt+W) unchanged.
- Generalise the `xbb-open-settings` listener from `bridge.js` into a shared `bb-open-settings` in each site's panel hook (`<site>.openSettings` is already the common name for 3 of the 4; Reddit uses `RBE.openSettingsInPage`, so the build maps `site -> opener`).

## 4. Dev workflow and cross-browser

### `npm run dev:ext`

Generalise `x/ext/dev-server.js` into `ext/dev-server.js`:

- Watch: `src/`, `instagram/src/`, `x/src/`, `pinterest/src/`, `userscript/`, `ext/`, the four manifests. Debounce 150 ms, rebuild `--dev` into `dist/better-browsing-ext/` (about 20 ms for the X part today; four sites should stay under 100 ms; verify).
- `GET /version` -> `{id}`; the worker polls (1.2 s + alarm fallback, as today) and on change reloads **only tabs on the four site hosts** and then `runtime.reload()`.
- `POST /log` -> `dist/bb-ext-dev.log`, one line each: `HH:MM:SS.mmm [level] [site] args (url)`. `[site]` is derived from the sender tab URL, so the log is greppable per site.
- Dev build flag `__BB_DEV__` replaces `__XBB_DEV__` (keep `__XBB_DEV__` as a sed alias until X files are updated). Dev manifest name "Better Browsing (Dev)", extra host `http://127.0.0.1:47910/*`, extra permission `alarms`.
- Scripts: `build:ext`, `dev:ext`, `test:ext`. `build:x:ext` and `dev:x:ext` stay as aliases for one release.
- Hygiene (from global rules): dev server is a long-lived node process, so stop it when the session ends; `dist/` stays gitignored; Chrome profile for tests goes in the scratchpad, not the repo.

### Chrome (primary)

- `chrome://extensions` -> Developer mode -> **Load unpacked** -> `dist/better-browsing-ext/`. Dev builds reload themselves; no manual "Reload" click.
- Service worker (`background.service_worker`), MV3 limits: it can sleep, so all state lives in `storage.local/session`, not module variables (already the case for `BLOCK_KEY`).

### Firefox (Firefox-ready from P1, verified in P3)

| Topic | Chrome | Firefox | Handling |
|---|---|---|---|
| Background | `service_worker` | MV3 uses `background.scripts` (event page); `service_worker` is ignored | Manifest lists **both** (`x/ext/build-ext.js` already does); Chrome ignores `scripts`, Firefox ignores `service_worker`. Worker code is event-driven, no `importScripts`. |
| `world: "MAIN"` | Chrome 111+ | Firefox **128+** | `strict_min_version: "128.0"`. `runMain` stays only in the userscript. |
| DNR | full | `declarativeNetRequest` supported; dynamic rules + `tabIds` need 128+ | Same code; test `tabIds` rules in P3. |
| API namespace | `chrome.*` (callbacks and promises) | `browser.*` (promises), `chrome.*` also works | Keep the existing `typeof browser !== 'undefined' ? browser : chrome`. |
| Host permissions | granted at install | **optional by default** in MV3: user must grant | Show a one-time "Allow on <site>" prompt in the hub popup (`permissions.request`); content scripts do not run until granted. Easy to miss, so surface it. |
| Gecko id | n/a | needs `browser_specific_settings.gecko.id` | `better-browsing@watdafawx`, `strict_min_version 128.0`. |
| Run | Load unpacked | `about:debugging` -> This Firefox -> Load Temporary Add-on (pick `manifest.json`); better: `npx web-ext run --source-dir dist/better-browsing-ext --firefox-profile <scratch> --keep-profile-changes` | `npm run dev:ext:ff` wraps `web-ext run`; the dev server is the same, `web-ext` also auto-reloads, so keep ours as the single reload source and pass `--no-reload`. |
| Video quirks | n/a | clicks on native video controls reach the page differently (see CLAUDE.md) | Unchanged: already handled in site code. |

Output is **one build, one manifest, both browsers**. A `--target=chrome|firefox` flag only drops the other browser's background key if a store rejects both (AMO accepts both today; Chrome Web Store warns but accepts).

## 5. Phased checklist

Each phase ends green on `npm run test:all` and leaves the userscripts shippable.

### P1: unify build + manifest for all four sites (about 1 day)

- [ ] Extract `SITES` and `siteCode` pieces from `build.js` into `build-lib.js`; `build.js` imports it (output byte-identical, check with `git diff --stat dist` before/after and `test:headers`).
- [ ] `ext/manifest.base.json`, `ext/build.js` emitting `dist/better-browsing-ext/` with all four sites (section 1).
- [ ] Generic `ext/background.js`: `DNR` table, `bb-ext-get/set`, `bb-inject`, `bb-open-settings`, dev poller; X rules moved over unchanged.
- [ ] Generic `ext/bridge.js` (rename `XBB.ext` use; keep `XBB.ext` for X code, alias only).
- [ ] `reddit/hls.js` split + lazy `bb-inject` stub; `build.js` keeps the inline version.
- [ ] `claim.js`: userscripts stand aside for `data-bb-by="ext"` / `bb-ext-<site>`; extend `test/double-install.mjs` (extension fake sets the attribute and mark; both orders).
- [ ] `npm run build:ext`, `dev:ext` (single server, `dist/bb-ext-dev.log`).
- [ ] Manual: load unpacked in Chrome; open all four sites logged in; settings still there (keys unchanged); X Fast UI blocking still toggles; Reddit video plays (hls.js injected on first video).
- [ ] Retire `x/ext` entry points to aliases; delete `dist/x-fast-ext` references.

### P2: toolbar popup + settings migration + smoke tests (about 1 day)

- [ ] `popup.html/js` hub + active-site detection + open-settings message.
- [ ] `userscript/mirror.js` (restore/backup, newest-wins) + Export/Import.
- [ ] Tests: `test/ext-smoke.mjs` using Playwright `chromium.launchPersistentContext(dir, {args:['--disable-extensions-except=…','--load-extension=…']})` (headed-less is unsupported for extensions: use `--headless=new` which does load them; fixtures served by the existing mock routes so **no live traffic**). Checks per site: content script claims `<html data-bb-by="ext">`; settings seeded in the legacy localStorage key appear in the panel; clear localStorage then reload and mirror restores it; hub popup page (`chrome-extension://<id>/popup.html`) lists four sites; X block toggle adds/removes rules via `declarativeNetRequest.getDynamicRules()`.
- [ ] Add `test:ext` to `test/all.mjs`.
- [ ] Docs: README "Install the extension" section, migration note ("keep Violentmonkey off for these sites or leave it: the extension takes over").

### P3: Firefox parity + Pinterest Fast UI (about 2 to 3 days, can split)

- [ ] Firefox: `web-ext lint`, load via `about:debugging`, run `test/ext-smoke.mjs` against Firefox (Playwright cannot load extensions in Firefox; use `web-ext run` + a Marionette/geckodriver check, as done for Violentmonkey in CLAUDE.md, or keep Firefox manual with a documented checklist). Host-permission prompt, `world:"MAIN"` on 128+, DNR `tabIds`.
- [ ] Pinterest Fast UI: capture the real bundle/telemetry URL list (network capture on a logged-in page, no automation against live Pinterest in tests), add `PIN` DNR table entries, learn/escape-hatch logic mirroring X, mock-based offline test (`test/pinterest-fast-offline.mjs`).
- [ ] Store prep: icons 16/32/48/128, privacy statement (no data leaves the browser; dev server only in dev), AMO source-zip note (build is deterministic from the repo).
- [ ] Decide userscript end-of-life: after 2 to 3 extension releases, apply the "End of the transition" steps in CLAUDE.md.

## 6. Risks and decisions to confirm

1. **Chrome Web Store / AMO review**: blocking a site's own JS (X, later Pinterest) is user-visible behaviour; describe it in the listing. Reddit/Instagram have no such rule.
2. **Host permissions in Firefox are opt-in**: first-run UX must prompt (handled in the hub); otherwise it looks like "nothing works".
3. **localStorage is per browser profile**: the mirror and Export/Import are the only cross-browser path. Do not move settings server-side.
4. **One bundle per site, no shared runtime between sites**: acceptable (4 isolated worlds), and it keeps each tab's cost proportional to its site.
5. `tabIds` scoped DNR rules need Chrome 114+/Firefox 128+; fallback if unsupported is a global rule plus the per-site "Native" reload, as X does today.
6. Naming: gecko id `better-browsing@watdafawx`. Do not reuse `better-browsing-x-fast@watdafawx` (that dev id was never published).

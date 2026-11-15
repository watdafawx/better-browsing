# Pinterest support: plan

Goal: the same treatment Reddit, Instagram and X get, on `https://*.pinterest.com/*`, inside the one userscript
(`dist/better-browsing.user.js`). This document is the plan and the list of unknowns; nothing here is built yet.

## What "the same improvements" means

Mapped from what the Reddit part does now (1.3.18):

| Reddit | Pinterest equivalent |
|---|---|
| Settings panel in the site (nav gear, Alt+W, Esc, shadow DOM) | gear in Pinterest's header + Alt+W, same `userscript/panel.js` and `popup/*` form |
| Video sound setting (volume %, muted, off) applied to the site's own players | pin video players: one `main-world.js` that patches `HTMLMediaElement` `play`/`muted`/`volume`/`autoplay` |
| Sound survives the player re-mounting; a refused start comes back on the next click | same logic (`setAudio`/`isMineAudio`/`tryPlay` from `video.js`), Pinterest re-renders players constantly |
| Pause videos scrolled out of view; pause when the tab/window is hidden | same, via one `IntersectionObserver` + `visibilitychange`/`blur` |
| Own image/video lightbox: click a feed image, wheel/arrows to step, filmstrip, text + comments panel | Pinterest's own close-up replaced by ours: click any pin in the grid, wheel/arrows through the grid, filmstrip, description panel; `Esc`/back closes |
| "Open original", "Open post", Discord embed link, download | "Open pin", copy link, download the image/video file, `Esc` behaviour |
| Pause the page's players behind our overlay | same, while the lightbox is open |
| Hiding promoted/suggested posts | hide promoted pins (`hidePromoted`) |
| Provider embeds keep their own player and are mounted only in view | pins that embed YouTube/Vimeo/redgifs keep the provider iframe; mount only in view, plus a reload button |
| Offline test suite per site, Chromium + Firefox | `test/pinterest-offline.mjs` sharing `test/lib/*` |

Not planned for v1: idea pins (multi-page stories) as a lightbox sequence, comments in the lightbox, board
management, shopping/Pins with product data beyond the image/video itself.

## What we know about Pinterest (verified by fetching pages)

- Logged out, `pinterest.com` is a marketing landing page: no feed, no pins. Everything interesting needs a
  logged-in session, so a real feed cannot be fetched from this machine (the anonymous `__PWS_DATA__` has no
  `initialReduxState`).
- The internal resource API exists and the web client uses it:
  `POST /resource/<NameResource>/<action>/?source_url=<path>&data=<json>` with `X-CSRFToken` (from the
  `csrftoken` cookie), `X-Requested-With: XMLHttpRequest`, `X-Pinterest-AppState: active`.
  Known names: `PinResource/get` (`v3_get_pin`, pin close-up), `BaseSearchResource/get` (`v3_search_pins`),
  `v3_home_feed` (requires auth), `RelatedPinFeedResource` (related pins). Paging uses `bookmarks`, and the
  envelope returns `resource_response.data` + `resource_response.bookmark`.
  Anonymous calls to it currently answer **403**, so it has to run from the page with the user's session.
- Pages carry a `__PWS_DATA__` JSON script (server state) — useful as a fallback, but the feed itself is
  client-rendered into a virtualised masonry grid.
- Images: `i.pinimg.com/<bucket>/<file>` with buckets such as `236x`, `474x`, `736x`, `originals` — the same
  file at several sizes, so "full resolution" is a bucket swap, not a new URL.
- Videos: `v1.pinimg.com/videos/...` (progressive `mp4`, and an HLS variant for some pins). A video pin carries
  `is_video: true` and a `videos.video_list` map of renditions (`V_720P`, `V_HLSV3_MOBILE`, …).
- Class names are hashed and change often, like Instagram's: select by `data-test-id`, `role`, structure and
  geometry, never by class name.

## Unknowns that need one logged-in session (milestone 0)

Do these first, with the real site open, and write down the answers in `pinterest/README.md`:

1. Feed: the element that is one pin (`data-test-id="pin"`? `role="listitem"`?), where the link to the pin lives,
   which attribute carries the full-size image (`src`/`srcset`, `data-test-id="pinrep-image"`?) and whether the
   grid is virtualised (pins removed when scrolled away) — that decides whether the lightbox steps through DOM
   entries or through API data.
2. Close-up: the container Pinterest opens when a pin is clicked, how it is detected, and how it is closed
   (`Esc`, `popstate`) so our overlay can replace it without fighting the router.
3. Video pin: the actual `<video>` markup (`src` vs `<source>`, muted/autoplay attributes, controls), which
   `video_list` key the page uses, and whether the progressive `mp4` really carries audio.
4. Which API call the page makes for a close-up (copy the request from the network tab) and the JSON it returns,
   so our data layer can ask for the same thing once per pin instead of scraping.
5. Whether the header has a stable slot for our gear (like Reddit's navy bar) and whether Alt+W is free.
6. Behaviour when logged out is irrelevant for us, but pages must not break if a session expires mid-browse.

## Architecture (follows the existing per-site shape)

New folder, same skeleton as `instagram/`:

```
pinterest/
  manifest.base.json          version + content_scripts list (main-world first, then content, then css)
  README.md                   features, how they work, the findings from milestone 0
  src/main-world.js           patches HTMLMediaElement in the page's world (sound/autoplay)
  src/content/defaults.js     PIN.DEFAULTS + PIN.mergeSettings/loadSettings
  src/content/core.js         settings, shared MutationObserver, h(), sanitize, fetch
  src/content/video.js        own players, offscreen pause, sound, provider embeds (lazy frames, reload)
  src/content/lightbox.js     our overlay (adapted from src/content/lightbox.js)
  src/content/hide.js         promoted/suggested pins, optional
  src/content/settings.js     header gear + Alt+W → PIN.openSettings
  src/content/content.css
  src/popup/{popup.html,popup.css,popup.js}
  src/icons/icon48.png
```

`build.js` gets one more `site({...})` and one more branch in the `sites` host switch:

```js
} else if (/(^|\.)pinterest\.com$/.test(host)) {${pinterest}
```

with

```js
const pinterest = site({
  srcDir: 'pinterest/src', manifest: 'pinterest/manifest.base.json', cssId: 'pin-css',
  api: `PIN.api = bbStore('pin-userscript-settings');`,        // flat, like Instagram and X
  panelJs: `PIN.openSettings = bbPanel({ cls: 'pin-root pin-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => PIN.mountSettings(root) });`
});
```

Header: add `// @match https://*.pinterest.com/*`, drop `@noframes` concerns (Pinterest embeds its own
`/pin/…/embed` frames — `@noframes` must stay), and put Pinterest in the description. No hls.js for Pinterest
unless milestone 0 shows HLS-only videos; the progressive `mp4` renditions should make that unnecessary, which
keeps the script from growing.

Version: the header becomes `reddit.instagram.x.pinterest.revision`, i.e. `1.3.18.1.6.10.1.0.4.1.0.0`;
`package.json`'s version is the Reddit part's, so add `pinterest/manifest.base.json`'s `version` to `build.js`'s
`ver()` list and to `README.md`'s release notes.

Data layer: `PIN.getPin(id)` through `PinResource/get` (cached per page, like `RBE.getPosts`), with the DOM as a
fallback — the same two-tier approach that saved us on Reddit when `/api/info.json` and `/by_id` started
answering 403. Requests go through `PIN.getJSON` built on `content.fetch` in a Firefox content realm.

## Milestones

0. **Recon (needs the logged-in site).** Answer the six unknowns above; save one feed page and one close-up as
   fixtures (HTML + the JSON the page fetched). Deliverable: `pinterest/README.md` "how it works" filled in.
1. **Skeleton.** Folder, manifest, `build.js` wiring, storage, empty content scripts, panel mounting, header and
   version. Test: the built script loads on a fixture page, `PIN` exists, settings read/write, panel opens with
   Alt+W and closes with Esc.
2. **Video.** `main-world.js` + `content/video.js`: sound setting applied to Pinterest's players, no autoplay
   fighting (patch `autoplay`/`play`/`muted`/`volume`), pause offscreen and when hidden, our own player for
   pins we open in the lightbox.
3. **Lightbox.** Adapted from Reddit's: click a grid pin → overlay with the full image or video, wheel/arrows
   through the grid, filmstrip, description + comments side panel, `Esc`/back, idea pins as a page sequence,
   provider embeds lazy-mounted + reload.
4. **Polish.** Hide promoted pins (default on), "Open pin"/copy-link/download actions, floating bottom-right
   settings button + Alt+W, `Esc` conflicts with Pinterest's own overlay/router, NSFW/sensitive-content handling.
5. **Tests + docs.** `test/pinterest-offline.mjs` on fixtures (feed grid, close-up JSON, a video pin, an embed
   pin) with the same PASS/FAIL output; add it to `test/all.mjs` for Chromium and Firefox; update
   `README.md`, `CLAUDE.md` (new "Pinterest" section) and the release notes.

## Risks

- **Virtualised feed**: if Pinterest removes off-screen pins from the DOM, stepping through the lightbox has to
  fetch by id and re-anchor, like Reddit's `moreFeed()` does with `scrollTo` behind the overlay.
- **Hashed classes**: every selector goes through `data-test-id`/`role`/structure; treat any class-based hook as a
  future breakage.
- **API drift**: the resource API is unofficial; `PinResource/get` and field names can change. Keep the DOM path
  working (that is where Reddit's `domItems` earns its keep).
- **Autoplay policies**: Pinterest's own player behaviour (muted autoplay, hover playback) varies by browser and
  by whether the pin is "story"-style. The `main-world` patch must not fight the site in a loop (the X bug that
  cost a day of CPU spikes).
- **Growth**: adding a fourth site grows the single script. Pinterest should not pull in hls.js; if it needs HLS,
  reuse `RBE_LOAD_HLS` lazily rather than shipping a second copy.

## Decisions (answered)

1. **Scope**: all of it — images, videos, idea pins as sequences, and comments in the lightbox.
2. **Downloads / Discord-style links**: build them if the API gives the file and a stable pin URL; if not, lightbox +
   sound is the acceptable floor.
3. **Hide promoted/suggested pins**: yes, on by default.
4. **Settings entry**: a floating button in the bottom-right corner (plus Alt+W), not the header. That also
   sidesteps the hashed, frequently re-laid-out header.

## Recon checklist (milestone 0, logged-in session)

Open the site, then note in `pinterest/README.md`:

- one grid pin: element, attrs (`data-test-id`, `role`, `data-grid-item`), the link, the full-size image URL;
- scroll far and back: are off-screen pins removed from the DOM? (virtualisation)
- a pin close-up: container, how it opens/closes, router interaction;
- the network calls: `PinResource/get` payload and response (`images`, `videos.video_list`, `story_pin_data`,
  comment counts), and the comments call behind the close-up;
- a video pin: `<video>` markup and attributes, which `video_list` key is used, and whether the progressive mp4
  decodes audio (`video.webkitAudioDecodedByteCount` after a second of playback, or `captureStream()` audio tracks);
- an idea pin: how pages/segments are addressed, and whether the API exposes them as a list;
- Alt+W availability inside Pinterest's own shortcuts, and where a fixed bottom-right button can live without
  being covered by their "Save" hover actions.

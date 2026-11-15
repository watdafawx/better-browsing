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

## What we know about Pinterest (from a real logged-in session, Nov 2026)

Full detail in `pinterest/README.md`. The short version, and what it changes here:

- Feed pins: `div[data-test-id="pin"]` with `data-test-pin-id`; link in `pinWrapper` (`a[href="/pin/<id>/"]`);
  image `pinrep-image`; idea pins `pincard-storyPin-without-link`. Hashed classes only, as guessed.
- **The grid is virtualised** (first pins left the DOM after scrolling, count grew 24 → 64). The lightbox keeps
  its own ordered list of ids and fetches by id; DOM entries cannot be the model.
- Data: `PinResource/get` with `field_set_key=auth_web_main_pin` plus `x-pinterest-source-url` and
  `x-pinterest-pws-handler` headers (without those two it answers "Invalid Request"), envelope
  `resource_response.data`. Works from the page with cookies, no extra token.
- Images: `pin.images` has `orig` (full), `1200x`, `736x`, … — pick `orig`, fall back down the list.
- Videos: `pin.videos.video_list.V_720P` is a progressive mp4 **with AAC audio** (ffprobe), plus `V_HLSV4` /
  `V_HLSV3_MOBILE`. The page plays them through MSE; we can use the mp4 directly, so **Pinterest needs no
  hls.js** and the script does not grow by 400 KB.
- `is_video` can be false on a video pin → detect video by `videos.video_list`.
- Idea pins: `story_pin_data.pages[]` (blocks, per-page video/image), rendered as
  `story-pin-page-drag-surface` / `story-pin-image-block`.
- Close-up is a navigation to `/pin/<id>/` with `closeup-*` elements; closing our overlay must return to the
  feed URL without fighting the router.
- Still unknown: the comment resource (sampled pins had no comments) and the promoted-pin marker.

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

0. **Recon — done.** Findings in `pinterest/README.md`. Two leftovers for implementation time: the comment
   resource (needs a pin that has comments) and the promoted-pin marker.
1. **Skeleton.** Folder, manifest, `build.js` wiring, storage, empty content scripts, panel mounting, header and
   version. Test: the built script loads on a fixture page, `PIN` exists, settings read/write, panel opens with
   Alt+W and closes with Esc.
2. **Video — done.** `main-world.js` owns the sound decision (`play`/`muted`/`volume`/`autoplay`), `video.js`
   publishes the setting, marks our players, pauses offscreen and when hidden, and retries a refused audible start.
   Pinterest's `V_720P` mp4 made hls.js unnecessary.
3. **Lightbox — done.** Our viewer over the grid with its own id list (virtualised grid), `images.orig` at full
   size, `story_pin_data.pages` as a page sequence, our own video player, side panel, zoom, filmstrip, Esc/back.
4. **Polish — done.** Promoted pins hidden (label match), sidebar/floating settings entries, Alt+W,
   open-on-Pinterest and copy-link actions, and comments in the side panel (`UnifiedCommentsResource`, first page,
   link to the rest). Downloads were left out.
5. **Tests + docs — done.** `test/pinterest-offline.mjs` on fixtures (grid, pin API, image/video/idea pins, a
   promoted card), in `test/all.mjs` for Chromium and Firefox; `README.md`, `CLAUDE.md` and this file updated.

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

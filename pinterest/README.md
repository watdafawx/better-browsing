# Pinterest Better Browsing

Part of the one userscript (`dist/better-browsing.user.js`). This file describes the features and then holds what
a real logged-in session showed, so nobody has to re-discover it.

## Features

- **Pin viewer** instead of Pinterest's close-up: click a pin in any grid. Wheel, arrows or the ‹ › buttons step
  through the loaded pins (the grid is virtualised, so it keeps its own id list and loads more by scrolling the
  page behind). An idea pin steps through its pages before moving on. Click the media to zoom.
  - Fast first paint: the grid's own thumbnail is shown while the pin's data loads, and the next pin is prefetched.
  - The stage uses a screen-sized rendition (`1200x`/`750x`/`736x`); the `originals`/`orig` file is fetched only
    when you zoom, instead of on every step.
  - The filmstrip is built once per entry list and only its `on` class changes per step.
- **Side panel** with the pin's title, description, author, saves and comment count, and the comments themselves
  (first page of them, from `UnifiedCommentsResource`), with a link to read the rest on Pinterest.
- **Video** at your volume (default 40%), muted, or no autoplay, using `video_list.V_720P`, the progressive mp4
  that carries AAC audio, in our own player. With no autoplay the viewer opens paused and a click on the picture
  starts it. Pinterest's own players follow the same setting, **except that feed/grid videos stay muted unless
  you turn on "Feed videos play with sound"** (off by default, the way Pinterest intends), pause when scrolled out
  of view and when the tab/window loses focus (`main-world.js` + `video.js`).
- **Promoted pins** hidden from the grid (and skipped by the viewer) when the setting is on.
- **Settings** in Pinterest's left sidebar (a clone of one of its nav items), an optional floating button, or
  <kbd>Alt</kbd>+<kbd>W</kbd>. Stored in `pin-userscript-settings` (flat, like Instagram and X).
- Idea pins, images and videos all open without leaving the page; Ctrl/⌘/middle-click still goes to Pinterest.

## Verified on a live session (Nov 2026)

**Feed (home and search).** Pins are `div[data-test-id="pin"]` with the pin id on `data-test-pin-id` (and
`data-pin-drag-id`, `data-test-pin-slot-index`). Inside: `[data-test-id="pinWrapper"]` wraps the link
`a[href="/pin/<id>/"]`; the image is `[data-test-id="pinrep-image"]`; cards are
`[data-test-id="pincard-image-with-link"]`, `pincard-image-without-link`, and idea pins
`pincard-storyPin-without-link`; the hover menu is `more-actions-button`. Class names are hashed
(`box_k`, `relative_K`, …) — never select on them.

**The grid is virtualised.** After scrolling, the first pins were gone from the DOM and the count grew (24 → 64).
So the lightbox cannot walk DOM entries: keep its own ordered list of pin ids, fetch each by id, and re-anchor
the feed by scrolling when it closes.

**Pin data.** `GET /resource/PinResource/get/?source_url=%2Fpin%2F<id>%2F&data=<json>` with
`options: { id, field_set_key: "auth_web_main_pin", noCache: true }`, and these headers (all required; without
the last two the API answers "Invalid Request"):

```
Accept: application/json, text/javascript, */*, q=0.01
X-Requested-With: XMLHttpRequest
X-Pinterest-AppState: active
x-pinterest-source-url: /pin/<id>/
x-pinterest-pws-handler: www/pin/[id].js
```

The envelope is `resource_response.data` (`status`, `code`, `bookmark` for paging). It works from the page with
cookies; no token beyond `csrftoken` in the cookie jar.

**Images.** `pin.images` is a map: `60x60`, `136x136`, `170x`, `236x`, `474x`, `564x`, `736x`, `600x315`,
`1200x`, `orig`. `orig` is the full resolution; the feed only loads `236x`/`474x` through `srcset`, and the
close-up shows `736x`. Use `orig` (fall back to `1200x`, `750x`, `736x`). Idea-pin pages and blocks name the full
size `originals` (plural) instead, so `imgOf` checks both.

**Videos.** `pin.videos.video_list`:

```
V_720P          https://v1.pinimg.com/videos/iht/expMp4/…_720w.mp4     ← progressive, h264 + aac (ffprobe)
V_HLSV4         …/videos/iht/hls/….m3u8
V_HLSV3_MOBILE  …/videos/iht/hls/….m3u8
```

The page itself plays through MSE (`<video data-test-id="web-video-player" src="blob:…">`, `muted` autoplay in
the feed). We do not need that: `V_720P` is a normal mp4 **with audio**, so our own `<video>` can play it (our
volume settings, our lightbox) without hls.js.

**`is_video` is not reliable**: a pin whose `videos.video_list` exists reported `is_video: false`. Detect video
by `pin.videos?.video_list?.V_720P` (or any `V_*` mp4).

**Idea pins.** `pin.story_pin_data.pages[]` with `page_count`; each page has `type`, `layout`, `blocks[]`
(`block_type` is a number, the image is `block.image.images`), plus `video` (nullable), `should_mute`,
`music_attributions`, `image`, `image_signature`. The close-up renders them as
`[data-test-id="story-pin-page-drag-surface"]` and `[data-test-id="story-pin-image-block"]`. So an idea pin is a
page sequence: iterate `pages`, use `video` when present, else `blocks[].image` / `image`.

**Close-up.** Opening a pin is a real navigation to `/pin/<id>/` (no modal on the feed page): the overlay uses
`[data-test-id^="closeup-"]` (image, actions, comments), plus "Save", "View larger", "Search image" and
"Add a comment to share your thoughts" in the DOM. Our lightbox replaces this view, so `Esc`/Back must not fight
the router: closing should return to the previous feed URL.

**Comments.** They hang off the pin's **aggregated** id, not the pin id: `GET /resource/UnifiedCommentsResource/get/`
with `options: { aggregated_pin_id: <pin.aggregated_pin_data.id>, comment_featured_ids: [], page_size: 10,
redux_normalize_feed: true, is_reversed: false }`, same headers. `resource_response.data` is an **array** of
`{ text, user: { username, full_name, image_medium_url }, created_at, is_edited, reaction_counts, id, … }`.
A pin's `comment_count` can be 0 while the resource still returns comments, so fetch it whenever the pin has an
aggregated id.

**Promoted pins.** No ad card appeared in the sampled feeds, so the marker is a text match on the card
("Promoted", "Sponsored" and a few languages) in `PIN.isPromoted`; `PinResource`'s `is_promotable` is unrelated.
Refine it with a real ad card.

## Settings

`bbStore('pin-userscript-settings')` (flat, like Instagram and X), panel through the shared
`userscript/panel.js`, opened by an entry in Pinterest's left nav (a clone of a `vertical-nav-icon` item, class
`.pin-nav-entry`), an optional floating bottom-right button, and Alt+W.

## Open questions

- **Performance**: if the page feels slow (reported on Zen/Firefox), set `localStorage['pin-perf'] = '1'`, reload,
  scroll for ~15s, then run `PIN.perf()`. It reports, per subscriber, how many times it ran and the total ms
  (`video-scan`, `video-interval`, `promoted`, `entry`) plus `longTasks`. `idle` and `churn` guards live in
  `test/pinterest-offline.mjs` (`test/lib/perf.mjs`), but they measure the page world; Violentmonkey's content
  realm adds Xray overhead the harness cannot reproduce, which is why the probe exists.
- Comments: only the first page (10) is fetched; the resource's envelope also carries a `bookmark` for paging if
  we ever want more than that in the panel.
- The promoted-pin marker is a label match in the card ("Promoted", "Sponsored", and a few languages). Refine it
  with a real ad card, and check whether Pinterest ever exposes it in the data instead.
- Whether the feed gives a stable hook for "this pin is now visible" (for prefetching the next pins).
- Alt+W availability inside Pinterest's own shortcuts.

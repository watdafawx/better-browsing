# Pinterest Better Browsing (planned)

Part of the one userscript (`dist/better-browsing.user.js`). This file holds what was learned from a real
logged-in session (milestone 0) so the implementation does not have to re-discover it.

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
close-up shows `736x`. Use `orig` (fall back to `736x`, then the largest key present).

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
(`block_type: "story_pin_image_block"`, `type`, `block_style`, `image`), plus `video` (nullable),
`should_mute`, `music_attributions`, `image`, `image_signature`. The close-up renders them as
`[data-test-id="story-pin-page-drag-surface"]` and `[data-test-id="story-pin-image-block"]`. So an idea pin is a
page sequence: iterate `pages`, use `video` when present, else `blocks[].image` / `image`.

**Close-up.** Opening a pin is a real navigation to `/pin/<id>/` (no modal on the feed page): the overlay uses
`[data-test-id^="closeup-"]` (image, actions, comments), plus "Save", "View larger", "Search image" and
"Add a comment to share your thoughts" in the DOM. Our lightbox replaces this view, so `Esc`/Back must not fight
the router: closing should return to the previous feed URL.

**Comments.** Not captured yet: the sampled pins had `comment_count: 0`, so no comment resource call was made.
The UI is there ("Add a comment…"), so the resource name has to be read off a pin that actually has comments
during milestone 2 (likely a `…CommentResource/get/`; confirm before coding).

**Promoted pins.** Not verified. `PinResource` exposes `is_promotable`; the feed card has its own ad markup.
Check both when implementing "hide promoted".

## Settings

`bbStore('pin-userscript-settings')` (flat, like Instagram and X), panel through the shared
`userscript/panel.js`, opened by a floating bottom-right button and Alt+W.

## Open questions

- Comment resource name and payload (needs a pin with comments).
- The promoted-pin marker (API field vs card markup).
- Whether the feed gives a stable hook for "this pin is now visible" (for prefetching the next pins).
- Alt+W availability inside Pinterest's own shortcuts.

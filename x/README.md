# X Better Browsing

The X part of Better Browsing, published as its own userscript, **Better Browsing for X** (`dist/better-browsing-x.user.js`; install: https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-x.user.js, see the main [README](../README.md#install)). `x/manifest.base.json` lists the scripts `build.js` puts into it, in load order, and holds this part's version. It replaces these older single-purpose scripts: *Native Media Controls with autoplay*, *X - Auto unmute videos*, *One Click Copy Link Button for Twitter(X)*, *Retweet in one click & Like+Retweet* and the video part of *X.com Heavy JS Optimizer+*.

## Features

- **Browser video controls on every tweet video** (seek bar, volume, fullscreen, speed, picture-in-picture). X's own overlay (play button, mute button) is invisible and click-through; clicks on the controls don't open the tweet. GIFs are left to X.
- **Pauses when you leave.** When the tab is hidden or the window loses focus, playing videos pause and nothing starts meanwhile; back again, the same rules pick the video that plays (optional).
- **One video plays at a time.** The video you start wins until it scrolls away; otherwise the one nearest the middle of the screen plays (among videos at least half in view; the current one keeps it until another is clearly more central). Pause a video yourself and it stays paused, and nothing else starts in its place while it is on screen, so a tweet with several videos (or a quote tweet with its own) no longer fights over which one plays. Scrolled out of view, videos pause (optional).
- **Sound on by default** at your volume (40% to start). Browsers only allow sound after a click or key press on the page; until then videos play muted and unmute on the first one. X mutes videos on its own; those page-made mutes are ignored. Volume you set with the controls carries to the next videos until the page reloads. Modes: play with sound, always muted, no autoplay, or hands off.
- **One-click retweet**: Retweet and Undo repost skip the menu. <kbd>Shift</kbd>+click shows it (for Quote).
- **Like + Retweet** button in the action bar; click again to undo both.
- **Copy link for Discord** (link icon in the action bar): copies `https://vxtwitter.com/<user>/status/<id>`, which Discord shows as an embed with the picture or a playable video. The domain is a setting (`vxtwitter.com`, `fxtwitter.com`, `fixupx.com`, `fixvx.com` suggested).
- **Lighter page**: removes backdrop blur effects.

Settings: the gear after the last link in X's left sidebar, or <kbd>Alt</kbd>+<kbd>W</kbd> on any x.com page. They live in the page's localStorage (`xbb-userscript-settings`).

Not carried over from the old optimizer script: timer and animation-frame throttling, blocking X's metrics requests, removing preloads, hiding old tweets in the feed. They change how X's own code runs and can break it; say so if one of them is worth having back.

## How it works

- `main-world.js` patches `HTMLMediaElement` (`play`, `muted`, `volume`, `autoplay`) so X's players follow your audio setting, and swallows X's own `play()` on every video except the pick (`data-xbb-pick`) when one-at-a-time or no-autoplay is on. Settings arrive in `<html data-xbb-video>`. A mute or volume change counts as yours only right after a click or key press on that video's own player (in Firefox, which does not show the page a click on a video's controls, the pointer resting on the player plus the page's user activation counts too; in Chrome that guess is off, or X's autoplay and mutes would be taken for yours whenever the mouse sat over a video). A mute that was yours is forgotten when X puts other media in the same `<video>` element, as the feed virtualises.
- `content/video.js` turns on `controls`, observes every video with one `IntersectionObserver`, and decides the pick on scroll, visibility and your clicks (no polling, no fighting with X's player). It tells your clicks from X's own play/pause calls by whether a click or key press just happened on that player. Overlay hiding is pure CSS (`videoComponent > :not(:has(video))`), so it survives X re-rendering.
- GIFs are looping videos from `/tweet_video/` in the same `videoPlayer`; they are skipped by that source path, or by `loop` being set when first seen.
- `content/tweet.js` finds tweets by `article[data-testid="tweet"]`, the `role="group"` action bar and the `like` / `unlike` / `retweet` / `unretweet` / `retweetConfirm` / `unretweetConfirm` test ids. A tweet's own link is the date link inside its article (a quoted tweet has none). One-click retweet hides X's menu (`html.xbb-rt`) while it clicks the confirm entry.
- `content/settings.js` clones a link in X's primary nav (Bookmarks if shown, else Explore) for the gear.

## Fast UI engine (opt-in, groundwork)

Milestone 1 of a faster X UI that reads X's own GraphQL data instead of its DOM. No visible feature yet; the `fastUi` setting (default off) only switches the passive tap on. `main-world-api.js` finds X's current GraphQL query IDs in its webpack chunks at run time (nothing is hardcoded), learns the session headers and live `{queryId, features, fieldToggles}` from X's own requests, and can run an operation for the content script. `content/api.js` is the client (`XBB.gql.call`, `onTap`, `getTapped`) with a per-operation circuit breaker that tells the UI to fall back to native X when X changes an operation. `content/model.js` turns the payloads into flat, defensively normalized records (`XBB.model.normalizeTweet`, `normalizeUser`, `extractTimeline`). Details and rules are in CLAUDE.md.

## Fast UI overlays (1.3.0)

With Fast UI on, nothing on Home navigates away any more:

- **Media lightbox**: a photo, a GIF or a video's expand button opens a full-window viewer: the photo at `name=large` (`orig` once zoomed), a video with its controls (the feed's videos pause behind it), Prev/Next, ←/→, the wheel, a "1 / 4" counter, ALT, click or +/− to zoom, F for fullscreen, and a bar with the author, the text and Like, Retweet, Like + Retweet, Bookmark, Copy link and Open thread.
- **Thread drawer**: a click on a post (its card, its time, Reply) opens it in a panel on the right (or centred, from the header): the post at once, then its ancestors above and its replies below. Replies and quotes open one level deeper, with Back. The URL becomes the post's, but Home stays under it at the exact scroll position. Before X has ever loaded a post page in this session, replies may say "Open on X once"; one visit teaches the operation.
- **Keyboard** (setting "Keyboard shortcuts"): `j`/`k` move, `o`/Enter open the thread, `m` the media, `l`/`t`/`b` like, retweet, bookmark, `c` copy the embed link, `/` search, `.` show new posts, Esc closes the lightbox, then the drawer, then the focus.

Back, Esc or a click beside an overlay closes one level.

## Fast UI views (1.4.0)

More of X now opens inside Fast UI, without leaving the page you were on:

- **Profiles** (`/<handle>`, Replies, Media): banner, avatar, name, bio, location, website, join date, following and followers, and Follow / Unfollow (instant; undone if X refuses). Author names and @handles open them.
- **Search** (the sidebar box, hashtags): a sticky search bar and Top / Latest / People / Media tabs; People shows account cards.
- **Bookmarks** (`/i/bookmarks`), with paging.
- **Notifications**: the bell opens a popout next to it (a sheet on narrow screens) with All and Mentions and the unread badge; a post opens in the thread drawer, a person opens their profile. Your scroll position never moves.
- **Messages**: the envelope opens a drawer with your inbox; a conversation shows its messages and a reply box (sent at once, taken back if X refuses). End-to-end encrypted conversations and calls open in X's own XChat (one click).

If X has not yet shown Fast UI how a page loads in this session, that page says "not learned yet" with an Open on X button; one visit teaches it. Home is never affected by that.

## Test

`npm run test:x` builds the userscripts and loads `dist/better-browsing-x.user.js` into plain Chromium against fixtures in `test/x-offline.mjs` (a small clip, `test/fixtures/clip.webm`, plays in them). It never contacts x.com. `npm run test:x:api` covers the Fast UI engine in the same way (fake webpack chunks, fake GraphQL backend, payload fixtures). `npm run test:x:fast`, `npm run test:x:overlay` and `npm run test:x:m4` cover the Fast UI shell, Home, the overlays and the profile, search, bookmarks, notifications and messages views on a mock x.com. What it can't cover: X's real markup, which changes; after changing selectors in `video.js`, `tweet.js` or `settings.js`, check by hand on x.com.

## Firefox

Tested in Firefox as well as Chromium (`BROWSER=firefox node test/x-offline.mjs`). Firefox does not show the page clicks on a video's own controls, and Chrome's native bar shows it nothing either, so a pause that no page `pause()` came before is taken as yours, a play from the bar as yours only when that video has the focus, and a mute or volume set on the bar as yours because it is neither our level nor a page write. Which video plays is measured from the video's position when it is needed (not from the observer's last report), and again while you scroll (at most every 150 ms), so the one nearest the middle plays right away.

# Better Browsing

One lightweight browser extension (and optional per-site userscripts) for **Reddit, Instagram, X, and Pinterest** — plain JavaScript, zero runtime dependencies, zero tracking.

- **Reddit:** read posts and comments without leaving the feed, softened dark image lightbox, lazy `hls.js` video sound/autoplay control, spoilers, NSFW, themes.
- **Instagram:** browser video controls with sound, softened dark lightbox with read-only comments, one-click downloads, Not Interested, Discord embed links.
- **X (Twitter):** opt-in **Fast UI** (virtualized Home/Profile/Search/Bookmarks, Thread Drawer, Media Lightbox, Notifications & DMs, inline post translation + auto-translate languages, profile hovercards, 22 Hopper themes + JSON import) plus Zero-JS blocking in the extension.
- **Pinterest:** opt-in **Fast UI** (virtualized masonry grid, Search/Profile/Boards, Save-to-Board, full-viewport zoom/wheel Lightbox with Info & Comments / More like this, data-level promoted pin dropping, 22 Hopper themes + JSON import) plus Zero-JS blocking in the extension.

<p align="center">

[![Add to Firefox (All 4 Sites)](https://img.shields.io/badge/Add%20to%20Firefox-All%204%20Sites%20(Extension)-FF7139?style=for-the-badge&logo=firefox&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/extension/better-browsing-latest-firefox.xpi)

<br>

[![Install Better Browsing for Reddit](https://img.shields.io/badge/Install-Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-reddit.user.js)
[![Install Better Browsing for Instagram](https://img.shields.io/badge/Install-Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-instagram.user.js)
[![Install Better Browsing for X](https://img.shields.io/badge/Install-X-000000?style=for-the-badge&logo=x&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-x.user.js)
[![Install Better Browsing for Pinterest](https://img.shields.io/badge/Install-Pinterest-BD081C?style=for-the-badge&logo=pinterest&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-pinterest.user.js)

</p>

- [Install](#install)
  - [Extension vs. Userscript limits](#extension-vs-userscript-limits)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Notes and limits](#notes-and-limits)
- [Development](#development)
- [License](#license)

## Install

### Firefox Extension (recommended on Firefox — all 4 sites, auto-updating)

1. Click **Add to Firefox** above and confirm the install prompt (signed via Mozilla AMO, self-hosted auto-updates via GitHub Releases).
2. Open `about:addons` → **Better Browsing** → **Permissions** tab and toggle site access **ON** (Firefox defaults MV3 host permissions off).

### Chrome / Chromium Extension (unpacked)

```bash
npm run build:ext
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/better-browsing-ext/`.

### Userscripts (Tampermonkey / Violentmonkey)

Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/), click the badge for each site you use above, and confirm **Install**. Each script auto-updates via a tiny `.meta.js` header check (~2 KB).

- Chrome users need userscripts enabled: `chrome://extensions` → manager **Details** → **Allow user scripts** (or Developer mode on older builds).
- **Coexistence:** if you install both the extension and a userscript, they never run twice on the same page — the extension automatically takes over, and the userscript resumes on its own if the extension is removed.

### Extension vs. Userscript limits

The extension and userscripts are built from the exact same source tree, but userscript managers cannot access two browser APIs that the MV3 extension uses:

| Capability | MV3 Extension | Userscripts |
|---|---|---|
| **Zero-JS mode on X & Pinterest Fast UI** | Uses `declarativeNetRequest` to block X's and Pinterest's heavy JS bundles (`abs.twimg.com`, `s.pinimg.com/webapp/`), eliminating background React/Relay main-thread freezes (0 ms scroll jank). | Cannot block page scripts — Fast UI hides X's/Pinterest's native app underneath `display: none`, so the native app still uses CPU/RAM in the background. |
| **Lazy `hls.js` on Reddit** | Injected on-demand (`scripting.executeScript`) only when a video plays (`reddit/content.js` is ~175 KB). | Inlined into the ~610 KB Reddit userscript bundle. |
| **Install & updates** | One install for all 4 sites; auto-updates on Firefox. | Separate install per site; auto-updates via Tampermonkey/Violentmonkey. |

| Site | Runs on | Settings | Details |
|---|---|---|---|
| **Reddit** | `*.reddit.com` (not `old.reddit.com`) | Top-bar gear, quick bar ⚙️ | [below](#reddit) |
| **Instagram** | `www.instagram.com` | Sidebar gear, or <kbd>Alt</kbd>+<kbd>W</kbd> | [instagram/README.md](instagram/README.md) |
| **X** | `x.com` | Sidebar gear, Fast UI rail, or <kbd>Alt</kbd>+<kbd>W</kbd> | [x/README.md](x/README.md) |
| **Pinterest** | `*.pinterest.com` | Left sidebar entry, Fast UI rail, or <kbd>Alt</kbd>+<kbd>W</kbd> | [pinterest/README.md](pinterest/README.md) |

Settings live in each site's `localStorage`, so switching between the extension and userscripts keeps all your settings intact.

## Features

### Shared across all 4 sites
- **Modern Settings UI:** 2-column grouped card modal with pill toggle switches, sticky header, and live theme syncing (follows your active Hopper theme on X and Pinterest Fast UI; soft dark slate on Reddit and Instagram).
- **Hopper Themes (X & Pinterest Fast UI):** 22 built-in themes (Lights Out, Dim, Light, Hopper Dark/Light, Rosé Pine, Tokyo Night, Catppuccin, Dracula, Nord, Gruvbox, Everforest, One Dark, Solarized, etc.), Follow System, and custom Zed/Hopper JSON theme import via the top-bar **Appearance** button.

### X (Twitter) — [x/README.md](x/README.md)
- **Fast UI (opt-in):** replaces X's heavy feed with a virtualized Shadow DOM timeline (**Home / For you / Following**, **Profiles**, **Search**, **Bookmarks**), **Thread Drawer** with hover prefetch (keeps your exact feed scroll position), native `<dialog>` **Media Lightbox**, **Notifications** popout, and **Messages** DM drawer.
- **Post translation:** inline in-place translation via X's own translation endpoint with **Show original** toggle, **Auto-translate languages** quick-toggle chips in Settings, and one-click **Always translate \<Language\>** right under any translated post.
- **Profile hovercards:** hover any avatar, display name, or `@mention` for an instant preview card (bio, follower/following counts, and optimistic Follow/Unfollow).
- **Zero-JS mode & escape hatch:** blocks X's JS bundles automatically in the extension once Home is learned; press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> or click **Native X** (or add `?xbb=native`) any time to drop straight back to native X.
- **Video & tweet QoL:** native video controls with volume memory, one-video-at-a-time, one-click retweet (`Shift`+click for Quote), Like + Retweet button, Discord embed link copy (`vxtwitter.com` / `fxtwitter.com` / `fixupx.com`).

### Pinterest — [pinterest/README.md](pinterest/README.md)
- **Fast UI (opt-in):** pre-computed virtualized masonry grid (≤50 DOM nodes even for 5,000+ pins), data-level promoted pin dropping, **Search** (All / Videos / Idea Pins), **Profile** (Boards / Pins), **Board** views, and **Save to board** picker with Create Board.
- **Full-viewport Lightbox:** 100% viewport stage, mouse wheel stepping between pins & Idea Pin pages, smooth zoom-to-cursor + drag-to-pan (1x–4x, loads full-res `orig`, zero scrollbars), progressive `V_720P` MP4 video with audio, and a collapsible `360px` side panel (`I` key) with **Info & Comments** and **More like this** tabs.
- **Zero-JS mode & escape hatch:** blocks Pinterest's webapp bundles in the extension; <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, **Native Pinterest**, or `?pin=native` switches back cleanly.

### Instagram — [instagram/README.md](instagram/README.md)
- **Soft dark Lightbox with comments:** opens grid/feed posts and carousels in a fast viewer with read-only comments (instant preview comments, rate-limit-safe lazy fetch, Load more, expandable replies), wheel/keyboard stepping, and zoom.
- **Video, downloads & feed:** native video controls with sound, Reels auto-scroll, one-click photo/video/story downloads (`Alt+S` / `D`), **Not interested** button with Undo, and Discord embed link copy (`oginstagram.com` / `vxinstagram.com`).

### Reddit
| Feature | What it does |
|---|---|
| **No page switching** | Open posts with comments in a **side panel**, **modal**, or **inline** in the feed. Threads collapse, "load more" works, comment sort switches live, and hovering a post prefetches its comments. |
| **Image viewer** | Softened dark fullscreen lightbox (`#14161c` / `#1a1d26`). Wheel steps through galleries and into next posts, click to zoom, drag to pan, `Ctrl`+wheel zoom, optional vertical strip mode, side text/comments panel, and filmstrip. |
| **Video** | Autoplay with sound at your volume, muted, or click-to-play; offscreen pause/resume; pauses when tab hides; lazy `hls.js` with audio + Reddit embed fallback (`⧉`). |
| **Spoilers & NSFW** | Auto-reveal spoilers (`Alt+S`), reveal-all button, and NSFW show/blur/hide (`Alt+N`). |
| **Looks & Quick bar** | 9 themes + custom accent, layout presets (cards, compact, wide feed, hide sidebars/ads), custom CSS, export/import settings, floating quick bar, and Discord embed link copy (`redditez.com` / `vxreddit.com`). |

## Keyboard shortcuts

| Where | Key | Action |
|---|---|---|
| Instagram / X / Pinterest | `Alt+W` | Open settings |
| Reddit (anywhere) | `Alt+N` / `Alt+V` / `Alt+S` | Cycle NSFW / video mode / toggle spoiler auto-reveal |
| Reddit viewer / lightbox | `J` / `K`, `C`, `T`, `Backspace`, `Esc` | Next/prev, comments, text panel, back, close |
| X Fast UI | `J` / `K`, `O`, `M`, `L` / `T` / `B` / `C`, `/`, `.`, `Esc` | Move focus, thread drawer, lightbox, like/RT/bookmark/copy, search, new posts, close |
| X / Pinterest Fast UI | `Alt+Shift+X` / `Alt+Shift+P` | Toggle between Fast UI and native site |
| Pinterest Fast UI | `/`, `J` / `K`, `Enter`/`O`, `S`, `Z`, `I`, `Esc` | Search, move focus, open viewer, save to board, zoom, toggle side panel, close |

## Notes and limits

- **Sound before the first click:** browsers block audible autoplay until you interact with the page. Videos start muted and unmute on your first click/key press (or immediately on Firefox if the site is on your autoplay allow list).
- **Old Reddit** (`old.reddit.com`) is not supported.
- **Reddit voting/replying** and **X posting/E2EE XChat** open on the native site via one-click escape buttons.

## Development

Requires Node 22+. Zero runtime dependencies (`playwright` is dev-only for offline tests).

```bash
npm install                               # only needed for tests
npm run build                             # userscripts + .meta.js in dist/
npm run build:ext                         # Chrome MV3 extension in dist/better-browsing-ext/
node ext/build.js --firefox               # Firefox MV3 extension (background.scripts + gecko)
npm run dev:ext                           # watch + rebuild + hot-reload Chrome extension + active tabs
npx playwright install chromium firefox   # once, for tests
npm run test:all                          # full offline suite in Chromium & Firefox
npm run test:ext                          # real Chromium MV3 extension smoke test
```

### Layout

```
ext/                  unified 4-site MV3 extension (build.js, background.js, bridges, popup, dev-server, release-firefox.mjs)
userscript/           shared code: storage (store.js), settings modal (panel.js), Hopper themes (themes.js), coexistence (claim.js)
src/                  Reddit (main-world.js, content/*, popup/*, vendor/hls.min.js)
instagram/            Instagram (main-world.js, content/*, popup/*)
x/                    X + X Fast UI (main-world-api.js, content/model.js, api.js, content/fast/*)
pinterest/            Pinterest + Pinterest Fast UI (main-world-api.js, content/fast/*)
build-lib.js          shared site registry & helpers used by build.js and ext/build.js
build.js              builds userscripts in dist/
release.mjs           npm run release:userscript (publishes userscripts to GitHub release `userscript`)
test/                 offline Playwright test suites (never send traffic to live sites)
```

See [CLAUDE.md](CLAUDE.md) for architecture details and invariants.

### Releasing

- **Firefox extension:** bump `version` in `ext/manifest.base.json`, commit, and run `npm run release:firefox` (or trigger the **Release Firefox Extension** GitHub Action). Signs unlisted on AMO via `web-ext`, generates `updates.json`, and uploads `.xpi` + `updates.json` to the `extension` GitHub release.
- **Userscripts:** bump the changed part's `version` (or `userscriptRevision` in `package.json`), commit, and run `npm run release:userscript`.

## License

MIT

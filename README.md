# Better Browsing

Userscripts for new Reddit, Instagram, X and Pinterest, for Chrome and Firefox with Tampermonkey or Violentmonkey.
One script per site, each updating itself. On Reddit: read posts and comments without leaving the feed, browse
images in a proper viewer, and control video autoplay, spoilers, NSFW and themes. On the others: browser video
controls with sound at your volume, a fast viewer, and small fixes to each site.

<p align="center">

[![Install Better Browsing for Reddit](https://img.shields.io/badge/Install-Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-reddit.user.js)
[![Install Better Browsing for Instagram](https://img.shields.io/badge/Install-Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-instagram.user.js)
[![Install Better Browsing for X](https://img.shields.io/badge/Install-X-000000?style=for-the-badge&logo=x&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-x.user.js)
[![Install Better Browsing for Pinterest](https://img.shields.io/badge/Install-Pinterest-BD081C?style=for-the-badge&logo=pinterest&logoColor=white)](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-pinterest.user.js)

</p>

- [Install](#install)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Notes and limits](#notes-and-limits)
- [Development](#development)
- [License](#license)

## Install

Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/), click
the button for each site you use above, and confirm **Install**. The manager checks for updates by itself: each
script has a small `.meta.js` file (about 2 KB) it reads for the version, and it downloads the script only when a
new one is out.

| Script | Runs on | What it does | Settings |
|---|---|---|---|
| [Better Browsing for Reddit](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-reddit.user.js) | www.reddit.com and other subdomains, not old.reddit.com | Post viewer, image viewer, video, spoilers, NSFW, themes ([features](#features)) | Gear in Reddit's top bar, or the quick bar's ⚙️ |
| [Better Browsing for Instagram](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-instagram.user.js) | www.instagram.com | Browser video controls, sound on, lightbox, downloads ([instagram/README.md](instagram/README.md)) | Sidebar gear, or <kbd>Alt</kbd>+<kbd>W</kbd> |
| [Better Browsing for X](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-x.user.js) | x.com | Browser video controls, one video at a time, sound on, one-click retweet, Like + Retweet, copy link for Discord ([x/README.md](x/README.md)) | Sidebar gear, or <kbd>Alt</kbd>+<kbd>W</kbd> |
| [Better Browsing for Pinterest](https://github.com/watdafawx/better-browsing/releases/download/userscript/better-browsing-pinterest.user.js) | pinterest.com and its subdomains | Pin viewer, video sound, offscreen pause, promoted pins hidden ([pinterest/README.md](pinterest/README.md)) | Left sidebar entry, or <kbd>Alt</kbd>+<kbd>W</kbd> |

- Settings are kept in each site's localStorage, so they don't sync between browsers. They stay where they are
  when you switch scripts.
- Chrome needs userscripts allowed: on `chrome://extensions`, open the manager's **Details** and turn on
  **Allow user scripts** (or Developer mode on older versions).
- If you still have one of the old Reddit or Instagram Better Browsing extensions installed, remove it: the script
  and the extension would both control the same videos. The X script replaces the older single-purpose X scripts
  listed in [x/README.md](x/README.md).

### Coming from the combined script

Until now there was one script for all four sites, **Better Browsing (Reddit + Instagram)**. It still works and
still updates for a few more releases, so nothing breaks if you do nothing yet. The repo was renamed from
`reddit-better-browsing` to `better-browsing`; GitHub redirects the old address, so the copy you have keeps
finding its updates.

1. Install the per-site scripts you want from the buttons above.
2. Reload each site once. On the first load the combined script may still be the one running; from the next
   load the per-site script takes over, and the combined one stands aside on that site. The two never run at
   the same time.
3. Once you have every site you use, remove **Better Browsing (Reddit + Instagram)** from the manager's dashboard.

On Instagram, X and Pinterest the combined script shows a one-time note pointing at that site's own script. If
you remove a per-site script later, the combined one (if still installed) picks that site up again after one load.

## Features

These are the Reddit script's. Instagram, X and Pinterest have theirs in [instagram/README.md](instagram/README.md), [x/README.md](x/README.md) and [pinterest/README.md](pinterest/README.md).

| Feature | What it does |
|---|---|
| **No page switching** | Clicking a post opens it with its comments in a **side panel**, a **modal**, or **inline** in the feed (pick in settings). Threads collapse, "load more" works, you can change the comment sort, and post links inside the viewer open in the viewer too (← goes back). Ctrl/⌘/middle-click still opens a new tab. |
| **Fast opening** | When the pointer rests on a post, its comments start loading in the background, so the viewer usually opens instantly. |
| **Image viewer** | Replaces Reddit's fullscreen viewer. The mouse wheel goes to the next or previous image, and past the last image of a gallery it continues into the next posts (optional). Click the image to zoom, drag to pan, `Ctrl`+wheel to zoom. A "vertical strip" style is available if you'd rather scroll. |
| **Video** | Autoplay with sound at X% (default 10%), autoplay muted, or no autoplay. Can pause videos scrolled out of view, keep them from starting before they scroll in (and play them when you scroll to them), and when the tab is hidden or the window loses focus. The viewer and lightbox use the browser's video controls (seek bar, volume, fullscreen); turn that off to play and pause with a click instead. |
| **Spoilers** | Auto-reveal all spoilers, or reveal everything on the page once. |
| **NSFW** | Reddit default, show, blur or hide. |
| **Looks** | 9 themes plus an accent color, layout presets (card posts, compact, wide feed, hide sidebars, hide ads/awards, max media height, square corners) and custom CSS. Settings can be imported and exported. |
| **Quick bar** | A small floating bar at the bottom left with NSFW, video and spoiler toggles and a settings button. It can be turned off. |
| **Copy for Discord** | 🔗 in the viewer, lightbox and under each opened post copies the post link on an embed-fixer domain (`redditez.com` by default, a setting), so Discord shows the picture or a playable video. If previews stop showing, try another embed-fixer domain. |

## Keyboard shortcuts

| Where | Key | Action |
|---|---|---|
| Anywhere | `Alt+N` | Cycle NSFW mode |
| Anywhere | `Alt+V` | Cycle video mode |
| Anywhere | `Alt+S` | Toggle spoiler auto-reveal |
| Post viewer | `J` / `K` | Next / previous post |
| Post viewer | `Backspace` | Back (after following a link inside the viewer) |
| Post viewer | `Esc` or browser **Back** | Close |
| Image viewer | Wheel, arrows, `Space`, `J` / `K` | Next / previous image |
| Image viewer | `C` or `Enter` | Open post with comments |
| Image viewer | `T` | Show / hide the post text panel |
| Image viewer | `Esc` | Close |

## Notes and limits

- **Sound before the first click**: browsers block audible autoplay until you've interacted with the page. Until then videos start muted, then unmute to your chosen volume on your first click or key press.
- **Voting and replying** aren't built into the viewer yet. Use "Reply on Reddit ↗" or "Open on Reddit".
- **Old Reddit** (old.reddit.com) is not supported.
- Reddit changes its page markup often. The viewer and image viewer load content from Reddit's JSON API, so they hold up well. Themes and layout presets depend on Reddit's CSS names and may need updating; use Custom CSS for quick fixes.

## Development

Requires Node 22 or newer. There are no runtime dependencies; Playwright is only used by the tests.

```bash
npm install          # only needed for the tests
npm run build        # dist/better-browsing-<site>.user.js + .meta.js per site, and the combined dist/better-browsing.user.js
npx playwright install chromium firefox   # once, for the tests
npm run test:all -- --site=reddit  # one site, both browsers, combined bundle + shared checks
npm test             # offline smoke test of the Reddit script (also test:instagram, test:x, test:pinterest,
                     # test:headers, test:double, and test:all for everything in both browsers)
```

To try changes, install the site's `dist/better-browsing-<site>.user.js` in your userscript manager (drag the file onto its dashboard, or open it from a local web server). Edit the source files only; `dist/` is generated.

### Layout

```
src/                  the Reddit part
  main-world.js       runs in the page's own JS world to control Reddit's video players
  content/            the Reddit scripts, loaded in this order:
    defaults.js         default settings, themes, settings loader
    core.js             settings + change events, shared DOM observer, fetch, HTML sanitizer, avatars
    media.js            post data cache, batched post fetching, media extraction from post JSON
    theme.js            themes, layout presets, spoiler/NSFW CSS, custom CSS
    video.js            autoplay/volume, offscreen pause, our own video players (hls.js)
    spoilers.js         spoiler and blur auto-reveal
    lightbox.js         image viewer (step and strip styles)
    viewer.js           post + comments viewer (side / modal / inline), thread cache + prefetch
    quickbar.js         floating quick bar, hotkey actions
    navgear.js          settings gear in Reddit's header
    main.js             click interception and global hotkeys
    content.css         styles for everything above
  popup/              the settings form shown in the settings panel
  vendor/hls.min.js   hls.js, run only when one of our players needs it
manifest.base.json    the Reddit part's script list (load order) and version
userscript/           shared by every script: settings storage, settings panel, page-world runner, the
                      one-copy-per-page claim, icon
build.js              builds dist/ (no dependencies): one bundle per site plus the combined one
release.mjs           npm run release:userscript: checks, then uploads dist/ to the `userscript` release
test/                 Playwright smoke tests against fixture pages, never hit the live sites
instagram/, x/, pinterest/   the Instagram, X and Pinterest parts, same shape as src/
```

See [CLAUDE.md](CLAUDE.md) for how the pieces fit together and the rules to keep when changing them.

### Releasing

1. Bump `version` in the part you changed (`manifest.base.json` and `package.json` for Reddit,
   `instagram/manifest.base.json`, `x/manifest.base.json`, `pinterest/manifest.base.json`), or the bundle's
   `userscriptRevision` in `package.json` for a change to the script alone. Commit.
2. `npm run release:userscript` (or `npm run release:userscript -- --site=reddit` for a Reddit-only change; use full suite for shared changes). It refuses (and says why) on a dirty tree, a failing `npm run test:all`, or a
   script whose version is not above the published one while its content changed; then it uploads each changed
   `.user.js` and its `.meta.js` to the fixed `userscript` release that installed scripts check.

## Instagram, X and Pinterest

`instagram/` holds the Instagram part: browser video controls on every video, sound on by default at your volume, and a fast lightbox. See [instagram/README.md](instagram/README.md). `x/` holds the X part: [x/README.md](x/README.md).

`pinterest/` holds the Pinterest part: a pin viewer over the grid (wheel/arrows through the loaded pins, idea pins as page sequences, click to zoom, description side panel), video sound at your volume with the browser's controls, offscreen and hidden-tab pause, promoted pins hidden, and the settings in Pinterest's left sidebar or <kbd>Alt</kbd>+<kbd>W</kbd>. See [pinterest/README.md](pinterest/README.md).

`npm run build` builds each into its own script, and all four into the combined one.

## License

[MIT](LICENSE). hls.js is bundled under its own license (`src/vendor/hls.LICENSE`).

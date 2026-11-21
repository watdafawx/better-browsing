/* Video autoplay / volume control (isolated world side) */
(() => {
  let lastGesture = 0, lastTarget = null;
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
  }, true));
  const gesture = () => Date.now() - lastGesture < 1200;

  // Tab hidden or window unfocused: pause everything that plays, and let nothing start meanwhile
  const known = new Set();         // every <video> guard() has seen, including those inside players' shadow roots
  let blurred = false;
  const away = () => !!RBE.settings.videoPauseOnHide && (document.hidden || blurred);
  const pauseAway = () => {
    if (!away()) return;
    for (const v of known) { if (!v.isConnected) known.delete(v); else if (!v.paused && document.pictureInPictureElement !== v) v.pause(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAway(); });
  addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) { blurred = true; pauseAway(); } }));
  addEventListener('focus', () => { blurred = false; });

  // A click/key on THIS video's player in the last moment: the video, its own container a level or two up, or
  // anything in the same shadow root. Never as far up as <body>, or every earlier click would count for every
  // video. Comparing root nodes alone would call any earlier click on the page a gesture on this video.
  const userOn = v => {
    if (!gesture() || !lastTarget) return false;      // long after any click: the page's doing, not the user's
    if (lastTarget === v) return true;
    const root = v.getRootNode();
    if (root !== document) return lastTarget.getRootNode?.() === root;
    let p = v;
    for (let i = 0; i < 2 && p; i++, p = p.parentElement) {
      if (!p || p === document.body || p === document.documentElement) break;
      if (p.contains(lastTarget)) return true;
    }
    return false;
  };

  // Wholly outside the viewport (the observer's "not intersecting"). Until the observer has reported on a video
  // its rect decides: our own players are started before they are inserted, and a play()/'playing' can come
  // before the first report. Not laid out yet (detached, no size): unknown, so not "outside".
  const rectOf = v => {
    // A just-inserted player often has no size yet: judge it by the nearest ancestor that has one (through shadow hosts).
    for (let n = v, i = 0; n && i < 12; i++) {
      const r = n.getBoundingClientRect();
      if (r.width && r.height) return r;
      n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
    }
    return null;
  };
  const outside = v => {
    if (!v.isConnected) return false;
    const r = rectOf(v);
    if (!r) return false;
    return r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth;
  };
  const outOfView = v => v._rbeInView === false || (v._rbeInView === undefined && outside(v));

  const seen = new WeakSet();
  const io = new IntersectionObserver(entries => {
    const s = RBE.settings;
    for (const e of entries) {
      const v = e.target;
      v._rbeInView = e.isIntersecting;
      if (v.dataset.rbeOwn) {
        if (e.isIntersecting) v._rbeSeen = true;
        else if (!v._rbeSeen && !v.paused) { v.pause(); delete v.dataset.rbeStarted; continue; }   // started before we knew it is out of view
        // our own video that wanted to autoplay but was out of view (lightbox strip, long viewer): start it now
        if (e.isIntersecting && v.dataset.rbeWantPlay && !v.dataset.rbeStarted && !away()) { tryPlay(v); continue; }
      }
      if (!e.isIntersecting) {
        // Playing as it leaves counts as playing even when we missed its 'playing' (an autoplay attribute that
        // fired before our scan found the player): the page meant it to play, so it comes back on entry.
        if (!v.paused && !v.dataset.rbeUserPaused) v._rbePlaying = true;
        if (s.videoPauseOffscreen && !v.paused) v.pause();
        // The site usually pauses feed videos itself as they leave. Remember that it was playing, so it can
        // come back when it returns — unless the user paused it on purpose.
        if (s.videoPauseOffscreen && v._rbePlaying && !v.dataset.rbeUserPaused) v.dataset.rbePausedOffscreen = '1';
        else delete v.dataset.rbePausedOffscreen;
      } else if (e.isIntersecting && v.dataset.rbePausedOffscreen && s.videoMode !== 'off' && !away()) {
        delete v.dataset.rbePausedOffscreen;
        v._rbePlaying = true;
        v.play().catch(() => {});
      }
    }
  }, { threshold: 0.15 });

  function guard(v) {
    if (seen.has(v)) return;
    seen.add(v);
    known.add(v);
    io.observe(v);
    // Playing again (the user pressed play, or the page restarted it) ends an earlier user pause: a mark left
    // behind would stop it from ever coming back after it scrolls away and returns.
    v.addEventListener('playing', () => { v._rbePlaying = true; if (v.dataset.rbeUserPaused) delete v.dataset.rbeUserPaused; });
    // A pause right after a click/key on that player is the user's: never undo it later.
    v.addEventListener('pause', () => {
      if (userOn(v)) {
        v._rbePlaying = false;
        v.dataset.rbeUserPaused = '1';
      }
    });
    v.addEventListener('play', () => {
      const s = RBE.settings;
      if (away() && !gesture()) { v.pause(); return; }
      // Started while wholly out of view (an autoplay attribute once the source arrives, a player that restarts
      // after buffering or a re-mount, hls.js once its stream is ready): pause it and let it start when it comes
      // in. The observer only acts when a video crosses the edge, so without this it would play out of sight.
      // main-world.js already holds back play() calls like these; this catches starts that never call play().
      if (s.videoPauseOffscreen && outOfView(v) && !userOn(v) && document.pictureInPictureElement !== v) {
        v.pause();
        v.dataset.rbePausedOffscreen = '1';
        return;
      }
      // Reddit's players stay paused behind our lightbox. main-world.js's capture 'play' listener never sees a
      // start inside a shadow root (media events do not leave it), so an autoplay player there needs this.
      if (document.documentElement.hasAttribute('data-rbe-lb') && !v.dataset.rbeOwn && !v.closest('.rbe-root')) { v.pause(); return; }
      if (s.videoMode === 'off' && !gesture() && !v.dataset.rbeAllowed) v.pause();
      if (gesture()) v.dataset.rbeAllowed = '1';
    });
  }

  // Walk into (open) shadow roots of Reddit's player components to find <video>s.
  function scan(root, depth = 0) {
    if (!root || depth > 4) return;
    root.querySelectorAll('video').forEach(guard);
    root.querySelectorAll('iframe').forEach(guardFeedFrame);
    if (root === document) for (const f of frameSrc.keys()) if (!f.isConnected) forgetFrame(f);
    root.querySelectorAll('shreddit-player, shreddit-player-2, shreddit-media-player, media-player, shreddit-async-loader, shreddit-embed').forEach(h => h.shadowRoot && scan(h.shadowRoot, depth + 1));
  }

  function publish(s) {
    // `off`: videoPauseOffscreen, for main-world.js's hold on play() calls made out of view
    document.documentElement.dataset.rbeVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0, off: !!s.videoPauseOffscreen });
  }
  RBE.onSettings(publish);

  RBE.onDomChange(() => scan(document), 300);
  // safety net for players that swap videos inside shadow roots (no light-DOM mutation); skip in background tabs
  setInterval(() => { if (!document.hidden) scan(document); }, 3000);

  // Our own audio writes on our own videos must never be taken for the user's choice: that would stop the
  // unmute-on-click below and leave a video silent for good.
  const mine = new WeakMap();          // video -> [muted, volume] we last left it at
  const noteAudio = v => mine.set(v, [v.muted, v.volume]);
  const isMineAudio = v => { const m = mine.get(v); return !!m && m[0] === v.muted && Math.abs(m[1] - v.volume) < 0.01; };
  const setAudio = (v, { muted = v.muted, volume = v.volume } = {}) => {
    if (volume !== v.volume) v.volume = volume;
    if (muted !== v.muted) v.muted = muted;
    noteAudio(v);
  };

  // Cross-origin players cannot be paused from Reddit: unload them outside the viewport.
  const frameSrc = new Map(), frameVisible = new WeakMap(), feedFrames = new WeakSet(), frameObservers = new WeakMap();
  function syncFrame(f) {
    const src = frameSrc.get(f);
    if (!src) return;
    const feed = feedFrames.has(f);
    const visible = !frameIO || (feed && !RBE.settings.videoPauseOffscreen) || frameVisible.get(f);
    const behindLightbox = document.documentElement.hasAttribute('data-rbe-lb') && !f.closest('.rbe-lb');
    const wanted = visible && !behindLightbox ? src : 'about:blank';
    const current = f.getAttribute('src') || '';
    if (current !== wanted && (current || wanted !== 'about:blank')) f.src = wanted;
  }
  const frameIO = typeof IntersectionObserver === 'function' && new IntersectionObserver(entries => {
    for (const e of entries) { frameVisible.set(e.target, e.isIntersecting); syncFrame(e.target); }
  }, { threshold: 0.15 });
  function forgetFrame(f) {
    frameIO?.unobserve(f);
    frameObservers.get(f)?.disconnect();
    frameObservers.delete(f); frameSrc.delete(f); frameVisible.delete(f); feedFrames.delete(f);
  }
  RBE.lazyFrame = function (frame, src = '') {
    if (!src) return frame;
    frameSrc.set(frame, src);
    if (frameIO) frameIO.observe(frame); else frame.src = src;
    return frame;
  };
  function isRedgifsUrl(raw) {
    try {
      const u = new URL(raw);
      if (/(^|\.)redgifs\.com$/i.test(u.hostname) && /^\/(?:ifr|watch)\//i.test(u.pathname)) return true;
      if (/(^|\.)embedly\.com$/i.test(u.hostname)) {
        for (const k of ['src', 'url']) {
          const inner = u.searchParams.get(k);
          if (inner && isRedgifsUrl(inner)) return true;
        }
      }
    } catch {}
    return false;
  }
  function redgifsFrame(f) {
    return isRedgifsUrl(f.src);
  }
  function guardFeedFrame(f) {
    if (frameSrc.has(f) || !redgifsFrame(f)) return;
    feedFrames.add(f);
    RBE.lazyFrame(f, f.src);
    // Reddit can restore src without inserting a new node. Keep that from restarting hidden audio.
    const observer = new MutationObserver(() => {
      if (f.getAttribute('src') !== 'about:blank') {
        if (!redgifsFrame(f)) { forgetFrame(f); return; }
        frameSrc.set(f, f.src);
      }
      syncFrame(f);
    });
    frameObservers.set(f, observer);
    observer.observe(f, { attributes: true, attributeFilter: ['src'] });
    syncFrame(f);
  }
  RBE.onSettings(() => { scan(document); for (const f of frameSrc.keys()) syncFrame(f); });
  new MutationObserver(() => { for (const f of frameSrc.keys()) syncFrame(f); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-rbe-lb'] });
  // Reload a provider player: their API is flaky (the same call answers 401, then 200), so a fresh frame often
  // brings the video back without closing the lightbox.
  RBE.reloadFrame = function (f) {
    const src = frameSrc.get(f) || f.getAttribute('src') || '';
    const nf = f.cloneNode(false);
    nf.removeAttribute('src');
    f.replaceWith(nf);
    if (src) RBE.lazyFrame(nf, src);
    return nf;
  };

  // play() that only falls back to muted when the browser really blocked audible autoplay.
  // Any other rejection (AbortError when hls.js swaps in its MediaSource while play() is pending,
  // NotSupportedError before a source exists) is not a sound problem; muting there silenced
  // Reddit videos in the lightbox/viewer even though the stream has audio.
  function tryPlay(v) {
    return v.play().catch(err => {
      if (err && err.name === 'NotAllowedError' && !v.muted) {
        // Firefox refuses sound when play() comes after the click's activation ran out (hls.js still loading).
        // Start muted, and give the sound back on the next click or key press.
        setAudio(v, { muted: true });
        const back = () => {
          ['pointerdown', 'keydown'].forEach(t => removeEventListener(t, back, true));
          if (v.isConnected && v.muted && !v.dataset.rbeUserAudio) setAudio(v, { muted: !(+RBE.settings.videoVolume) || RBE.settings.videoMode === 'muted' });
        };
        ['pointerdown', 'keydown'].forEach(t => addEventListener(t, back, true));
        return v.play().catch(() => {});
      }
    });
  }

  // Browser controls on our own videos, or none: then a click plays/pauses (and does not reach the page behind)
  function ownControls(v) {
    const on = RBE.settings.nativeControls !== false;
    v.controls = on;
    if (!v._rbeToggle) {
      v._rbeToggle = e => { if (v.controls) return; e.preventDefault(); e.stopPropagation(); if (v.paused) tryPlay(v); else v.pause(); };
      v.addEventListener('click', v._rbeToggle);
    }
  }
  RBE.onSettings(() => document.querySelectorAll('video[data-rbe-own]').forEach(ownControls));

  // For videos we create ourselves (viewer / lightbox)
  RBE.setupOwnVideo = function (v, { autoplay = true } = {}) {
    const s = RBE.settings;
    v.playsInline = true;
    v.loop = !!s.videoLoop;
    v.dataset.rbeOwn = '1';
    ownControls(v);
    const vol = Math.max(0, Math.min(1, (+s.videoVolume || 0) / 100));
    if (s.videoMode === 'muted') setAudio(v, { muted: true });
    else if (s.videoMode === 'volume' || s.videoMode === 'off') setAudio(v, { muted: vol === 0, volume: vol });
    const wantsPlay = autoplay && s.videoMode !== 'off';
    v.addEventListener('volumechange', () => { if (!isMineAudio(v) && gesture()) v.dataset.rbeUserAudio = '1'; });
    if (wantsPlay) {
      v.dataset.rbeWantPlay = '1'; // hls.js retries play once the stream is ready
      // Out of view (strip neighbours, lower in the viewer): don't start; the observer starts it when it shows.
      // outOfView, not just the observer's verdict: the first 'playing' can come before its first report.
      v.addEventListener('play', () => { if (outOfView(v) && !gesture()) v.pause(); });
      v.addEventListener('playing', () => { if (outOfView(v) && !v._rbeSeen) v.pause(); else v.dataset.rbeStarted = '1'; });
      tryPlay(v);   // now, inside the click, so the browser lets it play with sound later
    }
    io.observe(v);
  };

  // hls.js (~400 KB) runs on first use: build.js wraps it in the function RBE_LOAD_HLS.
  let hlsLoad = null;
  RBE.loadHls = () => {
    if (globalThis.Hls) return Promise.resolve(true);
    return hlsLoad || (hlsLoad = Promise.resolve().then(() => RBE_LOAD_HLS())
      .then(() => !!globalThis.Hls, e => { console.warn('[RBE] hls.js load failed', e); return false; })
      .then(ok => { if (!ok) hlsLoad = null; return ok; }));
  };

  // Attach a Reddit video (HLS with audio; falls back to silent MP4)
  RBE.attachRedditVideo = function (v, item) {
    if (item.hls && !globalThis.Hls) {
      RBE.loadHls().then(() => { if (!v._rbeDead) attach(v, item); });
      return;
    }
    attach(v, item);
  };
  // Reddit's fallback_url is the video track alone, so a video left on it plays silent. Say so once
  // instead of leaving the lightbox looking broken.
  let toldSilent = false;
  const silentFallback = v => {
    v.dataset.rbeSilent = '1';
    console.warn('[RBE] no HLS player for this video; using Reddit\'s silent MP4 fallback');
    if (!toldSilent) { toldSilent = true; RBE.toast?.('This video plays silent: its HLS stream did not load. Opening the post plays it with sound.'); }
  };
  // A stream with no audio track at all (Reddit's silent preview of an external video, a GIF upload). Say it
  // once instead of leaving a "why is there no sound" mystery.
  let toldNoAudio = false;
  const silentStream = v => {
    if (v.dataset.rbeSilent) return;
    v.dataset.rbeSilent = '1';
    console.warn('[RBE] this video\'s stream has no audio track');
    if (!toldNoAudio) { toldNoAudio = true; RBE.toast?.('This video has no sound track (Reddit\'s silent preview or a GIF upload).'); }
  };
  function attach(v, item) {
    const fallback = () => {
      v._rbeHls?.destroy(); v._rbeHls = null;
      if (item.fallback && v.getAttribute('src') !== item.fallback) { silentFallback(v); v.src = item.fallback; if (v.dataset.rbeWantPlay && !outOfView(v)) v.play().catch(() => {}); }   // out of view: the observer starts it on entry
    };
    // Prefer hls.js: newer Chrome claims native HLS support but stalls at 0:00 on Reddit's streams
    if (item.hls && globalThis.Hls && Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, startLevel: -1 });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { console.warn('[RBE] hls error', data.type, data.details); fallback(); } });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!hls.audioTracks.length && !hls.levels.some(l => /mp4a|ac-3|ec-3|opus|flac|alac/i.test(l.attrs?.CODECS || ''))) silentStream(v);
        if (v.dataset.rbeWantPlay && !outOfView(v) && !v.dataset.rbeStarted) tryPlay(v);
      });
      hls.loadSource(item.hls);
      hls.attachMedia(v);
      v._rbeHls = hls;
      return;
    }
    if (item.hls && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = item.hls;
      v.addEventListener('error', fallback, { once: true });
      return;
    }
    if (item.fallback) silentFallback(v);
    v.src = item.fallback;
  }
  RBE.destroyVideos = root => root.querySelectorAll('video').forEach(v => { v._rbeDead = true; v.pause(); v._rbeHls?.destroy(); v.removeAttribute('src'); v.load(); });
})();

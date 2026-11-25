/* Tweet videos: browser controls, and one video playing at a time.
   Which video plays: the one you started (until it scrolls away), else the one nearest the middle of the screen. Pausing a
   video yourself sticks: it never restarts on its own while it is on screen, and nothing else starts
   in its place. No timers fight with X's player; the work runs on scroll/visibility changes and your clicks. */
(() => {
  const root = document.documentElement;
  const PLAYER = '[data-testid="videoPlayer"]';
  const ours = v => !!v.closest('.xbb-root');
  // GIFs sit in the same kind of player (a looping video from /tweet_video/): X keeps handling those
  const isGif = v => v.hasAttribute('data-xbb-gif') || /\/tweet_video\//.test(v.currentSrc || v.src || '');
  const managed = v => v instanceof HTMLVideoElement && !ours(v) && !isGif(v);

  const score = new Map();         // the videos we watch (the observer only wakes us up; see sc())
  const userPaused = new WeakSet();
  const failed = new WeakSet();
  let pick = null;                 // the video that should be playing
  let chosen = null;               // a video the user started: keeps the pick while it stays on screen

  // ---------- user gestures (to tell your clicks from X's own play/pause calls) ----------
  let lastGesture = 0, lastTarget = null;
  // The focused element, through open shadow roots (Fast UI's videos live in one; document.activeElement is its host)
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  // The element really clicked: an event from inside a shadow root reaches window retargeted to its host
  const origin = e => { try { const p = e.composedPath && e.composedPath(); if (p && p[0] && p[0].nodeType === 1) return p[0]; } catch {} return e.target; };
  const onGesture = e => { lastGesture = Date.now(); lastTarget = e.type === 'keydown' ? (deepActive() || e.target) : origin(e); };
  ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach(t => addEventListener(t, onGesture, true));
  // In Firefox's content realm (Violentmonkey on nonce-CSP sites like x.com), Xray wrappers bypass
  // page-world prototype patches and hide expando properties set by main-world.js.
  const pageEl = v => v.wrappedJSObject || v;
  // Which side paused. The browser's own controls, and the media keys, never call pause(), and send the
  // page no click either in Chrome (Firefox reports the focus): a pause that no page pause() came before
  // is the user's. main-world.js marks the page's calls (X's pauses always go through pause()).
  const pageCall = (v, k) => performance.now() - (pageEl(v)[k] || 0) < 500;
  // The bar's own play: no play() came before it, and using the bar focuses the video (Chrome fires no
  // other event at all, Firefox a focus event). A video the browser restarts by itself is not focused.
  const barPlay = v => !pageCall(v, '_xbbPagePlay') && deepActive() === v;
  const playerOf = v => v.closest(PLAYER) || v.parentElement?.parentElement;
  const on = (v, t) => { if (!t) return false; if (t === v) return true; const p = playerOf(v); return !!p && p !== document.body && p !== document.documentElement && p.contains(t); };
  const userOn = v => Date.now() - lastGesture <= 1500 && on(v, lastTarget);

  // ---------- native controls ----------
  function prep(v) {
    if (!managed(v)) return;
    const s = XBB.settings;
    const box = v.closest('[data-testid="videoComponent"]') || v.parentElement?.parentElement;
    if (s.nativeControls) {
      if (!v.controls) v.controls = true;
      v.loop = !!s.videoLoop;
      v.dataset.xbbNative = '1';
      if (box && box !== document.body && box !== document.documentElement) box.setAttribute('data-xbb-player', '1');
      if (!v._xbbClick) {
        // Clicks on the controls must not reach X, which would open the tweet
        v._xbbClick = e => { if (v.dataset.xbbNative) e.stopPropagation(); };
        v.addEventListener('click', v._xbbClick);
      }
    } else if (v.dataset.xbbNative) {
      v.controls = false;
      delete v.dataset.xbbNative;
      box?.removeAttribute('data-xbb-player');
    }
  }

  // ---------- picking ----------
  // How much of the video is on screen (0..1), measured now: the observer only reports at a few thresholds,
  // and in Firefox it lags a scroll, which made the pick jump around near the edges.
  const sc = v => {
    const r = v.getBoundingClientRect();
    if (!r.height || !r.width) return 0;
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w <= 0 || h <= 0 ? 0 : h / Math.min(r.height, innerHeight);
  };
  const quiet = v => { v._xbbQuiet = performance.now(); pageEl(v).pause(); };   // a pause that is ours, not yours
  const isPip = v => document.pictureInPictureElement === v;

  // ---------- tab hidden / window unfocused: pause, and let nothing start meanwhile ----------
  let blurred = false;
  const away = () => !!XBB.settings.videoPauseOnHide && (document.hidden || blurred);
  const pauseAway = () => {
    if (!away()) return;
    for (const v of score.keys()) if (v.isConnected && managed(v) && !v.paused && !isPip(v)) quiet(v);   // ours, not yours: it resumes when you are back
  };
  addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) { blurred = true; pauseAway(); } }));
  addEventListener('focus', () => { blurred = false; schedule(0); });

  function start(v) {
    if (failed.has(v)) return;
    const s = XBB.settings;
    // If main-world.js didn't inject (strict CSP without a nonce), apply audio from here too.
    if (!(window.wrappedJSObject || window).__xbbMainWorld && s.videoMode === 'volume') {
      const vol = Math.max(0, Math.min(1, (+s.videoVolume || 0) / 100));
      v.volume = vol;
      v.muted = vol === 0;
    }
    // main-world.js's play() handles sound before the first click (starts muted, unmutes on the click);
    // unwrap in Firefox's content realm so Xray wrappers don't bypass the page-world prototype patch.
    pageEl(v).play().catch(err => {
      // Neither a pause by us nor a browser that refuses to start before the first click is a reason to
      // give up on this video: after a click it may play, and the click schedules another try.
      if (err?.name === 'AbortError' || err?.name === 'NotAllowedError') return;
      failed.add(v);
    });
  }
  const setPick = v => {
    if (pick === v) return;
    pick?.removeAttribute('data-xbb-pick');
    pick = v;
    v?.setAttribute('data-xbb-pick', '');
  };

  function evaluate() {
    const s = XBB.settings;
    if (s.videoMode === 'default') { setPick(null); return; }
    const list = [];
    for (const v of [...score.keys()]) {
      if (!v.isConnected) { score.delete(v); shadowed.delete(v); if (pick === v) pick = null; if (chosen === v) chosen = null; continue; }
      if (!managed(v)) continue;
      // an overlay (Fast UI's lightbox or drawer) is up: what is behind it stays quiet
      if (!inScope(v)) { if (!v.paused && !isPip(v)) quiet(v); if (chosen === v) chosen = null; continue; }
      list.push(v);
    }
    // gone from the screen: a pause of yours no longer counts, and offscreen videos pause
    for (const v of list) {
      if (sc(v) < 0.05) {
        userPaused.delete(v);
        if (s.videoPauseOffscreen && !v.paused && !isPip(v) && document.fullscreenElement !== v) quiet(v);
      }
    }
    if (chosen && sc(chosen) < 0.1) chosen = null;
    // you paused something that is still in view: stay quiet until it is gone
    const hush = list.some(v => userPaused.has(v) && sc(v) >= 0.35);

    let best = chosen;
    if (!best && !hush && s.videoMode !== 'off') {   // no autoplay: only a video you started is ever the pick
      const cand = list.filter(v => sc(v) >= 0.5 && !v.ended && !userPaused.has(v));
      // the video nearest the middle of the screen wins. The current pick only keeps it while it is
      // about as central as the best one, so scrolling a little never swaps videos but a clearly
      // more central one always takes over (not whichever was playing first while still in view)
      const mid = innerHeight / 2, dist = v => { const r = v.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - mid); };
      best = cand.sort((a, b) => dist(a) - dist(b))[0] || null;
      if (pick && pick !== best && cand.includes(pick) && dist(pick) <= dist(best) + innerHeight * 0.08) best = pick;
    }
    setPick(best);

    if (s.videoOneAtATime) for (const v of list) if (v !== best && !v.paused && !isPip(v)) quiet(v);
    if (s.videoMode === 'off' || hush || away()) return;
    // autoplay: the pick; without one-at-a-time, every video that is well in view
    const targets = s.videoOneAtATime ? (best ? [best] : []) : list.filter(v => sc(v) >= 0.5);
    for (const v of targets) if (v.paused && !v.ended && !userPaused.has(v)) start(v);
  }
  // Fast UI's overlays: while one is up, only the videos inside it may play (XBB.videoPolicy.scope)
  let scopeEl = null;
  const inScope = v => !scopeEl || !scopeEl.isConnected || scopeEl.contains(v);
  let timer = 0;
  function schedule(ms = 120) { clearTimeout(timer); timer = setTimeout(evaluate, ms); }

  // ---------- events ----------
  const onPlay = e => {
    const v = e.target, s = XBB.settings;
    if (!managed(v)) return;
    if (!inScope(v)) { quiet(v); return; }   // behind an overlay
    if (away() && !userOn(v)) { quiet(v); return; }   // X restarting something while you are away
    if (userOn(v) || barPlay(v)) {         // you started it: it wins, and everything else yields
      userPaused.delete(v);
      chosen = v;
      setPick(v);
      if (s.videoOneAtATime) for (const o of [...score.keys()]) if (o !== v && !o.paused && managed(o)) quiet(o);
    } else if (s.videoOneAtATime && s.videoMode !== 'default' && v !== pick) {
      // X started one on its own. It may well be the one that should play (a scroll just moved it to the
      // middle): pick again with the current positions first; stopping it only if it still is not the pick.
      // A play() the page never made is the browser's (its own controls, or its own restart): not yours.
      evaluate();
      if (v !== pick && !v.paused) quiet(v);
    }
  };
  const onPause = e => {
    const v = e.target;
    if (!managed(v) || v.ended || performance.now() - (v._xbbQuiet || 0) < 400) return;
    // Paused by you if you clicked the player, or if the browser's own controls did it: those, and the media
    // keys, never call pause(), so no page call came before this pause. X's own pauses always do.
    if (userOn(v) || !pageCall(v, '_xbbPagePause')) { userPaused.add(v); if (chosen === v) chosen = null; }
  };
  const onEnded = e => {
    if (e.target === chosen) chosen = null;
    if (e.target === pick) schedule(0);
  };
  document.addEventListener('play', onPlay, true);
  document.addEventListener('pause', onPause, true);
  document.addEventListener('ended', onEnded, true);

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const r = e.boundingClientRect;
      score.set(e.target, e.isIntersecting && r.height ? e.intersectionRect.height / Math.min(r.height, innerHeight) : 0);
    }
    schedule();
  }, { threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1] });

  const seen = new WeakSet();
  function watch(v) {
    if (seen.has(v) || ours(v)) return false;
    if (v.loop) v.setAttribute('data-xbb-gif', '');   // X loops GIFs itself; a real video only loops by our setting, applied below
    seen.add(v);
    if (!managed(v)) return false;
    io.observe(v);
    score.set(v, score.get(v) || 0);
    prep(v);
    return true;
  }
  function scan() {
    document.querySelectorAll('video').forEach(watch);
  }

  // ---------- videos in a shadow root (Fast UI) ----------
  // document.querySelectorAll cannot see into a shadow root, and media events are not composed: they never
  // reach the document listeners above. Fast UI hands its videos over here, so they follow exactly the same
  // rules (one at a time, offscreen pause, pause when away, your pause sticks). The page-world half
  // (main-world.js) is told through a composed event, so its audio rules reach them too.
  const shadowed = new Set();
  XBB.videoPolicy = {
    add(v) {
      if (!(v instanceof HTMLVideoElement)) return false;
      if (!watch(v)) return false;
      if (v.getRootNode() !== document && !shadowed.has(v)) {
        shadowed.add(v);
        v.addEventListener('play', onPlay, true);
        v.addEventListener('pause', onPause, true);
        v.addEventListener('ended', onEnded, true);
        try { v.dispatchEvent(new CustomEvent('xbb-video-own', { bubbles: true, composed: true })); } catch {}
      }
      schedule(0);
      return true;
    },
    remove(v) {
      if (!v) return;
      io.unobserve(v);
      score.delete(v);
      seen.delete(v);
      userPaused.delete(v);
      if (pick === v) setPick(null);
      if (chosen === v) chosen = null;
      if (shadowed.delete(v)) {
        v.removeEventListener('play', onPlay, true);
        v.removeEventListener('pause', onPause, true);
        v.removeEventListener('ended', onEnded, true);
      }
    },
    // Before a node that holds videos is thrown away or reused: stop them and drop what they loaded
    destroy(root) {
      if (!root) return;
      const list = root instanceof HTMLVideoElement ? [root] : [...root.querySelectorAll('video')];
      for (const v of list) {
        XBB.videoPolicy.remove(v);
        try { quiet(v); } catch {}
        v.removeAttribute('src');
        v.querySelectorAll('source').forEach(s => s.remove());
        try { v.load(); } catch {}
      }
    },
    evaluate: () => schedule(0),
    // An element (a lightbox or drawer <dialog>): videos outside it pause and nothing outside it starts, until scope(null)
    scope(el) {
      el = el || null;
      if (scopeEl === el) return;
      scopeEl = el;
      if (chosen && !inScope(chosen)) chosen = null;
      schedule(0);
    }
  };
  XBB.onDomChange(scan, 200);
  let lastRun = 0;
  addEventListener('scroll', () => {
    const now = performance.now();
    if (now - lastRun > 150) { lastRun = now; evaluate(); }
    schedule(150);                       // and once more when it settles
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAway(); else schedule(); });
  XBB.onSettings(s => {
    root.dataset.xbbVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0, one: !!s.videoOneAtATime });
    root.classList.toggle('xbb-native', !!s.nativeControls);
    root.classList.toggle('xbb-light', !!s.lighterPage);
    for (const v of score.keys()) prep(v);
    schedule();
  });
  scan();
})();

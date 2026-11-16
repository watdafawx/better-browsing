/* Video: Pinterest's own players (sound setting, offscreen and hidden-tab pause) and our own players in the
   lightbox. The sound decision itself lives in main-world.js; this side publishes the setting and marks
   videos as ours. */
(() => {
  let lastGesture = 0, lastTarget = null;
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
  }, true));
  const gesture = () => Date.now() - lastGesture < 1200;

  const known = new Set();          // every <video> we have seen
  let blurred = false;
  const away = () => !!PIN.settings.videoPauseOnHide && (document.hidden || blurred);
  const pauseAway = () => {
    if (!away()) return;
    for (const v of known) { if (!v.isConnected) known.delete(v); else if (!v.paused && document.pictureInPictureElement !== v) v.pause(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAway(); });
  addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) { blurred = true; pauseAway(); } }));
  addEventListener('focus', () => { blurred = false; });

  const seen = new WeakSet();
  const io = new IntersectionObserver(entries => {
    const s = PIN.settings;
    for (const e of entries) {
      const v = e.target;
      if (v.dataset.pinOwn) {
        v._pinInView = e.isIntersecting;
        if (e.isIntersecting) {
          v._pinSeen = true;
          // our own video that wanted to play but was out of view: start it now
          if (v.dataset.pinWantPlay && !away() && v.paused) PIN.tryPlay(v);
        } else if (!v._pinSeen && !v.paused) v.pause();   // started before we knew it is out of view
        continue;
      }
      if (!e.isIntersecting) {
        if (s.videoPauseOffscreen && !v.paused) v.pause();
        // Pinterest pauses grid videos itself as they leave. Remember that it was playing, so it can come
        // back when it returns — unless the user paused it on purpose.
        if (s.videoPauseOffscreen && v._pinPlaying && !v.dataset.pinUserPaused) v.dataset.pinPausedOffscreen = '1';
        else delete v.dataset.pinPausedOffscreen;
      } else if (e.isIntersecting && v.dataset.pinPausedOffscreen && s.videoMode !== 'off' && !away()) {
        delete v.dataset.pinPausedOffscreen;
        v._pinPlaying = true;
        v.play().catch(() => {});
      }
    }
  }, { threshold: 0.15 });

  function guard(v) {
    if (seen.has(v)) return;
    seen.add(v);
    known.add(v);
    io.observe(v);
    v.addEventListener('playing', () => { v._pinPlaying = true; });
    // A pause right after a click/key on that player is the user's: never undo it later. In the light DOM the
    // click lands on the video or its own container (a few levels up); inside a player's shadow root only that
    // root counts. Comparing root nodes alone would call any earlier click on the page a pause of this video.
    const userPausedIt = () => {
      if (!gesture() || !lastTarget) return false;      // a pause long after any click is the page's, not the user's
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
    v.addEventListener('pause', () => {
      if (userPausedIt()) {
        v._pinPlaying = false;
        v.dataset.pinUserPaused = '1';
      }
    });
    v.addEventListener('play', () => {
      const s = PIN.settings;
      if (away() && !gesture()) { v.pause(); return; }
      if (s.videoMode === 'off' && !gesture() && !v.dataset.pinAllowed) v.pause();
      if (gesture()) v.dataset.pinAllowed = '1';
    });
  }

  // Pinterest renders its players in the light DOM (`video[data-test-id="web-video-player"]`). A whole-document
  // attribute-substring query per mutation was the expensive part in Firefox's content realm, so scan <video>
  // elements only, and look for new shadow roots rarely (they have not appeared on Pinterest).
  const roots = new Set([document]);
  let lastDeep = 0;
  function scan() {
    for (const r of roots) r.querySelectorAll('video').forEach(guard);
    if (Date.now() - lastDeep < 15000) return;
    lastDeep = Date.now();
    for (const r of [...roots]) discover(r, 0);
  }
  function discover(root, depth) {
    if (!root || depth > 3) return;
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot || roots.has(el.shadowRoot)) continue;
      roots.add(el.shadowRoot);
      discover(el.shadowRoot, depth + 1);
    }
  }

  function publish(s) {
    document.documentElement.dataset.pinVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0, feed: s.feedSound === true });
    document.documentElement.classList.toggle('pin-native', s.nativeControls !== false);
  }
  PIN.onSettings(publish);

  PIN.onDomChange(() => { const t0 = performance.now(); scan(); PIN.count('video-scan', performance.now() - t0); }, 300, 'video-scan');
  setInterval(() => {
    if (document.hidden) return;
    const t0 = performance.now(); scan(); PIN.count('video-interval', performance.now() - t0);
  }, 5000);

  // play() that only falls back to muted when the browser really blocked audible autoplay.
  PIN.tryPlay = function (v) {
    return v.play().catch(err => {
      if (err && err.name === 'NotAllowedError' && !v.muted) {
        v.muted = true;
        v.dataset.pinSoundBlocked = '1';
        const back = () => {
          ['pointerdown', 'keydown'].forEach(t => removeEventListener(t, back, true));
          if (!v.isConnected || !v.muted || v.dataset.pinUserAudio) return;
          v.muted = !(+PIN.settings.videoVolume) || PIN.settings.videoMode === 'muted';
          delete v.dataset.pinSoundBlocked;
        };
        ['pointerdown', 'keydown'].forEach(t => addEventListener(t, back, true));
        return v.play().catch(() => {});
      }
    });
  };

  // ---------- our own player (lightbox) ----------
  PIN.setupOwnVideo = function (v, { autoplay = true } = {}) {
    const s = PIN.settings;
    v.playsInline = true;
    v.loop = !!s.videoLoop;
    v.dataset.pinOwn = '1';
    const on = s.nativeControls !== false;
    v.controls = on;
    const vol = Math.max(0, Math.min(1, (+s.videoVolume || 0) / 100));
    if (s.videoMode === 'muted') v.muted = true;
    else if (s.videoMode !== 'default') { v.volume = vol; v.muted = vol === 0; }
    // Clicking the picture plays or pauses, even with the browser's own controls: with autoplay off the viewer
    // opens paused, and clicking the video (not its control bar) is what people try. A video the browser forced
    // to start muted unmutes on that first click instead of pausing.
    if (!v._pinToggle) {
      v._pinToggle = e => {
        if (v.controls && e.clientY > v.getBoundingClientRect().bottom - 46) return;   // let the control bar have it
        if (!v.paused && v.muted && v.dataset.pinSoundBlocked) { v.muted = false; delete v.dataset.pinSoundBlocked; return; }
        if (v.paused) PIN.tryPlay(v); else v.pause();
      };
      v.addEventListener('click', v._pinToggle);
    }
    const wantsPlay = autoplay && s.videoMode !== 'off';
    if (wantsPlay) {
      v.dataset.pinWantPlay = '1';
      // out of view (a long strip): don't start until it shows
      v.addEventListener('play', () => { if (v._pinInView === false && !gesture()) v.pause(); });
      PIN.tryPlay(v);
    }
    io.observe(v);
  };

  PIN.destroyVideos = root => root.querySelectorAll('video').forEach(v => v.pause());
})();

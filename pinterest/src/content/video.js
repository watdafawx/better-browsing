/* Video: Pinterest's own players (sound setting, offscreen and hidden-tab pause) and our own players in the
   lightbox. The sound decision itself lives in main-world.js; this side publishes the setting and marks
   videos as ours. */
(() => {
  let lastGesture = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, () => { lastGesture = Date.now(); }, true));
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
      if (!e.isIntersecting && s.videoPauseOffscreen && !v.paused) { v.pause(); v.dataset.pinPausedOffscreen = '1'; }
      else if (e.isIntersecting && v.dataset.pinPausedOffscreen && s.videoMode !== 'off' && !away()) {
        delete v.dataset.pinPausedOffscreen; v.play().catch(() => {});
      }
    }
  }, { threshold: 0.15 });

  function guard(v) {
    if (seen.has(v)) return;
    seen.add(v);
    known.add(v);
    io.observe(v);
    v.addEventListener('play', () => {
      const s = PIN.settings;
      if (away() && !gesture()) { v.pause(); return; }
      if (s.videoMode === 'off' && !gesture() && !v.dataset.pinAllowed) v.pause();
      if (gesture()) v.dataset.pinAllowed = '1';
    });
  }

  // Pinterest renders its players in the light DOM (`video[data-test-id="web-video-player"]`), but keep the
  // shadow-root walk: media players have moved in and out of them before.
  function scan(root, depth = 0) {
    if (!root || depth > 3) return;
    root.querySelectorAll('video').forEach(guard);
    root.querySelectorAll('[data-test-id*="player"], [data-test-id*="video"]').forEach(h => h.shadowRoot && scan(h.shadowRoot, depth + 1));
  }

  function publish(s) {
    document.documentElement.dataset.pinVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0 });
    document.documentElement.classList.toggle('pin-native', s.nativeControls !== false);
  }
  PIN.onSettings(publish);

  PIN.onDomChange(() => scan(document), 300);
  setInterval(() => { if (!document.hidden) scan(document); }, 3000);

  // play() that only falls back to muted when the browser really blocked audible autoplay.
  PIN.tryPlay = function (v) {
    return v.play().catch(err => {
      if (err && err.name === 'NotAllowedError' && !v.muted) {
        v.muted = true;
        const back = () => {
          ['pointerdown', 'keydown'].forEach(t => removeEventListener(t, back, true));
          if (!v.isConnected || !v.muted || v.dataset.pinUserAudio) return;
          v.muted = !(+PIN.settings.videoVolume) || PIN.settings.videoMode === 'muted';
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
    else if (s.videoMode === 'volume' || s.videoMode === 'off') { v.volume = vol; v.muted = vol === 0; }
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

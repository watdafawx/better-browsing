/* Runs in the PAGE's JS world so it can control Pinterest's own players.
   Settings arrive from the content script via <html data-pin-video='{"mode":"volume","volume":40}'>.
   While our lightbox is open (<html data-pin-lb>) or Fast UI owns the page (<html data-pin-fast>), page videos
   are not allowed to start. */
(() => {
  if (window.__pinMainWorld) return;
  window.__pinMainWorld = true;

  const root = document.documentElement;
  const P = HTMLMediaElement.prototype;
  const origPlay = P.play;
  const mutedDesc = Object.getOwnPropertyDescriptor(P, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(P, 'volume');
  const autoDesc = Object.getOwnPropertyDescriptor(P, 'autoplay');
  const setMuted = (el, v) => mutedDesc.set.call(el, v);
  const setVol = (el, v) => volDesc.set.call(el, v);

  let lastGesture = 0, lastTarget = null;
  const gesture = () => Date.now() - lastGesture < 1200;
  // A recent click/key on this video's own player (the video or its controls). A click elsewhere
  // (a card, the nav) is not the user's choice about this video's sound.
  const userOn = el => {
    if (!gesture() || !lastTarget) return false;
    if (lastTarget === el) return true;
    let p = el;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) if (p.contains(lastTarget)) return true;
    return false;
  };

  // Parse the settings attribute only when it changes (the setters below run on every volume/mute write)
  let cfg = {};
  const readCfg = () => { try { cfg = JSON.parse(root.dataset.pinVideo || '{}'); } catch { cfg = {}; } };
  readCfg();
  new MutationObserver(readCfg).observe(root, { attributes: true, attributeFilter: ['data-pin-video'] });

  // Our own players (lightbox) are built before they are attached, so check the flag as well as the root
  const ours = el => !!(el.dataset?.pinOwn || el.closest?.('.pin-root'));
  const active = el => {
    const m = cfg.mode;
    if (!m || m === 'default' || !(el instanceof HTMLVideoElement) || ours(el)) return false;
    // Feed/grid videos stay muted unless the feed-sound option is on: Pinterest's own players, not our viewer.
    if (m === 'volume' && !cfg.feed) return false;
    return true;
  };

  // Videos that had to start muted because the browser blocked audible autoplay; unmute on first interaction.
  const waiting = new Set();
  const onGesture = e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
    if (cfg.mode !== 'volume' || !cfg.volume) return;
    for (const v of waiting) {
      if (v.isConnected && !v.paused && !v.dataset.pinUserAudio) { setVol(v, cfg.volume / 100); setMuted(v, false); }
      waiting.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el) {
    if (el.dataset.pinUserAudio) return;
    if (cfg.mode === 'muted') setMuted(el, true);
    else if (cfg.mode === 'volume' || cfg.mode === 'off') {
      setVol(el, Math.max(0, Math.min(1, (cfg.volume || 0) / 100)));
      setMuted(el, !cfg.volume);
    }
  }

  // Our viewer is open, or Fast UI owns the page (Pinterest's own page is hidden underneath and must stay silent)
  const lbOpen = () => root.hasAttribute('data-pin-lb') || (root.hasAttribute('data-pin-fast') && root.getAttribute('data-pin-fast') !== 'native');

  // Backstop for playback that skips play() (autoplay attribute, resume after buffering)
  document.addEventListener('play', e => {
    const v = e.target;
    if (lbOpen() && v instanceof HTMLVideoElement && !ours(v)) v.pause();
  }, true);

  P.play = function () {
    if (lbOpen() && this instanceof HTMLVideoElement && !ours(this)) return Promise.resolve();
    if (!active(this)) return origPlay.apply(this, arguments);
    const user = gesture();
    if (cfg.mode === 'off' && !user && !this.dataset.pinAllowed) return Promise.resolve(); // swallow autoplay
    if (user) this.dataset.pinAllowed = '1';
    applyAudio(this);
    const el = this;
    return origPlay.call(this).catch(err => {
      if (err && err.name === 'NotAllowedError' && !el.muted) {
        setMuted(el, true); // browser refuses sound before the first click: start muted, unmute on first gesture
        waiting.add(el);
        return origPlay.call(el);
      }
      throw err;
    });
  };

  // Pinterest mutes its players on mount and writes `muted` while scrolling. Page-initiated changes
  // are ignored; ones from a click/key on that video's player are the user's and stick.
  // With browser controls on (the default) the site's own mute button is hidden, so writes from the
  // page are not the user's; theirs come through volumechange on the controls below.
  const nativeOn = () => root.classList.contains('pin-native');
  const userWrite = el => {
    if (!active(el)) return true;
    if (el.hasAttribute('data-bb-vol-write')) { el.dataset.pinUserAudio = '1'; waiting.delete(el); return true; }
    if (nativeOn() || !userOn(el)) return false;
    el.dataset.pinUserAudio = '1';
    waiting.delete(el);
    return true;
  };
  Object.defineProperty(P, 'muted', {
    configurable: true, enumerable: true,
    get() { return mutedDesc.get.call(this); },
    set(v) { if (userWrite(this)) setMuted(this, v); }
  });
  Object.defineProperty(P, 'volume', {
    configurable: true, enumerable: true,
    get() { return volDesc.get.call(this); },
    set(v) { if (userWrite(this)) setVol(this, v); }
  });
  // The autoplay attribute bypasses play(); neuter it when autoplay is off.
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && cfg.mode === 'off') return; autoDesc.set.call(this, v); }
  });

  // React sets `muted` as a property on mount, before play(); re-apply our level when playback starts.
  // A video still waiting for a click is fine to unmute once the page has had one.
  const activated = () => !!navigator.userActivation?.hasBeenActive;
  document.addEventListener('playing', e => {
    const v = e.target;
    if (!active(v)) return;
    if (waiting.has(v) && activated()) waiting.delete(v);
    if (!waiting.has(v)) applyAudio(v);
  }, true);

  // Safety net: a playing video that is muted (or silent) though the user never changed its audio gets
  // our level back. Only after the page has had a click or key press: unmuting before that makes the
  // browser pause it. Pinterest's grid plays many of these.
  setInterval(() => {
    if (cfg.mode !== 'volume' || !cfg.volume || document.hidden || !activated()) return;
    const want = Math.max(0, Math.min(1, cfg.volume / 100));
    for (const v of document.querySelectorAll('video')) {
      if (v.paused || !v.isConnected || v.dataset.pinUserAudio || !active(v)) continue;
      if (!v.muted && Math.abs(v.volume - want) < 0.01) continue;
      waiting.delete(v);
      setVol(v, want);
      setMuted(v, false);
    }
  }, 600);
  // The browser's own controls change volume/mute without going through the setters above.
  document.addEventListener('volumechange', e => {
    const v = e.target;
    if (!active(v) || v.dataset.pinUserAudio || !userOn(v)) return;
    const want = cfg.mode === 'muted' ? null : Math.max(0, Math.min(1, (cfg.volume || 0) / 100));
    const ours = want === null ? v.muted : v.muted === (want === 0) && Math.abs(v.volume - want) < 0.01;
    if (!ours) { v.dataset.pinUserAudio = '1'; waiting.delete(v); }
  }, true);
})();

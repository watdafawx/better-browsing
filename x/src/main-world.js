/* Runs in the PAGE's JS world so it can control X's own video players.
   Settings arrive from the content script via <html data-xbb-video='{"mode":"volume","volume":40,"one":true}'>.
   The content script marks the video it wants playing with data-xbb-pick; with one-at-a-time on (or
   autoplay off), X's own play() calls on any other video are swallowed unless the user just clicked. */
(() => {
  if (window.__xbbMainWorld) return;
  window.__xbbMainWorld = true;

  const root = document.documentElement;
  const P = HTMLMediaElement.prototype;
  const origPlay = P.play;
  const mutedDesc = Object.getOwnPropertyDescriptor(P, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(P, 'volume');
  const autoDesc = Object.getOwnPropertyDescriptor(P, 'autoplay');
  // Remember the audio state our own writes leave, so the volumechange they cause is never taken for the
  // user's (a video we had to leave muted before the first click stayed muted for good that way).
  const mine = new WeakMap();
  const note = el => mine.set(el, [mutedDesc.get.call(el), volDesc.get.call(el)]);
  const isMine = el => { const m = mine.get(el); return !!m && m[0] === el.muted && Math.abs(m[1] - el.volume) < 0.01; };
  const setMuted = (el, v) => { mutedDesc.set.call(el, v); note(el); };
  const setVol = (el, v) => { volDesc.set.call(el, v); note(el); };

  const PLAYER = '[data-testid="videoPlayer"]';
  let lastGesture = 0, lastTarget = null;
  const gesture = () => Date.now() - lastGesture < 1200;
  // A recent click/key on this video's own player (the video, its own overlay and X's buttons inside it).
  // Clicking elsewhere on the page is a gesture too, but X's mute/pause right after it is not the user's.
  // The browser's own controls (native bar, media keys) send the page no click at all: they are told apart
  // by not going through play()/pause() (see the wrappers below), so the pointer resting on a video is
  // never needed here. Treating it as a click let X's own play()/mute calls through whenever the mouse
  // happened to sit over a video (in the feed, most of the time), so X took the video from the pick and
  // could mute it for good.
  const playerOf = el => el.closest(PLAYER) || el.parentElement?.parentElement;
  const on = (el, t) => { if (!t) return false; if (t === el) return true; const p = playerOf(el); return !!p && p !== document.body && p !== document.documentElement && p.contains(t); };
  const userOn = el => gesture() && on(el, lastTarget);

  // X reuses a <video> element for another tweet's media as the feed virtualises, so a mute that was the
  // user's on one video must not silence the next one in the same element.
  const userAudio = el => {
    if (!el.dataset.xbbUserAudio) return false;
    if (el.dataset.xbbUserAudioSrc === (el.currentSrc || '')) return true;
    delete el.dataset.xbbUserAudio;
    delete el.dataset.xbbUserAudioSrc;
    return false;
  };
  const markUserAudio = el => { el.dataset.xbbUserAudio = '1'; el.dataset.xbbUserAudioSrc = el.currentSrc || ''; };

  // Parse the settings attribute only when it changes
  let cfg = {};
  const readCfg = () => { try { cfg = JSON.parse(root.dataset.xbbVideo || '{}'); } catch { cfg = {}; } };
  readCfg();
  new MutationObserver(readCfg).observe(root, { attributes: true, attributeFilter: ['data-xbb-video'] });

  const ours = el => !!el.closest?.('.xbb-root');
  // Only real tweet videos: GIFs (looping /tweet_video/ files in the same player) keep X's own handling
  const isGif = el => el.hasAttribute('data-xbb-gif') || /\/tweet_video\//.test(el.currentSrc || el.src || '');
  const active = el => {
    const m = cfg.mode;
    return !!m && m !== 'default' && el instanceof HTMLVideoElement && !ours(el) && !isGif(el);
  };
  // Volume the user last chose with the browser controls on any video (until the page reloads)
  let sessionVol = null;
  const level = () => sessionVol ?? Math.max(0, Math.min(1, (cfg.volume || 0) / 100));

  // Videos that had to start muted because the browser blocked audible autoplay; unmute on first interaction.
  const waiting = new Set();
  // Through open shadow roots (Fast UI's videos live in one): window sees such events retargeted to the host
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const origin = e => { try { const p = e.composedPath && e.composedPath(); if (p && p[0] && p[0].nodeType === 1) return p[0]; } catch {} return e.target; };
  const onGesture = e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (deepActive() || e.target) : origin(e);
    if (e.type === 'focusin' || cfg.mode !== 'volume' || !level()) return;
    for (const v of waiting) {
      if (!v.isConnected || userAudio(v)) { waiting.delete(v); continue; }
      if (v.paused) {
        // The browser refused even a muted start (Firefox's "block audio and video"): try the pick again
        // now that the page has had a click, which is what it was waiting for.
        if (v.hasAttribute('data-xbb-pick') && canSound(v)) { waiting.delete(v); setVol(v, level()); setMuted(v, false); origPlay.call(v).catch(() => {}); }
        continue;
      }
      setVol(v, level()); setMuted(v, false); waiting.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el) {
    if (userAudio(el)) return;
    if (cfg.mode === 'muted') setMuted(el, true);
    else if (cfg.mode === 'volume' || cfg.mode === 'off') {
      setVol(el, level());
      // a playing muted video stays muted until it may make sound: unmuting it now would pause it
      if (level() && el.muted && !el.paused && !canSound(el)) { waiting.add(el); return; }
      setMuted(el, !level());
    }
  }

  // With one-at-a-time (or autoplay off), only the picked video, or one the user just started, may play.
  const gated = el => cfg.mode === 'off' || cfg.one;
  // Only the pick, or a video you just clicked yourself. Not "any video, for a while after any click": X
  // calls play() on its other videos after a key press or click, and once they were let through they were
  // let through for good, so X and our own pausing took turns in a tight loop (CPU spikes).
  const mayPlay = el => el.hasAttribute('data-xbb-pick') || userOn(el);

  P.play = function () {
    if (!active(this)) return origPlay.apply(this, arguments);
    if (gated(this) && !mayPlay(this)) return Promise.resolve();   // swallow X's autoplay
    this._xbbPagePlay = performance.now();   // a page call: X's, or ours; not the browser's own controls
    applyAudio(this);
    const el = this;
    return origPlay.call(this).catch(err => {
      if (err && err.name === 'NotAllowedError' && !el.muted) {
        el._xbbPageWrite = performance.now();   // ours, not the browser's: it must not look like the user muting
        setMuted(el, true); // browser refuses sound before the first click: start muted, unmute on first gesture
        waiting.add(el);
        return origPlay.call(el).catch(e => { if (e?.name !== 'AbortError') throw e; });
      }
      throw err;
    });
  };
  // Same for pause: one the browser makes itself (its control bar, the media keys) never comes through here.
  const origPause = P.pause;
  P.pause = function () {
    if (active(this)) this._xbbPagePause = performance.now();
    return origPause.apply(this, arguments);
  };

  // X mutes new videos and keeps its own mute state. With browser controls on, X's own mute button is
  // hidden, so a mute or volume write from the page is never the user's; theirs come from the browser
  // controls, which call no setter at all (volumechange below). Without browser controls, a write right
  // after a click on the player counts: that is X's own overlay button, a page element in both browsers.
  const nativeOn = () => root.classList.contains('xbb-native');
  const userWrite = el => {
    if (!active(el)) return true;
    el._xbbPageWrite = performance.now();     // a write from the page, allowed below or not: not the browser's
    if (nativeOn() || !userOn(el)) return false;
    markUserAudio(el);
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
  // The autoplay attribute bypasses play(); neuter it when autoplay is gated.
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && gated(this)) return; autoDesc.set.call(this, v); }
  });

  // React sets `muted` as a property on mount, before play(); re-apply our level when playback starts.
  // Before the page has had a click, unmuting would make the browser pause the video: wait for the click.
  const activated = () => !!navigator.userActivation?.hasBeenActive;
  // May this video make sound now? Unmuting a playing video that may not makes the browser pause it, and
  // X then restarts it with sound still refused: play, stop, play silent. On Firefox the browser answers
  // for itself (navigator.getAutoplayPolicy), which also covers a site the user put on its autoplay allow
  // list: x.com there may play with sound on a fresh page, before any click, and holding it for a click
  // kept it muted anyway.
  const canSound = el => { try { if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy(el) === 'allowed'; } catch {} return activated(); };
  const onPlaying = e => {
    const v = e.target;
    if (!active(v)) return;
    if (v.muted && cfg.mode === 'volume' && !canSound(v)) { waiting.add(v); return; }
    waiting.delete(v);
    applyAudio(v);
  };
  document.addEventListener('playing', onPlaying, true);

  // Safety net: a playing video that is muted though the user never muted it gets our level back.
  // Only where the browser would let it make sound: unmuting before that pauses the video.
  setInterval(() => {
    if (cfg.mode !== 'volume' || !level() || document.hidden) return;
    for (const v of [...document.querySelectorAll('video'), ...own]) {
      if (v.paused || !v.muted || userAudio(v) || !active(v) || !canSound(v)) continue;
      waiting.delete(v);
      setVol(v, level());
      setMuted(v, false);
    }
  }, 600);

  // The browser's own controls change volume/mute without going through the setters above, and send the
  // page no click either: a change that is neither our level nor a page write is the user's. Keep it for
  // this video, and a volume they set (not a mute) becomes the level for the videos after it.
  const onVolume = e => {
    const v = e.target;
    if (!active(v) || userAudio(v) || isMine(v) || !mine.has(v)) return;
    const want = cfg.mode === 'muted' ? null : level();
    const same = want === null ? v.muted : v.muted === (want === 0) && Math.abs(v.volume - want) < 0.01;
    if (same) return;                                               // our own level, or a write we matched
    if (performance.now() - (v._xbbPageWrite || 0) < 100) return;    // X's (blocked or allowed above)
    markUserAudio(v);
    waiting.delete(v);
    if (!v.muted && v.volume > 0 && cfg.mode !== 'muted') sessionVol = v.volume;
  };
  document.addEventListener('volumechange', onVolume, true);

  // Fast UI's videos sit in a shadow root, where media events never reach the document: video.js announces
  // each one with a composed event, and the same listeners go on the element itself.
  const own = new Set();
  document.addEventListener('xbb-video-own', e => {
    let v = null;
    try { v = e.composedPath()[0]; } catch {}
    if (!(v instanceof HTMLVideoElement) || own.has(v)) return;
    for (const x of own) if (!x.isConnected) own.delete(x);
    own.add(v);
    v.addEventListener('playing', onPlaying, true);
    v.addEventListener('volumechange', onVolume, true);
  }, true);
})();

/* Shared across all four sites (userscripts + MV3 extension):
   1. RMB + wheel on any non-GIF <video> adjusts volume in 5% steps, shows a brief % HUD,
      and suppresses the context menu on RMB release (plain right-click keeps its normal menu).
   2. Hover volume pill on narrow <video controls> (< 360px wide, where browsers hide the native
      volume slider): compact glass speaker icon at top-left that expands a mini slider on hover
      and supports wheel scrolling over the pill. Zero DOM nodes or timers when idle. */
(() => {
  if (window.__bbVolCtrl) return;
  window.__bbVolCtrl = true;

  const NARROW_MAX = 360;
  const NARROW_MIN = 60;
  const STEP = 0.05;
  const lastVol = new WeakMap();

  const isSilent = v => !(v instanceof HTMLVideoElement) ||
    v.hasAttribute('data-xbb-gif') ||
    v.hasAttribute('data-rbe-silent') ||
    v.hasAttribute('data-bb-silent') ||
    /\/tweet_video\//.test(v.currentSrc || v.src || '');

  function setVol(v, vol, muted) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0));
    const m = !!muted || clamped === 0;
    if (!m && clamped > 0) lastVol.set(v, clamped);
    try {
      v.dataset.rbeUserAudio = '1';
      v.dataset.igbUserAudio = '1';
      v.dataset.pinUserAudio = '1';
      v.dataset.xbbUserAudioSrc = v.currentSrc || v.src || '1';
    } catch {}
    v.setAttribute('data-bb-vol-write', '1');
    try {
      if (clamped > 0 || !m) v.volume = clamped;
      v.muted = m;
    } catch {} finally {
      v.removeAttribute('data-bb-vol-write');
    }
  }

  function effVol(v) {
    return v.muted ? 0 : Math.max(0, Math.min(1, v.volume));
  }

  function stepVol(v, dir) {
    const cur = effVol(v);
    const next = Math.max(0, Math.min(1, Math.round((cur + dir * STEP) * 20) / 20));
    setVol(v, next, next === 0);
    return next;
  }

  function toggleMute(v) {
    if (v.muted || v.volume === 0) {
      const restore = lastVol.get(v) || (v.volume > 0 ? v.volume : 0.5);
      setVol(v, restore, false);
    } else {
      lastVol.set(v, v.volume);
      setVol(v, v.volume, true);
    }
  }

  function videoFromPath(path) {
    if (!path) return null;
    for (let i = 0; i < path.length; i++) {
      const n = path[i];
      if (n instanceof HTMLVideoElement) return isSilent(n) ? null : n;
      if (n && n.nodeType === 1 && n.matches && n.matches('.vid, .ph.v, [data-testid="videoPlayer"], .rbe-media, .pin-lb-media')) {
        const v = n.querySelector('video');
        if (v && !isSilent(v)) return v;
      }
    }
    return null;
  }

  // ---------- lazy single shadow-DOM overlay (popover="manual" so it sits above <dialog> modals) ----------
  let host = null, sr = null, pill = null, muteBtn = null, range = null, pctEl = null, hud = null, hudIcon = null, hudTxt = null, hudFill = null;
  let pillVideo = null, pillHideT = 0, hudHideT = 0, dragging = false, popOpen = false;

  const SVG_MUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  const SVG_LOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  const SVG_HIGH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
  const iconFor = vol => vol <= 0 ? SVG_MUTE : vol < 0.5 ? SVG_LOW : SVG_HIGH;

  const CSS = `
:host { all: initial; }
.pill {
  position: fixed; z-index: 2147483647; pointer-events: auto;
  display: inline-flex; align-items: center; height: 28px; padding: 0 3px;
  border-radius: 999px; color: #fff; font: 600 11px/1 system-ui, -apple-system, sans-serif;
  background: rgba(15, 20, 25, 0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.18); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  opacity: 0; visibility: hidden; transition: opacity .12s ease;
  user-select: none; -webkit-user-select: none;
}
.pill.on { opacity: 1; visibility: visible; }
.mute {
  all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; color: #fff; flex: none;
}
.mute:hover { background: rgba(255, 255, 255, 0.14); }
.mute svg, .hud svg { width: 14px; height: 14px; display: block; }
.wrap {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 0; opacity: 0; overflow: hidden; padding: 0;
  transition: max-width .16s ease, opacity .14s ease, padding .16s ease;
}
.pill:hover .wrap, .pill.open .wrap { max-width: 124px; opacity: 1; padding: 0 6px 0 4px; }
input[type=range] {
  -webkit-appearance: none; appearance: none; width: 72px; height: 4px; margin: 0;
  background: rgba(255, 255, 255, 0.28); border-radius: 999px; outline: none; cursor: pointer;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 11px; height: 11px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 3px rgba(0,0,0,.45);
}
input[type=range]::-moz-range-thumb {
  width: 11px; height: 11px; border: 0; border-radius: 50%;
  background: #fff; box-shadow: 0 0 3px rgba(0,0,0,.45);
}
.pct { min-width: 28px; text-align: right; font-variant-numeric: tabular-nums; color: rgba(255,255,255,.92); }
.hud {
  position: fixed; z-index: 2147483647; pointer-events: none;
  transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px;
  border-radius: 999px; color: #fff; font: 600 12px/1 system-ui, -apple-system, sans-serif;
  background: rgba(15, 20, 25, 0.84); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
  opacity: 0; visibility: hidden; transition: opacity .12s ease;
  font-variant-numeric: tabular-nums;
}
.hud.on { opacity: 1; visibility: visible; }
.bar { width: 52px; height: 4px; border-radius: 999px; background: rgba(255,255,255,.24); overflow: hidden; }
.bar > i { display: block; height: 100%; background: #fff; border-radius: 999px; }
`;

  function ensureUI() {
    if (host && host.isConnected) return true;
    if (!document.body) return false;
    host = document.createElement('div');
    host.className = 'bb-vol-host';
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'position:fixed;inset:0;width:0;height:0;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;';
    sr = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    pill = document.createElement('div');
    pill.className = 'pill';
    muteBtn = document.createElement('button');
    muteBtn.className = 'mute';
    muteBtn.type = 'button';
    muteBtn.title = 'Mute / unmute (scroll to adjust volume)';
    const wrap = document.createElement('span');
    wrap.className = 'wrap';
    range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.setAttribute('aria-label', 'Volume');
    pctEl = document.createElement('span');
    pctEl.className = 'pct';
    wrap.append(range, pctEl);
    pill.append(muteBtn, wrap);

    hud = document.createElement('div');
    hud.className = 'hud';
    hudIcon = document.createElement('span');
    const bar = document.createElement('span');
    bar.className = 'bar';
    hudFill = document.createElement('i');
    bar.append(hudFill);
    hudTxt = document.createElement('span');
    hud.append(hudIcon, bar, hudTxt);

    sr.append(st, pill, hud);
    document.body.append(host);

    const stop = e => e.stopPropagation();
    pill.addEventListener('pointerdown', stop);
    pill.addEventListener('click', stop);
    muteBtn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!pillVideo) return;
      toggleMute(pillVideo);
      syncPill();
    });
    range.addEventListener('pointerdown', () => { dragging = true; pill.classList.add('open'); });
    const endDrag = () => { if (!dragging) return; dragging = false; pill.classList.remove('open'); };
    addEventListener('pointerup', endDrag, true);
    addEventListener('pointercancel', endDrag, true);
    range.addEventListener('input', () => {
      if (!pillVideo) return;
      const v = Math.max(0, Math.min(1, (+range.value || 0) / 100));
      setVol(pillVideo, v, v === 0);
      syncPill();
    });
    pill.addEventListener('wheel', e => {
      if (!pillVideo) return;
      e.preventDefault(); e.stopPropagation();
      const next = stepVol(pillVideo, e.deltaY < 0 ? 1 : -1);
      syncPill();
      showHud(pillVideo, next);
    }, { passive: false });
    pill.addEventListener('pointerenter', () => { clearTimeout(pillHideT); });
    pill.addEventListener('pointerleave', () => { if (!dragging) scheduleHidePill(); });
    return true;
  }

  function syncPopover() {
    if (!host || !host.isConnected) return;
    const need = (pill && pill.classList.contains('on')) || (hud && hud.classList.contains('on'));
    try {
      if (need && !popOpen) { host.showPopover(); popOpen = true; }
      else if (need && popOpen && !host.matches(':popover-open')) { host.showPopover(); }
      else if (!need && popOpen) { host.hidePopover(); popOpen = false; }
    } catch {}
  }

  function syncPill() {
    if (!pill || !pillVideo) return;
    const v = effVol(pillVideo);
    const pct = Math.round(v * 100);
    muteBtn.innerHTML = iconFor(v);
    range.value = String(pct);
    pctEl.textContent = pct + '%';
  }

  const onPillVolChange = () => { if (pillVideo) syncPill(); };

  function detachPill() {
    if (pillVideo) {
      pillVideo.removeEventListener('volumechange', onPillVolChange);
      pillVideo = null;
    }
    if (pill) pill.classList.remove('on', 'open');
    dragging = false;
    syncPopover();
  }

  function scheduleHidePill() {
    clearTimeout(pillHideT);
    pillHideT = setTimeout(() => { if (!dragging) detachPill(); }, 180);
  }

  function showPill(v) {
    if (!ensureUI()) return;
    clearTimeout(pillHideT);
    const r = v.getBoundingClientRect();
    if (r.width <= NARROW_MIN || r.width >= NARROW_MAX || r.height <= NARROW_MIN) { detachPill(); return; }
    if (pillVideo !== v) {
      if (pillVideo) pillVideo.removeEventListener('volumechange', onPillVolChange);
      pillVideo = v;
      pillVideo.addEventListener('volumechange', onPillVolChange);
    }
    pill.style.left = Math.max(6, Math.round(r.left + 8)) + 'px';
    pill.style.top = Math.max(6, Math.round(r.top + 8)) + 'px';
    syncPill();
    pill.classList.add('on');
    syncPopover();
  }

  function showHud(v, vol) {
    if (!ensureUI()) return;
    const r = v.getBoundingClientRect();
    const pct = Math.round(vol * 100);
    hudIcon.innerHTML = iconFor(vol);
    hudFill.style.width = pct + '%';
    hudTxt.textContent = pct === 0 ? 'Muted' : pct + '%';
    hud.style.left = Math.round(r.left + r.width / 2) + 'px';
    hud.style.top = Math.max(10, Math.round(r.top + 14)) + 'px';
    hud.classList.add('on');
    syncPopover();
    clearTimeout(hudHideT);
    hudHideT = setTimeout(() => {
      if (hud) hud.classList.remove('on');
      syncPopover();
    }, 850);
  }

  // ---------- RMB + wheel on any video ----------
  let suppressCtx = 0;
  addEventListener('pointerdown', e => {
    if (e.button === 2) suppressCtx = 0;
  }, true);

  addEventListener('wheel', e => {
    if ((e.buttons & 2) === 0) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    const v = videoFromPath(path);
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    suppressCtx = Date.now();
    const next = stepVol(v, e.deltaY < 0 ? 1 : -1);
    showHud(v, next);
    if (pillVideo === v) syncPill();
  }, { capture: true, passive: false });

  addEventListener('contextmenu', e => {
    if (suppressCtx && Date.now() - suppressCtx < 1500) {
      e.preventDefault();
      e.stopPropagation();
      suppressCtx = 0;
    }
  }, true);

  // ---------- hover pill for narrow videos ----------
  addEventListener('mouseover', e => {
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (host && path.includes(host)) { clearTimeout(pillHideT); return; }
    const v = videoFromPath(path);
    if (v && v.controls) {
      const r = v.getBoundingClientRect();
      if (r.width > NARROW_MIN && r.width < NARROW_MAX && r.height > NARROW_MIN) {
        showPill(v);
        return;
      }
    }
    if (pillVideo && !dragging) scheduleHidePill();
  }, true);

  const hideOnMove = () => { if (pillVideo && !dragging) detachPill(); };
  addEventListener('scroll', hideOnMove, { capture: true, passive: true });
  addEventListener('resize', hideOnMove, { passive: true });
})();

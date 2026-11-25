/* Extension build only: runs inside https://*.redgifs.com/ifr/* (all_frames: true).
   Replaces Redgifs Embed Tweaks: blocks click-to-open-redgifs.com, makes click play/pause, adds a hover
   volume slider synced with Reddit's video settings, auto-unmute, auto-HD, one-at-a-time playback,
   keyboard shortcuts, and a native download button. Controlled by Reddit's `redgifsTweaks` setting (default on). */
(() => {
  if (window === window.top) return;   // only embedded /ifr/ frames, never top-level redgifs.com
  const api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const PREF_KEY = 'bb:redgifs:prefs';
  const REDDIT_KEY = 'bb:mirror:settings:reddit';
  const idOf = () => (location.pathname.match(/\/ifr\/([a-z0-9]+)/i) || [])[1] || 'video';
  const stGet = keys => new Promise(r => { try { Promise.resolve(api.storage.local.get(keys)).then(r, () => r({})); } catch { r({}); } });
  const stSet = obj => { try { Promise.resolve(api.storage.local.set(obj)).catch(() => {}); } catch {} };

  const myToken = Math.random().toString(36).slice(2);
  let bc = null;
  try { bc = new BroadcastChannel('bb-redgifs-one'); } catch {}

  let cfg = { redgifsTweaks: true, videoMode: 'volume', videoVolume: 40, videoLoop: true, videoPauseOffscreen: true, videoPauseOnHide: true };
  let prefs = { volume: null, hd: true };
  let userMuted = false;

  function loadCfg() {
    return stGet([REDDIT_KEY, PREF_KEY]).then(r => {
      try {
        const raw = r[REDDIT_KEY] && r[REDDIT_KEY].raw;
        const parsed = raw ? JSON.parse(raw) : null;
        const s = parsed && (parsed.sync && parsed.sync.settings || parsed.settings || parsed);
        if (s && typeof s === 'object') Object.assign(cfg, s);
      } catch {}
      if (r[PREF_KEY] && typeof r[PREF_KEY] === 'object') Object.assign(prefs, r[PREF_KEY]);
    });
  }

  function injectCss() {
    if (document.getElementById('bb-rg-css')) return;
    const st = document.createElement('style');
    st.id = 'bb-rg-css';
    st.textContent = `
      .SoundButton { position: relative !important; }
      .bb-rg-vol {
        position: absolute; right: 100%; top: 50%; transform: translateY(-50%);
        width: 84px; height: 26px; margin-right: 6px; padding: 0 6px; border-radius: 999px;
        background: rgba(15, 17, 24, .82); backdrop-filter: blur(8px);
        display: none; align-items: center; z-index: 50;
      }
      .SoundButton:hover .bb-rg-vol, .bb-rg-vol:hover { display: flex; }
      .bb-rg-vol input { width: 100%; margin: 0; accent-color: #7eb8f0; cursor: pointer; }
      .bb-rg-dl {
        display: grid; place-items: center; width: 36px; height: 36px; margin-top: 6px;
        border: 0; border-radius: 50%; background: rgba(15, 17, 24, .65); color: #fff;
        cursor: pointer; transition: background .15s;
      }
      .bb-rg-dl:hover { background: rgba(15, 17, 24, .92); }
      .bb-rg-dl svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    `;
    (document.head || document.documentElement).append(st);
  }

  const wantVolume = () => Math.max(0, Math.min(1, prefs.volume != null ? +prefs.volume : (+cfg.videoVolume || 40) / 100));

  function applyAudio(video) {
    if (!video || userMuted) return;
    const vol = wantVolume();
    video.volume = vol;
    if (cfg.videoMode === 'muted' || vol === 0) {
      video.muted = true;
    } else if (cfg.videoMode === 'volume') {
      const offBtn = document.querySelector('.soundOff, [aria-label="Sound Off"]');
      if (offBtn) offBtn.click();
      if (video.muted) {
        video.muted = false;
        // If browser paused playback because audible autoplay isn't allowed yet, resume muted until first click
        if (video.paused && cfg.videoMode !== 'off') {
          video.muted = true;
          video.play().catch(() => {});
        }
      }
    }
  }

  function mountUi(video) {
    // 1. Block click-to-open-redgifs.com on the video's wrapping <a> and make click play/pause cleanly
    const link = video.closest('a[href]');
    if (link && !link._bbRgLink) {
      link._bbRgLink = true;
      link.addEventListener('click', e => {
        if (e.target.closest('.sidebar, button, input, .bb-rg-vol, .bb-rg-dl')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      }, true);
    }

    // 2. Track manual mute clicks on Redgifs' own sound button so we don't fight the user
    const soundBox = document.querySelector('.SoundButton');
    if (soundBox && !soundBox._bbRgBound) {
      soundBox._bbRgBound = true;
      soundBox.addEventListener('click', e => {
        if (e.isTrusted && !e.target.closest('.bb-rg-vol')) {
          if (soundBox.querySelector('.soundOn, [aria-label="Sound On"]')) userMuted = true;
          else userMuted = false;
        }
      }, true);
    }

    // 3. Hover volume slider inside .SoundButton
    if (soundBox && !soundBox.querySelector('.bb-rg-vol')) {
      const wrap = document.createElement('div');
      wrap.className = 'bb-rg-vol';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.02';
      slider.value = String(wantVolume());
      slider.setAttribute('aria-label', 'Volume');
      slider.addEventListener('input', e => {
        const v = +e.target.value;
        userMuted = v === 0;
        video.volume = v;
        video.muted = v === 0;
        prefs.volume = v;
        stSet({ [PREF_KEY]: prefs });
        if (v > 0) document.querySelector('.soundOff, [aria-label="Sound Off"]')?.click();
        else document.querySelector('.soundOn, [aria-label="Sound On"]')?.click();
      });
      for (const ev of ['click', 'pointerdown', 'mouseup']) wrap.addEventListener(ev, e => e.stopPropagation());
      wrap.append(slider);
      soundBox.append(wrap);
      video.addEventListener('volumechange', () => {
        if (!video.muted) slider.value = String(video.volume);
      });
    }

    // 4. Native download button in .sidebar
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !sidebar.querySelector('.bb-rg-dl')) {
      const dl = document.createElement('button');
      dl.type = 'button'; dl.className = 'bb-rg-dl'; dl.title = 'Download video'; dl.setAttribute('aria-label', 'Download video');
      dl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></svg>';
      dl.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const src = video.currentSrc || video.src;
        if (!src) return;
        const name = 'redgifs_' + idOf() + '.mp4';
        try {
          Promise.resolve(api.runtime.sendMessage({ type: 'bb-download', url: src, filename: name })).then(r => {
            if (!r || !r.ok) window.open(src, '_blank', 'noopener');
          }, () => window.open(src, '_blank', 'noopener'));
        } catch { window.open(src, '_blank', 'noopener'); }
      });
      sidebar.append(dl);
    }

    // 5. Auto-HD (click SD button once if prefs.hd is on)
    if (prefs.hd !== false) {
      const q = document.querySelector('.gifQualityButton');
      if (q && !q._bbRgHd && /\bSD\b/i.test(q.textContent || q.getAttribute('aria-label') || '')) {
        q._bbRgHd = true;
        q.click();
      }
    }
  }

  function enhance(video) {
    if (video._bbRg) { mountUi(video); return; }
    video._bbRg = true;
    injectCss();
    mountUi(video);

    video.loop = cfg.videoLoop !== false;
    if (cfg.videoMode === 'off') {
      video.autoplay = false;
      if (!video.paused) video.pause();
    } else {
      applyAudio(video);
    }

    // Redgifs' React often re-mutes on canplay/playing right after mount: enforce once playback starts
    let unmuteTries = 0;
    const retryAudio = () => {
      if (cfg.videoMode === 'volume' && !userMuted && video.muted && unmuteTries++ < 4) applyAudio(video);
    };
    video.addEventListener('canplay', retryAudio);
    video.addEventListener('playing', retryAudio);

    if (bc) {
      video.addEventListener('play', () => { try { bc.postMessage({ playing: myToken }); } catch {} });
      bc.addEventListener('message', e => {
        if (e.data && e.data.playing && e.data.playing !== myToken && !video.paused) video.pause();
      });
    }

    if (cfg.videoPauseOnHide !== false) {
      document.addEventListener('visibilitychange', () => { if (document.hidden && !video.paused) video.pause(); });
    }
    if (cfg.videoPauseOffscreen !== false) {
      new IntersectionObserver(entries => {
        for (const en of entries) if (!en.isIntersecting && !video.paused) video.pause();
      }, { threshold: 0.2 }).observe(video);
    }

    document.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); }
      else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); userMuted = !video.muted; video.muted = !video.muted; }
      else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else (video.requestFullscreen || document.documentElement.requestFullscreen)?.call(video)?.catch?.(() => {});
      }
    });
  }

  loadCfg().then(() => {
    if (cfg.redgifsTweaks === false) return;
    const tick = () => {
      const v = document.querySelector('video');
      if (v) enhance(v);
    };
    tick();
    // Keep watching briefly while React hydrates .SoundButton / .sidebar after <video> mounts
    const mo = new MutationObserver(tick);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 12000);
  });
})();

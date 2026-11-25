/* X Fast UI MV3 extension content-script bridge.
   Runs right after defaults.js in the extension's isolated world:
     - Exposes XBB.ext ({ isExt, dev, blocking(), setBlock(on, opts), log(level, ...args) })
     - Syncs DNR block state so views/home.js knows when X's JS is blocked (0 ms boot fetch)
     - Auto-enables Zero-JS DNR blocking once HomeTimeline + auth are cached in localStorage
     - In dev builds, forwards [XBB ...] warnings/errors and longtask timings (>50 ms) to the
       local dev server log file via the background service worker. */
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const DEV = __XBB_DEV__;
  const LS_OPS = 'xbb-gql-ops-v1';
  const BLOCK_SNAP = 'xbb-ext-blocking';
  const root = document.documentElement;

  let blocking = false;
  try { blocking = localStorage.getItem(BLOCK_SNAP) === '1'; } catch {}
  if (blocking) root.setAttribute('data-xbb-ext-block', '1');

  function send(msg) {
    return new Promise(resolve => {
      try {
        api.runtime.sendMessage(msg, res => {
          if (api.runtime && api.runtime.lastError) { resolve(null); return; }
          resolve(res || null);
        });
      } catch { resolve(null); }
    });
  }

  function hasCachedHome() {
    try {
      const c = JSON.parse(localStorage.getItem(LS_OPS) || 'null');
      return !!(c && c.auth && c.ops && c.ops.HomeTimeline && c.ops.HomeTimeline.queryId && c.ops.HomeTimeline.liveVars);
    } catch { return false; }
  }

  function setLocalBlock(on) {
    blocking = !!on;
    try { localStorage.setItem(BLOCK_SNAP, blocking ? '1' : '0'); } catch {}
    if (blocking) root.setAttribute('data-xbb-ext-block', '1');
    else root.removeAttribute('data-xbb-ext-block');
  }

  async function setBlock(on, opts = {}) {
    setLocalBlock(!!on);
    const res = await send({ type: 'xbb-ext-set', block: !!on, reload: !!opts.reload, url: opts.url || '', reason: opts.reason || '' });
    if (res && typeof res.blocking === 'boolean') setLocalBlock(res.blocking);
    return blocking;
  }

  const ser = a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean' || a == null) return a;
    try { return JSON.parse(JSON.stringify(a)); } catch { return String(a); }
  };
  function log(level, ...args) {
    if (!DEV) return;
    send({ type: 'xbb-dev-log', level, args: args.map(ser) });
  }

  XBB.ext = {
    isExt: true,
    dev: DEV,
    blocking: () => blocking,
    hasCachedHome,
    setBlock,
    log
  };

  // Sync actual DNR state from background worker on boot
  send({ type: 'xbb-ext-get' }).then(res => {
    if (!res) return;
    setLocalBlock(!!res.blocking);
    const s = XBB.settings || {};
    const wantFast = !!s.fastUi && !new URLSearchParams(location.search).has('xbb');
    const isHome = location.pathname === '/' || location.pathname === '/home';
    // Safety: if blocking is ON but we haven't learned HomeTimeline + auth yet, un-block and reload once to learn
    if (blocking && wantFast && isHome && !hasCachedHome()) {
      log('warn', '[XBB ext] blocking was on without cached HomeTimeline/auth — reloading natively once to learn');
      setBlock(false, { reload: true, reason: 'need-learn' });
    }
    // If blocking is OFF, Fast UI is ON on /home, and we ALREADY have HomeTimeline + auth cached:
    // enable DNR blocking right away for next load (and reload once if X's heavy JS is currently running)
    if (!blocking && wantFast && isHome && hasCachedHome()) {
      log('info', '[XBB ext] HomeTimeline cached — enabling Zero-JS DNR blocking');
      setBlock(true, { reload: false, reason: 'auto-enable' });
    }
  });

  // Toolbar icon click -> open settings panel
  if (api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(msg => {
      if (msg && msg.type === 'xbb-open-settings' && XBB.openSettings) XBB.openSettings();
    });
  }

  // Dev mode: stream [XBB ...] warnings/errors + long tasks (>50 ms) to local dev server
  if (DEV) {
    for (const lvl of ['warn', 'error']) {
      const orig = console[lvl];
      console[lvl] = function (...args) {
        try {
          if (args.some(a => typeof a === 'string' && a.indexOf('[XBB') !== -1)) log(lvl, ...args);
        } catch {}
        return orig.apply(this, args);
      };
    }
    try {
      let ltCount = 0;
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (e.duration >= 50 && ltCount++ < 60) {
            log('perf', 'LONG TASK', Math.round(e.duration) + 'ms', { blocking, path: location.pathname });
          }
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch {}
    window.addEventListener('error', e => log('error', 'window.error', e.message, e.filename + ':' + e.lineno));
    log('info', '[XBB ext] content script loaded', { path: location.pathname, blocking, cachedHome: hasCachedHome(), fastUi: !!(XBB.settings && XBB.settings.fastUi) });
  }
})();

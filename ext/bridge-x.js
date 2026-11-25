/* Extension build only, X only (right after ext/bridge.js): Zero-JS DNR blocking of X's own bundle while Fast UI
   owns the page. Adds to `XBB.ext`: blocking(), hasCachedHome(), setBlock(on, opts).
     - the worker keeps the real state (`bb:block:x`, the DNR rules); `<html data-xbb-ext-block>` and
       localStorage `xbb-ext-blocking` mirror it so the first paint knows before the worker answers
     - auto-enable: Fast UI on, on /home, HomeTimeline + auth already learned -> block from the next load
     - auto-learn: blocking on but HomeTimeline/auth not learned yet -> un-block and reload once, natively
     - the escape hatches (Native X, Alt+Shift+X, ?xbb=native, breaker) call setBlock(false, { reload: true }) */
(() => {
  const { send } = bbExt, log = XBB.ext.log;
  const LS_OPS = 'xbb-gql-ops-v1', BLOCK_SNAP = 'xbb-ext-blocking';
  const root = document.documentElement;

  let blocking = false;
  try { blocking = localStorage.getItem(BLOCK_SNAP) === '1'; } catch {}
  if (blocking) root.setAttribute('data-xbb-ext-block', '1');

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
    const res = await send({ type: 'bb-ext-set', site: 'x', block: !!on, reload: !!opts.reload, url: opts.url || '', reason: opts.reason || '' });
    if (res && typeof res.blocking === 'boolean') setLocalBlock(res.blocking);
    return blocking;
  }
  Object.assign(XBB.ext, { blocking: () => blocking, hasCachedHome, setBlock });

  // Sync the real DNR state from the worker on boot
  send({ type: 'bb-ext-get', site: 'x' }).then(res => {
    if (!res) return;
    setLocalBlock(!!res.blocking);
    const s = XBB.settings || {};
    const wantFast = !!s.fastUi && !new URLSearchParams(location.search).has('xbb');
    const isHome = location.pathname === '/' || location.pathname === '/home';
    // blocking is on but HomeTimeline + auth are not learned yet: un-block and reload once, to learn natively
    if (blocking && wantFast && isHome && !hasCachedHome()) {
      log('warn', '[XBB ext] blocking was on without cached HomeTimeline/auth: reloading natively once to learn');
      setBlock(false, { reload: true, reason: 'need-learn' });
    }
    // blocking is off, Fast UI is on, /home, and everything is learned: block from the next load on
    if (!blocking && wantFast && isHome && hasCachedHome()) {
      log('info', '[XBB ext] HomeTimeline cached: enabling Zero-JS DNR blocking');
      setBlock(true, { reload: false, reason: 'auto-enable' });
    }
  });
  log('info', '[XBB ext] x bridge', { blocking, cachedHome: hasCachedHome(), fastUi: !!(XBB.settings && XBB.settings.fastUi) });
})();

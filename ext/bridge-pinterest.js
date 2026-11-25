/* Extension build only, Pinterest only (right after ext/bridge.js): Zero-JS DNR blocking of Pinterest's own app
   bundle (s.pinimg.com/webapp/) while Fast UI owns the page. Adds to `PIN.ext`: blocking(), hasLearnedHome(),
   setBlock(on, opts). Same shape as ext/bridge-x.js.
     - the worker keeps the real state (`bb:block:pinterest`, DNR rules 2001..2002); `<html data-pin-ext-block>` and
       localStorage `pin-ext-blocking` mirror it so the first paint knows before the worker answers
     - auto-enable: Fast UI on and owning Home, UserHomefeedResource's template learned (pin-ops-v1) -> block from
       the next load on
     - auto-learn: blocking on but nothing learned yet -> un-block and reload once, natively
     - the escape hatches (Native Pinterest, Alt+Shift+P, ?pin=native, a breaker) call setBlock(false, { reload })
     - safety net: a page loaded with the rules on that Fast UI does not own by DOMContentLoaded (another route, the
       setting off) gets the rules dropped and one reload (sessionStorage `pin-fast-reloaded` stops a loop) */
(() => {
  const { send } = bbExt, log = PIN.ext.log;
  const LS_OPS = 'pin-ops-v1', BLOCK_SNAP = 'pin-ext-blocking', RELOADED = 'pin-fast-reloaded';
  const root = document.documentElement;

  let blocking = false;
  try { blocking = localStorage.getItem(BLOCK_SNAP) === '1'; } catch {}
  if (blocking) root.setAttribute('data-pin-ext-block', '1');

  function hasLearnedHome() {
    try {
      const c = JSON.parse(localStorage.getItem(LS_OPS) || 'null');
      const o = c && c.v === 1 && c.ops && c.ops['UserHomefeedResource/get'];
      return !!(o && o.options && typeof o.options === 'object' && o.handler);
    } catch { return false; }
  }
  function setLocalBlock(on) {
    blocking = !!on;
    try { localStorage.setItem(BLOCK_SNAP, blocking ? '1' : '0'); } catch {}
    if (blocking) root.setAttribute('data-pin-ext-block', '1');
    else root.removeAttribute('data-pin-ext-block');
  }
  async function setBlock(on, opts = {}) {
    setLocalBlock(!!on);
    const res = await send({ type: 'bb-ext-set', site: 'pinterest', block: !!on, reload: !!opts.reload, url: opts.url || '', reason: opts.reason || '' });
    if (res && typeof res.blocking === 'boolean') setLocalBlock(res.blocking);
    return blocking;
  }
  Object.assign(PIN.ext, { blocking: () => blocking, hasLearnedHome, setBlock });

  const fastState = () => (PIN.fast && typeof PIN.fast.state === 'function' ? PIN.fast.state() : null);

  // Sync the real DNR state from the worker on boot
  send({ type: 'bb-ext-get', site: 'pinterest' }).then(res => {
    if (!res) return;
    setLocalBlock(!!res.blocking);
    const s = fastState();
    if (!s || !s.on) return;
    const learned = hasLearnedHome();
    if (blocking && s.owned && !learned) {
      log('warn', '[PIN ext] blocking was on without a learned UserHomefeedResource: reloading natively once to learn');
      setBlock(false, { reload: true, reason: 'need-learn' });
      return;
    }
    if (!blocking && s.owned && s.route === 'home' && learned) {
      log('info', '[PIN ext] UserHomefeedResource learned: enabling Zero-JS DNR blocking from the next load');
      setBlock(true, { reload: false, reason: 'auto-enable' });
    }
  });
  // Learned during this (unblocked) load: enable from the next one
  // (the rules only change what the next load fetches; this page keeps running unblocked)
  let asked = false;
  document.addEventListener('pin-api-tap', () => {
    if (blocking || asked) return;
    const s = fastState();
    if (s && s.owned && s.route === 'home' && hasLearnedHome()) { asked = true; send({ type: 'bb-ext-set', site: 'pinterest', block: true, reason: 'auto-enable' }); try { localStorage.setItem(BLOCK_SNAP, '1'); } catch {} }
  });

  // Safety net: the rules are on but nobody owns this page (no app will run): drop them and reload once
  addEventListener('DOMContentLoaded', () => {
    if (!blocking) { try { sessionStorage.removeItem(RELOADED); } catch {} return; }
    const s = fastState();
    if (s && s.owned) { try { sessionStorage.removeItem(RELOADED); } catch {} return; }
    let again = false;
    try { again = sessionStorage.getItem(RELOADED) === '1'; sessionStorage.setItem(RELOADED, '1'); } catch {}
    log('warn', '[PIN ext] rules on but the page is not Fast UI\'s: un-blocking' + (again ? '' : ' and reloading'));
    setBlock(false, { reload: !again, reason: 'not-owned' });
  });
  log('info', '[PIN ext] pinterest bridge', { blocking, learned: hasLearnedHome() });
})();

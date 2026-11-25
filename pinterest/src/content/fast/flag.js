/* Pinterest Fast UI: who owns the page. Runs at document-start, before Pinterest paints anything.
   <html data-pin-fast="home"> while Fast UI owns the route (content.css hides every other child of <body>: in the
   userscript Pinterest's app keeps running underneath, unpainted), "native" while the user asked for Pinterest's own
   page, absent otherwise (setting off, a route we do not own, a route whose breaker tripped).
     PIN.fast.state()          { on, route, owned, escaped, broken }
     PIN.fast.onChange(fn)     fn(state) when that changes
     PIN.fast.toNative(url?)   no url: Pinterest's own page here (the escape hatch); a url: hand that page to Pinterest
     PIN.fast.toFast()         back to Fast UI
     PIN.fast.fail(route, why, hard)   one hard failure (the route's primary resource breaker, a schema failure, a
                               signed-out session) or three soft ones in 5 minutes: Pinterest gets the route back for
                               the rest of the session. Only UserHomefeedResource can fail Home; comments, related
                               pins and the pin itself are the viewer's own inline notes.
     PIN.fast.ov               the viewer as history entries: push(next) / replace(next) / back() / closeAll() / get()
                               / onChange(fn). Each open pin is one entry { pin: 1, overlay: 'pin', base: 'home',
                               ov: JSON string { stack: [ids], i, y } } (primitives only, for Firefox's Xray wrappers);
                               the route stays `base` while the URL says /pin/<id>/, so Back closes one level and Home
                               never unmounts. Pinterest's router never sees those popstates.
   Alt+Shift+P switches either way, ?pin=native (or ?pinbb=native) starts on Pinterest's page, and a "Fast UI" entry in
   Pinterest's sidebar switches back. */
(() => {
  const fast = PIN.fast = PIN.fast || {};
  const root = document.documentElement;
  const ATTR = 'data-pin-fast';
  const BROKEN_KEY = 'pin-fast-broken', NATIVE_KEY = 'pin-fast-native';
  const ROUTES = { home: p => p === '/' || p === '/homefeed/' || p === '/homefeed' };
  // Only the primary resource of a route can hand it back to Pinterest
  const ROUTE_OPS = { home: ['UserHomefeedResource/get'] };
  const LABEL = { home: 'Home' };
  const routeOf = (path = location.pathname) => { for (const k in ROUTES) if (ROUTES[k](path)) return k; return null; };
  const ovState = () => {
    let s;
    try { s = history.state; } catch { return null; }
    if (!s || typeof s !== 'object' || s.pin !== 1 || typeof s.base !== 'string' || !ROUTES[s.base] || typeof s.ov !== 'string') return null;
    try { const o = JSON.parse(s.ov); return o && typeof o === 'object' ? Object.assign(o, { base: s.base }) : null; } catch { return null; }
  };
  const here = () => location.pathname + location.search + location.hash;

  let broken = {};
  try { broken = JSON.parse(sessionStorage.getItem(BROKEN_KEY) || '{}') || {}; } catch {}
  if (typeof broken !== 'object') broken = {};
  let escaped = false;
  try {
    const q = new URLSearchParams(location.search);
    escaped = q.get('pin') === 'native' || q.get('pinbb') === 'native' || sessionStorage.getItem(NATIVE_KEY) === '1';
  } catch {}
  const fails = {}, warned = new Set(), listeners = new Set();
  let state = null;

  const enabled = () => !!PIN.settings.fastUi && Object.keys(broken).length < 2;
  function compute() {
    const ovs = ovState();
    const on = enabled(), route = (ovs && ovs.base) || routeOf();
    return { on, route, owned: on && !escaped && !!route && !broken[route], escaped: on && escaped, broken: (route && broken[route]) || null };
  }
  const themeOf = s => { const v = s && s.fastUiTheme; if (v === 'black' || v === 'dim' || v === 'light') return v; try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'black' : 'light'; } catch { return 'light'; } };
  let ovWas = false;
  function update() {
    const s = compute();
    const attr = s.owned ? s.route : s.escaped ? 'native' : null;
    if (attr) { if (root.getAttribute(ATTR) !== attr) root.setAttribute(ATTR, attr); }
    else if (root.hasAttribute(ATTR)) root.removeAttribute(ATTR);
    const t = themeOf(PIN.settings);
    if (root.getAttribute('data-pin-theme') !== t) root.setAttribute('data-pin-theme', t);
    // the tap is only worth its cost while Fast UI may need Pinterest's answers
    fast.api && fast.api.tap(s.on && !s.escaped);
    const changed = !state || state.on !== s.on || state.route !== s.route || state.owned !== s.owned || state.escaped !== s.escaped;
    state = s;
    PIN.ext && PIN.ext.log('info', '[PIN flag] state', { on: s.on, route: s.route, owned: s.owned, escaped: s.escaped, broken: s.broken, attr: root.getAttribute(ATTR), host: !!document.querySelector('pin-fast') });
    if (changed) for (const fn of [...listeners]) { try { fn(s); } catch (e) { console.error('[PIN fast]', e); } }
    ovWas = !!(s.owned && ovState());
    syncEntry();
    emitOv(false);
    return s;
  }

  // ---------- the viewer in the history ----------
  const NONE = Object.freeze({ stack: [], i: -1, depth: 0, y: 0 });
  const ovListeners = new Set();
  let ovKey = '[]', ovY = 0;
  function ovCurrent() {
    const o = state && state.owned ? ovState() : null;
    if (!o) return NONE;
    const stack = Array.isArray(o.stack) ? o.stack.filter(x => typeof x === 'string' && /^\d{1,24}$/.test(x)).slice(-30) : [];
    return { stack, i: o.i | 0, depth: Math.max(0, o.depth | 0), y: +o.y || 0 };
  }
  // Pinterest's router may scroll on a popstate; closing the viewer puts the feed back on its exact pixel
  function restoreY(y) {
    const fix = () => { if (state && state.owned && !ovState() && Math.abs(scrollY - y) > 0.5) scrollTo(0, y); };
    fix(); requestAnimationFrame(fix); setTimeout(fix, 120);
  }
  function emitOv(force) {
    const c = ovCurrent();
    const k = JSON.stringify(c.stack);
    if (!force && k === ovKey) return;
    const wasOpen = ovKey !== '[]', isOpen = c.stack.length > 0;
    ovKey = k;
    if (wasOpen && !isOpen && state && state.owned) restoreY(ovY);
    if (isOpen) ovY = c.y;
    for (const fn of [...ovListeners]) { try { fn(c); } catch (e) { console.error('[PIN fast]', e); } }
  }
  const ovEntry = (next, depth, y) => ({ pin: 1, overlay: 'pin', base: state.route, ov: JSON.stringify({ stack: (next.stack || []).slice(-30), i: next.i | 0, depth, y }) });
  const pinUrl = next => { const id = (next.stack || [])[next.stack.length - 1]; return id ? '/pin/' + id + '/' : here(); };
  let going = 0, pendingNative = false;
  function go(n) {
    if (going && Date.now() - going < 1000) return;    // one history.go at a time (Esc + the dialog's cancel)
    going = Date.now();
    history.go(n);
  }
  // Moving between our entries, or from one back to the route's own entry, is ours alone: Pinterest's router never
  // saw those URLs (pushState) and would render the close-up underneath. Capture on window runs before its listener.
  addEventListener('popstate', e => {
    going = 0;
    const was = ovWas;
    update();
    if (state && state.owned && (was || ovState())) e.stopImmediatePropagation();
    if (pendingNative && !ovState()) { pendingNative = false; fast.toNative(); }
  }, true);
  const ov = {
    get: ovCurrent,
    onChange(fn) { ovListeners.add(fn); return () => ovListeners.delete(fn); },
    push(next) {
      if (!state || !state.owned) return false;
      const c = ovCurrent();
      try { history.pushState(ovEntry(next, c.depth + 1, c.depth ? c.y : scrollY), '', pinUrl(next)); } catch { return false; }
      update();
      return true;
    },
    replace(next) {
      const c = ovCurrent();
      if (!state || !state.owned || !c.depth) return ov.push(next);
      try { history.replaceState(ovEntry(next, c.depth, c.y), '', pinUrl(next)); } catch { return false; }
      update();
      return true;
    },
    back(n = 1) { if (n > 0) go(-n); },
    closeAll() { const c = ovCurrent(); if (c.depth) go(-c.depth); },
    isOurs: () => !!ovState(),
    // tell the listeners again (the viewer could not paint before <body> existed)
    emit: () => emitOv(true)
  };

  // ---------- toast (light DOM: it must show while Pinterest's own page is up, too) ----------
  let toastEl = null, toastT = 0;
  function toast(msg) {
    if (!document.body) { addEventListener('DOMContentLoaded', () => toast(msg), { once: true }); return; }
    if (!toastEl || !toastEl.isConnected) {
      toastEl = PIN.h('div', { class: 'pin-root pin-fast-toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 3600);
  }

  const ext = () => (PIN.ext && typeof PIN.ext.blocking === 'function' ? PIN.ext : null);
  Object.assign(fast, {
    routeOf, toast, ov, LABEL, ROUTE_OPS, themeOf,
    state: () => state || compute(),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    update,
    // Anything Fast UI does not own (search until M2, Explore, a pin opened in a new tab) is a normal page load
    toNative(url) {
      if (url) {
        let u;
        try { u = new URL(url, location.href); } catch { return; }
        const e = ext();
        if (e && e.blocking()) { e.setBlock(false, { reload: true, url: u.href, reason: 'hand-off' }); return; }
        location.assign(u.href);
        return;
      }
      // the viewer is open: close it first (its entries are ours; Pinterest never saw them), then escape
      if (state && state.owned && ovCurrent().depth) { pendingNative = true; ov.closeAll(); return; }
      const e = ext();
      if (e && e.blocking()) {
        try { sessionStorage.setItem(NATIVE_KEY, '1'); } catch {}
        const u = new URL(location.href);
        u.searchParams.set('pin', 'native');
        e.setBlock(false, { reload: true, url: u.href, reason: 'to-native' });
        return;
      }
      escaped = true;
      update();
    },
    toFast() {
      if (!PIN.settings.fastUi) return;
      try { sessionStorage.removeItem(NATIVE_KEY); } catch {}
      const r = routeOf();
      if (r && broken[r]) { toast(`Fast UI is off for ${LABEL[r]} until this tab is closed (Pinterest changed something)`); return; }
      const e = ext();
      if (e && !e.blocking() && fast.api && fast.api.ready()) {
        const u = new URL(r ? location.href : '/', location.href);
        u.searchParams.delete('pin'); u.searchParams.delete('pinbb');
        e.setBlock(true, { reload: true, url: u.href, reason: 'to-fast' });
        return;
      }
      escaped = false;
      if (!r) { location.assign('/'); return; }
      update();
    },
    isBroken: r => !!broken[r],
    fail(route, reason, hard) {
      if (!route || broken[route]) return;
      const now = Date.now();
      const list = fails[route] = (fails[route] || []).filter(t => now - t < 5 * 60 * 1000);
      list.push(now);
      if (!warned.has(route + reason)) { warned.add(route + reason); console.warn('[PIN fast]', route, reason); }
      if (!hard && list.length < 3) return;
      broken[route] = String(reason || 'failed').slice(0, 200);
      try { sessionStorage.setItem(BROKEN_KEY, JSON.stringify(broken)); } catch {}
      const was = state && state.owned && state.route === route;
      update();
      const e = ext();
      if (was && e && e.blocking()) { e.setBlock(false, { reload: true, reason: 'breaker:' + route }); return; }
      if (was) toast(/signed-out/.test(reason) ? 'Sign in on Pinterest to use Fast UI; showing Pinterest\'s own page'
        : `Pinterest changed something; showing its own page for ${LABEL[route] || route}`);
    }
  });

  // An API breaker open on a route's primary resource: that route is Pinterest's
  fast.api && fast.api.breaker.onChange((name, st) => {
    if (!st || st.state !== 'open' || !PIN.settings.fastUi) return;
    for (const r in ROUTE_OPS) if (ROUTE_OPS[r].includes(name)) fast.fail(r, `api ${name}: ${st.kind}${st.status ? ' ' + st.status : ''}`, true);
  });

  // ---------- following Pinterest's router ----------
  addEventListener('popstate', () => update());
  let lastPath = location.pathname;
  PIN.onDomChange(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; update(); } }, 300, 'fast-route');

  addEventListener('keydown', e => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyP') return;
    const s = PIN.settings;
    if (!s.fastUi || s.fastUiKeys === false) return;
    e.preventDefault(); e.stopPropagation();
    if (state && state.owned) fast.toNative(); else fast.toFast();
  }, true);

  // ---------- "Fast UI" entry in Pinterest's sidebar, while its own page is up ----------
  // A clone of one of its nav items (like settings.js's entry), never selected by class name.
  const BOLT = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>';
  function syncEntry() {
    const want = !!(state && state.on && !state.owned && document.body);
    const cur = document.querySelectorAll('.pin-fast-entry');
    if (!want) { cur.forEach(n => n.remove()); return; }
    if (cur.length && cur[0].isConnected && cur[0].parentElement && cur[0].parentElement.querySelector('[data-test-id="vertical-nav-icon"]')) return;
    cur.forEach(n => n.remove());
    const src = document.querySelector('[data-test-id="vertical-nav-icon"]');
    const a0 = src && src.querySelector('a');
    if (!a0) return;
    const node = src.cloneNode(true);
    node.classList.add('pin-fast-entry');
    node.removeAttribute('data-test-id');
    node.querySelectorAll('[data-test-id]').forEach(el => el.removeAttribute('data-test-id'));
    node.querySelectorAll('[aria-label]').forEach(el => el.setAttribute('aria-label', 'Fast UI'));
    const a = node.querySelector('a');
    a.setAttribute('href', '/');
    a.setAttribute('role', 'button');
    a.setAttribute('title', 'Better Browsing Fast UI (Alt+Shift+P)');
    a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fast.toFast(); });
    const svg = a.querySelector('svg');
    if (svg) { svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'currentColor'); svg.innerHTML = BOLT; }
    const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (walk.currentNode.textContent.trim() && !walk.currentNode.parentElement.closest('svg')) walk.currentNode.textContent = 'Fast UI';
    src.parentElement.insertBefore(node, src);
  }
  PIN.onDomChange(() => { if (state && state.on && !state.owned) syncEntry(); }, 600, 'fast-entry');
  addEventListener('DOMContentLoaded', () => syncEntry());

  // First call happens now, from the settings snapshot: the attribute is there before Pinterest's first paint
  PIN.onSettings(() => update());
})();

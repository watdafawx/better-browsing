/* Pinterest Fast UI: who owns the page. Runs at document-start, before Pinterest paints anything.
   <html data-pin-fast="home"> while Fast UI owns the route (content.css hides every other child of <body>: in the
   userscript Pinterest's app keeps running underneath, unpainted), "native" while the user asked for Pinterest's own
   page, absent otherwise (setting off, a route we do not own, a route whose breaker tripped).
     PIN.fast.state()          { on, route, owned, escaped, broken }
     PIN.fast.onChange(fn)     fn(state) when that changes
     PIN.fast.toNative(url?)   no url: Pinterest's own page here (the escape hatch); a url: hand that page to Pinterest
     PIN.fast.toFast()         back to Fast UI
     PIN.fast.go(url)          an owned route renders here (pushState, a history entry of ours; Pinterest's router
                               never sees it), anything else is fast.toNative(url). The viewer closes first.
     PIN.fast.baseUrl()        the URL the current view shows (the viewer's entries keep it in `u`)
     PIN.fast.onNav(fn)        fn(state) when that URL changes; PIN.fast.navKind() 'load' | 'push' | 'pop'
     PIN.fast.fail(route, why, hard)   one hard failure (the route's primary resource breaker, a schema failure, a
                               signed-out session) or three soft ones in 5 minutes: Pinterest gets the route back for
                               the rest of the session. Only UserHomefeedResource can fail Home; comments, related
                               pins and the pin itself are the viewer's own inline notes.
     PIN.fast.ov               the viewer as history entries: push(next) / replace(next) / back() / closeAll() / get()
                               / onChange(fn). Each open pin is one entry { pin: 1, overlay: 'pin', base: 'home',
                               ov: JSON string { stack: [ids], i, y, u } } (primitives only, for Firefox's Xray
                               wrappers; `u` is the base view's URL);
                               the route stays `base` while the URL says /pin/<id>/, so Back closes one level and Home
                               never unmounts. Pinterest's router never sees those popstates.
   Alt+Shift+P switches either way, ?pin=native (or ?pinbb=native) starts on Pinterest's page, and a "Fast UI" entry in
   Pinterest's sidebar switches back. */
(() => {
  const fast = PIN.fast = PIN.fast || {};
  const root = document.documentElement;
  const ATTR = 'data-pin-fast';
  const BROKEN_KEY = 'pin-fast-broken', NATIVE_KEY = 'pin-fast-native';
  // First path segments that are never a username: add to it before Pinterest ships a new top-level page, or Fast UI
  // takes that page for a profile.
  const RESERVED = new Set(['pin', 'search', 'settings', 'ideas', 'today', 'business', 'about', 'login', 'signup', 'logout',
    'password', 'resource', 'api', 'oauth', '_', 'notifications', 'messages', 'homefeed', 'pin-creation-tool', 'pin-builder',
    'explore', 'shopping', 'news_hub', 'videos', 'topics', 'categories', 'discover', 'creators', 'edit', 'convert',
    'secure', 'help', 'terms', 'privacy', 'ads', 'analytics', 'me', 'board', 'boards', 'user', 'users', 'following',
    'invite', 'join', 'download', 'offsite', 'amp', 'story', 'idea-pin-builder', 'creator-hub', 'brand', 'partner']);
  const USER = /^[A-Za-z0-9_]{1,64}$/;
  const segs = p => String(p || '').split('/').filter(Boolean);
  const userSeg = s => !!s && USER.test(s) && !RESERVED.has(s.toLowerCase());
  const ROUTES = {
    home: p => p === '/' || p === '/homefeed/' || p === '/homefeed',
    search: p => p === '/search/pins/' || p === '/search/pins',
    // /<user>/, /<user>/_saved/, /<user>/_created/
    profile: p => { const s = segs(p); return userSeg(s[0]) && (s.length === 1 || (s.length === 2 && (s[1] === '_saved' || s[1] === '_created'))); },
    // /<user>/<board>/ (never a _tab)
    board: p => { const s = segs(p); return s.length === 2 && userSeg(s[0]) && !s[1].startsWith('_'); }
  };
  // Only the primary resource of a route can hand it back to Pinterest. The other views never fail their route: an
  // answer they cannot use is their own banner with "Open on Pinterest" (one unvisited page type never turns Fast UI off).
  const ROUTE_OPS = { home: ['UserHomefeedResource/get'] };
  const LABEL = { home: 'Home', search: 'Search', profile: 'Profile', board: 'Board' };
  const routeOf = (path = location.pathname) => { for (const k in ROUTES) if (ROUTES[k](path)) return k; return null; };
  const ovState = () => {
    let s;
    try { s = history.state; } catch { return null; }
    if (!s || typeof s !== 'object' || s.pin !== 1 || typeof s.base !== 'string' || !ROUTES[s.base] || typeof s.ov !== 'string') return null;
    try { const o = JSON.parse(s.ov); return o && typeof o === 'object' ? Object.assign(o, { base: s.base }) : null; } catch { return null; }
  };
  const here = () => location.pathname + location.search + location.hash;
  const isOurs = () => { try { const s = history.state; return !!(s && typeof s === 'object' && s.pin === 1); } catch { return false; } };
  // The URL Pinterest's own app (userscript: it keeps running underneath) last rendered: an entry it made or the one
  // this document loaded with. Our own entries never reach its router.
  let appUrl = here();
  const landedUrl = here();
  let navKind = 'load', navBase = null, navved = false;
  const navListeners = new Set();

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
    if (!isOurs()) appUrl = here();
    PIN.ext && PIN.ext.log('info', '[PIN flag] state', { on: s.on, route: s.route, owned: s.owned, escaped: s.escaped, broken: s.broken, attr: root.getAttribute(ATTR), host: !!document.querySelector('pin-fast') });
    if (changed) for (const fn of [...listeners]) { try { fn(s); } catch (e) { console.error('[PIN fast]', e); } }
    const bu = s.owned ? baseUrl() : null;
    if (bu !== navBase) { navBase = bu; if (bu != null) for (const fn of [...navListeners]) { try { fn(s); } catch (e) { console.error('[PIN fast]', e); } } }
    ovWas = !!(s.owned && isOurs());
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
    return { stack, i: o.i | 0, depth: Math.max(0, o.depth | 0), y: +o.y || 0, u: typeof o.u === 'string' && o.u.charAt(0) === '/' ? o.u : '' };
  }
  function baseUrl() { const o = ovState(); return o ? (typeof o.u === 'string' && o.u.charAt(0) === '/' ? o.u : '/') : here(); }
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
  const ovEntry = (next, depth, y, u) => ({ pin: 1, overlay: 'pin', base: state.route, ov: JSON.stringify({ stack: (next.stack || []).slice(-30), i: next.i | 0, depth, y, u }) });
  const pinUrl = next => { const id = (next.stack || [])[next.stack.length - 1]; return id ? '/pin/' + id + '/' : here(); };
  let going = 0, pendingNative = false, pendingGo = null;
  function go(n) {
    if (going && Date.now() - going < 1000) return;    // one history.go at a time (Esc + the dialog's cancel)
    going = Date.now();
    history.go(n);
  }
  // Moving between our entries (the viewer's, and the views fast.go pushed), or from one back to an entry of
  // Pinterest's, is ours alone: Pinterest's router never saw those URLs (pushState) and would render them underneath.
  // Capture on window runs before its listener.
  addEventListener('popstate', e => {
    going = 0;
    const was = ovWas;
    navKind = 'pop';
    update();
    if (state && state.owned && (was || isOurs())) e.stopImmediatePropagation();
    if (pendingNative && !ovState()) { pendingNative = false; fast.toNative(); }
    if (pendingGo && !ovState()) { const u = pendingGo; pendingGo = null; fast.go(u); }
  }, true);
  const ov = {
    get: ovCurrent,
    onChange(fn) { ovListeners.add(fn); return () => ovListeners.delete(fn); },
    push(next) {
      if (!state || !state.owned) return false;
      const c = ovCurrent();
      try { history.pushState(ovEntry(next, c.depth + 1, c.depth ? c.y : scrollY, c.depth ? c.u : here()), '', pinUrl(next)); } catch { return false; }
      update();
      return true;
    },
    replace(next) {
      const c = ovCurrent();
      if (!state || !state.owned || !c.depth) return ov.push(next);
      try { history.replaceState(ovEntry(next, c.depth, c.y, c.u), '', pinUrl(next)); } catch { return false; }
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
    routeOf, toast, ov, LABEL, ROUTE_OPS, RESERVED, themeOf, baseUrl,
    state: () => state || compute(),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onNav(fn) { navListeners.add(fn); return () => navListeners.delete(fn); },
    navKind: () => navKind,
    // this document's first URL, and nothing navigated since (Pinterest's own app may still ask for this page itself)
    landed: () => !navved && here() === landedUrl,
    update,
    go(url) {
      let u;
      try { u = new URL(url, location.href); } catch { return false; }
      if (u.origin !== location.origin) { location.assign(u.href); return false; }
      const r = routeOf(u.pathname);
      const s = state || compute();
      if (!s.owned || !r || broken[r] || (r === 'search' && !(u.searchParams.get('q') || '').trim())) { fast.toNative(u.href); return false; }
      const to = u.pathname + u.search + u.hash;
      // the viewer is open: close it first (its entries are ours), then go
      if (ovCurrent().depth) { pendingGo = to; ov.closeAll(); return true; }
      if (to === here()) return true;
      try { history.pushState({ pin: 1, nav: 1 }, '', to); } catch { location.assign(u.href); return false; }
      navKind = 'push'; navved = true;
      update();
      return true;
    },
    // Anything Fast UI does not own (Explore, a pin opened in a new tab) is a normal page load; a route it does own,
    // handed to Pinterest ("Open on Pinterest"), loads with ?pin=native so Fast UI stands aside for that load
    toNative(url) {
      if (url) {
        let u;
        try { u = new URL(url, location.href); } catch { return; }
        if (u.origin === location.origin && routeOf(u.pathname)) u.searchParams.set('pin', 'native');
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
      // Pinterest's app is on another URL than this view (fast.go moved without it): load this one natively
      if (state && state.owned && here() !== appUrl) {
        const u = new URL(location.href);
        u.searchParams.set('pin', 'native');
        location.assign(u.href);
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

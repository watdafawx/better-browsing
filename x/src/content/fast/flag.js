/* X Fast UI: who owns the page. Runs at document-start, before X paints anything.
   <html data-xbb-fast="<route>"> while Fast UI owns the route (content.css then hides #react-root: X keeps running
   underneath, unpainted), "native" while the user asked for X's own page, absent otherwise (setting off, a route
   we do not own, or a route whose breaker tripped). Everything else here keeps the user from ever being trapped:
     XBB.fast.toNative(url?)   no url: show X's own page here (the escape hatch). A url: hand that page to X (its
                               router follows a pushState + popstate, no reload); Fast UI takes over again when X
                               comes back to a route we own.
     XBB.fast.toFast()         back to Fast UI (to Home when this route is not ours)
     XBB.fast.fail(route, why, hard)   a view or an op went wrong: three soft failures in 5 minutes, or one hard one
                               (a whole response that fails the schema guard, a render error, an open API breaker
                               for the route's ops), and X gets that route back for the rest of the session
     XBB.fast.onChange(fn)     fn(state) when ownership or the route's URL changes: { on, route, url, owned, escaped, broken }
     XBB.fast.go(url)          in-app navigation: a route we own (home, bookmarks, search, profile) renders here, the
                               rest is X's page; fast.back() is a view's Back button; fast.me() the logged-in user
     XBB.fast.ov               overlays (media lightbox, thread drawer) as history entries on top of the route's own:
                               push(next, url) / replace(next, url) / back(n) / closeAll() / get() / onChange(fn).
                               While such an entry is current the route stays its `base` (the URL may say
                               /<user>/status/<id>), so Back closes the overlay and Home never unmounts.
   Alt+Shift+X switches either way, ?xbb=native in the URL starts on X's own page, and a "Fast UI" entry in X's
   sidebar switches back. */
(() => {
  const root = document.documentElement;
  const ATTR = 'data-xbb-fast';
  const BROKEN_KEY = 'xbb-fast-broken';
  // Route table: what Fast UI owns. Anything that is not listed is X's. A first path segment X uses for its own
  // pages is never a profile.
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'compose', 'login', 'logout',
    'signup', 'tos', 'privacy', 'intent', 'hashtag', 'lists', 'communities', 'jobs', 'grok', 'premium', 'account', 'chat', 'share',
    'download', 'about', 'display', 'keyboard_shortcuts', 'onboarding', 'who_to_follow', 'topics', 'spaces', 'bookmarks', 'oauth', 'verified']);
  const HANDLE = /^\/([A-Za-z0-9_]{1,15})(?:\/(with_replies|media))?\/?$/;
  const handleOf = p => { const m = HANDLE.exec(p || ''); return m && !RESERVED.has(m[1].toLowerCase()) ? { handle: m[1], tab: m[2] || '' } : null; };
  const ROUTES = {
    home: p => p === '/' || p === '/home',
    bookmarks: p => p === '/i/bookmarks',
    search: p => p === '/search' || p === '/search/',
    profile: p => !!handleOf(p)
  };
  // Only Home's ops can hand a route to X. Profile, search and bookmarks never fail the page: a missing or drifted
  // op there is that view's own banner ("Open on X once to learn …"), so one unlearned op never costs Home.
  const ROUTE_OPS = { home: ['HomeTimeline', 'HomeLatestTimeline'] };
  // ops a route can live without until X teaches them: a missing queryId there is the view's own note, not a failure
  // (Following before the user ever opened it on X); drift on them still hands the route to X
  const LEARNABLE = new Set(['HomeLatestTimeline']);
  const LABEL = { home: 'Home', bookmarks: 'Bookmarks', search: 'Search', profile: 'Profile' };
  const routeOf = (path = location.pathname) => { for (const k in ROUTES) if (ROUTES[k](path)) return k; return null; };
  // Our overlay entries: { xbb: 1, overlay, base, ov: JSON } (primitives only: read through Firefox's Xray wrappers)
  const ovState = () => {
    let s;
    try { s = history.state; } catch { return null; }
    if (!s || typeof s !== 'object' || s.xbb !== 1 || typeof s.base !== 'string' || !ROUTES[s.base] || typeof s.ov !== 'string') return null;
    try {
      const o = JSON.parse(s.ov);
      if (!o || typeof o !== 'object') return null;
      // the URL of the route under the overlay (entries from before M4 have none: Home's)
      if (typeof o.bu !== 'string' || o.bu[0] !== '/') { if (s.base !== 'home') return null; o.bu = '/home'; }
      return Object.assign(o, { base: s.base });
    } catch { return null; }
  };
  const here = () => location.pathname + location.search + location.hash;
  const routeUrlNow = ovs => ovs ? ovs.bu : location.pathname + location.search;

  let broken = {};
  try { sessionStorage.removeItem(BROKEN_KEY); } catch {}
  let escaped = false;
  try { escaped = new URLSearchParams(location.search).get('xbb') === 'native'; } catch {}
  const fails = {};
  const warned = new Set();
  const listeners = new Set();
  let state = null;

  // Two broken routes: the whole mode is off for the session
  const enabled = () => !!XBB.settings.fastUi && Object.keys(broken).length < 2;
  function compute() {
    const ovs = ovState();
    const on = enabled(), route = (ovs && ovs.base) || routeOf();
    return { on, route, url: route ? routeUrlNow(ovs) : '', owned: on && !escaped && !!route && !broken[route], escaped: on && escaped, broken: (route && broken[route]) || null };
  }
  let ovWas = false;          // the entry we are on is an overlay of ours (X was never told its URL)
  function update() {
    const s = compute();
    const attr = s.owned ? s.route : s.escaped ? 'native' : null;
    if (attr) { if (root.getAttribute(ATTR) !== attr) root.setAttribute(ATTR, attr); }
    else if (root.hasAttribute(ATTR)) root.removeAttribute(ATTR);
    const changed = !state || state.on !== s.on || state.route !== s.route || state.url !== s.url || state.owned !== s.owned || state.escaped !== s.escaped;
    state = s;
    if (changed) for (const fn of [...listeners]) { try { fn(s); } catch (e) { console.error('[XBB fast]', e); } }
    ovWas = !!(s.owned && ovState());
    syncEntry();
    emitOv(false);
    return s;
  }

  // ---------- overlays in the history ----------
  // Every overlay level (the lightbox, each post on the drawer's stack) is one history entry, so the browser's Back
  // closes exactly one level. The picture { drawer: [ids], lb: { id, i } | null, dm: { c } | null, depth, y, bu }
  // lives in the entry (dm: the messages drawer, c the open conversation or ''; bu: the URL of the route under it);
  // lightbox.js, drawer.js and messages.js only follow it (onChange), and show it only while Fast UI owns the route.
  const NONE = Object.freeze({ drawer: [], lb: null, dm: null, depth: 0, y: 0, bu: '' });
  const EMPTY = '[[],null,null]';
  const ovListeners = new Set();
  let ovKey = EMPTY, ovY = 0, ovBu = '';
  function ovCurrent() {
    const o = state && state.owned ? ovState() : null;
    if (!o) return NONE;
    const drawer = Array.isArray(o.drawer) ? o.drawer.filter(x => typeof x === 'string' && /^\d+$/.test(x)) : [];
    const lb = o.lb && typeof o.lb.id === 'string' ? { id: o.lb.id, i: Math.max(0, o.lb.i | 0) } : null;
    const dm = o.dm && typeof o.dm === 'object' ? { c: typeof o.dm.c === 'string' && /^[\w:-]{1,80}$/.test(o.dm.c) ? o.dm.c : '' } : null;
    return { drawer, lb, dm, depth: Math.max(0, o.depth | 0), y: +o.y || 0, bu: o.bu };
  }
  // X's own router may scroll the window on a popstate; closing an overlay puts the feed back on its exact pixel.
  // Only when we are back on the route the overlay was opened over: a profile opened from the drawer starts at its top.
  function restoreY(y, bu) {
    const fix = () => { if (state && state.owned && !ovState() && state.url === bu && Math.abs(scrollY - y) > 1) scrollTo(0, y); };
    fix(); requestAnimationFrame(fix); setTimeout(fix, 150);
  }
  function emitOv(force) {
    const c = ovCurrent();
    const k = JSON.stringify([c.drawer, c.lb, c.dm]);
    if (!force && k === ovKey) return;
    const wasOpen = ovKey !== EMPTY, isOpen = k !== EMPTY;
    ovKey = k;
    if (wasOpen && !isOpen && state && state.owned) restoreY(ovY, ovBu);
    if (isOpen) { ovY = c.y; ovBu = c.bu; }
    for (const fn of [...ovListeners]) { try { fn(c); } catch (e) { console.error('[XBB fast]', e); } }
  }
  function ovEntry(next, depth, y, bu) {
    const drawer = (next.drawer || []).slice(-30), lb = next.lb || null, dm = next.dm ? { c: String(next.dm.c || '') } : null;
    return { xbb: 1, overlay: lb ? 'lightbox' : drawer.length ? 'drawer' : dm ? 'messages' : '', base: state.route, ov: JSON.stringify({ drawer, lb, dm, depth, y, bu }) };
  }
  // history.go is async: a second close before its popstate (Esc's keydown and the dialog's cancel, two quick
  // clicks) would go back one entry too far, past the route itself. One go at a time.
  let going = 0;
  function go(n) {
    if (going && Date.now() - going < 1000) return;
    going = Date.now();
    history.go(n);
  }
  // Moving between overlay entries, or from one back to the route's own entry, is ours alone: X's router never saw
  // those URLs (pushState), and on a popstate it would render /<user>/status/<id> underneath (and fetch it). Capture
  // on window runs before X's listener; we update ourselves and keep the event from it. Our own mirrored popstate
  // (navigateX) and anything while X owns the page go through.
  // X's router is told only about URLs it should render. Landing back on an entry of the route's own whose URL is not
  // the one X last rendered (a profile opened from the drawer, then Back twice) goes through, so X is never left on
  // another page than the one in the address bar.
  let xAt = here();
  addEventListener('popstate', e => {
    going = 0;
    if (mirroring) return;
    const was = ovWas;
    update();
    const ovs = ovState();
    if (state && state.owned && (was || ovs) && (ovs || here() === xAt)) e.stopImmediatePropagation();
    else xAt = here();
  }, true);
  const ov = {
    get: ovCurrent,
    onChange(fn) { ovListeners.add(fn); return () => ovListeners.delete(fn); },
    refresh: () => emitOv(true),
    push(next, url) {
      if (!state || !state.owned) return false;
      const c = ovCurrent();
      try { history.pushState(ovEntry(next, c.depth + 1, c.depth ? c.y : scrollY, c.depth ? c.bu : state.url), '', url || here()); } catch { return false; }
      update();
      return true;
    },
    replace(next, url) {
      const c = ovCurrent();
      if (!state || !state.owned || !c.depth) return ov.push(next, url);
      try { history.replaceState(ovEntry(next, c.depth, c.y, c.bu), '', url || here()); } catch { return false; }
      update();
      return true;
    },
    back(n = 1) { if (n > 0) go(-n); },
    closeAll() { const c = ovCurrent(); if (c.depth) go(-c.depth); },
    isOurs: () => !!ovState()
  };

  // ---------- toast (light DOM: it must show while X's own page is up, too) ----------
  let toastEl = null, toastT = 0;
  function toast(msg) {
    if (!document.body) { addEventListener('DOMContentLoaded', () => toast(msg), { once: true }); return; }
    if (!toastEl || !toastEl.isConnected) {
      toastEl = XBB.h('div', { class: 'xbb-root xbb-fast-toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 3200);
  }

  // ---------- navigation that X's own router follows ----------
  // React Router listens to popstate: push the URL, then tell it. Same in Chrome and Firefox, no reload.
  let mirroring = false;
  const NAV = Object.freeze({ xbbNav: 1 });   // an entry we pushed: our Back buttons go back to where they came from
  function navigateX(url, replace) {
    let u;
    try { u = new URL(url, location.href); } catch { return false; }
    if (u.origin !== location.origin) { location.assign(u.href); return false; }
    const target = u.pathname + u.search + u.hash;
    let wasNav = false;
    try { wasNav = !!(history.state && history.state.xbbNav === 1); } catch {}
    if (target !== here()) history[replace ? 'replaceState' : 'pushState'](replace ? (wasNav ? NAV : null) : NAV, '', target);
    else if (ovState()) history.replaceState(null, '', target);   // an overlay's own URL (a post in the drawer): X's from now on
    xAt = target;
    mirroring = true;
    try { dispatchEvent(new PopStateEvent('popstate', { state: null })); } catch {} finally { mirroring = false; }
    return true;
  }

  // The logged-in user: id from the twid cookie (u%3D<id>), handle from X's own profile link (hidden but in the DOM),
  // the store, or the last one seen (localStorage)
  const ME_KEY = 'xbb-fast-me';
  function me() {
    let id = '', sn = '';
    try { const m = /(?:^|;\s*)twid=([^;]+)/.exec(document.cookie); if (m) { const v = /u=(\d+)/.exec(decodeURIComponent(m[1])); if (v) id = v[1]; } } catch {}
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const h = a && handleOf(a.getAttribute('href'));
    if (h) sn = h.handle;
    if (!sn && id && fast.store) { const u = fast.store.user(id); if (u && u.screenName) sn = u.screenName; }
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch {}
    if (!sn && cached && typeof cached.sn === 'string' && (!id || !cached.id || cached.id === id)) sn = cached.sn;
    if (sn && (!cached || cached.sn !== sn || (id && cached.id !== id))) try { localStorage.setItem(ME_KEY, JSON.stringify({ id, sn })); } catch {}
    return { id, screenName: sn };
  }

  const fast = XBB.fast = XBB.fast || {};
  Object.assign(fast, {
    routeOf, navigateX, toast, LABEL, ov, handleOf, me,
    state: () => state || compute(),
    routeUrl: () => (state && state.url) || '',
    // Go somewhere from inside Fast UI: a route we own is rendered here (X's router follows underneath, so what it
    // fetches is tapped), on top of any overlay entries (Back returns to the drawer); anything else is X's page.
    // /hashtag/<tag> is a search for #<tag>.
    go(url, opts) {
      let u;
      try { u = new URL(url, location.href); } catch { return false; }
      if (u.origin !== location.origin) { open(u.href, '_blank', 'noopener'); return false; }
      const tag = /^\/hashtag\/([^/?#]+)\/?$/.exec(u.pathname);
      if (tag) { let t = tag[1]; try { t = decodeURIComponent(t); } catch {} u = new URL('/search?q=' + encodeURIComponent('#' + t) + '&src=hashtag_click', location.href); }
      const r = routeOf(u.pathname);
      if (r && enabled() && !escaped && !broken[r]) { navigateX(u.pathname + u.search + u.hash, !!(opts && opts.replace)); update(); return true; }
      fast.toNative(u.pathname + u.search + u.hash);
      return false;
    },
    // A view's Back button: the entry we came from when we pushed this one, else Home
    back() {
      let s = null;
      try { s = history.state; } catch {}
      if (s && s.xbbNav === 1 && history.length > 1) history.back();
      else fast.go('/home');
    },
    isMirroring: () => mirroring,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    update,
    toNative(url) {
      // From a post in the drawer, X's own page is that post (X's router follows the URL we are already on)
      if (!url && state && state.owned) { const o = ovState(); if (o && Array.isArray(o.drawer) && o.drawer.length) url = here(); }
      const u = new URL(url || location.href, location.href);
      const ownedTarget = !url || !!routeOf(u.pathname);
      if (XBB.ext && XBB.ext.blocking()) {
        if (ownedTarget) u.searchParams.set('xbb', 'native');
        XBB.ext.setBlock(false, { reload: true, url: u.href, reason: 'to-native' });
        return;
      }
      if (url) {
        if (ownedTarget) escaped = true;
        navigateX(url);
        update();
        return;
      }
      escaped = true;
      update();
    },
    toFast() {
      if (!XBB.settings.fastUi) return;
      if (XBB.ext && !XBB.ext.blocking() && XBB.ext.hasCachedHome()) {
        const u = new URL(routeOf() ? location.href : 'https://x.com/home');
        u.searchParams.delete('xbb');
        XBB.ext.setBlock(true, { reload: true, url: u.href, reason: 'to-fast' });
        return;
      }
      escaped = false;
      const r = routeOf();
      if (r && broken[r]) toast(`Fast UI is off for ${LABEL[r]} until the next page load (X changed something)`);
      if (!r) navigateX('/home');
      update();
    },
    isBroken: r => !!broken[r],
    fail(route, reason, hard) {
      if (!route || broken[route]) return;
      const now = Date.now();
      const list = fails[route] = (fails[route] || []).filter(t => now - t < 5 * 60 * 1000);
      list.push(now);
      if (!warned.has(route + reason)) { warned.add(route + reason); console.warn('[XBB fast]', route, reason); }
      if (!hard && list.length < 3) return;
      broken[route] = String(reason || 'failed').slice(0, 200);
      try { sessionStorage.setItem(BROKEN_KEY, JSON.stringify(broken)); } catch {}
      const was = state && state.owned && state.route === route;
      update();
      if (was && XBB.ext && XBB.ext.blocking()) {
        XBB.ext.setBlock(false, { reload: true, reason: 'breaker:' + route });
        return;
      }
      if (was) toast(`X changed something; showing X's own page for ${LABEL[route] || route}`);
    }
  });

  // An API breaker open on one of a route's operations: that route is X's
  XBB.gql?.breaker?.onChange((op, st) => {
    if (!st || st.state !== 'open' || !XBB.settings.fastUi) return;
    if (st.kind === 'missing-op' && LEARNABLE.has(op)) return;
    for (const r in ROUTE_OPS) if (ROUTE_OPS[r].includes(op)) fast.fail(r, `api ${op}: ${st.kind}${st.status ? ' ' + st.status : ''}`, true);
  });

  // ---------- following X's router ----------
  addEventListener('popstate', () => update());
  document.addEventListener('xbb-nav', () => update());
  let lastPath = location.pathname + location.search;
  XBB.onDomChange(() => {
    const p = location.pathname + location.search;
    if (p !== lastPath) { lastPath = p; if (!ovState()) xAt = here(); update(); }
  }, 300);

  addEventListener('keydown', e => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyX') return;
    const s = XBB.settings;
    if (!s.fastUi || s.fastUiKeys === false) return;
    e.preventDefault(); e.stopPropagation();
    if (state && state.owned) fast.toNative(); else fast.toFast();
  }, true);

  // ---------- "Fast UI" entry in X's sidebar, while X's own page is up ----------
  // A clone of one of X's own nav links (like the settings gear), found by href, never by class name.
  const BOLT = '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>';
  function syncEntry() {
    const want = !!(state && state.on && !state.owned);
    const cur = document.querySelectorAll('.xbb-fast-entry');
    if (!want) { cur.forEach(n => n.remove()); return; }
    if (cur.length) return;
    const nav = document.querySelector('nav[aria-label="Primary"], header nav[role="navigation"]');
    if (!nav) return;
    const src = nav.querySelector(':scope > a[href="/explore"]:not(.xbb-gear)') || nav.querySelector(':scope > a[href]:not(.xbb-gear)');
    if (!src) return;
    const a = src.cloneNode(true);
    a.classList.add('xbb-fast-entry');
    a.removeAttribute('data-testid');
    a.removeAttribute('aria-label');
    a.removeAttribute('aria-current');
    a.setAttribute('href', '/home');
    a.setAttribute('role', 'button');
    a.setAttribute('title', 'Better Browsing Fast UI (Alt+Shift+X)');
    a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fast.toFast(); });
    const svg = a.querySelector('svg');
    if (svg) { svg.innerHTML = BOLT; svg.setAttribute('viewBox', '0 0 24 24'); }
    const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (walk.currentNode.textContent.trim() && !walk.currentNode.parentElement.closest('svg')) walk.currentNode.textContent = 'Fast UI';
    const gear = nav.querySelector(':scope > .xbb-gear');
    (gear || [...nav.querySelectorAll(':scope > a')].pop()).after(a);
  }
  XBB.onDomChange(() => { if (state && state.on && !state.owned) syncEntry(); }, 600);

  // First call happens now, from the snapshot: the attribute is there before X's first paint
  XBB.onSettings(() => update());
})();

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
     XBB.fast.onChange(fn)     fn(state) when ownership changes: { on, route, owned, escaped, broken }
   Alt+Shift+X switches either way, ?xbb=native in the URL starts on X's own page, and a "Fast UI" entry in X's
   sidebar switches back. */
(() => {
  const root = document.documentElement;
  const ATTR = 'data-xbb-fast';
  const BROKEN_KEY = 'xbb-fast-broken';
  // Route table: what Fast UI owns (M2: Home only). Anything that is not listed is X's.
  const ROUTES = { home: p => p === '/' || p === '/home' };
  const ROUTE_OPS = { home: ['HomeTimeline', 'HomeLatestTimeline'] };
  const LABEL = { home: 'Home' };
  const routeOf = (path = location.pathname) => { for (const k in ROUTES) if (ROUTES[k](path)) return k; return null; };

  let broken = {};
  try { broken = JSON.parse(sessionStorage.getItem(BROKEN_KEY) || '{}') || {}; } catch {}
  let escaped = false;
  try { escaped = new URLSearchParams(location.search).get('xbb') === 'native'; } catch {}
  const fails = {};
  const warned = new Set();
  const listeners = new Set();
  let state = null;

  // Two broken routes: the whole mode is off for the session
  const enabled = () => !!XBB.settings.fastUi && Object.keys(broken).length < 2;
  function compute() {
    const on = enabled(), route = routeOf();
    return { on, route, owned: on && !escaped && !!route && !broken[route], escaped: on && escaped, broken: (route && broken[route]) || null };
  }
  function update() {
    const s = compute();
    const attr = s.owned ? s.route : s.escaped ? 'native' : null;
    if (attr) { if (root.getAttribute(ATTR) !== attr) root.setAttribute(ATTR, attr); }
    else if (root.hasAttribute(ATTR)) root.removeAttribute(ATTR);
    const changed = !state || state.on !== s.on || state.route !== s.route || state.owned !== s.owned || state.escaped !== s.escaped;
    state = s;
    if (changed) for (const fn of [...listeners]) { try { fn(s); } catch (e) { console.error('[XBB fast]', e); } }
    syncEntry();
    return s;
  }

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
  function navigateX(url, replace) {
    let u;
    try { u = new URL(url, location.href); } catch { return false; }
    if (u.origin !== location.origin) { location.assign(u.href); return false; }
    const target = u.pathname + u.search + u.hash;
    if (target !== location.pathname + location.search + location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', target);
    mirroring = true;
    try { dispatchEvent(new PopStateEvent('popstate', { state: null })); } catch {} finally { mirroring = false; }
    return true;
  }

  const fast = XBB.fast = XBB.fast || {};
  Object.assign(fast, {
    routeOf, navigateX, toast, LABEL,
    state: () => state || compute(),
    isMirroring: () => mirroring,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    update,
    toNative(url) {
      if (url) { navigateX(url); update(); return; }
      escaped = true;
      update();
    },
    toFast() {
      if (!XBB.settings.fastUi) return;
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
      if (was) toast(`X changed something; showing X's own page for ${LABEL[route] || route}`);
    }
  });

  // An API breaker open on one of a route's operations: that route is X's
  XBB.gql?.breaker?.onChange((op, st) => {
    if (!st || st.state !== 'open' || !XBB.settings.fastUi) return;
    for (const r in ROUTE_OPS) if (ROUTE_OPS[r].includes(op)) fast.fail(r, `api ${op}: ${st.kind}${st.status ? ' ' + st.status : ''}`, true);
  });

  // ---------- following X's router ----------
  addEventListener('popstate', () => update());
  document.addEventListener('xbb-nav', () => update());
  let lastPath = location.pathname;
  XBB.onDomChange(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; update(); } }, 300);

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

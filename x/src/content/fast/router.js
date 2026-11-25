/* X Fast UI: puts the shell and its view on screen while Fast UI owns the route, and takes them away when it does
   not (flag.js decides; this file only follows XBB.fast.onChange).
     - First time a route is owned: mount the shell (once <body> exists) and the route's view.
     - Views are keyed by route and what they show (Home; a profile by handle; a search by query; bookmarks). Home
       lives for the whole page: leaving it pauses it (no layout work, its scroll kept), coming back resumes it. Any
       other view is replaced by the next one; the same key with another URL (a profile's tab, a search's tab) is
       that view's setUrl().
     - Owned -> not owned (a link to a page we do not own, "Native X", Alt+Shift+X, a tripped breaker): the view
       pauses, its videos stop, its scroll position is kept. X's own page is already up underneath.
     - Back to an owned route (Back button, the "Fast UI" entry): the view resumes where it was.
     - The setting turned off: shell and views are destroyed, the store is kept until the page unloads.
   While Fast UI is on screen the browser's own scroll restoration is off, so X's and ours do not fight. */
(() => {
  const fast = XBB.fast;
  let shell = null, view = null, viewKey = null, viewUrl = '', home = null, wasOwned = false, savedRestore = null;

  const keyOf = s => {
    let u;
    try { u = new URL(s.url || '/', location.href); } catch { return s.route; }
    if (s.route === 'profile') { const p = fast.handleOf(u.pathname); return 'profile:' + (p ? p.handle.toLowerCase() : ''); }
    if (s.route === 'search') return 'search:' + (u.searchParams.get('q') || '').trim();
    return s.route;
  };
  function stopVideos() {
    if (!shell) return;
    for (const v of shell.root.querySelectorAll('video')) { try { if (!v.paused) v.pause(); } catch {} }
  }
  function setRestore(owned) {
    try {
      if (owned) { if (savedRestore === null) savedRestore = history.scrollRestoration; history.scrollRestoration = 'manual'; }
      else if (savedRestore !== null) { history.scrollRestoration = savedRestore; savedRestore = null; }
    } catch {}
  }

  function show(s) {
    if (!document.body) { addEventListener('DOMContentLoaded', () => apply(fast.state()), { once: true }); return; }
    try {
      shell = shell || fast.shell.mount();
      const key = keyOf(s);
      if (viewKey !== key) {
        const old = view;
        if (old) {
          if (old === home) { if (wasOwned) old.pause(true); }
          else old.destroy();
        }
        stopVideos();
        view = null; viewKey = null;
        if (s.route === 'home' && home) { view = home; shell.setView(view, s); view.pause(false); }
        else {
          const make = fast.views && fast.views[s.route];
          if (!make) { fast.fail(s.route, 'no view', true); return; }
          shell.main.replaceChildren();
          view = make(shell, { url: s.url });
          if (s.route === 'home') home = view;
          shell.setView(view, s);
          if (s.route !== 'home') scrollTo(0, 0);
        }
        viewKey = key; viewUrl = s.url;
      } else {
        if (view && !wasOwned) view.pause(false);
        if (s.url !== viewUrl) { viewUrl = s.url; if (view && view.setUrl) view.setUrl(s.url); }
        shell.setView(view, s);
      }
      wasOwned = true;
      setRestore(true);
      shell.applyTheme();
      fast.ov.refresh();             // an overlay entry (Back/Forward onto it, a reload): lightbox / drawer follow
      XBB.videoPolicy && XBB.videoPolicy.evaluate();
    } catch (e) {
      console.error('[XBB fast]', e);
      fast.fail(s.route || 'home', 'mount: ' + (e && e.message), true);
    }
  }
  function hide() {
    if (view && wasOwned) { try { view.pause(true); } catch (e) { console.error('[XBB fast]', e); } }
    stopVideos();
    wasOwned = false;
    setRestore(false);
    XBB.videoPolicy && XBB.videoPolicy.evaluate();
  }
  function teardown() {
    hide();
    for (const v of new Set([view, home])) if (v) { try { v.destroy(); } catch {} }
    view = null; viewKey = null; home = null;
    if (shell) shell.destroy();
    shell = null;
  }

  function apply(s) {
    if (!s.on) { if (shell) teardown(); return; }
    if (s.owned) show(s); else hide();
  }
  fast.onChange(apply);
  apply(fast.state());

  // for tests and debugging
  fast.debug = () => ({ state: fast.state(), mounted: !!shell, styleMode: shell && shell.styleMode, viewKey, view: view && view.debug ? view.debug() : null, home: home && home !== view && home.debug ? home.debug() : null, store: fast.store.stats(), extraRequests: fast.extraRequests || 0 });
  fast.view = () => view;
})();

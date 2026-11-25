/* X Fast UI: puts the shell and its view on screen while Fast UI owns the route, and takes them away when it does
   not (flag.js decides; this file only follows XBB.fast.onChange).
     - First time a route is owned: mount the shell (once <body> exists) and the route's view.
     - Owned -> not owned (a link to a page we do not own, "Native X", Alt+Shift+X, a tripped breaker): the view
       pauses (no layout work, no observer reactions), its videos stop, its scroll position is kept. X's own page
       is already up underneath, nothing to rebuild.
     - Back to an owned route (Back button, the "Fast UI" entry): the view resumes where it was.
     - The setting turned off: shell and view are destroyed, the store is kept until the page unloads.
   While Fast UI is on screen the browser's own scroll restoration is off, so X's and ours do not fight. */
(() => {
  const fast = XBB.fast;
  let shell = null, view = null, viewRoute = null, wasOwned = false, savedRestore = null;

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
      if (viewRoute !== s.route) {
        if (view) view.destroy();
        view = null; viewRoute = null;
        const make = fast.views && fast.views[s.route];
        if (!make) { fast.fail(s.route, 'no view', true); return; }
        view = make(shell);
        viewRoute = s.route;
        shell.setView(view);
      } else if (view && !wasOwned) view.pause(false);
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
    if (view) { try { view.destroy(); } catch {} }
    view = null; viewRoute = null;
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
  fast.debug = () => ({ state: fast.state(), mounted: !!shell, styleMode: shell && shell.styleMode, view: view && view.debug ? view.debug() : null, store: fast.store.stats(), extraRequests: fast.extraRequests || 0 });
  fast.view = () => view;
})();

/* Pinterest Fast UI: the router. Mounts the shell once <body> exists and the route is ours, and shows the view of
   the current URL (fast.baseUrl(): the viewer's entries keep the URL of the view under them):
     home      views/home.js     kept alive for the whole page: leaving it hides it (grid paused, the masonry and the
                                 pins kept), Back puts it on its exact scrollY again without a request
     search    views/search.js   one per query
     profile   views/profile.js  one per user; a tab (/_saved/, /_created/) is view.setUrl
     board     views/board.js    one per board
   Any other view is destroyed when left and mounted again on Back, at the scroll it had (remembered per URL). A push
   (fast.go) starts at the top. While Pinterest's own page is up the view is only hidden. Pinterest's own videos are
   paused when Fast UI takes the page (main-world.js holds any later play() of theirs while data-pin-fast is set).
     PIN.fast.router.home() / current() / route() / shell() */
(() => {
  const fast = PIN.fast;
  let shell = null, home = null, cur = null, homeY = 0, waiting = false;
  const ys = new Map();                 // url -> scrollY when it was left (Back restores it)

  const whenBody = fn => {
    if (document.body) { fn(); return; }
    if (waiting) return;
    waiting = true;
    const mo = new MutationObserver(() => { if (document.body) { mo.disconnect(); waiting = false; fn(); } });
    mo.observe(document.documentElement, { childList: true });
  };
  function pauseNative() {
    for (const v of document.querySelectorAll('video')) {
      if (v.dataset.pinOwn || v.closest('.pin-root')) continue;
      try { if (!v.paused) v.pause(); } catch {}
    }
  }
  const keyOf = (route, url) => {
    if (route === 'home') return 'home';
    const V = fast.views && fast.views[route];
    let k = url;
    try { if (V && V.key) k = V.key(url); } catch {}
    return route + ':' + k;
  };
  function settle(y) {
    const fix = () => { if (cur && cur.view === home && fast.state().owned && !fast.ov.get().depth && Math.abs(scrollY - y) > 0.5) scrollTo(0, y); };
    fix(); requestAnimationFrame(fix); setTimeout(fix, 120);
  }

  function render() {
    const s = fast.state();
    if (!s.owned) { if (cur) cur.view.hide(); return; }
    whenBody(() => {
      const now = fast.state();
      if (!now.owned) return;
      if (!shell) shell = fast.shell.mount();
      if (!shell) return;
      const route = now.route, url = fast.baseUrl(), key = keyOf(route, url), kind = fast.navKind();
      if (cur && cur.key === key) {
        if (cur.url !== url) { ys.delete(cur.url); cur.url = url; try { cur.view.setUrl && cur.view.setUrl(url); } catch (e) { console.error('[PIN fast]', e); } }
        cur.view.show();
        shell.setRoute && shell.setRoute(route, url);
        pauseNative();
        fast.ov.emit();
        return;
      }
      // leave the current view
      if (cur) {
        if (cur.view === home) { homeY = scrollY; home.hide(); }
        else { ys.set(cur.url, scrollY); try { cur.view.hide(); cur.view.destroy(); } catch (e) { console.error('[PIN fast]', e); } }
        if (fast.save) fast.save.close();
      }
      let view = null;
      if (route === 'home') {
        if (!home) home = fast.home.mount(shell);
        view = home;
      } else {
        const V = fast.views && fast.views[route];
        const y = kind === 'pop' ? (ys.get(url) || 0) : 0;
        try { view = V ? V.mount(shell, url, { y }) : null; } catch (e) { console.error('[PIN fast]', e); }
        if (!view) { cur = null; fast.toNative(url); return; }
      }
      const first = !cur;
      cur = { key, url, route, view };
      shell.setRoute && shell.setRoute(route, url);
      view.show();
      if (view === home) { if (!first) settle(kind === 'pop' ? homeY : 0); }
      else if (!first && kind !== 'pop') scrollTo(0, 0);
      PIN.ext && PIN.ext.log('info', '[PIN router] view', { route, url, kind });
      pauseNative();
      fast.ov.emit();                       // a viewer entry restored before <body> existed
    });
  }
  fast.onChange(render);
  fast.onNav(render);
  render();
  fast.router = {
    home: () => home,
    shell: () => shell,
    current: () => (cur ? cur.view : null),
    route: () => (cur ? cur.route : null),
    url: () => (cur ? cur.url : null)
  };
})();

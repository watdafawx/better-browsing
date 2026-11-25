/* Pinterest Fast UI: the router. Mounts the shell once <body> exists and the route is ours, shows Home while Fast UI
   owns the page and pauses it (state and scroll kept) while Pinterest's own page is up. Pinterest's own videos are
   paused when Fast UI takes the page (main-world.js holds any later play() of theirs while data-pin-fast is set).
     PIN.fast.router.home()   the Home view, once mounted (tests, PIN.perf) */
(() => {
  const fast = PIN.fast;
  let shell = null, home = null, waiting = false;

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
  function apply(s) {
    if (s.owned) {
      whenBody(() => {
        const now = fast.state();
        if (!now.owned) return;
        if (!shell) shell = fast.shell.mount();
        if (!shell) return;
        if (!home) home = fast.home.mount(shell);
        home.show();
        pauseNative();
        fast.ov.emit();                       // a viewer entry restored before <body> existed
      });
    } else if (home) {
      home.hide();
    }
  }
  fast.onChange(apply);
  apply(fast.state());
  fast.router = { home: () => home, shell: () => shell };
})();

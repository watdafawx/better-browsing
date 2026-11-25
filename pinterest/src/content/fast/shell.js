/* Pinterest Fast UI: the shell. One <pin-fast> element in <body> with an open shadow root (Pinterest's CSS and ours
   never meet): the left icon rail, the sticky top bar (search, theme, Native Pinterest) and the feed the view fills.
   Layout and look: pinterest/fast-ui-mock.html.
     PIN.fast.shell.mount() -> { host, root, top, feed, applyTheme(), destroy() }   (idempotent; needs document.body)
     PIN.fast.patch(obj)    write settings the way popup.js does (read, merge, write back)
     .setRoute(route, url)  the rail's highlight, the search field's text and the feed's label for that view
   Themes: the shared registry in userscript/themes.js (bbThemes): Lights Out ("black"), Dim, Light, the Hopper palettes and
   imported JSON themes, chosen in the Appearance popover (bbThemes.mountPicker); "auto" follows the system. Search is /search/pins/?q= in Fast UI
   (fast.go). Clicks are delegated on the shadow root: [data-go] links (authors, boards, tabs, the rail) are
   fast.go (the viewer closes first), [data-fv-native] is fast.toNative(href), [data-save] / [data-save-pick] are
   save.js; a middle or modified click stays the browser's (a new tab). */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const SVG = {
    home: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2 2.8 10.6a1 1 0 0 0 1.25 1.56L5 11.4V20a1 1 0 0 0 1 1h4.5v-6h3v6H18a1 1 0 0 0 1-1v-8.6l.95.76a1 1 0 0 0 1.25-1.56z"/></svg>',
    explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    boards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    black: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    dim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  };
  // our own constant markup only (never text from Pinterest)
  const icon = name => { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = SVG[name] || ''; return s; };
  fast.icon = icon;
  fast.SVG = SVG;
  const sysTheme = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'black' : 'light'; } catch { return 'light'; } };

  fast.patch = async obj => {
    try {
      const cur = ((await PIN.api.storage.sync.get('settings')) || {}).settings || {};
      Object.assign(cur, obj);
      await PIN.api.storage.sync.set({ settings: cur });
    } catch (e) { console.error('[PIN fast]', e); }
  };

  // Constructable stylesheet where the realm allows it (the page's own constructor in Firefox's content realm), a
  // <style> in the shadow root otherwise; checked, not assumed.
  function style(root) {
    const css = (PIN.FAST_CSS || '') + bbThemes.CSS;
    try {
      const W = window.wrappedJSObject;
      const S = (W && W.CSSStyleSheet) || CSSStyleSheet;
      const sheet = new S();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      if (root.adoptedStyleSheets && root.adoptedStyleSheets.length === 1 && sheet.cssRules.length) return 'adopted';
    } catch {}
    try { root.adoptedStyleSheets = []; } catch {}
    root.prepend(h('style', null, css));
    return 'style';
  }

  let shell = null;
  function mount() {
    if (shell) return shell;
    if (!document.body) return null;
    const host = document.createElement('pin-fast');
    host.setAttribute('data-pin-fast-host', '');
    const root = host.attachShadow({ mode: 'open' });
    const how = style(root);
    const rb = (attrs, ic, tip) => h('a', Object.assign({ class: 'rbtn' }, attrs), icon(ic), h('span', { class: 'tip' }, tip));

    const rail = h('nav', { class: 'rail', 'aria-label': 'Fast UI' },
      h('a', { class: 'mark', href: '/', 'data-go': '', title: 'Better Browsing · Fast UI' }, 'bb'),
      rb({ href: '/', 'data-go': '', 'data-rail': 'home', 'aria-label': 'Home', 'aria-current': 'page', class: 'rbtn on' }, 'home', 'Home'),
      rb({ href: '#', 'data-act': 'profile', 'data-rail': 'profile', 'aria-label': 'Your profile' }, 'user', 'Profile'),
      rb({ href: '#', 'data-act': 'boards', 'data-rail': 'boards', 'aria-label': 'Your boards' }, 'boards', 'Boards'),
      rb({ href: '/ideas/', 'data-act': 'native-url', 'aria-label': 'Explore on Pinterest' }, 'explore', 'Explore (Pinterest)'),
      h('div', { class: 'spacer' }),
      rb({ href: '#', 'data-act': 'settings', 'aria-label': 'Settings', role: 'button' }, 'gear', 'Settings (Alt+W)'));

    const q = h('input', { type: 'search', name: 'q', placeholder: 'Search pins', autocomplete: 'off', 'aria-label': 'Search pins', enterkeyhint: 'search' });
    const picker = bbThemes.mountPicker(root, {
      get: () => (PIN.settings && PIN.settings.fastUiTheme) || 'auto',
      auto: sysTheme, systemLabel: 'Light or dark as your system is', accent: '#e60023',
      onChange: id => { PIN.settings.fastUiTheme = id; fast.patch({ fastUiTheme: id }); applyTheme(); }
    });
    const seg = picker.el;
    const nativeBtn = h('button', { class: 'native', type: 'button', 'data-pin-to-native': '', title: "Pinterest's own page (Alt+Shift+P)" },
      icon('ext'), h('span', { class: 'lbl' }, 'Native Pinterest'));
    const top = h('header', { class: 'top' },
      h('form', { class: 'search', role: 'search', 'data-pin-search': '' }, icon('search'), q, h('kbd', null, '/')),
      seg, nativeBtn);
    const feed = h('main', { class: 'feed', 'aria-label': 'Home feed' });
    root.append(rail, h('div', { class: 'main' }, top, feed));

    root.addEventListener('submit', e => {
      const f = e.target;
      if (!f || !f.matches || !f.matches('[data-pin-search]')) return;
      e.preventDefault();
      const v = q.value.trim();
      if (!v) return;
      q.blur();
      fast.go('/search/pins/?q=' + encodeURIComponent(v) + '&rs=typed');
    });
    root.addEventListener('click', e => {
      if (e.defaultPrevented || e.button) return;
      const t = e.composedPath()[0];
      const el = t && t.closest ? t.closest('[data-pin-to-native],[data-act],[data-go],[data-fv-native],[data-save],[data-save-pick]') : null;
      if (!el) return;
      if (el.hasAttribute('data-save') || el.hasAttribute('data-save-pick')) {
        e.preventDefault(); e.stopPropagation();
        const id = el.getAttribute('data-save-id');
        if (fast.save && id) el.hasAttribute('data-save') ? fast.save.quick(id, el) : fast.save.open(id, el);
        return;
      }
      if (el.hasAttribute('data-go') || el.hasAttribute('data-fv-native')) {
        const href = el.getAttribute('href');
        if (!href || href === '#' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;     // a new tab: the browser's
        e.preventDefault();
        if (el.hasAttribute('data-fv-native')) { fast.toNative(href); return; }
        if (fast.routeOf(href.split(/[?#]/)[0]) === 'home' && fast.state().route === 'home' && !fast.ov.get().depth) { scrollTo(0, 0); return; }
        fast.go(href);
        return;
      }
      if (el.hasAttribute('data-pin-to-native')) { e.preventDefault(); fast.toNative(); return; }
      const act = el.getAttribute('data-act');
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;           // a new tab: the browser's own job
      e.preventDefault();
      if (act === 'top') scrollTo(0, 0);
      else if (act === 'settings') { try { PIN.openSettings(); } catch (err) { console.error('[PIN fast]', err); } }
      else if (act === 'native-url') fast.toNative(el.getAttribute('href'));
      else if (act === 'profile' || act === 'boards') {
        const u = fast.me ? fast.me() : '';
        if (u) fast.go('/' + u + (act === 'boards' ? '/_saved/' : '/'));
        else { (fast.vtoast || fast.toast)("Couldn't tell who is signed in; showing Pinterest's page"); fast.toNative(); }
      }
    });
    // the top bar's border once the page has scrolled (one class flip, no layout read)
    let sc = false;
    addEventListener('scroll', () => { const s = scrollY > 4; if (s !== sc) { sc = s; top.classList.toggle('scrolled', s); } }, { passive: true });

    function applyTheme() {
      const s = PIN.settings;
      bbThemes.apply(host, s.fastUiTheme || 'auto', { auto: sysTheme(), site: 'pin', page: true });
      picker.update();
      nativeBtn.hidden = s.fastUiNativeButton === false;
    }
    PIN.onSettings(applyTheme);
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { fast.update(); applyTheme(); }); } catch {}

    // the view on screen: the rail's highlight, the query in the search field, the feed's label
    function setRoute(route, url) {
      let path = '/', sp = null;
      try { const u = new URL(url || '/', location.href); path = u.pathname; sp = u.searchParams; } catch {}
      const segs = path.split('/').filter(Boolean);
      const me = (fast.me ? fast.me() : '').toLowerCase();
      const mine = !!me && (segs[0] || '').toLowerCase() === me;
      const on = route === 'home' ? 'home' : route === 'profile' && mine ? (segs[1] === '_saved' ? 'boards' : 'profile') : route === 'board' && mine ? 'boards' : '';
      for (const r of rail.querySelectorAll('[data-rail]')) {
        const yes = r.getAttribute('data-rail') === on;
        r.classList.toggle('on', yes);
        if (yes) r.setAttribute('aria-current', 'page'); else r.removeAttribute('aria-current');
      }
      const want = route === 'search' && sp ? (sp.get('q') || '') : '';
      if (q.value !== want && shell && shell.root.activeElement !== q) q.value = want;
      feed.setAttribute('aria-label', (fast.LABEL && fast.LABEL[route]) || 'Feed');
      host.setAttribute('data-route', route || '');
    }

    document.body.append(host);
    shell = { host, root, top, feed, how, applyTheme, setRoute, destroy() { host.remove(); shell = null; } };
    return shell;
  }
  fast.shell = { mount, get: () => shell };
  fast.themes = bbThemes;
})();

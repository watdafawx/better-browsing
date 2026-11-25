/* X Fast UI: the shell. One <xbb-fast> element after #react-root with an open shadow root (X's CSS and ours never
   meet), a top bar (brand, stats, theme, "Native X"), the left rail, the centre column the view fills and the right
   sidebar. Layout and look: x/fast-ui-mock.html.
     XBB.fast.shell.mount()  -> { host, root, main, setStat(text), setView(view, state), setBadge(kind, n), applyTheme(),
                                 destroy() }   (idempotent)
   Themes: the shared registry in userscript/themes.js (bbThemes): Lights Out ("black"), Dim, Light, the Hopper palettes
   and imported JSON themes, chosen in the Appearance popover (bbThemes.mountPicker); "auto" follows X's own night_mode
   cookie (0 light, 1 dim, 2 black). A Hopper theme sets the shadow root's variables inline and data-theme to black/light.
   Clicks are delegated on the shadow root: render.click first (actions, cards), then links: a route Fast UI owns
   stays here (XBB.fast.go: Home, a profile, a search, bookmarks), anything else is handed to X's own router.
   Notifications opens the popout over the current view, Messages the DM drawer; both keep the view and its scroll. */
(() => {
  const { h } = XBB;
  const fast = XBB.fast;

  function xTheme() {
    const m = /(?:^|;\s*)night_mode=(\d)/.exec(document.cookie || '');
    if (m) return m[1] === '0' ? 'light' : m[1] === '1' ? 'dim' : 'black';
    try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'black'; } catch { return 'black'; }
  }
  const themeOf = s => bbThemes.classOf(s && s.fastUiTheme, xTheme());

  // Constructable stylesheet where the realm allows it (the page's own constructor in Firefox's content realm),
  // a <style> in the shadow root otherwise; checked, not assumed.
  function style(root) {
    const css = (XBB.FAST_CSS || '') + bbThemes.CSS;
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
    const host = document.createElement('xbb-fast');
    host.setAttribute('data-xbb-fast-host', '');
    const root = host.attachShadow({ mode: 'open' });
    const how = style(root);
    const I = (n, c) => fast.render.icon(n, c);

    const stat = h('span', { class: 'stat', 'aria-live': 'off' });
    const picker = bbThemes.mountPicker(root, {
      get: () => (XBB.settings && XBB.settings.fastUiTheme) || 'auto',
      auto: xTheme, systemLabel: "Same as X's own theme", accent: '#1d9bf0',
      onChange: id => { XBB.saveSetting('fastUiTheme', id); XBB.settings.fastUiTheme = id; applyTheme(); }
    });
    const seg = picker.el;
    const nativeBtn = h('button', { class: 'native-btn', type: 'button', 'data-xbb-to-native': '', title: "Show X's own page (Alt+Shift+X)" },
      I('ext'), h('span', { class: 'long' }, 'Native X'));
    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, I('bolt', 'i fill'), h('span', null, 'Better Browsing'), h('small', null, 'Fast UI')),
      h('span', { class: 'spacer' }), stat, seg, nativeBtn);

    const badges = {};
    const nav = (href, ic, label, extra = {}) => h('a', Object.assign({ class: 'nav' + (extra.wide ? ' wide' : ''), href, 'data-route': extra.route || null }, extra.attrs || {}),
      h('span', { class: 'nic' }, I(ic), extra.badge ? (badges[extra.badge] = h('span', { class: 'nbadge', hidden: true, 'aria-hidden': 'true' })) : null),
      h('span', { class: 'label' }, label), extra.ext ? I('ext', 'i ext') : null);
    const rail = h('nav', { class: 'rail', 'aria-label': 'Fast UI' },
      nav('/home', 'home', 'Home', { route: 'home', attrs: { 'aria-current': 'page' } }),
      nav('/explore', 'explore', 'Explore', { ext: true }),
      nav('/notifications', 'bell', 'Notifications', { badge: 'notifications', attrs: { 'data-nt-open': '', 'aria-haspopup': 'dialog' } }),
      nav('/messages', 'mail', 'Messages', { badge: 'messages', attrs: { 'data-dm-open': '', 'aria-haspopup': 'dialog' } }),
      nav('/i/bookmarks', 'bm', 'Bookmarks', { wide: true, route: 'bookmarks' }),
      nav('/i/profile', 'user', 'Profile', { route: 'me', attrs: { 'data-profile': '' } }),
      h('a', { class: 'nav wide', href: '#', 'data-xbb-settings': '' }, I('gear'), h('span', { class: 'label' }, 'Settings')),
      h('a', { class: 'post-btn', href: '/compose/post' }, I('pen'), h('span', null, 'Post')));

    const main = h('main', { 'aria-label': 'Timeline' });
    const search = h('input', { type: 'search', name: 'q', placeholder: 'Search on X', autocomplete: 'off', 'aria-label': 'Search on X' });
    const side = h('aside', { class: 'side' },
      h('form', { class: 'search', role: 'search', 'data-xbb-search': '' }, h('label', null, I('explore'), search)),
      h('section', { class: 'card' },
        h('h2', null, 'Fast UI'),
        h('p', null, 'Home, profiles, search, bookmarks, notifications and messages, without the wait. Everything else opens X\'s own page.'),
        h('p', null, h('kbd', null, 'Alt'), ' + ', h('kbd', null, 'Shift'), ' + ', h('kbd', null, 'X'), ' switches between this and X\'s page.'),
        h('a', { class: 'row', href: '#', 'data-xbb-settings': '' }, 'Fast UI settings')),
      h('div', { class: 'foot' },
        h('a', { href: '/tos' }, 'Terms of Service'), h('a', { href: '/privacy' }, 'Privacy Policy'),
        h('span', { class: 'bb' }, I('bolt', 'i fill'), 'Better Browsing for X')));

    root.append(topbar, h('div', { class: 'layout' }, rail, main, side));

    function applyTheme() {
      const s = XBB.settings || {};
      bbThemes.apply(host, s.fastUiTheme || 'auto', { auto: xTheme(), site: 'x', page: true });
      picker.update();
      nativeBtn.hidden = s.fastUiNativeButton === false;
    }

    // ---------- delegated events ----------
    let view = null;
    const firstEl = e => { const p = e.composedPath ? e.composedPath() : [e.target]; return p[0] && p[0].nodeType === 1 ? p[0] : e.target; };
    root.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0) return;
      const t = firstEl(e);
      if (t.closest('[data-xbb-to-native]')) { e.preventDefault(); fast.toNative(); return; }
      if (t.closest('[data-xbb-settings]')) { e.preventDefault(); XBB.openSettings && XBB.openSettings(); return; }
      const nt = t.closest('[data-nt-open]');
      if (nt && !e.ctrlKey && !e.metaKey && fast.notifications) { e.preventDefault(); fast.notifications.toggle(nt); return; }
      const dm = t.closest('[data-dm-open]');
      if (dm && !e.ctrlKey && !e.metaKey && fast.messages) { e.preventDefault(); fast.messages.open(); return; }
      if (view && view.click && view.click(e)) return;
      if (fast.render.click(e, { root, refresh: id => view && view.refresh && view.refresh(id) })) return;
      const a = t.closest('a[href]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target === '_blank') return;
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
      if (u.origin !== location.origin) return;
      e.preventDefault();
      if (a.hasAttribute('data-profile')) {
        const me = fast.me();
        if (!me.screenName) { fast.toNative('/i/profile'); return; }
        u = new URL('/' + me.screenName, location.href);
      }
      // the page we are on: back to its top (a click on Home while on Home)
      if (u.pathname + u.search === fast.routeUrl() && !fast.ov.isOurs()) { if (view && view.top) view.top(); return; }
      fast.go(u.pathname + u.search + u.hash);
    });
    root.addEventListener('submit', e => {
      const f = firstEl(e).closest('[data-xbb-search]');
      if (!f) return;
      e.preventDefault();
      const q = search.value.trim();
      if (!q) return;
      search.blur();
      fast.go(fast.views && fast.views.search ? fast.views.search.urlFor(q, 'top') : '/search?q=' + encodeURIComponent(q) + '&src=typed_query');
    });
    // Prefetch thread replies on 220ms hover or pointerdown (max 1 hover prefetch in flight) so comments
    // are already loaded or in flight by the time the click opens the drawer.
    let hoverT = 0, hoverId = '';
    const tweetIdOf = e => {
      const a = firstEl(e)?.closest?.('article.tweet[data-id]');
      return a && !a.classList.contains('focal') ? a.dataset.id : '';
    };
    root.addEventListener('pointerover', e => {
      const id = tweetIdOf(e);
      if (id === hoverId) return;
      clearTimeout(hoverT);
      hoverId = id;
      if (id && fast.drawer && fast.drawer.prefetch) hoverT = setTimeout(() => { hoverT = 0; fast.drawer.prefetch(id, true); }, 220);
    }, { passive: true });
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const id = tweetIdOf(e);
      if (id && fast.drawer && fast.drawer.prefetch) fast.drawer.prefetch(id, false);
    }, { passive: true });

    // Keys typed in our fields must not reach X's shortcuts (j/k/l/n... are X's) or our own
    for (const type of ['keydown', 'keypress', 'keyup']) root.addEventListener(type, e => {
      const t = firstEl(e);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) e.stopPropagation();
    });

    const offSettings = XBB.onSettings(() => applyTheme());
    applyTheme();
    const rr = document.getElementById('react-root');
    if (rr && rr.parentNode === document.body) rr.after(host); else document.body.append(host);

    shell = {
      host, root, main, styleMode: how,
      setStat(text) { if (stat.textContent !== text) stat.textContent = text; },
      setView(v, s) {
        view = v;
        if (v && v.el && v.el.parentNode !== main) main.replaceChildren(v.el);
        // the rail marks where we are (Profile: only on the logged-in user's own profile)
        let here = s ? s.route : '';
        if (here === 'profile') {
          const me = fast.me(), p = fast.handleOf(new URL(s.url, location.href).pathname);
          here = me.screenName && p && p.handle.toLowerCase() === me.screenName.toLowerCase() ? 'me' : '';
        }
        for (const a of rail.querySelectorAll('[data-route]')) {
          if (a.dataset.route === here) { if (a.getAttribute('aria-current') !== 'page') a.setAttribute('aria-current', 'page'); }
          else if (a.hasAttribute('aria-current')) a.removeAttribute('aria-current');
        }
        const label = (s && { home: 'Home timeline', bookmarks: 'Bookmarks', search: 'Search results', profile: 'Profile' }[s.route]) || 'Timeline';
        if (main.getAttribute('aria-label') !== label) main.setAttribute('aria-label', label);
      },
      // unread counts on the rail (n > 0 shows it; 0 or null hides it)
      setBadge(kind, n) {
        const b = badges[kind];
        if (!b) return;
        const v = +n > 0 ? (+n > 99 ? '99+' : String(+n)) : '';
        b.hidden = !v;
        if (b.textContent !== v) b.textContent = v;
        const a = b.closest('a');
        if (a) a.setAttribute('aria-label', a.querySelector('.label').textContent + (v ? ' (' + v + ' unread)' : ''));
      },
      rail,
      applyTheme,
      destroy() {
        if (typeof offSettings === 'function') offSettings();
        host.remove();
        shell = null;
      }
    };
    return shell;
  }

  fast.shell = { mount, get: () => shell, themeOf };
  fast.themes = bbThemes;
})();

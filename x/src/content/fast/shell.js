/* X Fast UI: the shell. One <xbb-fast> element after #react-root with an open shadow root (X's CSS and ours never
   meet), a top bar (brand, stats, theme, "Native X"), the left rail, the centre column the view fills and the right
   sidebar. Layout and look: x/fast-ui-mock.html.
     XBB.fast.shell.mount()  -> { host, root, main, setStat(text), applyTheme(), destroy() }   (idempotent)
   Themes: Lights Out ("black"), Dim, Light; "auto" follows X's own night_mode cookie (0 light, 1 dim, 2 black).
   Clicks are delegated on the shadow root: render.click first (actions, cards), then links: a route Fast UI owns
   stays here, anything else is handed to X's own router (XBB.fast.toNative(url)). */
(() => {
  const { h } = XBB;
  const fast = XBB.fast;
  const THEMES = [['auto', 'Auto', 'Same as X'], ['black', 'Lights out', ''], ['dim', 'Dim', ''], ['light', 'Light', '']];
  const SW = { auto: 'linear-gradient(135deg,#000 50%,#fff 50%)', black: '#000', dim: '#15202b', light: '#fff' };

  function xTheme() {
    const m = /(?:^|;\s*)night_mode=(\d)/.exec(document.cookie || '');
    if (m) return m[1] === '0' ? 'light' : m[1] === '1' ? 'dim' : 'black';
    try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'black'; } catch { return 'black'; }
  }
  const themeOf = s => { const v = s && s.fastUiTheme; return v === 'black' || v === 'dim' || v === 'light' ? v : xTheme(); };

  // Constructable stylesheet where the realm allows it (the page's own constructor in Firefox's content realm),
  // a <style> in the shadow root otherwise; checked, not assumed.
  function style(root) {
    const css = XBB.FAST_CSS || '';
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
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' },
      THEMES.map(([k, label, title]) => {
        const sw = h('span', { class: 'sw', 'aria-hidden': 'true' });
        sw.style.background = SW[k];
        return h('button', { type: 'button', 'data-theme-pick': k, title: title || label, 'aria-pressed': 'false' }, sw, h('span', { class: 'long' }, label));
      }));
    const nativeBtn = h('button', { class: 'native-btn', type: 'button', 'data-xbb-to-native': '', title: "Show X's own page (Alt+Shift+X)" },
      I('ext'), h('span', { class: 'long' }, 'Native X'));
    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, I('bolt', 'i fill'), h('span', null, 'Better Browsing'), h('small', null, 'Fast UI')),
      h('span', { class: 'spacer' }), stat, seg, nativeBtn);

    const nav = (href, ic, label, extra = {}) => h('a', Object.assign({ class: 'nav' + (extra.wide ? ' wide' : ''), href }, extra.attrs || {}),
      I(ic), h('span', { class: 'label' }, label), extra.ext ? I('ext', 'i ext') : null);
    const rail = h('nav', { class: 'rail', 'aria-label': 'Fast UI' },
      nav('/home', 'home', 'Home', { attrs: { 'aria-current': 'page' } }),
      nav('/explore', 'explore', 'Explore', { ext: true }),
      nav('/notifications', 'bell', 'Notifications', { ext: true }),
      nav('/messages', 'mail', 'Messages', { ext: true, wide: true }),
      nav('/i/bookmarks', 'bm', 'Bookmarks', { ext: true, wide: true }),
      nav('/i/profile', 'user', 'Profile', { ext: true, attrs: { 'data-profile': '' } }),
      h('a', { class: 'nav wide', href: '#', 'data-xbb-settings': '' }, I('gear'), h('span', { class: 'label' }, 'Settings')),
      h('a', { class: 'post-btn', href: '/compose/post' }, I('pen'), h('span', null, 'Post')));

    const main = h('main', { 'aria-label': 'Home timeline' });
    const search = h('input', { type: 'search', name: 'q', placeholder: 'Search on X', autocomplete: 'off', 'aria-label': 'Search on X' });
    const side = h('aside', { class: 'side' },
      h('form', { class: 'search', role: 'search', 'data-xbb-search': '' }, h('label', null, I('explore'), search)),
      h('section', { class: 'card' },
        h('h2', null, 'Fast UI'),
        h('p', null, 'Home, without the wait. Everything else opens X\'s own page.'),
        h('p', null, h('kbd', null, 'Alt'), ' + ', h('kbd', null, 'Shift'), ' + ', h('kbd', null, 'X'), ' switches between this and X\'s page.'),
        h('a', { class: 'row', href: '#', 'data-xbb-settings': '' }, 'Fast UI settings')),
      h('div', { class: 'foot' },
        h('a', { href: '/tos' }, 'Terms of Service'), h('a', { href: '/privacy' }, 'Privacy Policy'),
        h('span', { class: 'bb' }, I('bolt', 'i fill'), 'Better Browsing for X')));

    root.append(topbar, h('div', { class: 'layout' }, rail, main, side));

    function applyTheme() {
      const s = XBB.settings || {};
      const t = themeOf(s);
      if (host.getAttribute('data-theme') !== t) host.setAttribute('data-theme', t);
      const pick = s.fastUiTheme || 'auto';
      for (const b of seg.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(b.dataset.themePick === pick));
      nativeBtn.hidden = s.fastUiNativeButton === false;
    }

    // ---------- delegated events ----------
    let view = null;
    const firstEl = e => { const p = e.composedPath ? e.composedPath() : [e.target]; return p[0] && p[0].nodeType === 1 ? p[0] : e.target; };
    root.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0) return;
      const t = firstEl(e);
      const pick = t.closest('[data-theme-pick]');
      if (pick) { XBB.saveSetting('fastUiTheme', pick.dataset.themePick); XBB.settings.fastUiTheme = pick.dataset.themePick; applyTheme(); return; }
      if (t.closest('[data-xbb-to-native]')) { e.preventDefault(); fast.toNative(); return; }
      if (t.closest('[data-xbb-settings]')) { e.preventDefault(); XBB.openSettings && XBB.openSettings(); return; }
      if (view && view.click && view.click(e)) return;
      if (fast.render.click(e, { root, refresh: id => view && view.refresh && view.refresh(id) })) return;
      const a = t.closest('a[href]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target === '_blank') return;
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
      if (u.origin !== location.origin) return;
      e.preventDefault();
      if (a.hasAttribute('data-profile')) {
        const p = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        u = new URL(p ? p.getAttribute('href') : '/home', location.href);
      }
      const target = u.pathname + u.search + u.hash;
      if (fast.routeOf(u.pathname)) {
        if (u.pathname !== location.pathname) fast.navigateX(target);
        if (view && view.top) view.top();
        fast.update();
      } else fast.toNative(target);
    });
    root.addEventListener('submit', e => {
      const f = firstEl(e).closest('[data-xbb-search]');
      if (!f) return;
      e.preventDefault();
      const q = search.value.trim();
      if (q) fast.toNative('/search?q=' + encodeURIComponent(q) + '&src=typed_query');
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
      setView(v) { view = v; },
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
})();

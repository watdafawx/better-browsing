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
    const sideSearch = h('form', { class: 'search', role: 'search', 'data-xbb-search': '' }, h('label', null, I('explore'), search));
    const side = h('aside', { class: 'side' },
      sideSearch,
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
    const offSearchBox = fast.views && fast.views.search && fast.views.search.attachBox
      ? fast.views.search.attachBox(search, { wrap: sideSearch, onQuery: q => fast.go(fast.views.search.urlFor(q, 'top')) })
      : null;
    root.addEventListener('submit', e => {
      const f = firstEl(e).closest('[data-xbb-search]');
      if (!f) return;
      e.preventDefault();
      const q = search.value.trim();
      if (!q) return;
      search.blur();
      if (fast.views && fast.views.search && fast.views.search.addRecent) fast.views.search.addRecent({ kind: 'query', q });
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

    // ---------- profile hovercard (top-layer popover="manual", instant from store + lazy UserByScreenName) ----------
    const hc = h('div', { class: 'hovercard', popover: 'manual', role: 'dialog', 'aria-label': 'Profile preview', hidden: true });
    root.append(hc);
    const hcPending = new Map();
    let hcShowT = 0, hcHideT = 0, hcHandle = '', hcAnchor = null, hcInCard = false, hcFollowBusy = false;
    function hcClose() {
      clearTimeout(hcShowT); clearTimeout(hcHideT);
      hcHandle = ''; hcAnchor = null; hcInCard = false;
      try { if (hc.matches(':popover-open')) hc.hidePopover(); } catch {}
      hc.hidden = true;
    }
    function hcTriggerOf(e) {
      const el = firstEl(e);
      if (!el || !el.closest) return null;
      if (el.closest('.hovercard, .rail, .topbar')) return null;
      const a = el.closest('a.avl, .head a.name, .ctx a, .reply-to a, .text a[href^="/"]');
      if (!a) return null;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/')) return null;
      const p = fast.handleOf && fast.handleOf(href.split(/[?#]/)[0]);
      if (!p || !p.handle || p.tab) return null;
      return { el: a, handle: p.handle };
    }
    function hcPlace(anchor) {
      if (!anchor || !anchor.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const w = 300, pad = 12;
      const left = Math.max(pad, Math.min(innerWidth - w - pad, r.left));
      hc.style.left = left + 'px';
      const estH = hc.offsetHeight || 200;
      const below = r.bottom + 8 + estH <= innerHeight - pad;
      hc.style.top = (below ? r.bottom + 8 : Math.max(pad, r.top - estH - 8)) + 'px';
    }
    function hcPaint(handle, u, loading) {
      if (hcHandle.toLowerCase() !== handle.toLowerCase()) return;
      const R = fast.render, sn = (u && u.screenName) || handle;
      const me = fast.me();
      const mine = !!(u && ((me.id && me.id === u.id) || (me.screenName && me.screenName.toLowerCase() === sn.toLowerCase())));
      let act = null;
      if (u && u.id && !u.unavailable && !mine && !u.blocking) {
        const st = u.followingState || 'none';
        act = h('button', { class: 'btn follow' + (st === 'none' ? ' primary' : ' on'), type: 'button', 'data-hc-follow': sn, 'aria-pressed': String(st !== 'none'), disabled: hcFollowBusy || null },
          st === 'following' ? h('span', { class: 'when-off' }, 'Following') : st === 'requested' ? 'Pending' : 'Follow',
          st === 'following' ? h('span', { class: 'when-on' }, 'Unfollow') : null);
      }
      const av = u && u.avatar ? h('img', { class: 'hc-av', src: R.safe(XBB.model.avatarSize(u.avatar, 'bigger')), alt: '', decoding: 'async' })
        : h('span', { class: 'hc-av ini' }, ((u && u.name) || sn || '?').slice(0, 1).toUpperCase());
      const hasCounts = u && (u.followers > 0 || u.following > 0 || u.at);
      hc.replaceChildren(
        h('div', { class: 'hc-top' },
          h('a', { class: 'hc-avl', href: '/' + sn }, av),
          h('span', { class: 'spacer' }),
          act),
        h('a', { class: 'hc-names', href: '/' + sn },
          h('span', { class: 'hc-name' }, h('b', null, (u && u.name) || sn), u ? R.badge(u) : null, u && u.protected ? R.icon('lock', 'i lock') : null),
          h('span', { class: 'hc-handle' }, '@' + sn, u && u.followedBy ? h('span', { class: 'follows-you' }, 'Follows you') : null)),
        u && u.bio ? h('div', { class: 'hc-bio', dir: 'auto' }, u.bio) : (loading ? h('div', { class: 'hc-loading' }, 'Loading…') : null),
        hasCounts ? h('div', { class: 'hc-counts' },
          h('span', null, h('b', null, R.fmt(u.following) || '0'), ' Following'),
          h('span', null, h('b', null, R.fmt(u.followers) || '0'), ' Followers')) : null);
      if (hcAnchor) hcPlace(hcAnchor);
    }
    async function hcFetch(handle) {
      const key = handle.toLowerCase();
      if (hcPending.has(key)) return hcPending.get(key);
      const p = XBB.gql.call('UserByScreenName', { screen_name: handle, withGrokTranslatedBio: false })
        .then(r => {
          if (r && r.ok) {
            const u = XBB.model.extractUser(r.data);
            if (u && u.id) return fast.store.putProfile(u);
          }
          return null;
        }).catch(() => null).finally(() => hcPending.delete(key));
      hcPending.set(key, p);
      return p;
    }
    function hcOpen(anchor, handle) {
      hcHandle = handle; hcAnchor = anchor;
      const prof = fast.store.profile(handle);
      const u = prof || fast.store.userByHandle(handle) || null;
      const fresh = prof && Date.now() - (prof.at || 0) < 5 * 60 * 1000;
      const needFetch = !fresh && (!u || (u.bio === undefined && !u.followers && !u.following));
      hc.hidden = false;
      hcPaint(handle, u, needFetch);
      try { if (typeof hc.showPopover === 'function' && !hc.matches(':popover-open')) hc.showPopover(); } catch {}
      hcPlace(anchor);
      if (needFetch) hcFetch(handle).then(fullU => { if (fullU) hcPaint(handle, fullU, false); else hcPaint(handle, u, false); });
    }
    async function hcFollow(handle) {
      const u = fast.store.profile(handle) || fast.store.userByHandle(handle);
      if (!u || !u.id || hcFollowBusy) return;
      const was = u.followingState || 'none', want = was === 'none';
      const before = { followingState: was, followers: u.followers };
      hcFollowBusy = true;
      const next = fast.store.putProfile(Object.assign({}, u, {
        followingState: want ? (u.protected ? 'requested' : 'following') : 'none',
        followers: Math.max(0, (u.followers || 0) + (want ? (u.protected ? 0 : 1) : -1))
      }));
      hcPaint(handle, next, false);
      const r = await XBB.gql.rest(want ? '/i/api/1.1/friendships/create.json' : '/i/api/1.1/friendships/destroy.json',
        { method: 'POST', form: true, body: { include_profile_interstitial_type: '1', skip_status: 'true', user_id: u.id } });
      hcFollowBusy = false;
      if (!r || !r.ok) {
        const back = fast.store.putProfile(Object.assign({}, next, before));
        fast.toast(`Couldn't ${want ? 'follow' : 'unfollow'} @${handle} on X${r && r.kind === 'rate-limit' ? ' (rate limited)' : ''}.`);
        hcPaint(handle, back, false);
      } else hcPaint(handle, next, false);
    }
    hc.addEventListener('pointerenter', () => { hcInCard = true; clearTimeout(hcHideT); });
    hc.addEventListener('pointerleave', () => { hcInCard = false; clearTimeout(hcHideT); hcHideT = setTimeout(() => { if (!hcInCard) hcClose(); }, 220); });
    hc.addEventListener('click', e => {
      const fb = firstEl(e).closest('[data-hc-follow]');
      if (fb) { e.preventDefault(); e.stopPropagation(); hcFollow(fb.dataset.hcFollow); return; }
      const a = firstEl(e).closest('a[href]');
      if (a) hcClose();
    });
    root.addEventListener('pointerover', e => {
      const tr = hcTriggerOf(e);
      if (!tr) return;
      clearTimeout(hcHideT);
      if (hcHandle.toLowerCase() === tr.handle.toLowerCase() && hcAnchor === tr.el) return;
      clearTimeout(hcShowT);
      hcShowT = setTimeout(() => { hcShowT = 0; if (tr.el.isConnected) hcOpen(tr.el, tr.handle); }, 320);
    }, { passive: true });
    root.addEventListener('pointerout', e => {
      const tr = hcTriggerOf(e);
      if (!tr) return;
      clearTimeout(hcShowT);
      clearTimeout(hcHideT);
      hcHideT = setTimeout(() => { if (!hcInCard) hcClose(); }, 220);
    }, { passive: true });
    const onScrollHide = () => { if (hcHandle && !hcInCard) hcClose(); };
    addEventListener('scroll', onScrollHide, { passive: true });
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && hcHandle) hcClose(); });

    const offSettings = XBB.onSettings(() => { applyTheme(); fast.render.scanAuto && fast.render.scanAuto(root); });
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
        sideSearch.hidden = !!(s && s.route === 'search');
        if (sideSearch.hidden && offSearchBox && offSearchBox.close) offSearchBox.close();
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
        hcClose();
        if (offSearchBox && offSearchBox.destroy) offSearchBox.destroy();
        removeEventListener('scroll', onScrollHide);
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

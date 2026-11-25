/* Pinterest Fast UI: the Profile view (/<user>/, /<user>/_saved/, /<user>/_created/).
   Header from UserResource/get (avatar, name, @username, bio, followers / following), then two tabs:
     Boards  (/<user>/ and /<user>/_saved/)  BoardsResource/get: a responsive grid of board covers; a cover opens the
                                             Board view in Fast UI; more boards come as the end scrolls into view
     Pins    (/<user>/_created/)             UserPinsResource/get in the shared pin feed (feed.js)
   A tab is a link (fast.go): the router keeps this view for the same user and calls setUrl. Each failure is the
   view's own banner with "Open on Pinterest", never fast.fail.
     PIN.fast.views.profile.mount(shell, url, { y }) -> { key, el, grid, show(), hide(), destroy(), setUrl(url), state() }
     PIN.fast.boardGrid({ username }) -> { el, start(), destroy(), boards() }   (the Boards tab) */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const LOCK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';
  const lock = () => { const s = h('span', { class: 'lock', title: 'Secret board' }); s.innerHTML = LOCK; return s; };
  const parse = url => {
    let p = [];
    try { p = new URL(url, location.href).pathname.split('/').filter(Boolean); } catch {}
    return { user: p[0] || '', tab: p[1] === '_created' ? 'pins' : 'boards' };
  };

  function boardCard(b) {
    const cov = h('div', { class: 'bcov' }, b.cover ? h('img', { src: b.cover, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : null);
    return h('a', { class: 'bcard', href: b.url || null, 'data-go': b.url ? '' : null, 'data-board-id': b.id, draggable: 'false' }, cov,
      h('div', { class: 'bname' }, b.secret ? lock() : null, h('span', null, b.name)),
      h('div', { class: 'bmeta' }, fast.fmt(b.pins) + (b.pins === 1 ? ' pin' : ' pins') + (b.sections ? ' · ' + b.sections + ' sections' : '')));
  }

  function boardGrid({ username }) {
    const OP = 'BoardsResource/get';
    const list = h('div', { class: 'bgrid', 'data-boards': '' });
    const status = h('div', { class: 'status', 'aria-live': 'polite' });
    const el = h('div', { class: 'bwrap' }, list, status);
    let bookmark = '', ended = false, loading = false, first = false, dead = false, started = false;
    const boards = [], seen = new Set();
    const nativeUrl = '/' + username + '/_saved/';
    const overrides = () => ({ username, page_size: 25, privacy_filter: 'all', sort: 'last_pinned_to', field_set_key: 'profile_grid_item' });
    const opts = { vars: { username }, guard: PIN.model.isBoards };
    const setStatus = (kind, node) => { status.setAttribute('data-state', kind); status.replaceChildren(...(node ? [node] : [])); };
    const spin = text => h('span', { class: 'row' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, text));
    function take(r) {
      const f = PIN.model.extractBoards(r.data);
      const fresh = f.boards.filter(b => !seen.has(b.id) && seen.add(b.id));
      for (const b of fresh) boards.push(b);
      list.append(...fresh.map(boardCard));
      bookmark = r.bookmark || '';
      ended = !bookmark || bookmark === '-end-';
      first = true;
      setStatus('idle', !boards.length && ended ? h('div', { class: 'empty' }, 'No boards yet.') : null);
      el.setAttribute('data-count', String(boards.length));
    }
    async function load() {
      if (loading || dead || (first && ended)) return;
      loading = true;
      setStatus('loading', spin(first ? 'Loading more boards…' : 'Loading boards…'));
      const r = first ? await fast.api.call(OP, Object.assign(overrides(), { bookmarks: [bookmark] }), opts)
        : await fast.firstPage(OP, overrides(), opts, o => o.username === username);
      loading = false;
      if (dead) return;
      if (r.ok) { take(r); return; }
      setStatus('err', fast.banner(r, first ? 'More boards' : 'These boards', nativeUrl, 'Open boards on Pinterest', true));
    }
    status.addEventListener('click', e => { const t = e.composedPath()[0]; if (t && t.closest && t.closest('[data-fv-retry]')) { e.preventDefault(); load(); } });
    // the next page when the end comes within a screen (an observer, no scroll handler)
    let io = null;
    try { io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && first && !ended) load(); }, { rootMargin: '0px 0px 800px 0px' }); io.observe(status); } catch {}
    return {
      el,
      start() { if (started) return; started = true; load(); },
      destroy() { dead = true; if (io) io.disconnect(); el.remove(); },
      boards: () => boards
    };
  }

  function mount(shell, url, { y } = {}) {
    let { user, tab } = parse(url);
    const head = h('header', { class: 'phead', 'data-profile-head': '' }, h('div', { class: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, 'Loading profile…')));
    const tBoards = h('a', { class: 'tab', href: '/' + user + '/_saved/', 'data-go': '', 'data-tab': 'boards' }, 'Boards');
    const tPins = h('a', { class: 'tab', href: '/' + user + '/_created/', 'data-go': '', 'data-tab': 'pins' }, 'Pins');
    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Profile' }, tBoards, tPins);
    const body = h('div', { class: 'pbody' });
    const el = h('section', { class: 'view profile', 'data-view': 'profile', hidden: true }, head, tabs, body);
    shell.feed.append(el);
    let feed = null, boards = null, visible = false, dead = false, userP = null, profile = null, restore = y || 0;

    function paintTabs() {
      for (const t of [tBoards, tPins]) { const on = t.getAttribute('data-tab') === tab; t.classList.toggle('on', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
    }
    function showTab() {
      if (feed) { feed.destroy(); feed = null; }
      if (boards) { boards.destroy(); boards = null; }
      if (tab === 'pins') {
        feed = fast.pinFeed({
          op: 'UserPinsResource/get', what: 'These pins', nativeUrl: '/' + user + '/_created/', nativeLabel: 'Open on Pinterest', restoreY: restore,
          overrides: () => ({ username: user, page_size: 25 }), opts: { vars: { username: user }, guard: PIN.model.isFeed },
          match: o => o.username === user, empty: 'No pins yet.'
        });
        body.append(feed.el);
        if (visible) { feed.show(); feed.start(); }
      } else {
        boards = boardGrid({ username: user });
        body.append(boards.el);
        if (visible) boards.start();
        if (restore) { const yy = restore; setTimeout(() => { if (!dead) scrollTo(0, yy); }, 300); }
      }
      restore = 0;
      paintTabs();
    }
    function paintHead(u) {
      const stat = (n, label) => h('span', null, h('b', null, fast.fmt(n)), ' ' + label);
      head.replaceChildren(
        fast.avatar(u.name, u.avatar, 'pav'),
        h('h1', { class: 'pname' }, u.name),
        h('div', { class: 'puser' }, '@' + u.username),
        u.bio ? h('p', { class: 'pbio' }, u.bio) : null,
        h('div', { class: 'pstats' }, stat(u.followers, 'followers'), h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'), stat(u.following, 'following')),
        h('div', { class: 'pacts' }, h('a', { class: 'bbtn', href: '/' + u.username + '/', 'data-fv-native': '' }, 'Open on Pinterest')));
    }
    function loadUser() {
      if (userP) return userP;
      userP = fast.firstPage('UserResource/get', { username: user, field_set_key: 'profile' },
        { vars: { username: user }, guard: d => !!PIN.model.normalizeUser(d) }, o => o.username === user).then(r => {
        if (dead) return;
        if (r.ok) { profile = PIN.model.normalizeUser(r.data); paintHead(profile); return; }
        userP = null;
        head.replaceChildren(fast.banner(r, 'This profile', '/' + user + '/', 'Open profile on Pinterest', true));
      });
      return userP;
    }
    head.addEventListener('click', e => { const t = e.composedPath()[0]; if (t && t.closest && t.closest('[data-fv-retry]')) { e.preventDefault(); loadUser(); } });
    paintTabs();

    return {
      key: 'profile:' + user.toLowerCase(), el,
      get grid() { return feed ? feed.grid : null; },
      show() {
        el.hidden = false; visible = true;
        loadUser();
        if (!feed && !boards) showTab();
        else if (feed) { feed.show(); feed.start(); } else boards.start();
      },
      hide() { visible = false; if (feed) feed.hide(); el.hidden = true; },
      destroy() { dead = true; if (feed) feed.destroy(); if (boards) boards.destroy(); el.remove(); },
      setUrl(next) {
        const n = parse(next);
        if (n.user.toLowerCase() !== user.toLowerCase() || n.tab === tab) return;
        tab = n.tab;
        showTab();
        scrollTo(0, 0);
      },
      state: () => ({ user, tab, profile, boards: boards ? boards.boards().length : 0, pins: feed ? feed.state() : null })
    };
  }
  fast.boardGrid = boardGrid;
  fast.views = fast.views || {};
  fast.views.profile = { mount, key: url => parse(url).user.toLowerCase() };
})();

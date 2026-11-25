/* Pinterest Fast UI: the Board view (/<user>/<board>/). BoardResource/get for the header (name, description, pin
   count, the owner as a Fast UI link), then BoardFeedResource/get ({ board_id, board_url }) in the shared pin feed
   (feed.js): virtualized masonry, paging, the viewer. A failure is the view's own banner ("Open board on
   Pinterest"), never fast.fail.
     PIN.fast.views.board.mount(shell, url, { y }) -> { key, el, grid, show(), hide(), destroy(), state() } */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const parse = url => {
    let p = [];
    try { p = new URL(url, location.href).pathname.split('/').filter(Boolean); } catch {}
    return { user: p[0] || '', slug: p[1] || '' };
  };

  function mount(shell, url, { y } = {}) {
    const { user, slug } = parse(url);
    const path = '/' + user + '/' + slug + '/';
    const head = h('header', { class: 'vhead bhead', 'data-board-head': '' }, h('div', { class: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, 'Loading board…')));
    const body = h('div', { class: 'pbody' });
    const el = h('section', { class: 'view board', 'data-view': 'board', hidden: true }, head, body);
    shell.feed.append(el);
    let board = null, feed = null, visible = false, dead = false, loadP = null;

    function paintHead(b) {
      const owner = b.owner && b.owner.username ? b.owner : { username: user, name: user, avatar: '' };
      head.replaceChildren(
        h('h1', { class: 'vtitle' }, b.name),
        b.description ? h('p', { class: 'bdesc' }, b.description) : null,
        h('div', { class: 'bown' },
          fast.avatar(owner.name || owner.username, owner.avatar),
          h('a', { class: 'olink', href: '/' + owner.username + '/', 'data-go': '' }, owner.name || owner.username),
          h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
          h('span', { 'data-board-pins': '' }, fast.fmt(b.pins) + (b.pins === 1 ? ' pin' : ' pins')),
          b.secret ? h('span', { class: 'secret' }, 'Secret') : null,
          h('span', { class: 'grow' }),
          h('a', { class: 'bbtn', href: path, 'data-fv-native': '' }, 'Open on Pinterest')));
    }
    function startFeed(b) {
      const boardUrl = b.url || path;
      feed = fast.pinFeed({
        op: 'BoardFeedResource/get', what: 'This board', nativeUrl: path, nativeLabel: 'Open board on Pinterest', restoreY: y,
        overrides: () => ({ board_id: b.id, board_url: boardUrl, page_size: 25 }),
        opts: { vars: { username: user, slug }, guard: PIN.model.isFeed },
        match: o => String(o.board_id || '') === b.id, empty: 'This board has no pins yet.'
      });
      body.append(feed.el);
      if (visible) { feed.show(); feed.start(); }
    }
    function load() {
      if (loadP) return loadP;
      loadP = fast.firstPage('BoardResource/get', { username: user, slug, field_set_key: 'detailed' },
        { vars: { username: user, slug }, guard: d => !!PIN.model.normalizeBoard(d) },
        o => o.username === user && o.slug === slug).then(r => {
        if (dead) return;
        if (r.ok) { board = PIN.model.normalizeBoard(r.data); paintHead(board); startFeed(board); return; }
        loadP = null;
        head.replaceChildren(fast.banner(r, 'This board', path, 'Open board on Pinterest', true));
      });
      return loadP;
    }
    head.addEventListener('click', e => { const t = e.composedPath()[0]; if (t && t.closest && t.closest('[data-fv-retry]')) { e.preventDefault(); load(); } });

    return {
      key: 'board:' + (user + '/' + slug).toLowerCase(), el,
      get grid() { return feed ? feed.grid : null; },
      show() { el.hidden = false; visible = true; if (feed) { feed.show(); feed.start(); } else load(); },
      hide() { visible = false; if (feed) feed.hide(); el.hidden = true; },
      destroy() { dead = true; if (feed) feed.destroy(); el.remove(); },
      state: () => ({ user, slug, board, pins: feed ? feed.state() : null })
    };
  }
  fast.views = fast.views || {};
  fast.views.board = { mount, key: url => { const p = parse(url); return (p.user + '/' + p.slug).toLowerCase(); } };
})();

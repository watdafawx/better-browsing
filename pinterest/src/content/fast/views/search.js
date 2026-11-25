/* Pinterest Fast UI: the Search view (/search/pins/?q=). BaseSearchResource/get in the shared pin feed (feed.js):
   the same virtualized masonry as Home, promoted pins dropped, `bookmarks` paging, the viewer, and the All / Videos /
   Idea Pins chips. The query stays in the top bar. A failure is this view's own banner ("Open Search on Pinterest"),
   never a reason to hand Home back.
     PIN.fast.views.search.mount(shell, url, { y }) -> { key, el, grid, show(), hide(), destroy(), state() }
     PIN.fast.views.search.key(url)   the query (the router keeps the view while it is the same) */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const OP = 'BaseSearchResource/get';
  const qOf = url => { try { return (new URL(url, location.href).searchParams.get('q') || '').trim().slice(0, 200); } catch { return ''; } };

  function mount(shell, url, { y } = {}) {
    const q = qOf(url);
    const nativeUrl = '/search/pins/?q=' + encodeURIComponent(q) + '&rs=typed';
    const feed = fast.pinFeed({
      op: OP, what: 'Search', nativeUrl, nativeLabel: 'Open Search on Pinterest', filters: true, restoreY: y,
      overrides: () => ({ query: q, scope: 'pins', auto_correction_disabled: false, page_size: 25 }),
      opts: { vars: { q }, guard: PIN.model.isFeed },
      match: o => String(o.query || '').trim() === q,
      loading: 'Searching…', empty: `No pins found for “${q}”.`
    });
    const head = h('header', { class: 'vhead' }, h('h1', { class: 'vtitle', 'data-search-title': '' }, q), h('div', { class: 'vsub' }, 'Pins'));
    const el = h('section', { class: 'view search', 'data-view': 'search', hidden: true }, head, feed.el);
    shell.feed.append(el);
    return {
      key: 'search:' + q, el, feed,
      get grid() { return feed.grid; },
      show() { el.hidden = false; feed.show(); feed.start(); },
      hide() { feed.hide(); el.hidden = true; },
      destroy() { feed.destroy(); el.remove(); },
      state: () => Object.assign({ q }, feed.state())
    };
  }
  fast.views = fast.views || {};
  fast.views.search = { mount, key: url => qOf(url), qOf };
})();

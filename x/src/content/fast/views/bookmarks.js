/* X Fast UI: /i/bookmarks. A header (Back, "Bookmarks"), the Bookmarks op { count: 20 } in XBB.fast.feed with
   pagination; X's own bookmarks page underneath is tapped for the first page. A post un-bookmarked here stays in
   the list until the next visit (like X).
   XBB.fast.views.bookmarks(shell, { url }) -> feed view */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, render = fast.render;

  fast.views = fast.views || {};
  fast.views.bookmarks = function bookmarks(shell) {
    const me = fast.me();
    const bar = h('div', { class: 'pf-bar' },
      h('button', { class: 'icon-btn', type: 'button', 'data-bk': 'back', title: 'Back', 'aria-label': 'Back' }, render.icon('back')),
      h('div', { class: 'pf-title' }, h('b', null, 'Bookmarks'), h('small', null, me.screenName ? '@' + me.screenName : '')));
    const feed = fast.feed(shell, {
      cls: 'bookmarks-view', label: 'bookmarks', head: bar,
      tabs: {
        all: {
          label: 'Bookmarks', learn: 'Bookmarks', ops: ['Bookmarks'],
          vars: () => ({ count: 20, includePromotedContent: true }),
          match: () => true,
          list: () => 'bookmarks',
          native: () => '/i/bookmarks'
        }
      },
      empty: () => 'Save posts for later: bookmark them and they show up here.',
      click(e, t) {
        if (!t.closest('[data-bk="back"]')) return false;
        e.preventDefault();
        fast.back();
        return true;
      }
    });
    feed.kick();
    return Object.assign({}, feed, { debug: () => Object.assign(feed.debug(), { view: 'bookmarks' }) });
  };
})();

/* X Fast UI: search, /search?q=<query>[&f=live|user|media]. A sticky bar (Back, the query, prefilled), tabs Top /
   Latest / People / Media, each one SearchTimeline { rawQuery, count, querySource, product } in XBB.fast.feed. X's
   own search underneath is tapped for the first page; People rows are account cards. A new query is a new entry
   (Back returns to the last one), a tab switch replaces the URL.
   XBB.fast.views.search(shell, { url }) -> feed view + { setUrl(url), query() } */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, render = fast.render;
  const TAB_OF = { '': 'top', live: 'latest', user: 'people', media: 'media' };
  const F = { top: '', latest: 'live', people: 'user', media: 'media' };
  const PRODUCT = { top: 'Top', latest: 'Latest', people: 'People', media: 'Media' };
  const urlFor = (q, k) => '/search?q=' + encodeURIComponent(q) + '&src=typed_query' + (F[k] ? '&f=' + F[k] : '');

  fast.views = fast.views || {};
  fast.views.search = function search(shell, ctx) {
    const parse = url => { const u = new URL(url || location.href, location.href); return { q: (u.searchParams.get('q') || '').trim(), f: u.searchParams.get('f') || '' }; };
    const first = parse(ctx && ctx.url);
    const q = first.q;

    const input = h('input', { type: 'search', name: 'q', value: q, placeholder: 'Search', autocomplete: 'off', 'aria-label': 'Search' });
    const form = h('form', { class: 'sr-bar', role: 'search', 'data-sr-form': '' },
      h('button', { class: 'icon-btn', type: 'button', 'data-sr': 'back', title: 'Back', 'aria-label': 'Back' }, render.icon('back')),
      h('label', { class: 'search' }, render.icon('explore'), input));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const nq = input.value.trim();
      if (nq && nq !== q) fast.go(urlFor(nq, 'top'));
    });

    const TABS = {};
    for (const k of ['top', 'latest', 'people', 'media']) TABS[k] = {
      label: k === 'top' ? 'Top' : k === 'latest' ? 'Latest' : k === 'people' ? 'People' : 'Media',
      learn: 'Search', ops: ['SearchTimeline'], users: k === 'people',
      vars: () => q ? { rawQuery: q, count: 20, querySource: 'typed_query', product: PRODUCT[k] } : null,
      match: v => String(v.rawQuery || '').trim() === q && String(v.product || 'Top') === PRODUCT[k],
      list: () => `search:${k}:${q}`,
      native: () => urlFor(q, k)
    };
    const feed = fast.feed(shell, {
      cls: 'search-view', label: 'search', head: form, tabs: TABS, tab: TAB_OF[first.f] || 'top',
      onSelect: k => fast.go(urlFor(q, k), { replace: true }),
      empty: k => q ? `No results for "${q}"${k === 'people' ? ' among accounts' : ''}.` : 'Type something to search for.',
      click(e, t) {
        if (!t.closest('[data-sr="back"]')) return false;
        e.preventDefault();
        fast.back();
        return true;
      }
    });
    feed.kick();

    return Object.assign({}, feed, {
      query: () => q,
      input,
      setUrl(url) {
        const p = parse(url);
        if (p.q !== q) return false;
        feed.select(TAB_OF[p.f] || 'top', true);
        return true;
      },
      debug: () => Object.assign(feed.debug(), { view: 'search', q })
    });
  };
  fast.views.search.urlFor = urlFor;
})();

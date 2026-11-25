/* X Fast UI: the Home view. Two tabs, "For you" (HomeTimeline) and "Following" (HomeLatestTimeline), each a
   timeline in the store with its own rows, cursors, heights and scroll position, shown in one virtual list.
     - Boot costs no request: X loads its own Home underneath (hidden) and the passive tap hands us that response
       (XBB.gql.getTapped / onTap). Only when nothing arrived after a few seconds does the view ask itself.
     - Later responses X fetches are placed by their cursor: none = a fresh top page (new posts), the tab's bottom
       cursor = the next page, the top cursor = newer posts. New posts while scrolled down wait behind a
       "Show N posts" pill; at the top they go straight in (the scroll anchor keeps the view still either way).
     - Next page: within three screens of the end, the tab's own variables with the bottom cursor, one at a time.
     - Schema guard: a 200 that holds no timeline at all fails the route hard (X gets Home back); a failed page
       load is a soft failure (three in five minutes do the same).
   XBB.fast.views.home(shell) -> { el, click(e), refresh(id), top(), showPending(), pending(), pause(on), list(), destroy(), debug() } */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store, render = fast.render;
  const TABS = {
    foryou: { op: 'HomeTimeline', label: 'For you' },
    following: { op: 'HomeLatestTimeline', label: 'Following' }
  };
  const TAB_KEY = 'xbb-fast-home-tab';
  const FALLBACK_MS = 1800;
  const BASE_VARS = { count: 20, includePromotedContent: true, latestControlAvailable: true, withCommunity: true };
  const stripVars = v => { const o = Object.assign({}, v || {}); delete o.cursor; delete o.seenTweetIds; delete o.requestContext; return o; };

  fast.views = fast.views || {};
  fast.views.home = function home(shell) {
    let tab = 'foryou';
    try { const t = sessionStorage.getItem(TAB_KEY); if (TABS[t]) tab = t; } catch {}
    const lists = {};
    for (const k in TABS) {
      const l = lists[k] = store.list('home:' + k);
      l.pending = l.pending || [];
      l.loading = false;
      l.error = '';
      l.done = false;
    }
    let dead = false, paused = false;

    // ---------- DOM ----------
    const tabBtns = {};
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, Object.keys(TABS).map(k =>
      tabBtns[k] = h('button', { type: 'button', role: 'tab', 'data-tab': k, 'aria-selected': String(k === tab) }, TABS[k].label)));
    const pill = h('button', { class: 'new-pill', type: 'button', hidden: true, 'data-pill': '' });
    const headEl = h('div', { class: 'col-head' }, tabs, pill);
    const listEl = h('div', { class: 'vlist', role: 'feed', 'aria-busy': 'false' });
    const stateEl = h('div', { class: 'state' });
    const el = h('div', { class: 'home' }, headEl, listEl, stateEl);
    shell.main.replaceChildren(el);

    const vl = fast.vlist({
      el: listEl,
      overscan: 1,
      estimate: render.estimate,
      mount(row, node) { node.append(render.tweet(store.tweet(row.id), row)); },
      attached: node => { render.attach(node); if (fast.keys) fast.keys.mark(node); },
      unmount: node => render.release(node),
      onNearEnd: () => loadMore(),
      onError: e => fast.fail('home', 'render: ' + (e && e.message), false)
    });

    // ---------- rows from a timeline response ----------
    function rowsOf(items, list) {
      const out = [];
      const seen = new Set();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== 'tweet' || !it.tweet || !it.tweet.id) continue;
        const t = store.put(it.tweet);
        if (list.keys.has(t.id) || seen.has(t.id)) continue;
        seen.add(t.id);
        const prev = items[i - 1], next = items[i + 1];
        const inMod = x => x && x.kind === 'tweet' && it.moduleId && x.moduleId === it.moduleId;
        out.push({ key: t.id, id: t.id, threadPrev: inMod(prev) || undefined, threadNext: inMod(next) || undefined });
      }
      return out;
    }
    // where: 'replace' | 'bottom' | 'top'. Returns how many rows came in, or -1 when the response is not a timeline.
    function ingest(name, data, where) {
      const list = lists[name];
      const tl = XBB.model.extractTimeline(data);
      if (!tl.rawEntryCount && !tl.cursors.top && !tl.cursors.bottom) {
        // Alert-only or clear-cache instructions are valid empty responses from X (e.g. background polls): ignore them.
        if (tl.hasInstructions) {
          console.warn('[XBB fast] empty instructions:', { op: TABS[name].op, types: tl.instructionTypes, dataKeys: data && data.data ? Object.keys(data.data) : [] });
          return 0;
        }
        const topKeys = data && typeof data === 'object' ? Object.keys(data) : [];
        const dataKeys = data && data.data && typeof data.data === 'object' ? Object.keys(data.data) : [];
        console.warn('[XBB fast] schema detail:', { op: TABS[name].op, topKeys, dataKeys, errors: data && data.errors });
        fast.fail('home', `schema: no timeline in ${TABS[name].op}`, true);
        return -1;
      }
      const rows = rowsOf(tl.items, list);
      if (where === 'replace' || !list.rows.length) {
        list.rows = rows; list.keys = new Set(rows.map(r => r.key));
        list.cursors.top = tl.cursors.top; list.cursors.bottom = tl.cursors.bottom;
        list.loadedAt = Date.now();
        if (name === tab) vl.setRows(list.rows, list.heights);
      } else if (where === 'bottom') {
        for (const r of rows) { list.rows.push(r); list.keys.add(r.key); }
        // no new cursor, the same cursor again, or nothing new: the end of this timeline
        const sent = list.cursors.bottom;
        list.cursors.bottom = tl.cursors.bottom || null;
        if (!tl.cursors.bottom || tl.cursors.bottom === sent || !rows.length) list.done = true;
        if (name === tab) vl.append(rows);
      } else {
        if (tl.cursors.top) list.cursors.top = tl.cursors.top;
        if (rows.length) {
          for (const r of rows) list.keys.add(r.key);
          if (name === tab && atTop() && !list.pending.length) { list.rows = rows.concat(list.rows); vl.prepend(rows); }
          else list.pending = rows.concat(list.pending);
        }
      }
      sync();
      return rows.length;
    }

    // ---------- the passive tap ----------
    const tabOf = op => { for (const k in TABS) if (TABS[k].op === op) return k; return null; };
    function onTap(t) {
      if (dead || !t || !(t.status >= 200 && t.status < 300) || !t.data) return;
      const name = tabOf(t.op);
      if (!name) return;
      const list = lists[name], cur = t.variables && t.variables.cursor;
      list.vars = stripVars(t.variables);
      if (!list.rows.length) ingest(name, t.data, 'replace');
      else if (!cur) ingest(name, t.data, 'top');
      else if (cur === list.cursors.bottom) ingest(name, t.data, 'bottom');
      else if (cur === list.cursors.top) ingest(name, t.data, 'top');
      // another cursor: a page of X's own list we never showed; its posts would land out of order, so skip it
    }
    const offTaps = Object.values(TABS).map(T => XBB.gql.onTap(T.op, onTap));
    for (const T of Object.values(TABS)) for (const t of XBB.gql.getTapped(T.op, { all: true })) onTap(t);

    // ---------- our own requests ----------
    const varsFor = name => {
      const l = lists[name];
      if (l.vars) return Object.assign({}, l.vars);
      const other = lists[name === 'foryou' ? 'following' : 'foryou'].vars;
      return Object.assign({}, BASE_VARS, stripVars(other));
    };
    async function request(name, where) {
      const list = lists[name];
      if (list.loading || dead) return;
      list.loading = true; list.error = '';
      sync();
      const vars = varsFor(name);
      if (where === 'bottom') vars.cursor = list.cursors.bottom;
      fast.extraRequests = (fast.extraRequests || 0) + 1;
      const r = await XBB.gql.call(TABS[name].op, vars);
      list.loading = false;
      if (dead) return;
      if (r.ok) { if (!list.vars) list.vars = stripVars(vars); ingest(name, r.data, list.rows.length ? where : 'replace'); return; }
      console.warn('[XBB fast] request failed:', TABS[name].op, { kind: r.kind, status: r.status, error: r.error, txid: r.txid });
      if (name === 'following' && (r.kind === 'missing-op' || r.kind === 'breaker-open')) {
        list.error = 'Following feed not learned yet. Open Native X → Following once, or switch to For you.';
        sync();
        return;
      }
      list.error = r.kind === 'rate-limit' ? 'X is rate limiting requests. Try again in a minute.' : 'Could not load posts from X.';
      // drift / missing-op opened the API breaker: flag.js hands the route to X. Everything else counts as soft.
      if (r.kind !== 'drift' && r.kind !== 'missing-op' && r.kind !== 'breaker-open') fast.fail('home', `load ${TABS[name].op}: ${r.kind}`, false);
      sync();
    }
    function loadMore() {
      const list = lists[tab];
      if (paused || list.loading || list.done || !list.cursors.bottom || !list.rows.length) return;
      request(tab, 'bottom');
    }
    // Nothing tapped yet: X may still be booting. Ask ourselves only after a while.
    let fallbackT = 0;
    function ensure(name) {
      clearTimeout(fallbackT);
      const list = lists[name];
      if (list.rows.length || list.loading) return;
      if (name === 'foryou') fallbackT = setTimeout(() => { if (!dead && !lists.foryou.rows.length) request('foryou', 'replace'); }, FALLBACK_MS);
      else request(name, 'replace');
    }

    // ---------- state ----------
    const atTop = () => listEl.getBoundingClientRect().top >= -40;
    function sync() {
      if (dead) return;
      const list = lists[tab];
      for (const k in tabBtns) tabBtns[k].setAttribute('aria-selected', String(k === tab));
      const n = list.pending.length;
      pill.hidden = !n;
      if (n) pill.textContent = `Show ${n} post${n === 1 ? '' : 's'}`;
      listEl.setAttribute('aria-busy', String(!!list.loading));
      let st = null;
      if (list.error) st = h('div', null, list.error, h('div', null, h('button', { class: 'btn', type: 'button', 'data-retry': '' }, 'Retry')));
      else if (list.loading || (!list.rows.length && !list.done)) st = h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' });
      else if (list.done || !list.cursors.bottom) st = list.rows.length ? null : h('div', null, 'Nothing to see here yet.');
      stateEl.replaceChildren(...(st ? [st] : []));
      shell.setStat(`⚡ ${list.rows.length} posts · ${fast.extraRequests || 0} extra requests`);
    }

    function select(name) {
      if (!TABS[name] || name === tab) return;
      lists[tab].scroll = scrollY;
      tab = name;
      try { sessionStorage.setItem(TAB_KEY, name); } catch {}
      vl.setRows(lists[name].rows, lists[name].heights);
      scrollTo(0, lists[name].scroll || 0);
      vl.layoutNow();
      ensure(name);
      sync();
    }
    function showPending() {
      const list = lists[tab];
      const rows = list.pending;
      list.pending = [];
      list.rows = rows.concat(list.rows);
      vl.setRows(list.rows, list.heights);
      top();
      sync();
    }
    function top() { scrollTo(0, 0); vl.layoutNow(); }

    function refresh(id) {
      for (const node of vl.nodes()) {
        if (node._key !== id) continue;
        render.release(node);
        const row = vl.rows()[node._i] || { id };
        node.replaceChildren(render.tweet(store.tweet(id), row));
        render.attach(node);
      }
    }
    function click(e) {
      const p = e.composedPath ? e.composedPath() : [e.target];
      const t = p[0] && p[0].nodeType === 1 ? p[0] : e.target;
      const tb = t.closest('[data-tab]');
      if (tb) { e.preventDefault(); if (tb.dataset.tab === tab) { top(); } else select(tb.dataset.tab); return true; }
      if (t.closest('[data-pill]')) { e.preventDefault(); showPending(); return true; }
      if (t.closest('[data-retry]')) { e.preventDefault(); const l = lists[tab]; l.error = ''; request(tab, l.rows.length ? 'bottom' : 'replace'); return true; }
      return false;
    }

    // first paint: whatever is already here (tapped before we mounted, or kept from an earlier visit)
    vl.setRows(lists[tab].rows, lists[tab].heights);
    ensure(tab);
    sync();

    return {
      el, click, refresh, top, showPending,
      pending: () => lists[tab].pending.length,
      pause(on) {
        paused = !!on;
        if (on) lists[tab].scroll = scrollY;
        vl.pause(on);
        if (!on) { scrollTo(0, lists[tab].scroll || 0); vl.layoutNow(); sync(); }
      },
      tab: () => tab,
      select,
      list: () => vl,
      destroy() {
        dead = true;
        clearTimeout(fallbackT);
        offTaps.forEach(f => f());
        vl.destroy();
        el.remove();
      },
      debug: () => ({ tab, mounted: vl.mounted(), rows: lists[tab].rows.length, pending: lists[tab].pending.length, cursors: Object.assign({}, lists[tab].cursors), loading: lists[tab].loading, total: vl.total() })
    };
  };
})();

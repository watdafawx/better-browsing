/* X Fast UI: a tabbed timeline in the centre column, shared by the profile, search and bookmarks views. One virtual
   list for every tab; each tab is a timeline in the store (rows, cursors, heights, scroll).
     - First page: a fresh response X itself just got for the same variables (the passive tap: X's router renders the
       page underneath and fetches it, so opening a profile or a search costs no request of ours). Otherwise, unless
       X's JS is blocked (Zero-JS mode: no tap will ever come, fetch at 0 ms), a short wait for that tap, then our call.
     - Next pages: the tab's bottom cursor, within three screens of the end, one at a time.
     - An op we cannot use (not learned yet, X changed it, no main world) is the view's own banner with "Open on X":
       it never fails the route and never touches Home's breaker (flag.js only watches Home's ops).
   XBB.fast.feed(shell, cfg) -> { el, head, list(), click(e), refresh(id), select(k), tab(), kick(), top(), pause(on),
     destroy(), debug() }
   cfg: { cls, label, head: Node (sticky), hero: Node (scrolls away, tabs below it), tabs: { key: T }, tab, onSelect(key),
          empty(key), click(e, target) }
   T:   { label, ops: [op, fallbackOp...], vars() (null while not ready), match(tapVars), list() (store list name),
          native() (X's URL for this tab), learn (what to call it in the banner), users: rows are accounts } */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store, render = fast.render;
  const TAP_WAIT = 700;          // ms to wait for X's own response before asking ourselves
  const TAP_FRESH = 60000;       // a tapped first page younger than this is used as is
  const UNLEARNED = new Set(['missing-op', 'no-main-world']);

  fast.feed = function feed(shell, cfg) {
    const tabs = cfg.tabs;
    let tab = tabs[cfg.tab] ? cfg.tab : Object.keys(tabs)[0];
    let dead = false, paused = false, waitT = 0;
    const meta = new Map();            // list name -> { loading, error, done, banner, waited }
    const L = k => { const l = store.list(tabs[k].list()); if (!meta.has(l.name)) meta.set(l.name, { loading: false, banner: null, done: false, waited: false }); return l; };
    const M = k => { L(k); return meta.get(tabs[k].list()); };

    // ---------- DOM ----------
    const tabBtns = {};
    const tabRow = Object.keys(tabs).length > 1 ? h('div', { class: 'tabs', role: 'tablist' }, Object.keys(tabs).map(k =>
      tabBtns[k] = h('button', { type: 'button', role: 'tab', 'data-fd-tab': k, 'aria-selected': String(k === tab) }, tabs[k].label))) : null;
    // the sticky header holds the tabs too, unless a hero (the profile's banner and bio) sits between them
    const headEl = h('div', { class: 'col-head' }, cfg.head || null, cfg.hero ? null : tabRow);
    const bannerEl = h('div', { class: 'fd-banner', role: 'status', hidden: true });
    const listEl = h('div', { class: 'vlist', role: 'feed', 'aria-busy': 'false' });
    const stateEl = h('div', { class: 'state' });
    const el = h('div', { class: 'feed ' + (cfg.cls || '') }, headEl, cfg.hero || null, cfg.hero ? tabRow : null, bannerEl, listEl, stateEl);

    const vl = fast.vlist({
      el: listEl,
      overscan: 1,
      estimate: row => row.uid ? 96 : render.estimate(row),
      mount(row, node) { node.append(row.uid ? render.userCard(store.profileById(row.uid) || store.user(row.uid)) : render.tweet(store.tweet(row.id), row)); },
      attached: node => { render.attach(node); if (fast.keys) fast.keys.mark(node); },
      unmount: node => render.release(node),
      onNearEnd: () => loadMore()
    });

    // ---------- rows ----------
    function rowsOf(items, list, users) {
      const out = [], seen = new Set();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'user' && it.user && it.user.id && !it.user.unavailable) {
          store.putProfile(it.user);
          const key = 'u' + it.user.id;
          if (list.keys.has(key) || seen.has(key)) continue;
          seen.add(key);
          out.push({ key, uid: it.user.id });
          continue;
        }
        if (users || it.kind !== 'tweet' || !it.tweet || !it.tweet.id) continue;
        const t = store.put(it.tweet);
        if (list.keys.has(t.id) || seen.has(t.id)) continue;
        seen.add(t.id);
        const prev = items[i - 1], next = items[i + 1];
        const inMod = x => x && x.kind === 'tweet' && it.moduleId && x.moduleId === it.moduleId;
        out.push({ key: t.id, id: t.id, pinned: it.pinned || undefined, threadPrev: inMod(prev) || undefined, threadNext: inMod(next) || undefined });
      }
      return out;
    }
    // where: 'replace' | 'bottom'. -1 when the response holds no timeline at all.
    function ingest(k, data, where) {
      const T = tabs[k], list = L(k), m = M(k);
      const tl = XBB.model.extractTimeline(data);
      if (!tl.rawEntryCount && !tl.cursors.top && !tl.cursors.bottom && !tl.hasInstructions) {
        console.warn('[XBB fast] no timeline in', T.ops[0], data && data.errors);
        m.banner = { kind: 'drift', msg: `X sent no ${T.learn || T.label} timeline.` };
        sync();
        return -1;
      }
      const rows = rowsOf(tl.items, list, T.users);
      if (where === 'replace' || !list.rows.length) {
        list.rows = rows; list.keys = new Set(rows.map(r => r.key));
        list.cursors.top = tl.cursors.top; list.cursors.bottom = tl.cursors.bottom;
        list.loadedAt = Date.now();
        m.done = !tl.cursors.bottom || !rows.length;
        if (k === tab) vl.setRows(list.rows, list.heights);
      } else {
        for (const r of rows) { list.rows.push(r); list.keys.add(r.key); }
        const sent = list.cursors.bottom;
        list.cursors.bottom = tl.cursors.bottom || null;
        if (!tl.cursors.bottom || tl.cursors.bottom === sent || !rows.length) m.done = true;
        if (k === tab) vl.append(rows);
      }
      m.banner = null;
      sync();
      return rows.length;
    }

    // ---------- the passive tap: X's own first page for these variables ----------
    const opsAll = [...new Set(Object.values(tabs).flatMap(T => T.ops))];
    const fresh = t => t && t.status >= 200 && t.status < 300 && t.data && Date.now() - (t.t || 0) < TAP_FRESH;
    const firstPage = t => !(t.variables && t.variables.cursor);
    function tapFor(k) {
      const T = tabs[k];
      if (!T.vars()) return null;
      let best = null;
      for (const op of T.ops) for (const t of XBB.gql.getTapped(op, { all: true })) {
        if (fresh(t) && firstPage(t) && T.match(t.variables || {}, t.op) && (!best || (t.t || 0) > (best.t || 0))) best = t;
      }
      return best;
    }
    function onTap(t) {
      if (dead || !fresh(t) || !firstPage(t)) return;
      for (const k in tabs) {
        const T = tabs[k];
        if (!T.ops.includes(t.op) || !T.vars() || !T.match(t.variables || {}, t.op)) continue;
        const list = L(k), m = M(k);
        if (list.rows.length || m.loading) continue;
        list.vars = t.variables;
        if (k === tab) clearTimeout(waitT);
        ingest(k, t.data, 'replace');
      }
    }
    const offTaps = opsAll.map(op => XBB.gql.onTap(op, onTap));

    // ---------- our own requests ----------
    const blocking = () => !!(XBB.ext && XBB.ext.blocking());
    async function request(k, where) {
      const T = tabs[k], list = L(k), m = M(k);
      const base = T.vars();
      if (m.loading || dead || !base) return;
      m.loading = true; m.banner = null;
      sync();
      let r = null;
      for (let i = 0; i < T.ops.length; i++) {
        const vars = Object.assign({}, base);
        if (where === 'bottom') vars.cursor = list.cursors.bottom;
        fast.extraRequests = (fast.extraRequests || 0) + 1;
        r = await XBB.gql.call(T.ops[i], vars);
        if (dead) return;
        // the first choice (UserOriginalsTimeline) not harvested: the next one (UserTweets)
        const unlearned = UNLEARNED.has(r.kind) || (r.kind === 'breaker-open' && r.breaker && r.breaker.kind === 'missing-op');
        if (!r.ok && unlearned && i < T.ops.length - 1) continue;
        break;
      }
      m.loading = false;
      if (r.ok) { ingest(k, r.data, list.rows.length ? where : 'replace'); return; }
      const bk = r.kind === 'breaker-open' && r.breaker ? r.breaker.kind : r.kind;
      const what = T.learn || T.label;
      if (UNLEARNED.has(bk)) m.banner = { kind: 'learn', msg: `${what} not learned yet. Open it on X once to learn it.` };
      else if (bk === 'drift') m.banner = { kind: 'drift', msg: `X changed how ${what} loads. Open it on X for now.` };
      else if (bk === 'rate-limit') m.banner = { kind: 'retry', msg: 'X is rate limiting requests. Try again in a minute.' };
      else if (bk === 'auth') m.banner = { kind: 'drift', msg: 'X did not accept the session. Open it on X.' };
      else m.banner = { kind: 'retry', msg: `Could not load ${what} from X.` };
      console.warn('[XBB fast] feed request failed:', T.ops.join('|'), { kind: r.kind, status: r.status, error: r.error });
      sync();
    }
    function loadMore() {
      const list = L(tab), m = M(tab);
      if (paused || m.loading || m.done || !list.cursors.bottom || !list.rows.length || m.banner) return;
      request(tab, 'bottom');
    }
    // the first page of the current tab: kept, tapped, a short wait for X's own call, or ours
    function ensure() {
      clearTimeout(waitT);
      const k = tab, list = L(k), m = M(k);
      if (list.rows.length || m.loading || m.banner || !tabs[k].vars()) { sync(); return; }
      const t = tapFor(k);
      if (t) { list.vars = t.variables; ingest(k, t.data, 'replace'); return; }
      if (blocking() || m.waited) { request(k, 'replace'); return; }
      m.waited = true;
      waitT = setTimeout(() => { if (!dead && tab === k && !L(k).rows.length) request(k, 'replace'); }, TAP_WAIT);
      sync();
    }

    // ---------- state ----------
    function sync() {
      if (dead) return;
      const list = L(tab), m = M(tab);
      for (const k in tabBtns) tabBtns[k].setAttribute('aria-selected', String(k === tab));
      listEl.setAttribute('aria-busy', String(!!m.loading));
      const b = m.banner;
      bannerEl.hidden = !b;
      if (b) {
        const T = tabs[tab];
        bannerEl.dataset.kind = b.kind;
        bannerEl.replaceChildren(h('span', null, b.msg), h('span', { class: 'fd-acts' },
          b.kind === 'retry' ? h('button', { class: 'btn', type: 'button', 'data-fd-retry': '' }, 'Retry') : null,
          h('button', { class: 'btn primary', type: 'button', 'data-fd-native': T.native() }, 'Open on X', render.icon('ext'))));
      }
      let st = null;
      if (b && !list.rows.length) st = null;
      else if (m.loading || (!list.rows.length && !m.done)) st = h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' });
      else if (!list.rows.length) st = h('div', { class: 'empty' }, cfg.empty ? cfg.empty(tab) : 'Nothing to see here yet.');
      stateEl.replaceChildren(...(st ? [st] : []));
      shell.setStat(`⚡ ${list.rows.length} ${tabs[tab].users ? 'accounts' : 'posts'} · ${fast.extraRequests || 0} extra requests`);
    }

    function select(k, quiet) {
      if (!tabs[k] || k === tab) return;
      L(tab).scroll = scrollY;
      tab = k;
      vl.setRows(L(k).rows, L(k).heights);
      const y = L(k).scroll || 0;
      if (y) scrollTo(0, y);
      else top();
      vl.layoutNow();
      ensure();
      if (!quiet && cfg.onSelect) cfg.onSelect(k);
    }
    // The tab's variables changed meaning (the profile's user arrived, a new query): start that tab again
    function kick() { vl.setRows(L(tab).rows, L(tab).heights); ensure(); sync(); }
    // jump so the list starts right under the sticky header (the profile's own header scrolls away)
    function top() {
      const r = listEl.getBoundingClientRect();
      const y = scrollY + r.top - (headEl.getBoundingClientRect().height || 0) - 60;
      scrollTo(0, Math.max(0, Math.min(scrollY, y)));
      vl.layoutNow();
    }

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
      const tb = t.closest('[data-fd-tab]');
      if (tb) { e.preventDefault(); if (tb.dataset.fdTab === tab) top(); else select(tb.dataset.fdTab); return true; }
      if (t.closest('[data-fd-retry]')) { e.preventDefault(); const m = M(tab); m.banner = null; request(tab, L(tab).rows.length ? 'bottom' : 'replace'); return true; }
      const nat = t.closest('[data-fd-native]');
      if (nat) { e.preventDefault(); fast.toNative(nat.dataset.fdNative); return true; }
      if (cfg.click && cfg.click(e, t)) return true;
      const uc = t.closest('.ucard[data-href]');
      if (uc && !t.closest('a[href], button') && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); fast.go(uc.dataset.href); return true; }
      return false;
    }

    return {
      el, head: headEl, click, refresh, select, kick, top, ensure,
      tab: () => tab,
      list: () => vl,
      rows: k => L(k || tab).rows,
      banner: k => M(k || tab).banner,
      pause(on) {
        paused = !!on;
        if (on) L(tab).scroll = scrollY;
        vl.pause(on);
        if (!on) { scrollTo(0, L(tab).scroll || 0); vl.layoutNow(); sync(); }
      },
      destroy() {
        dead = true;
        clearTimeout(waitT);
        offTaps.forEach(f => f());
        vl.destroy();
        el.remove();
      },
      debug: () => { const l = L(tab), m = M(tab); return { label: cfg.label, tab, rows: l.rows.length, mounted: vl.mounted(), cursors: Object.assign({}, l.cursors), loading: m.loading, done: m.done, banner: m.banner && m.banner.kind }; }
    };
  };
})();

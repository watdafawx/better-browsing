/* X Fast UI: the notifications popout. A native popover="auto" (top layer, light dismiss, Esc) next to the rail's
   Notifications button, a full-width sheet on narrow screens; the view under it and its scroll never move.
     - Tabs All / Mentions. Data: X's REST /i/api/2/notifications/{all,mentions}.json (a response X itself just got is
       used as is); on 404 or drift the GraphQL NotificationsTimeline. Both shapes: XBB.model.extractNotifications.
     - A post (liked, reposted, a reply, a mention): the thread drawer over the current view, the popout closes. A
       person: their profile in Fast UI. Anything else: X's own page for it.
     - Not learned / X refused: "Open Notifications on X" (fast.toNative).
     - The rail's unread badge: from X's own badge_count / fetchNotificationBadgeCountsQuery responses (the tap: no
       request of ours), once on our own only when X's JS is blocked (Zero-JS mode). Opening the popout clears it.
   XBB.fast.notifications.open(anchor) / toggle(anchor) / close() / isOpen() / debug() */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store, render = () => fast.render;
  const FRESH = 60000;
  const TABS = { all: { label: 'All', rest: 'all', gql: 'All', tap: 'notifications_all' }, mentions: { label: 'Mentions', rest: 'mentions', gql: 'Mentions', tap: 'notifications_mentions' } };
  const lists = {};
  for (const k in TABS) lists[k] = { items: [], ids: new Set(), cursor: null, via: '', loading: false, banner: null, at: 0, done: false };
  let closedAt = 0;   // light dismiss closes on pointerdown: the click on the rail button right after must not reopen it
  let tab = 'all', pop = null, bodyEl = null, tabBtns = {}, anchorEl = null;
  const unread = { notifications: null, messages: null };

  // ---------- badge ----------
  function paintBadge() {
    const sh = fast.shell && fast.shell.get();
    if (!sh || !sh.setBadge) return;
    sh.setBadge('notifications', unread.notifications);
    sh.setBadge('messages', unread.messages);
  }
  function onBadge(t) {
    if (!t || !(t.status >= 200 && t.status < 300)) return;
    const c = XBB.model.badgeCounts(t.data);
    if (c.notifications !== null && !(pop && isOpen())) unread.notifications = c.notifications;
    if (c.messages !== null) unread.messages = c.messages;
    paintBadge();
  }
  function onListTap(t) {
    if (!t || !(t.status >= 200 && t.status < 300) || !t.data) return;
    for (const k in TABS) if (TABS[k].tap === t.op && !lists[k].loading && !(lists[k].items.length && Date.now() - lists[k].at < FRESH)) take(k, t.data, 'replace', 'rest');
  }
  let offs = null, asked = false, askT = 0;
  function wire(on) {
    if (on && !offs) {
      offs = [XBB.gql.onTap('badge_count', onBadge), XBB.gql.onTap('fetchNotificationBadgeCountsQuery', onBadge),
        XBB.gql.onTap('notifications_all', onListTap), XBB.gql.onTap('notifications_mentions', onListTap)];
      for (const op of ['badge_count', 'fetchNotificationBadgeCountsQuery']) { const t = XBB.gql.getTapped(op); if (t) onBadge(t); }
    } else if (!on && offs) { offs.forEach(f => f()); offs = null; }
  }
  // Zero-JS mode: X never asks for its badge, so we do, once, after the feed is up
  async function askBadge() {
    if (asked || !(XBB.ext && XBB.ext.blocking())) return;
    asked = true;
    let r = null;
    if (await XBB.gql.knows('fetchNotificationBadgeCountsQuery')) r = await XBB.gql.call('fetchNotificationBadgeCountsQuery', {});
    if (!r || !r.ok) r = await XBB.gql.rest('/i/api/2/badge_count/badge_count.json', { query: { supports_ntab_urt: '1' } });
    if (r && r.ok) onBadge({ status: 200, data: r.data });
  }

  // ---------- data ----------
  function take(k, data, where, via) {
    const L = lists[k];
    const n = XBB.model.extractNotifications(data);
    if (!n.ok) return false;
    if (where === 'replace') { L.items = []; L.ids = new Set(); }
    for (const it of n.items) {
      if (L.ids.has(it.id)) continue;
      L.ids.add(it.id);
      if (it.tweet && it.tweet.id) store.put(it.tweet);
      for (const u of it.users) if (u && u.id) store.putProfile(u);
      L.items.push(it);
    }
    const sent = L.cursor;
    L.cursor = n.cursors.bottom || null;
    L.done = !L.cursor || L.cursor === sent && where !== 'replace' || !n.items.length;
    L.via = via;
    L.at = Date.now();
    L.banner = null;
    if (pop && tab === k) paint();
    return true;
  }
  const restPath = k => `/i/api/2/notifications/${TABS[k].rest}.json`;
  async function load(k, where) {
    const L = lists[k];
    if (L.loading) return;
    if (where === 'replace') {
      const t = XBB.gql.getTapped(TABS[k].tap);
      if (t && t.status >= 200 && t.status < 300 && Date.now() - (t.t || 0) < FRESH && take(k, t.data, 'replace', 'rest')) return;
    }
    L.loading = true; L.banner = null;
    paint();
    const cursor = where === 'bottom' ? L.cursor : null;
    let ok = false, r = null;
    if (L.via !== 'gql') {
      const query = { include_profile_interstitial_type: '1', count: '30' };
      if (cursor) query.cursor = cursor;
      fast.extraRequests = (fast.extraRequests || 0) + 1;
      r = await XBB.gql.rest(restPath(k), { query });
      if (r.ok) ok = take(k, r.data, where, 'rest');
    }
    // REST gone (404), refused (drift) or unreadable: X's GraphQL op
    if (!ok && (!r || ['not-found', 'drift', 'parse', 'bad-path'].includes(r.kind) || r.ok)) {
      const vars = { timeline_type: TABS[k].gql, count: 30 };
      if (cursor) vars.cursor = cursor;
      fast.extraRequests = (fast.extraRequests || 0) + 1;
      const g = await XBB.gql.call('NotificationsTimeline', vars);
      if (g.ok) ok = take(k, g.data, where, 'gql');
      r = g.ok && !ok ? { kind: 'parse' } : g;
    }
    L.loading = false;
    if (!ok) {
      const bk = r && (r.kind === 'breaker-open' && r.breaker ? r.breaker.kind : r.kind);
      L.banner = bk === 'missing-op' || bk === 'no-main-world' ? 'Notifications not learned yet. Open them on X once to learn them.'
        : bk === 'rate-limit' ? 'X is rate limiting requests. Try again in a minute.'
          : bk === 'auth' ? 'X did not accept the session.' : 'Could not load notifications from X.';
      console.warn('[XBB fast] notifications failed:', r && r.kind, r && r.status);
    }
    paint();
  }

  // ---------- DOM ----------
  const KIND_ICON = { like: 'like', rt: 'rt', follow: 'user', reply: 'reply', mention: 'reply', bell: 'bell' };
  function item(it) {
    const R = render();
    const t = it.tweet;
    const users = it.users.filter(u => u && u.screenName).slice(0, 6);
    const lead = users[0];
    const kids = [];
    if (it.kind === 'tweet' && t) {
      kids.push(h('div', { class: 'nt-head' }, R.avatar(t.author, 'sm'), h('b', null, t.author.name || t.author.screenName), R.badge(t.author),
        h('span', { class: 'handle' }, '@' + t.author.screenName), t.createdAtMs ? h('span', { class: 'when' }, '· ' + R.rel(t.createdAtMs)) : null));
      kids.push(h('div', { class: 'nt-text', dir: 'auto' }, R.rich(t, { plain: true })));
    } else {
      if (users.length) kids.push(h('div', { class: 'nt-avs' }, users.map(u => h('a', { href: '/' + u.screenName, 'data-nt-user': u.screenName, title: u.name || u.screenName }, R.avatar(u, 'sm')))));
      kids.push(h('div', { class: 'nt-msg', dir: 'auto' }, it.text || (lead ? (lead.name || lead.screenName) : 'Notification'),
        it.timeMs ? h('span', { class: 'when' }, ' · ' + R.rel(it.timeMs)) : null));
      if (t) kids.push(h('div', { class: 'nt-quote', dir: 'auto' }, String(t.text || '').slice(0, 280)));
    }
    let target = '';
    if (it.tweetId) target = 'tw';
    else if (lead) target = 'user';
    else if (it.url) target = 'url';
    return h('div', { class: 'nt-item' + (it.unread ? ' unread' : ''), role: 'listitem', tabindex: '0',
      'data-nt-tw': target === 'tw' ? it.tweetId : null, 'data-nt-user': target === 'user' ? lead.screenName : null,
      'data-nt-url': target === 'url' ? it.url : null },
    h('span', { class: 'nt-ic k-' + it.icon }, R.icon(KIND_ICON[it.icon] || 'bell', 'i fill')), h('div', { class: 'nt-body' }, kids));
  }
  function paint() {
    if (!pop) return;
    for (const k in tabBtns) tabBtns[k].setAttribute('aria-selected', String(k === tab));
    const L = lists[tab];
    const kids = [];
    if (L.items.length) kids.push(h('div', { class: 'nt-list', role: 'list' }, L.items.map(item)));
    if (L.banner) kids.push(h('div', { class: 'fd-banner', 'data-kind': 'learn', role: 'status' }, h('span', null, L.banner),
      h('span', { class: 'fd-acts' }, h('button', { class: 'btn', type: 'button', 'data-nt': 'retry' }, 'Retry'),
        h('button', { class: 'btn primary', type: 'button', 'data-nt': 'native' }, 'Open Notifications on X', render().icon('ext')))));
    else if (L.loading) kids.push(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' }));
    else if (!L.items.length) kids.push(h('div', { class: 'empty' }, tab === 'mentions' ? 'No mentions yet.' : 'Nothing new.'));
    else if (!L.done) kids.push(h('button', { class: 'btn more', type: 'button', 'data-nt': 'more' }, 'Load more'));
    bodyEl.replaceChildren(...kids);
  }
  function build(sh) {
    if (pop && pop.isConnected) return pop;
    tabBtns = {};
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' }, Object.keys(TABS).map(k =>
      tabBtns[k] = h('button', { type: 'button', role: 'tab', 'data-nt-tab': k, 'aria-selected': String(k === tab) }, TABS[k].label)));
    bodyEl = h('div', { class: 'nt-scroll' });
    pop = h('div', { class: 'ntf', popover: 'auto', role: 'dialog', 'aria-label': 'Notifications' },
      h('div', { class: 'nt-top' }, h('b', null, 'Notifications'), h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', type: 'button', 'data-nt': 'native', title: 'Open Notifications on X', 'aria-label': 'Open Notifications on X' }, render().icon('ext')),
        h('button', { class: 'icon-btn', type: 'button', 'data-nt': 'close', title: 'Close', 'aria-label': 'Close' }, render().icon('close'))),
      tabsEl, bodyEl);
    pop.addEventListener('click', onClick);
    pop.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const p = e.composedPath ? e.composedPath()[0] : e.target;
      if (p && p.classList && p.classList.contains('nt-item')) { e.preventDefault(); p.click(); }
    });
    pop.addEventListener('toggle', e => { if (e.newState === 'closed') { closedAt = Date.now(); if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false'); } });
    sh.root.append(pop);
    return pop;
  }
  function onClick(e) {
    const p = e.composedPath ? e.composedPath() : [e.target];
    const t = p[0] && p[0].nodeType === 1 ? p[0] : e.target;
    const tb = t.closest('[data-nt-tab]');
    if (tb) { e.preventDefault(); e.stopPropagation(); select(tb.dataset.ntTab); return; }
    const b = t.closest('[data-nt]');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      const k = b.dataset.nt;
      if (k === 'close') close();
      else if (k === 'native') { close(); fast.toNative('/notifications' + (tab === 'mentions' ? '/mentions' : '')); }
      else if (k === 'retry') { lists[tab].banner = null; load(tab, lists[tab].items.length ? 'bottom' : 'replace'); }
      else if (k === 'more') load(tab, 'bottom');
      return;
    }
    const u = t.closest('[data-nt-user]');
    const it = t.closest('.nt-item');
    // an avatar is its person; the rest of the row is what the notification is about
    if (u && (u.tagName === 'A' || !it || !it.dataset.ntTw)) { e.preventDefault(); e.stopPropagation(); close(); fast.go('/' + u.dataset.ntUser); return; }
    if (!it) return;
    e.preventDefault(); e.stopPropagation();
    if (it.dataset.ntTw) { close(); if (fast.drawer) fast.drawer.open(it.dataset.ntTw); else fast.toNative('/i/status/' + it.dataset.ntTw); }
    else if (it.dataset.ntUrl) {
      close();
      let url;
      try { url = new URL(it.dataset.ntUrl, location.href); } catch { return; }
      if (url.origin === location.origin || /(^|\.)(x|twitter)\.com$/.test(url.hostname)) fast.go(url.pathname + url.search);
    }
  }
  function select(k) {
    if (!TABS[k] || k === tab) return;
    tab = k;
    bodyEl.scrollTop = 0;
    paint();
    const L = lists[k];
    if (!L.items.length || Date.now() - L.at > FRESH) load(k, 'replace');
  }
  function place(a) {
    const narrow = (innerWidth || 1000) < 700;
    pop.classList.toggle('sheet', narrow);
    if (narrow || !a) { pop.style.left = ''; pop.style.top = ''; return; }
    const r = a.getBoundingClientRect();
    const w = Math.min(400, innerWidth - 16);
    let left = r.right + 8;
    if (left + w > innerWidth - 8) left = Math.max(8, r.left - w - 8);
    if (left < 8) left = 8;
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(Math.max(8, Math.min(r.top - 8, innerHeight - 200))) + 'px';
  }
  const isOpen = () => !!(pop && pop.isConnected && pop.matches(':popover-open'));
  function open(a) {
    const sh = fast.shell && fast.shell.get();
    if (!sh) return;
    build(sh);
    if (typeof pop.showPopover !== 'function') { fast.toNative('/notifications'); return; }
    anchorEl = a || sh.root.querySelector('[data-nt-open]');
    place(anchorEl);
    try { pop.showPopover(); } catch { fast.toNative('/notifications'); return; }
    if (anchorEl) anchorEl.setAttribute('aria-expanded', 'true');
    unread.notifications = 0;
    paintBadge();
    paint();
    const L = lists[tab];
    if (!L.items.length || Date.now() - L.at > FRESH) load(tab, 'replace');
  }
  function close() { if (isOpen()) { try { pop.hidePopover(); } catch {} } }

  // follow the page: taps only while Fast UI is on; the badge on every mount
  fast.onChange(s => {
    wire(!!s.on);
    if (!s.owned) close();
    paintBadge();
    if (s.owned && !asked && !askT && XBB.ext && XBB.ext.blocking()) askT = setTimeout(askBadge, 2500);
  });
  { const s = fast.state(); wire(!!s.on); }

  fast.notifications = {
    open, close, isOpen,
    toggle(a) { if (isOpen()) close(); else if (Date.now() - closedAt > 300) open(a); },
    unread: () => Object.assign({}, unread),
    debug: () => ({ open: isOpen(), tab, unread: Object.assign({}, unread), all: lists.all.items.length, mentions: lists.mentions.items.length, via: lists[tab].via, banner: lists[tab].banner, sheet: !!(pop && pop.classList.contains('sheet')) })
  };
})();

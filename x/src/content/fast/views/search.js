/* X Fast UI: search, /search?q=<query>[&f=live|user|media]. A sticky bar (Back, the query, prefilled, live typeahead
   via /i/api/1.1/search/typeahead.json, recent searches in localStorage, quick filter chips), tabs Top / Latest /
   People / Media, each one SearchTimeline { rawQuery, count, querySource, product } in XBB.fast.feed. X's own search
   underneath is tapped for the first page; People rows are account cards. A new query is a new entry (Back returns to
   the last one), a tab switch replaces the URL.
   XBB.fast.views.search(shell, { url }) -> feed view + { setUrl(url), query() }
   XBB.fast.views.search.attachBox(input, { wrap, onQuery, onUser }) -> { close(), destroy(), syncClear() } */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, render = fast.render;
  const TAB_OF = { '': 'top', live: 'latest', user: 'people', media: 'media' };
  const F = { top: '', latest: 'live', people: 'user', media: 'media' };
  const PRODUCT = { top: 'Top', latest: 'Latest', people: 'People', media: 'Media' };
  const urlFor = (q, k) => '/search?q=' + encodeURIComponent(q) + '&src=typed_query' + (F[k] ? '&f=' + F[k] : '');

  // ---------- recent searches (localStorage, max 12) ----------
  const RECENT_KEY = 'xbb-recent-searches-v1';
  const RECENT_MAX = 12;
  const recentKey = e => !e ? '' : e.kind === 'user' ? 'u:' + String(e.screenName || '').toLowerCase() : 'q:' + String(e.q || '').trim().toLowerCase();
  function getRecent() {
    try {
      const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (!Array.isArray(a)) return [];
      return a.filter(e => e && ((e.kind === 'query' && typeof e.q === 'string' && e.q.trim()) || (e.kind === 'user' && typeof e.screenName === 'string' && e.screenName)));
    } catch { return []; }
  }
  function saveRecent(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {}
  }
  function addRecent(entry) {
    const k = recentKey(entry);
    if (!k) return;
    const norm = entry.kind === 'user'
      ? { kind: 'user', screenName: entry.screenName, name: entry.name || entry.screenName, avatar: entry.avatar || '', verified: !!entry.verified, verifiedType: entry.verifiedType || '' }
      : { kind: 'query', q: entry.q.trim() };
    saveRecent([norm, ...getRecent().filter(e => recentKey(e) !== k)]);
  }
  function removeRecent(k) { saveRecent(getRecent().filter(e => recentKey(e) !== k)); }
  function clearRecent() { try { localStorage.removeItem(RECENT_KEY); } catch {} }

  // ---------- live typeahead (/i/api/1.1/search/typeahead.json, 60s cache) ----------
  const TA_CACHE = new Map();
  const TA_TTL = 60000;
  async function fetchTypeahead(q) {
    const key = q.toLowerCase();
    const hit = TA_CACHE.get(key);
    if (hit && Date.now() - hit.t < TA_TTL) return hit.v;
    if (!XBB.gql || !XBB.gql.rest) return null;
    const r = await XBB.gql.rest('/i/api/1.1/search/typeahead.json', {
      query: {
        include_ext_is_blue_verified: '1',
        include_ext_verified_type: '1',
        include_ext_profile_image_shape: '1',
        q,
        src: 'search_box',
        result_type: 'events,users,topics,lists'
      },
      timeout: 6000
    });
    if (!r || !r.ok || !r.data) return null;
    const d = r.data;
    const topics = (Array.isArray(d.topics) ? d.topics : [])
      .map(t => typeof t === 'string' ? t : (t && typeof t.topic === 'string' ? t.topic : ''))
      .filter(Boolean).slice(0, 5);
    const users = (Array.isArray(d.users) ? d.users : [])
      .map(u => u && typeof u.screen_name === 'string' && u.screen_name ? {
        id: String(u.id_str || u.id || ''),
        screenName: u.screen_name,
        name: u.name || u.screen_name,
        avatar: u.profile_image_url_https || '',
        verified: !!(u.ext_is_blue_verified || u.verified),
        verifiedType: u.ext_verified_type || ''
      } : null).filter(Boolean).slice(0, 6);
    const v = { topics, users };
    TA_CACHE.set(key, { t: Date.now(), v });
    if (TA_CACHE.size > 40) TA_CACHE.delete(TA_CACHE.keys().next().value);
    return v;
  }

  // ---------- shared search box controller (dropdown, recent, typeahead, keys, clear) ----------
  const HANDLE_LIKE = /^@?([A-Za-z0-9_]{1,15})$/;
  function attachBox(input, opts = {}) {
    const wrap = opts.wrap || input.closest('form') || input.parentNode;
    if (!wrap) return { close() {}, destroy() {}, syncClear() {} };
    wrap.classList.add('sr-wrap');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    const clearBtn = h('button', { class: 'sr-clear', type: 'button', title: 'Clear', 'aria-label': 'Clear search', hidden: !input.value }, render.icon('close'));
    if (input.parentNode) input.after(clearBtn);
    const drop = h('div', { class: 'sr-drop', role: 'listbox', hidden: true });
    wrap.append(drop);

    let open = false, timer = 0, seq = 0, idx = -1, items = [];
    const syncClear = () => { clearBtn.hidden = !input.value; };
    const close = () => {
      clearTimeout(timer);
      open = false; idx = -1; items = [];
      drop.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    const show = () => {
      open = true;
      drop.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const setActive = n => {
      const nodes = drop.querySelectorAll('[data-sr-opt]');
      if (!nodes.length) { idx = -1; return; }
      idx = ((n % nodes.length) + nodes.length) % nodes.length;
      nodes.forEach((el, i) => {
        const on = i === idx;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', String(on));
        if (on) try { el.scrollIntoView({ block: 'nearest' }); } catch {}
      });
    };
    const goQuery = q => {
      q = String(q || '').trim();
      if (!q) return;
      addRecent({ kind: 'query', q });
      close();
      input.blur();
      if (opts.onQuery) opts.onQuery(q);
      else fast.go(urlFor(q, 'top'));
    };
    const goUser = u => {
      if (!u || !u.screenName) return;
      addRecent({ kind: 'user', screenName: u.screenName, name: u.name, avatar: u.avatar, verified: u.verified, verifiedType: u.verifiedType });
      close();
      input.blur();
      if (opts.onUser) opts.onUser(u);
      else fast.go('/' + u.screenName);
    };

    function userRow(u, i, rmKey) {
      const av = render.avatar(u, 'sm');
      return h('div', { class: 'sr-opt sr-user', role: 'option', 'aria-selected': 'false', 'data-sr-opt': String(i) },
        av,
        h('div', { class: 'sr-uinfo' },
          h('span', { class: 'sr-uname' }, h('b', null, u.name || u.screenName), render.badge(u)),
          h('span', { class: 'sr-uhandle' }, '@' + u.screenName)),
        rmKey ? h('button', { class: 'sr-rm', type: 'button', 'data-sr-rm': rmKey, title: 'Remove', 'aria-label': 'Remove' }, render.icon('close')) : null);
    }
    function queryRow(label, i, rmKey, iconName) {
      return h('div', { class: 'sr-opt sr-q', role: 'option', 'aria-selected': 'false', 'data-sr-opt': String(i) },
        h('span', { class: 'sr-qic' }, render.icon(iconName || 'explore')),
        h('span', { class: 'sr-qtxt' }, label),
        rmKey ? h('button', { class: 'sr-rm', type: 'button', 'data-sr-rm': rmKey, title: 'Remove', 'aria-label': 'Remove' }, render.icon('close')) : null);
    }

    function paintRecent() {
      const rec = getRecent();
      items = []; idx = -1;
      if (!rec.length) {
        drop.replaceChildren(h('div', { class: 'sr-empty' }, 'Try searching for people, topics, or keywords'));
        show();
        return;
      }
      const frag = [h('div', { class: 'sr-sec' },
        h('span', null, 'Recent'),
        h('button', { class: 'sr-clear-all', type: 'button', 'data-sr-clear-all': '' }, 'Clear all'))];
      for (const e of rec) {
        const i = items.length, k = recentKey(e);
        if (e.kind === 'user') { items.push({ kind: 'user', u: e }); frag.push(userRow(e, i, k)); }
        else { items.push({ kind: 'query', q: e.q }); frag.push(queryRow(e.q, i, k)); }
      }
      drop.replaceChildren(...frag);
      show();
    }

    function paintSuggestions(q, res, loading) {
      items = []; idx = -1;
      const frag = [];
      items.push({ kind: 'query', q });
      frag.push(queryRow(`Search for "${q}"`, 0));

      const topics = (res && res.topics) || [];
      const users = (res && res.users) || [];
      const seenQ = new Set([q.toLowerCase()]);
      for (const t of topics) {
        if (seenQ.has(t.toLowerCase())) continue;
        seenQ.add(t.toLowerCase());
        const i = items.length;
        items.push({ kind: 'query', q: t });
        frag.push(queryRow(t, i));
      }
      const hm = HANDLE_LIKE.exec(q);
      const handle = hm ? hm[1] : '';
      const hasHandle = handle && users.some(u => u.screenName.toLowerCase() === handle.toLowerCase());
      if (users.length || (handle && !hasHandle)) {
        frag.push(h('div', { class: 'sr-div' }));
        for (const u of users) {
          const i = items.length;
          items.push({ kind: 'user', u });
          frag.push(userRow(u, i));
        }
        if (handle && !hasHandle) {
          const i = items.length;
          items.push({ kind: 'user', u: { screenName: handle, name: '@' + handle } });
          frag.push(queryRow(`Go to @${handle}`, i, null, 'user'));
        }
      } else if (loading) {
        frag.push(h('div', { class: 'sr-hint' }, 'Searching…'));
      }
      drop.replaceChildren(...frag);
      show();
    }

    function update() {
      syncClear();
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { paintRecent(); return; }
      const hit = TA_CACHE.get(q.toLowerCase());
      if (hit && Date.now() - hit.t < TA_TTL) { paintSuggestions(q, hit.v, false); return; }
      paintSuggestions(q, null, true);
      const my = ++seq;
      timer = setTimeout(async () => {
        const res = await fetchTypeahead(q);
        if (my !== seq || !open || input.value.trim() !== q) return;
        paintSuggestions(q, res, false);
      }, 180);
    }

    const onFocus = () => update();
    const onInput = () => update();
    const onBlur = () => close();
    const onKey = e => {
      if (e.key === 'ArrowDown') {
        if (!open) update();
        e.preventDefault();
        setActive(idx + 1);
      } else if (e.key === 'ArrowUp') {
        if (!open) update();
        e.preventDefault();
        setActive(idx < 0 ? items.length - 1 : idx - 1);
      } else if (e.key === 'Enter' && open && idx >= 0 && items[idx]) {
        e.preventDefault();
        e.stopPropagation();
        const it = items[idx];
        if (it.kind === 'user') goUser(it.u);
        else goQuery(it.q);
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); close(); }
        else input.blur();
      }
    };
    const onDropDown = e => { e.preventDefault(); };
    const onDropClick = e => {
      const p = e.composedPath ? e.composedPath() : [e.target];
      const t = p[0] && p[0].nodeType === 1 ? p[0] : e.target;
      const rm = t.closest('[data-sr-rm]');
      if (rm) { e.preventDefault(); e.stopPropagation(); removeRecent(rm.dataset.srRm); paintRecent(); return; }
      if (t.closest('[data-sr-clear-all]')) { e.preventDefault(); e.stopPropagation(); clearRecent(); paintRecent(); return; }
      const opt = t.closest('[data-sr-opt]');
      if (!opt) return;
      e.preventDefault(); e.stopPropagation();
      const it = items[+opt.dataset.srOpt];
      if (!it) return;
      if (it.kind === 'user') goUser(it.u);
      else goQuery(it.q);
    };
    const onClearDown = e => { e.preventDefault(); };
    const onClearClick = e => {
      e.preventDefault(); e.stopPropagation();
      input.value = '';
      syncClear();
      input.focus();
      update();
    };

    input.addEventListener('focus', onFocus);
    input.addEventListener('input', onInput);
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKey);
    drop.addEventListener('pointerdown', onDropDown);
    drop.addEventListener('click', onDropClick);
    clearBtn.addEventListener('pointerdown', onClearDown);
    clearBtn.addEventListener('click', onClearClick);

    return {
      close,
      syncClear,
      destroy() {
        close();
        input.removeEventListener('focus', onFocus);
        input.removeEventListener('input', onInput);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('keydown', onKey);
        drop.removeEventListener('pointerdown', onDropDown);
        drop.removeEventListener('click', onDropClick);
        clearBtn.removeEventListener('pointerdown', onClearDown);
        clearBtn.removeEventListener('click', onClearClick);
        clearBtn.remove();
        drop.remove();
      }
    };
  }

  // ---------- quick filter chips ----------
  const CHIPS = [
    { id: 'media', label: 'Media', op: 'filter:media', group: 'media' },
    { id: 'images', label: 'Images', op: 'filter:images', group: 'media' },
    { id: 'videos', label: 'Videos', op: 'filter:videos', group: 'media' },
    { id: 'links', label: 'Links', op: 'filter:links' },
    { id: 'noreplies', label: 'No replies', op: '-filter:replies' },
    { id: 'f100', label: '100+ likes', op: 'min_faves:100', group: 'faves' },
    { id: 'f1k', label: '1K+ likes', op: 'min_faves:1000', group: 'faves' },
    { id: 'verified', label: 'Verified', op: 'filter:verified' }
  ];
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opRe = op => new RegExp('(?:^|\\s)' + escRe(op) + '(?=\\s|$)', 'i');
  const hasOp = (q, op) => opRe(op).test(q);
  function toggleOp(q, chip) {
    const active = hasOp(q, chip.op);
    let out = q;
    if (chip.group) {
      for (const c of CHIPS) if (c.group === chip.group) out = out.replace(new RegExp('(?:^|\\s)' + escRe(c.op) + '(?=\\s|$)', 'ig'), ' ');
    } else {
      out = out.replace(new RegExp('(?:^|\\s)' + escRe(chip.op) + '(?=\\s|$)', 'ig'), ' ');
    }
    out = out.replace(/\s+/g, ' ').trim();
    if (!active) out = out ? out + ' ' + chip.op : chip.op;
    return out;
  }

  fast.views = fast.views || {};
  fast.views.search = function search(shell, ctx) {
    const parse = url => { const u = new URL(url || location.href, location.href); return { q: (u.searchParams.get('q') || '').trim(), f: u.searchParams.get('f') || '' }; };
    const first = parse(ctx && ctx.url);
    const q = first.q;
    if (q) addRecent({ kind: 'query', q });

    const input = h('input', { type: 'search', name: 'q', value: q, placeholder: 'Search', autocomplete: 'off', 'aria-label': 'Search' });
    const searchLabel = h('label', { class: 'search' }, render.icon('explore'), input);
    const form = h('form', { class: 'sr-bar', role: 'search', 'data-sr-form': '' },
      h('button', { class: 'icon-btn', type: 'button', 'data-sr': 'back', title: 'Back', 'aria-label': 'Back' }, render.icon('back')),
      searchLabel);

    const chipsEl = q ? h('div', { class: 'sr-chips', role: 'group', 'aria-label': 'Search filters' },
      CHIPS.map(c => h('button', { class: 'sr-chip', type: 'button', 'data-sr-chip': c.id, 'aria-pressed': String(hasOp(q, c.op)) }, c.label))) : null;
    const head = h('div', { class: 'sr-head' }, form, chipsEl);

    const TABS = {};
    for (const k of ['top', 'latest', 'people', 'media']) TABS[k] = {
      label: k === 'top' ? 'Top' : k === 'latest' ? 'Latest' : k === 'people' ? 'People' : 'Media',
      learn: 'Search', ops: ['SearchByRawQuery', 'SearchTimeline'], users: k === 'people',
      vars: () => q ? { rawQuery: q, count: 20, querySource: 'typed_query', product: PRODUCT[k] } : null,
      match: v => String(v.rawQuery || '').trim() === q && String(v.product || 'Top') === PRODUCT[k],
      list: () => `search:${k}:${q}`,
      native: () => urlFor(q, k)
    };
    const feed = fast.feed(shell, {
      cls: 'search-view', label: 'search', head, tabs: TABS, tab: TAB_OF[first.f] || 'top',
      onSelect: k => fast.go(urlFor(q, k), { replace: true }),
      empty: k => q ? `No results for "${q}"${k === 'people' ? ' among accounts' : ''}.` : 'Type something to search for.',
      click(e, t) {
        if (t.closest('[data-sr="back"]')) { e.preventDefault(); fast.back(); return true; }
        const chipBtn = t.closest('[data-sr-chip]');
        if (chipBtn) {
          e.preventDefault();
          const chip = CHIPS.find(c => c.id === chipBtn.dataset.srChip);
          if (!chip) return true;
          const nq = toggleOp(q, chip);
          if (nq) { addRecent({ kind: 'query', q: nq }); fast.go(urlFor(nq, feed.tab())); }
          return true;
        }
        return false;
      }
    });

    const submitQuery = nq => {
      nq = String(nq || '').trim();
      if (!nq) return;
      addRecent({ kind: 'query', q: nq });
      if (nq !== q) { fast.go(urlFor(nq, feed.tab())); return; }
      const list = fast.store.list(TABS[feed.tab()].list());
      list.rows = []; list.keys.clear(); list.cursors.bottom = null;
      feed.kick();
    };
    const box = attachBox(input, { wrap: form, onQuery: submitQuery });
    form.addEventListener('submit', e => {
      e.preventDefault();
      box.close();
      input.blur();
      submitQuery(input.value);
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
      destroy() { box.destroy(); feed.destroy(); },
      debug: () => Object.assign(feed.debug(), { view: 'search', q })
    });
  };
  fast.views.search.urlFor = urlFor;
  fast.views.search.attachBox = attachBox;
  fast.views.search.addRecent = addRecent;
  fast.views.search.getRecent = getRecent;
  fast.views.search.clearRecent = clearRecent;
  fast.views.search.toggleOp = toggleOp;
  fast.views.search.CHIPS = CHIPS;
})();

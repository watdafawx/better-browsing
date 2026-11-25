/* Pinterest Fast UI: what the M2 views share (search, a board's pins, a profile's pins).
     PIN.fast.firstPage(op, overrides, opts, match) -> Promise<call result + { source: 'tap' | 'call' }>
       The cheapest first page: a fresh tapped answer of Pinterest's own for the same options (`match(options)`), else,
       on the page this document loaded with (userscript: Pinterest's app boots hidden and asks itself), up to 700 ms
       after DOMContentLoaded for one, else our own call. In Zero-JS mode (no app will ask) and after an in-app
       navigation (Pinterest's router never saw it) our call goes out at once.
     PIN.fast.banner(res, what, nativeUrl, nativeLabel, retry) -> the view's own note: never fast.fail (only Home's
       primary resource hands a route back to Pinterest), "Open … on Pinterest" goes through fast.toNative.
     PIN.fast.pinFeed({ op, overrides(), opts, match, what, nativeUrl, nativeLabel, filters, restoreY, loading, empty })
       -> { el, grid, start(), show(), hide(), destroy(), setFilter(k), pins(), shown(), state() }
       The same virtualized masonry as Home (grid.js), promoted pins dropped by data, `bookmarks` paging until
       '-end-', the viewer on a card; `filters`: All / Videos / Idea Pins chips, a client-side filter over the pins
       loaded so far (the layout runs again at once; more pages are asked for while a filter shows too few). */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const ext = () => (PIN.ext && typeof PIN.ext.blocking === 'function' ? PIN.ext : null);
  const firstOf = e => !Array.isArray(e.options.bookmarks) || !e.options.bookmarks.length;

  function firstPage(op, overrides, opts, match) {
    const fits = e => { try { return !!(e && e.res && e.res.ok && firstOf(e) && (!match || match(e.options || {}))); } catch { return false; } };
    const t = fast.api.getTapped(op, { first: true, maxAge: 120000 });
    if (fits(t)) return Promise.resolve(Object.assign({}, t.res, { source: 'tap' }));
    const call = () => fast.api.call(op, overrides, opts).then(r => Object.assign({}, r, { source: 'call' }));
    const e = ext();
    if ((e && e.blocking()) || !fast.landed()) return call();
    return new Promise(resolve => {
      let done = false, tm = 0;
      const off = fast.api.onTap(en => {
        if (done || en.name !== op || !fits(en)) return;
        done = true; off(); clearTimeout(tm);
        resolve(Object.assign({}, en.res, { source: 'tap' }));
      });
      const later = () => { tm = setTimeout(() => { if (done) return; done = true; off(); call().then(resolve); }, 700); };
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', later, { once: true });
      else later();
    });
  }

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function banner(r, what, nativeUrl, nativeLabel, retry) {
    const kind = (r && r.kind) || 'err';
    const unlearned = kind === 'breaker' || kind === 'failure' || kind === 'schema' || (kind === 'http' && [400, 403, 404].includes(r.status));
    const text = kind === 'http' && r.status === 401 ? `Sign in on Pinterest to see ${what}.`
      : unlearned ? `${cap(what)} didn't load here: Pinterest changed something, or Fast UI has not learned it yet. Open it on Pinterest once.`
      : `${cap(what)} didn't load.`;
    return h('div', { class: 'banner', role: 'status', 'data-fv-banner': kind },
      h('span', { class: 'btext' }, text),
      retry && !unlearned ? h('button', { type: 'button', class: 'bbtn', 'data-fv-retry': '' }, 'Retry') : null,
      nativeUrl ? h('a', { class: 'bbtn red', href: nativeUrl, 'data-fv-native': '' }, nativeLabel || 'Open on Pinterest') : null);
  }

  const FILTERS = [['all', 'All'], ['video', 'Videos'], ['story', 'Idea Pins']];
  function pinFeed(o) {
    const gridEl = h('div', { class: 'grid', 'data-pin-grid': '' });
    const status = h('div', { class: 'status', 'aria-live': 'polite' });
    const chips = o.filters ? h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Filter pins' },
      FILTERS.map(([k, label]) => h('button', { type: 'button', class: 'chip' + (k === 'all' ? ' on' : ''), 'data-filter': k, 'aria-pressed': String(k === 'all') }, label))) : null;
    const el = h('div', { class: 'pfeed' }, chips, gridEl, status);
    const m = PIN.masonry({ gap: innerWidth <= 760 ? 12 : 16, minCol: 180, minCols: 2, maxCols: 6, footer: fast.card.footer });
    const grid = fast.grid({ el: gridEl, masonry: m, max: 50, overscan: 0.5, onNearEnd: () => more() });
    grid.pause(true);
    let all = [], shown = [], seen = new Set(), bookmark = '', loading = false, ended = false, first = false;
    let visible = false, started = false, dead = false, filter = 'all', empties = 0, restoreY = o.restoreY || 0;
    const stats = { promoted: 0, dropped: 0, pages: 0, source: '' };
    const pass = p => filter === 'all' || p.kind === filter;

    function setStatus(kind, text, node) {
      status.className = 'status' + (kind === 'err' ? ' err' : '');
      status.setAttribute('data-state', kind);
      if (kind === 'idle') { status.replaceChildren(); return; }
      if (node) { status.replaceChildren(node); return; }
      status.replaceChildren(kind === 'loading' ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null, h('span', { class: kind === 'empty' ? 'empty' : null }, text));
    }
    status.addEventListener('click', e => {
      const t = e.composedPath()[0];
      if (t && t.closest && t.closest('[data-fv-retry]')) { e.preventDefault(); setStatus('idle'); first ? more() : start(); }
    });
    if (chips) chips.addEventListener('click', e => {
      const t = e.composedPath()[0], b = t && t.closest ? t.closest('[data-filter]') : null;
      if (b) setFilter(b.getAttribute('data-filter'));
    });

    function after() {
      if (ended) setStatus(shown.length ? 'idle' : 'empty', filter === 'all' ? (o.empty || 'Nothing here yet.') : 'No pins of this kind here.');
      el.setAttribute('data-count', String(all.length));
      el.setAttribute('data-shown', String(shown.length));
    }
    function take(data, bm, source) {
      const f = PIN.model.extractFeed(data);
      stats.promoted += f.promoted; stats.dropped += f.dropped; stats.pages++;
      if (source && !stats.source) stats.source = source;
      const fresh = f.pins.filter(p => !seen.has(p.id) && seen.add(p.id));
      fast.viewer.know(fresh);
      bookmark = bm || '';
      ended = !bookmark || bookmark === '-end-';
      for (const p of fresh) all.push(p);
      const add = fresh.filter(pass);
      if (!first) {
        first = true;
        shown = add;
        grid.setItems(shown);
        if (restoreY) { const y = restoreY; restoreY = 0; requestAnimationFrame(() => { if (!dead && visible) scrollTo(0, y); }); }
      } else if (add.length) {
        for (const p of add) shown.push(p);
        grid.append(add);
        grid.refresh();
      }
      after();
      // the grid asks for more only when its own count grows: a filter that took nothing asks here (bounded)
      if (!add.length && !ended && visible) { if (++empties <= 3) setTimeout(more, 0); } else empties = 0;
    }

    async function start() {
      if (started || dead) return;
      started = true;
      setStatus('loading', o.loading || 'Loading…');
      const r = await firstPage(o.op, o.overrides(), o.opts, o.match);
      if (dead) return;
      PIN.ext && PIN.ext.log('info', '[PIN feed] first', { op: o.op, ok: r.ok, kind: r.kind, status: r.status, source: r.source });
      if (r.ok) { setStatus('idle'); take(r.data, r.bookmark, r.source); return; }
      started = false;
      setStatus('err', null, banner(r, o.what || 'These pins', o.nativeUrl, o.nativeLabel, true));
    }
    async function more() {
      if (!first || loading || ended || !visible || dead) return;
      loading = true;
      setStatus('loading', 'Loading more…');
      const r = await fast.api.call(o.op, Object.assign(o.overrides(), { bookmarks: [bookmark] }), o.opts);
      loading = false;
      if (dead) return;
      if (r.ok) { setStatus('idle'); take(r.data, r.bookmark); return; }
      setStatus('err', null, banner(r, 'More pins', o.nativeUrl, o.nativeLabel, true));
    }
    function setFilter(k) {
      if (!FILTERS.some(f => f[0] === k) || k === filter) return;
      filter = k;
      if (chips) for (const b of chips.children) { const on = b.getAttribute('data-filter') === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
      if (!first) return;
      shown = all.filter(pass);
      grid.setItems(shown);
      empties = 0;
      if (!ended) setStatus('idle');
      after();
      if (!shown.length && !ended) more();
    }

    // a card: the viewer (a plain left click; a middle or modified click opens Pinterest's page in a new tab)
    gridEl.addEventListener('click', e => {
      const t = e.composedPath()[0];
      const a = t && t.closest ? t.closest('a.media') : null;
      if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const card = a.closest('.card'), id = card && card.getAttribute('data-id');
      if (!id) return;
      e.preventDefault();
      fast.viewer.open(id, { list: () => shown.map(p => p.id) });
    });

    return {
      el, grid, start, setFilter,
      show() { el.hidden = false; visible = true; grid.pause(false); if (first && !ended && !shown.length) more(); },
      hide() { visible = false; grid.pause(true); el.hidden = true; },
      destroy() { dead = true; grid.destroy(); el.remove(); },
      pins: () => all,
      shown: () => shown,
      state: () => Object.assign({ count: all.length, shown: shown.length, filter, bookmark, ended, mounted: grid.mounted(), cols: m.cols() }, stats)
    };
  }

  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(n | 0);
  // an avatar: the picture, else the first letter on a colour of the name
  const AV = ['#e76f51', '#2a9d8f', '#264653', '#8a5a44', '#6d597a', '#457b9d', '#bc4749', '#386641'];
  function avatar(name, src, cls) {
    const a = h('span', { class: 'av' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    if (src) a.append(h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }));
    else {
      a.textContent = ((name || '?')[0] || '?').toUpperCase();
      let x = 0; for (let i = 0; i < (name || '').length; i++) x = (x * 31 + name.charCodeAt(i)) | 0;
      a.style.background = AV[Math.abs(x) % AV.length];
    }
    return a;
  }

  Object.assign(fast, { firstPage, banner, pinFeed, fmt, avatar });
})();

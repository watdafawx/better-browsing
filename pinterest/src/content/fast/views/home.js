/* Pinterest Fast UI: the Home view. The masonry grid of UserHomefeedResource, promoted pins dropped.
   First page, cheapest first: a fresh tapped response of Pinterest's own (userscript: its app boots hidden and asks
   for it), the server-rendered state in the page (<script id="__PWS_INITIAL_PROPS__|__PWS_DATA__">, read from the
   DOM, no page world needed), else our own call: at once in Zero-JS mode (no app will ask), else after Pinterest had
   700 ms after DOMContentLoaded to ask itself. Pagination: `bookmarks: [bookmark]` until Pinterest says '-end-'.
     PIN.fast.home.mount(shell) -> { show(), hide(), ids(), pins(), grid, state() }
   A 401 on the first page is a signed-out session and hands Home to Pinterest (flag.js); a schema or "Invalid
   Request" answer opens the breaker, which does the same; anything else is a retry banner. */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const OP = 'UserHomefeedResource/get';

  // the homefeed in the server-rendered state: bounded walk (depth, node budget), never throws
  function findSSR() {
    for (const id of ['__PWS_INITIAL_PROPS__', '__PWS_DATA__']) {
      const el = document.getElementById(id);
      if (!el || !el.textContent) continue;
      let j;
      try { j = JSON.parse(el.textContent); } catch { continue; }
      let budget = 40000, found = null;
      const walk = (o, d) => {
        if (found || !o || typeof o !== 'object' || d > 9 || --budget < 0) return;
        if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
        const r = o.UserHomefeedResource;
        if (r && typeof r === 'object') {
          for (const k in r) {
            const v = r[k];
            if (v && typeof v === 'object' && Array.isArray(v.data)) { found = { data: v.data, bookmark: typeof v.nextBookmark === 'string' ? v.nextBookmark : typeof v.bookmark === 'string' ? v.bookmark : '' }; return; }
          }
        }
        if (o.resource && o.resource.name === 'UserHomefeedResource' && o.resource_response && Array.isArray(o.resource_response.data)) {
          found = { data: o.resource_response.data, bookmark: String(o.resource_response.bookmark || '') };
          return;
        }
        for (const k in o) walk(o[k], d + 1);
      };
      walk(j, 0);
      if (found) return found;
    }
    return null;
  }

  function mount(shell) {
    const gridEl = h('div', { class: 'grid', 'data-pin-grid': '' });
    const status = h('div', { class: 'status', 'aria-live': 'polite' });
    const box = h('section', { class: 'view home', 'data-view': 'home' }, gridEl, status);
    shell.feed.append(box);
    const ext = () => (PIN.ext && typeof PIN.ext.blocking === 'function' ? PIN.ext : null);
    const narrow = innerWidth <= 760;
    const m = PIN.masonry({ gap: narrow ? 12 : 16, minCol: 180, minCols: 2, maxCols: 6, footer: fast.card.footer });
    let pins = [], seen = new Set(), bookmark = '', loading = false, ended = false, started = false, first = false, visible = false;
    let stats = { promoted: 0, dropped: 0, pages: 0, source: '' };

    const grid = fast.grid({ el: gridEl, masonry: m, max: 50, overscan: 0.5, onNearEnd: () => more() });
    grid.pause(true);                   // until show(): nothing to measure while Pinterest's page is up

    function setStatus(kind, text, retry) {
      status.className = 'status' + (kind === 'err' ? ' err' : '');
      status.setAttribute('data-state', kind);
      if (kind === 'idle') { status.replaceChildren(); return; }
      status.replaceChildren(kind === 'loading' ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null, h('span', null, text),
        retry ? h('button', { type: 'button', 'data-home-retry': '' }, 'Retry') : null);
    }
    status.addEventListener('click', e => { const t = e.composedPath()[0]; if (t && t.closest && t.closest('[data-home-retry]')) { setStatus('idle'); first ? more() : load(); } });

    function take(data, bm, source) {
      const f = PIN.model.extractFeed(data);
      stats.promoted += f.promoted; stats.dropped += f.dropped; stats.pages++;
      if (source) stats.source = stats.source || source;
      const fresh = f.pins.filter(p => !seen.has(p.id) && seen.add(p.id));
      PIN.ext && PIN.ext.log('info', '[PIN home] take', { source, raw: Array.isArray(data) ? data.length : -1, fresh: fresh.length, promoted: f.promoted, dropped: f.dropped, bm: (bm || '').slice(0, 24), attr: root.getAttribute('data-pin-fast') });
      fast.viewer.know(fresh);
      bookmark = bm || '';
      ended = !bookmark || bookmark === '-end-';
      if (!first) {
        first = true;
        pins = fresh;
        grid.setItems(pins);
        if (!pins.length) status.replaceChildren(h('div', { class: 'empty' }, 'Nothing here yet.'));
      } else {
        for (const p of fresh) pins.push(p);
        grid.append(fresh);
      }
      if (ended && pins.length) setStatus('idle');
      root.setAttribute('data-pin-home-count', String(pins.length));
    }
    const root = document.documentElement;

    async function load() {
      if (first || loading) return;
      loading = true;
      setStatus('loading', 'Loading your feed…');
      const r = await fast.api.call(OP, {}, { source: '/', handler: 'www/index.js', guard: PIN.model.isFeed });
      loading = false;
      if (first) return;                  // a tapped page came in meanwhile
      if (r.ok) { setStatus('idle'); take(r.data, r.bookmark, 'call'); return; }
      PIN.ext && PIN.ext.log('warn', '[PIN home] load failed', { kind: r.kind, status: r.status, err: r.error || '' });
      if (r.kind === 'http' && r.status === 401) { fast.fail('home', 'signed-out', true); return; }
      if (r.kind === 'breaker' || r.kind === 'failure' || r.kind === 'schema') return;     // flag.js hands Home back
      fast.fail('home', 'first page: ' + r.kind + (r.status ? ' ' + r.status : ''), false);
      setStatus('err', "Your feed didn't load.", true);
    }
    async function more() {
      if (!first || loading || ended || !visible) return;
      loading = true;
      setStatus('loading', 'Loading more…');
      const r = await fast.api.call(OP, { bookmarks: [bookmark] }, { source: '/', handler: 'www/index.js', guard: PIN.model.isFeed });
      loading = false;
      if (r.ok) { setStatus('idle'); take(r.data, r.bookmark); grid.refresh(); return; }
      if (r.kind === 'breaker' || r.kind === 'failure' || r.kind === 'schema') return;
      setStatus('err', "More pins didn't load.", true);
    }

    // Pinterest's own answer (userscript): the first page if we have none, a later page appended if it follows ours
    const offTap = fast.api.onTap(e => {
      if (e.name !== OP || !e.res.ok) return;
      const bms = Array.isArray(e.options.bookmarks) ? e.options.bookmarks : [];
      if (!first && !bms.length) { setStatus('idle'); take(e.res.data, e.res.bookmark, 'tap'); }
    });

    function start() {
      if (started) return;
      started = true;
      const t = fast.api.getTapped(OP, { first: true, maxAge: 120000 });
      if (t && t.res.ok) { take(t.res.data, t.res.bookmark, 'tap'); return; }
      const fromDom = () => {
        if (first) return true;
        const s = findSSR();
        if (s) { take(s.data, s.bookmark, 'ssr'); return true; }
        return false;
      };
      const e = ext();
      if (e && e.blocking()) {
        // Zero-JS: nobody else will ask; the SSR state if it is already parsed, else call now (in parallel with the HTML)
        if (!fromDom()) load();
        return;
      }
      setStatus('loading', 'Loading your feed…');
      const later = () => { if (fromDom()) return; setTimeout(() => { if (!first) load(); }, 700); };
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', later, { once: true });
      else later();
    }

    // a card: the viewer (a plain left click; a middle or modified click opens Pinterest's page in a new tab)
    gridEl.addEventListener('click', e => {
      const t = e.composedPath()[0];
      const a = t && t.closest ? t.closest('a.media') : null;
      if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const card = a.closest('.card');
      const id = card && card.getAttribute('data-id');
      if (!id) return;
      e.preventDefault();
      fast.viewer.open(id, { list: () => pins.map(p => p.id) });
    });

    return {
      grid, start,
      box,
      show() { box.hidden = false; visible = true; grid.pause(false); start(); },
      hide() { visible = false; grid.pause(true); box.hidden = true; },
      ids: () => pins.map(p => p.id),
      pins: () => pins,
      state: () => Object.assign({ count: pins.length, bookmark, ended, mounted: grid.mounted(), cols: m.cols() }, stats),
      destroy() { offTap(); grid.destroy(); box.remove(); }
    };
  }
  fast.home = { mount, findSSR };
})();

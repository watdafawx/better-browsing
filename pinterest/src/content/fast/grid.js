/* Pinterest Fast UI: the virtualized masonry grid on the document's own scroll (keyboard, PgDn, find-in-page and
   scroll restoration keep working). The box is as tall as the layout; only the cards within the viewport ± half a
   screen are in the DOM (at most 50, even with 5,000+ pins loaded), placed with translate3d and contained.
     PIN.fast.grid({ el, masonry, mount(node, item, i, rect), unmount(node), onNearEnd(), max: 50, overscan: 0.5 })
       .setItems(items) / .append(items) / .refresh() / .pause(on) / .remeasure() / .mounted() / .nodes()
       .indexOf(id) / .destroy()
     PIN.fast.card   the card template: make() once per pooled node, fill(node, pin, rect), clear(node) before pooling
   The scroll path does no layout reads: the grid's document top (`listTop`) is cached and measured again only on
   resize, resume and setItems; a frame whose visible set did not change returns before touching the DOM. A resize
   keeps the card under the top of the viewport exactly where it was. */
(() => {
  const fast = PIN.fast = PIN.fast || {};
  const { h } = PIN;
  const FOOT = 44;                      // the fixed footer of a card with text (fast.css .foot uses the same number)
  const footer = pin => (pin && (pin.title || (pin.author && pin.author.name)) ? FOOT : 0);
  const fmtDur = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const AV = ['#e76f51', '#2a9d8f', '#264653', '#8a5a44', '#6d597a', '#457b9d', '#bc4749', '#386641'];
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';
  const PAGES = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="5" width="12" height="16" rx="2"/><path d="M17 3h2a2 2 0 0 1 2 2v12h-2V5h-2z"/></svg>';

  const card = {
    footer, FOOT,
    make() {
      const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      const ico = h('span', { class: 'bi' }), txt = document.createTextNode('');
      const badge = h('span', { class: 'badge' }, ico, txt);
      const media = h('a', { class: 'media', draggable: 'false' }, img, badge);
      const av = h('span', { class: 'av', 'aria-hidden': 'true' }), nm = document.createTextNode('');
      const t = h('div', { class: 't' }), byl = h('a', { class: 'byl', 'data-go': '' }, av, h('span', null, nm));
      const by = h('div', { class: 'by' }, byl);
      const foot = h('div', { class: 'foot' }, t, by);
      // save.js: the quick Save pill (last board) and the picker's chevron, over the picture (not inside the link)
      const save = h('button', { class: 'save', type: 'button', 'data-save': '' }, 'Save');
      const pick = h('button', { class: 'savepick', type: 'button', 'data-save-pick': '', 'aria-label': 'Choose a board', title: 'Choose a board' }, h('span', { class: 'chev', 'aria-hidden': 'true' }));
      const tools = h('div', { class: 'stools' }, pick, save);
      const node = h('article', { class: 'card' }, media, tools, foot);
      node._c = { img, badge, ico, txt, media, av, nm, t, foot, byl, save, pick, kind: '' };
      return node;
    },
    fill(node, pin, rect) {
      const c = node._c;
      if (node._pin === pin && node._w === rect.w && node._h === rect.h) return;
      node._pin = pin; node._w = rect.w; node._h = rect.h;
      node.dataset.id = pin.id;
      node.classList.toggle('kfocus', !!(fast.keys && fast.keys.focusId() === pin.id));
      node.style.width = rect.w + 'px';
      node.style.height = rect.h + 'px';
      const fh = footer(pin);
      c.media.style.height = (rect.h - fh) + 'px';
      c.media.style.backgroundColor = pin.color || '';
      c.media.setAttribute('href', '/pin/' + pin.id + '/');
      c.media.setAttribute('aria-label', pin.title || 'Pin');
      c.img.style.visibility = '';
      if (c.img.getAttribute('src') !== pin.thumb) c.img.setAttribute('src', pin.thumb);
      const kind = pin.kind === 'video' ? 'video' : pin.kind === 'story' && pin.storyPages && pin.storyPages.length > 1 ? 'story' : '';
      if (c.kind !== kind) { c.kind = kind; c.ico.innerHTML = kind === 'video' ? PLAY : kind === 'story' ? PAGES : ''; c.badge.classList.toggle('show', !!kind); }
      c.txt.data = kind === 'video' ? (pin.video.dur ? fmtDur(pin.video.dur) : 'Video') : kind === 'story' ? String(pin.storyPages.length) : '';
      c.save.setAttribute('data-save-id', pin.id);
      c.pick.setAttribute('data-save-id', pin.id);
      if (fast.save) fast.save.paint(c.save, pin.id);
      c.foot.hidden = !fh;
      if (pin.author.username) c.byl.setAttribute('href', '/' + pin.author.username + '/'); else c.byl.removeAttribute('href');
      if (fh) {
        if (c.t.textContent !== pin.title) c.t.textContent = pin.title;
        const name = pin.author.name || pin.author.username || '';
        c.nm.data = name;
        c.av.textContent = (name[0] || '?').toUpperCase();
        let hsh = 0;
        for (let i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) | 0;
        c.av.style.background = AV[Math.abs(hsh) % AV.length];
      }
    },
    // before pooling: cancel the image request and forget the pin
    clear(node) {
      node._pin = null;
      node._c.img.removeAttribute('src');
      node.removeAttribute('data-id');
      node.classList.remove('kfocus', 'saved');
    }
  };
  fast.card = card;

  fast.grid = function grid(opts) {
    const el = opts.el, m = opts.masonry;
    const MAX = opts.max || 50, OVER = opts.overscan == null ? 0.5 : opts.overscan;
    let items = [], dead = false, paused = false, raf = 0, asked = -1;
    const mounted = new Map();          // index -> node
    const pool = [];
    let last = [], vis = [];
    let listTop = 0, topDirty = true, dirty = true;
    const measure = () => {
      const r = el.getBoundingClientRect();
      listTop = r.top + (scrollY || 0);
      topDirty = false;
      return r.width;
    };
    const viewTop = () => { if (topDirty) measure(); return (scrollY || 0) - listTop; };

    function release(i) {
      const node = mounted.get(i);
      if (!node) return;
      mounted.delete(i);
      try { opts.unmount && opts.unmount(node); } catch (e) { console.error('[PIN fast]', e); }
      card.clear(node);
      node.remove();
      if (pool.length < 80) pool.push(node);
    }
    const sameAs = (a, b) => { if (a.length !== b.length) return false; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false; return true; };

    function layout() {
      raf = 0;
      if (dead || paused) return;
      const vt = viewTop(), H = innerHeight || 800;
      let o = OVER;
      m.visible(vt - H * o, vt + H + H * o, vis);
      while (vis.length > MAX && o > 0) { o = Math.max(0, o - 0.125); m.visible(vt - H * o, vt + H + H * o, vis); }
      if (vis.length > MAX) vis.length = MAX;
      const n = m.count();
      // near the end: the shortest column is within two screens (once per item count; the caller decides)
      if (n && opts.onNearEnd && asked !== n && vt + 2 * H > m.shortest()) { asked = n; try { opts.onNearEnd(); } catch (e) { console.error('[PIN fast]', e); } }
      // fast path: the same cards as the last frame, nothing to do
      if (!dirty && sameAs(vis, last)) return;
      dirty = false;
      const want = new Set(vis);
      for (const i of [...mounted.keys()]) if (!want.has(i)) release(i);
      let frag = null;
      for (const i of vis) {
        const r = m.rect(i);
        let node = mounted.get(i);
        if (!node) {
          node = pool.pop() || card.make();
          mounted.set(i, node);
          node._i = i; node._x = node._y = -1;
          try { opts.mount ? opts.mount(node, items[i], i, r) : card.fill(node, items[i], r); } catch (e) { console.error('[PIN fast]', e); }
          (frag || (frag = document.createDocumentFragment())).append(node);
        } else if (node._w !== r.w || node._h !== r.h) {
          try { opts.mount ? opts.mount(node, items[i], i, r) : card.fill(node, items[i], r); } catch (e) { console.error('[PIN fast]', e); }
        }
        if (node._x !== r.x || node._y !== r.y) { node._x = r.x; node._y = r.y; node.style.transform = `translate3d(${r.x}px,${r.y}px,0)`; }
      }
      if (frag) el.append(frag);
      last = vis.slice();
      const ht = Math.ceil(m.height()) + 'px';
      if (el.style.height !== ht) el.style.height = ht;
    }
    const schedule = () => { if (!raf && !dead && !paused) raf = requestAnimationFrame(layout); };

    // Resize: keep the card under the top of the viewport where it is (rAF-debounced; one layout read)
    let rz = 0;
    function onResize() {
      if (rz || dead) return;
      rz = requestAnimationFrame(() => {
        rz = 0;
        if (paused || dead) { topDirty = true; return; }
        const before = viewTop();
        const a = m.anchor(Math.max(0, before));
        const width = measure();
        const r = m.setWidth(width);
        if (!r.changed) { dirty = true; layout(); return; }
        for (const i of [...mounted.keys()]) release(i);
        el.style.height = Math.ceil(m.height()) + 'px';
        if (a.i >= 0 && before > 0) scrollTo(0, Math.max(0, listTop + m.yOf(a.i) - a.off));
        dirty = true;
        layout();
      });
    }
    const onScroll = () => schedule();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize, { passive: true });

    return {
      setItems(next) {
        for (const i of [...mounted.keys()]) release(i);
        items = next.slice();
        m.reset();
        m.setWidth(measure());
        m.append(items);
        asked = -1; dirty = true; last = [];
        layout();
      },
      append(more) {
        if (!more.length) return;
        if (!m.width()) m.setWidth(measure());
        for (const it of more) items.push(it);
        m.append(more);
        dirty = true;
        el.style.height = Math.ceil(m.height()) + 'px';
        schedule();
      },
      refresh() { dirty = true; schedule(); },
      layoutNow() { dirty = true; layout(); },
      remeasure() { topDirty = true; dirty = true; schedule(); },
      // paused while Pinterest's own page is up (nothing to measure in a hidden tree); resumed: measure again
      pause(on) {
        paused = !!on;
        if (!paused) {
          topDirty = true; dirty = true;
          const w = el.getBoundingClientRect().width;
          if (w && Math.floor(w) !== m.width()) { for (const i of [...mounted.keys()]) release(i); m.setWidth(w); }
          schedule();
        }
      },
      items: () => items,
      indexOf: id => items.findIndex(p => p.id === id),
      mounted: () => mounted.size,
      nodes: () => [...mounted.values()],
      // the document y of item i (keys.js scrolls a card into view with it)
      docY: i => { if (topDirty) measure(); const r = m.rect(i); return r ? listTop + r.y : 0; },
      el, masonry: m,
      destroy() {
        dead = true;
        cancelAnimationFrame(raf); cancelAnimationFrame(rz);
        removeEventListener('scroll', onScroll);
        removeEventListener('resize', onResize);
        for (const i of [...mounted.keys()]) release(i);
      }
    };
  };
})();

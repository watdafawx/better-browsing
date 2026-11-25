/* X Fast UI: a windowed list on the document's own scroll (keyboard, Space/PgDn, find-in-page keep working).
   The list box is as tall as all its rows; only the rows within 1.5 screens of the viewport are in the DOM,
   absolutely placed with translateY.
     - Heights live in a Fenwick (binary indexed) tree: offset of row i and the row at y are O(log n), and so is
       correcting one row's height. Rows start at an estimate and one shared ResizeObserver corrects them.
     - Scroll-anchor lock: when rows change height, the first row at the top of the viewport stays exactly where
       it was (images arriving, "Show more", rows above the viewport growing). The browser's own anchoring is off
       (overflow-anchor: none) so the two never fight.
     - Row wrappers are pooled and reused.
   XBB.fast.vlist({ el, estimate(row), mount(row, node), attached(node), unmount(node), onNearEnd(), overscan })
     .setRows(rows, heights)   rows: [{ key, ... }]; heights: a Map key -> px kept by the caller (per timeline)
     .append(rows) / .prepend(rows) / .refresh() / .pause(on) / .mounted() / .destroy() / .offsetOf(key) */
(() => {
  // Fenwick tree over row heights, capacity a power of two so `find` is a plain binary lift
  function Fenwick() {
    let cap = 0, t = new Float64Array(1), h = [];
    const pow2 = n => { let c = 64; while (c < n) c *= 2; return c; };
    const f = {
      build(hs) {
        h = hs.slice();
        cap = pow2(h.length);
        t = new Float64Array(cap + 1);
        for (let i = 1; i <= cap; i++) {
          if (i <= h.length) t[i] += h[i - 1];
          const p = i + (i & -i);
          if (p <= cap) t[p] += t[i];
        }
      },
      size: () => h.length,
      get: i => h[i],
      set(i, v) { const d = v - h[i]; if (!d) return; h[i] = v; for (let j = i + 1; j <= cap; j += j & -j) t[j] += d; },
      push(v) {
        if (h.length + 1 > cap) { f.build(h.concat([v])); return; }
        h.push(0); f.set(h.length - 1, v);
      },
      // sum of the heights of rows [0, i)
      prefix(i) { let s = 0; for (let j = Math.min(i, cap); j > 0; j -= j & -j) s += t[j]; return s; },
      total: () => f.prefix(h.length),
      // the row that contains y (clamped to the list)
      find(y) {
        if (!h.length) return -1;
        let pos = 0, rem = y;
        for (let step = cap; step; step >>= 1) {
          const nx = pos + step;
          if (nx <= cap && t[nx] <= rem) { pos = nx; rem -= t[nx]; }
        }
        return Math.max(0, Math.min(pos, h.length - 1));
      }
    };
    return f;
  }

  XBB.fast.Fenwick = Fenwick;

  XBB.fast.vlist = function vlist(opts) {
    const el = opts.el;
    const overscan = opts.overscan ?? 1.5;
    const fw = Fenwick();
    let rows = [], heights = new Map(), paused = false, dead = false;
    const mounted = new Map();          // key -> node
    const pool = [];
    let raf = 0, nearEndAsked = 0, lastFirst = -1, lastLast = -2, lastTotal = -1, dirty = true;

    const est = r => Math.max(40, heights.get(r.key) || +opts.estimate(r) || 120);
    // Cache document-relative top of `el` so scroll rAF never forces synchronous layout via getBoundingClientRect()
    let listTop = 0, topDirty = true;
    const measureTop = () => { listTop = el.getBoundingClientRect().top + (scrollY || 0); topDirty = false; };
    const viewTop = () => { if (topDirty) measureTop(); return (scrollY || 0) - listTop; };

    function release(key) {
      const node = mounted.get(key);
      if (!node) return;
      mounted.delete(key);
      ro.unobserve(node);
      try { opts.unmount && opts.unmount(node); } catch (e) { console.error('[XBB fast]', e); }
      node.remove();
      node.replaceChildren();
      node._key = node._i = node._y = undefined;
      if (pool.length < 40) pool.push(node);
    }
    function acquire(row, i, batch) {
      const node = pool.pop() || document.createElement('div');
      node.className = 'row';
      node._key = row.key; node._i = i; node._y = -1;
      try { opts.mount(row, node); } catch (e) { console.error('[XBB fast]', e); opts.onError && opts.onError(e); }
      mounted.set(row.key, node);
      if (batch) batch.push(node);
      else {
        el.append(node);
        ro.observe(node);
        try { opts.attached && opts.attached(node); } catch (e) { console.error('[XBB fast]', e); }
      }
      return node;
    }

    function layout() {
      raf = 0;
      if (dead || paused) return;
      const n = rows.length;
      const total = fw.total();
      const vt = viewTop(), H = innerHeight || 800;
      const first = n ? fw.find(Math.max(0, vt - H * overscan)) : 0;
      const last = n ? fw.find(Math.max(0, vt + H + H * overscan)) : -1;
      // Fast path: 95%+ of scroll frames stay within the same [first, last] window — zero DOM/alloc work
      if (!dirty && first === lastFirst && last === lastLast && total === lastTotal) {
        if (n && opts.onNearEnd && total - (vt + H) < 3 * H && nearEndAsked !== n) { nearEndAsked = n; try { opts.onNearEnd(); } catch (e) { console.error('[XBB fast]', e); } }
        return;
      }
      dirty = false; lastFirst = first; lastLast = last;
      if (total !== lastTotal) { lastTotal = total; el.style.height = Math.ceil(total) + 'px'; }
      for (const [key, node] of [...mounted]) {
        const i = node._i;
        if (i < first || i > last || !rows[i] || rows[i].key !== key) release(key);
      }
      const added = [];
      for (let i = first; i <= last; i++) {
        const row = rows[i];
        const node = mounted.get(row.key) || acquire(row, i, added);
        node._i = i;
        const y = fw.prefix(i);
        if (node._y !== y) { node._y = y; node.style.transform = `translate3d(0,${y}px,0)`; }
      }
      if (added.length) {
        const frag = document.createDocumentFragment();
        for (const node of added) frag.append(node);
        el.append(frag);
        for (const node of added) {
          ro.observe(node);
          try { opts.attached && opts.attached(node); } catch (e) { console.error('[XBB fast]', e); }
        }
      }
      // within three screens of the end: ask for more (once per length, the caller decides whether it can)
      if (n && opts.onNearEnd && total - (vt + H) < 3 * H && nearEndAsked !== n) { nearEndAsked = n; try { opts.onNearEnd(); } catch (e) { console.error('[XBB fast]', e); } }
    }
    const schedule = () => { if (!raf && !dead) raf = requestAnimationFrame(layout); };

    // One observer for every mounted row. Before applying new heights, note where the row at the top of the
    // viewport sits; after, scroll by exactly what it moved.
    const ro = new ResizeObserver(entries => {
      if (dead || paused) return;
      const vt = viewTop();
      const anchor = vt > 0 && rows.length ? fw.find(vt) : -1;
      const before = anchor >= 0 ? fw.prefix(anchor) : 0;
      let changed = false;
      for (const e of entries) {
        const node = e.target, i = node._i;
        if (i == null || !rows[i] || rows[i].key !== node._key) continue;
        const box = e.borderBoxSize && e.borderBoxSize[0];
        const h = box ? box.blockSize : node.offsetHeight;
        if (!h) continue;                       // hidden (Fast UI not on screen): keep what we had
        if (Math.abs(h - fw.get(i)) < 0.5) continue;
        fw.set(i, h);
        heights.set(node._key, h);
        changed = true;
      }
      if (!changed) return;
      if (anchor >= 0) {
        const delta = fw.prefix(anchor) - before;
        if (Math.abs(delta) >= 0.5) scrollBy(0, delta);
      }
      // Reposition already-mounted rows without tearing down/mounting synchronously inside ResizeObserver
      el.style.height = Math.ceil(fw.total()) + 'px';
      for (const node of mounted.values()) {
        const y = fw.prefix(node._i);
        if (node._y !== y) { node._y = y; node.style.transform = `translate3d(0,${y}px,0)`; }
      }
      schedule();
    });

    const onScroll = () => schedule();
    const onResize = () => { topDirty = true; schedule(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize, { passive: true });

    const list = {
      setRows(next, hs) {
        for (const k of [...mounted.keys()]) release(k);
        rows = next.slice();
        if (hs) heights = hs;
        fw.build(rows.map(est));
        nearEndAsked = 0;
        topDirty = true; dirty = true; lastFirst = -1; lastLast = -2;
        layout();
      },
      append(more) {
        for (const r of more) { rows.push(r); fw.push(est(r)); }
        dirty = true;
        schedule();
      },
      // New rows on top. The row at the top of the viewport stays put (the caller scrolls to the top when the user
      // asked for the new rows).
      prepend(more) {
        if (!more.length) return;
        const vt = viewTop();
        const anchor = vt > 0 && rows.length ? fw.find(vt) : -1;
        const off = anchor >= 0 ? fw.prefix(anchor) - vt : 0;
        rows = more.concat(rows);
        fw.build(rows.map(est));
        for (const node of mounted.values()) node._i += more.length;
        if (anchor >= 0) scrollBy(0, fw.prefix(anchor + more.length) - off - vt);
        dirty = true;
        layout();
      },
      refresh: schedule,
      layoutNow: layout,
      pause(on) { paused = !!on; if (!paused) schedule(); },
      rows: () => rows,
      mounted: () => mounted.size,
      nodes: () => [...mounted.values()],
      offsetOf(key) { const i = rows.findIndex(r => r.key === key); return i < 0 ? null : fw.prefix(i); },
      total: () => fw.total(),
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        removeEventListener('scroll', onScroll);
        removeEventListener('resize', onResize);
        for (const k of [...mounted.keys()]) release(k);
        ro.disconnect();
      }
    };
    return list;
  };
})();

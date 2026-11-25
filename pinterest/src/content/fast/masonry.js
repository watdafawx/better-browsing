/* Pinterest Fast UI: the masonry layout. Pure (no DOM), so test/pinterest-fast-offline.mjs checks it in Node too.
   Every card's box comes from the pin's own width/height before anything is painted: nothing on a card can change
   its size afterwards, so nothing ever shifts.
     const m = PIN.masonry({ gap: 16, minCol: 180, minCols: 2, maxCols: 6, footer: item => 44 })
     m.setWidth(W)        -> { cols, colW, changed }   cols = clamp(floor((W + gap) / (minCol + gap)), 2, 6); a change
                             re-runs the whole layout (O(n), ~1 ms for 5,000 pins)
     m.append(items)      shortest column first (ties: leftmost); paging never moves what is already placed
     m.rect(i)            -> { col, x, y, w, h }      card height = round(colW * h / w) + footer(item)
     m.visible(top, bottom) -> indices (ascending) of the cards that intersect [top, bottom]: per column a binary search
                             on its sorted bottoms, then a walk: O(cols · log n + k)
     m.height() / m.shortest()   tallest column (the grid's height) / shortest column (the paging trigger)
     m.anchor(top) -> { i, off } / m.yOf(i)   the card under the top of the viewport, to keep it there across a resize
   Storage is struct-of-arrays (typed arrays grown ×2) plus, per column, its item indices in order (a column only ever
   grows downward, so its tops and bottoms are sorted). */
(() => {
  function masonry(opts = {}) {
    const gap = opts.gap == null ? 16 : opts.gap, minCol = opts.minCol || 180;
    const minCols = opts.minCols || 2, maxCols = opts.maxCols || 6, maxRatio = opts.maxRatio || 3;
    const footer = typeof opts.footer === 'function' ? opts.footer : () => +opts.footer || 0;
    let W = 0, cols = minCols, colW = 0, n = 0, cap = 0;
    let X = new Float64Array(0), Y = new Float64Array(0), H = new Float64Array(0), C = new Int32Array(0);
    let items = [];
    let colIdx = [], colLen = [], bottom = new Float64Array(0);

    function grow(need) {
      if (need <= cap) return;
      let c = Math.max(64, cap);
      while (c < need) c *= 2;
      const nx = new Float64Array(c), ny = new Float64Array(c), nh = new Float64Array(c), nc = new Int32Array(c);
      nx.set(X.subarray(0, n)); ny.set(Y.subarray(0, n)); nh.set(H.subarray(0, n)); nc.set(C.subarray(0, n));
      X = nx; Y = ny; H = nh; C = nc; cap = c;
    }
    function resetCols() {
      colIdx = []; colLen = []; bottom = new Float64Array(cols);
      for (let c = 0; c < cols; c++) { colIdx.push(new Int32Array(64)); colLen.push(0); }
    }
    const cardH = it => {
      const w = +it.w || 1, h = +it.h || 1;
      return Math.round(colW * Math.min(maxRatio, Math.max(1 / maxRatio, h / w))) + (footer(it) | 0);
    };
    function place(i) {
      let c = 0;
      for (let k = 1; k < cols; k++) if (bottom[k] < bottom[c]) c = k;
      const hh = cardH(items[i]);
      X[i] = c * (colW + gap); Y[i] = bottom[c]; H[i] = hh; C[i] = c;
      bottom[c] += hh + gap;
      let arr = colIdx[c];
      if (colLen[c] >= arr.length) { const a = new Int32Array(arr.length * 2); a.set(arr); colIdx[c] = arr = a; }
      arr[colLen[c]++] = i;
    }
    function relayout() {
      resetCols();
      for (let i = 0; i < n; i++) place(i);
    }

    const m = {
      setWidth(width) {
        W = Math.max(0, Math.floor(+width || 0));
        const nc = Math.max(minCols, Math.min(maxCols, Math.floor((W + gap) / (minCol + gap))));
        const nw = Math.max(1, Math.floor((W - gap * (nc - 1)) / nc));
        const changed = nc !== cols || nw !== colW || !bottom.length;
        cols = nc; colW = nw;
        if (changed) relayout();
        return { cols, colW, changed };
      },
      append(list) {
        if (!list || !list.length) return;
        if (!bottom.length) resetCols();
        grow(n + list.length);
        for (const it of list) { items[n] = it; place(n); n++; }
      },
      reset() { n = 0; items = []; resetCols(); },
      relayout,
      count: () => n,
      cols: () => cols,
      colW: () => colW,
      width: () => W,
      item: i => items[i],
      rect: i => (i >= 0 && i < n ? { col: C[i], x: X[i], y: Y[i], w: colW, h: H[i] } : null),
      yOf: i => (i >= 0 && i < n ? Y[i] : 0),
      height() { if (!n) return 0; let b = 0; for (let c = 0; c < cols; c++) if (bottom[c] > b) b = bottom[c]; return Math.max(0, b - gap); },
      shortest() { if (!n) return 0; let b = Infinity; for (let c = 0; c < cols; c++) if (bottom[c] < b) b = bottom[c]; return Math.max(0, b - gap); },
      visible(top, bot, out) {
        const res = out || [];
        res.length = 0;
        for (let c = 0; c < cols; c++) {
          const arr = colIdx[c], len = colLen[c];
          if (!len) continue;
          // first card in this column whose bottom reaches `top`
          let lo = 0, hi = len;
          while (lo < hi) { const mid = (lo + hi) >> 1, i = arr[mid]; if (Y[i] + H[i] < top) lo = mid + 1; else hi = mid; }
          for (let k = lo; k < len; k++) { const i = arr[k]; if (Y[i] > bot) break; res.push(i); }
        }
        res.sort((a, b) => a - b);
        return res;
      },
      // the first card (lowest index) that is under the top line, and how far its top is from that line
      anchor(top) {
        if (!n) return { i: -1, off: 0 };
        const v = m.visible(top, top + 1);
        let best = -1;
        for (const i of v) if (best < 0 || i < best) best = i;
        if (best < 0) { const w = m.visible(top, top + 2000); best = w.length ? w[0] : n - 1; }
        return { i: best, off: Y[best] - top };
      }
    };
    resetCols();
    return m;
  }
  (typeof PIN !== 'undefined' ? PIN : globalThis).masonry = masonry;
})();

/* Pinterest Fast UI: the keys. One window capture keydown listener, only while Fast UI owns the page and
   `fastUiKeys` is not false, never while typing (the deep active element) or with the settings panel open.
     /          focus the search
     j / k      the next / previous card of the current view's grid (a ring, `.kfocus`; the card scrolls into view)
     Enter, o   open the focused card in the viewer
     s          Save the focused card (the last board, else the picker)
     Esc        closes the board picker first, then the viewer (lightbox.js), then leaves the search field
   In the viewer: s saves, z zooms, + / - / 0 zoom in / out / fit, i the side panel, j/k and ←/→ step (lightbox.js). Alt+Shift+P switches to Pinterest's page and back
   (flag.js).
     PIN.fast.keys.focusId()   the focused card's pin id (grid.js puts the ring back when a card is mounted again)
     PIN.fast.keys.move(d)     tests */
(() => {
  const fast = PIN.fast;
  let fid = '', fgrid = null;
  const deep = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const typing = a => !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
  const view = () => (fast.router && fast.router.current ? fast.router.current() : null);
  const gridOf = () => { const v = view(); return v && v.grid ? v.grid : null; };

  function mark() {
    const g = gridOf();
    if (!g) return null;
    let hit = null;
    for (const n of g.nodes()) { const on = !!fid && n.getAttribute('data-id') === fid; n.classList.toggle('kfocus', on); if (on) hit = n; }
    return hit;
  }
  function move(d) {
    const g = gridOf();
    if (!g) return false;
    const items = g.items();
    if (!items.length) return false;
    if (fgrid !== g) { fgrid = g; fid = ''; }
    let i = fid ? g.indexOf(fid) : -1;
    if (i < 0) {
      // the first card at or below the top of the viewport
      const top = scrollY + 72;
      i = 0;
      for (let k = 0; k < items.length; k++) if (g.docY(k) >= top) { i = k; break; }
    } else i = Math.max(0, Math.min(items.length - 1, i + d));
    fid = items[i].id;
    const y = g.docY(i), r = g.masonry.rect(i), bottom = y + (r ? r.h : 0);
    if (y < scrollY + 72 || bottom > scrollY + innerHeight - 16) scrollTo(0, Math.max(0, y - 88));
    if (g.layoutNow) g.layoutNow();
    const n = mark();
    if (n && n._c && n._c.media) try { n._c.media.focus({ preventScroll: true }); } catch {}
    return true;
  }
  function focused() {
    const g = gridOf();
    if (!g || !fid || g.indexOf(fid) < 0) return null;
    return g.nodes().find(n => n.getAttribute('data-id') === fid) || null;
  }

  addEventListener('keydown', e => {
    const s = fast.state();
    if (!s.owned || PIN.settings.fastUiKeys === false) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.pin-settings')) return;
    const sv = fast.save;
    if (e.key === 'Escape') {
      if (sv && sv.isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); sv.close(); return; }
      if (fast.viewer && fast.viewer.isOpen()) return;          // lightbox.js closes it
      const a = deep();
      if (typing(a)) { e.preventDefault(); a.blur(); }
      return;
    }
    const a = deep();
    if (typing(a)) return;
    if (fast.viewer && fast.viewer.isOpen()) return;            // lightbox.js has its own keys
    const k = e.key;
    if (k === '/') {
      const sh = fast.shell.get(), q = sh && sh.root.querySelector('.search input');
      if (!q) return;
      e.preventDefault(); e.stopImmediatePropagation();
      q.focus(); q.select();
    } else if (k === 'j' || k === 'k') {
      if (move(k === 'j' ? 1 : -1)) { e.preventDefault(); e.stopImmediatePropagation(); }
    } else if (k === 'Enter' || k === 'o') {
      const n = focused();
      if (!n || (k === 'Enter' && a && a !== n._c.media && a.closest && !a.closest('.card'))) return;
      e.preventDefault(); e.stopImmediatePropagation();
      n._c.media.click();
    } else if (k === 's' || k === 'S') {
      const n = focused();
      if (!n || !sv) return;
      e.preventDefault(); e.stopImmediatePropagation();
      sv.quick(fid, n._c.save);
    }
  }, true);
  // another view: its grid starts without a ring
  fast.onNav && fast.onNav(() => { fid = ''; fgrid = null; });

  fast.keys = { focusId: () => fid, move, mark };
})();

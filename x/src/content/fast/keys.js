/* X Fast UI: keyboard shortcuts while Fast UI owns the page (setting fastUiKeys, default on). Never while typing
   (input, textarea, contenteditable, also inside our shadow root and the settings panel).
     j / k        next / previous post (a focus ring; the feed scrolls it in under the header; in the drawer: its posts)
     o / Enter    open the focused post in the thread drawer
     m            open its media in the lightbox
     l / t / b    like / retweet / bookmark it
     c            copy its embed (vxtwitter) link
     Esc          the lightbox, else the drawer, else the focus ring (lightbox.js and drawer.js handle the first two)
     /            the search box
     .            show the new posts waiting behind the pill
   X's own single-key shortcuts (j, k, l, …) would act on X's hidden page underneath: while Fast UI owns the page we
   stop them (a window capture listener runs before X's). The lightbox keeps its own keys (arrows, +/-, F).
     XBB.fast.keys.mark(node)   the virtual list calls it for every row it puts on screen (re-applies the ring)
     XBB.fast.keys.focusId() / clear() / debug() */
(() => {
  const fast = XBB.fast, store = fast.store;
  const R = () => fast.render;
  let feedKey = null;          // the feed row with the ring (a tweet id)
  let drawerKey = null;        // the drawer post with the ring
  let last = '';

  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const typing = (e) => {
    const p = e.composedPath ? e.composedPath() : [e.target];
    const els = [p[0], deepActive()];
    return els.some(t => t && t.nodeType === 1 && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.closest && t.closest('[contenteditable=""], [contenteditable="true"]'))));
  };
  const on = () => { const s = fast.state && fast.state(); return !!(s && s.owned) && XBB.settings.fastUiKeys !== false; };
  const lbOpen = () => !!(fast.lightbox && fast.lightbox.isOpen());
  const drOpen = () => !!(fast.drawer && fast.drawer.isOpen());

  // ---------- the ring ----------
  function paintFeed() {
    const v = fast.view && fast.view();
    const vl = v && v.list && v.list();
    if (!vl) return;
    for (const n of vl.nodes()) mark(n);
  }
  function mark(node) {
    if (!node) return;
    const a = node.querySelector ? node.querySelector('article.tweet') : null;
    const on = !!feedKey && node._key === feedKey;
    node.classList.toggle('kfocus', on);
    if (a) a.classList.toggle('kfocus', on);
  }
  function paintDrawer() {
    if (!fast.drawer) return;
    for (const a of fast.drawer.articles()) a.classList.toggle('kfocus', !!drawerKey && a.dataset.id === drawerKey);
  }

  function feedStep(d) {
    const v = fast.view && fast.view();
    const vl = v && v.list && v.list();
    const sh = fast.shell && fast.shell.get();
    if (!vl || !sh) return;
    const rows = vl.rows();
    if (!rows.length) return;
    const listEl = sh.main.querySelector('.vlist');
    const head = sh.main.querySelector('.col-head');
    const headB = head ? head.getBoundingClientRect().bottom : 100;
    let i = feedKey ? rows.findIndex(r => r.key === feedKey) : -1;
    if (i < 0) {
      // from wherever the view is now: the first row whose top is below the header
      const top = listEl ? listEl.getBoundingClientRect().top : 0;
      i = rows.findIndex(r => { const y = vl.offsetOf(r.key); return y != null && top + y >= headB - 4; });
      if (i < 0) i = 0;
      if (d < 0 && i > 0) i--;
    } else i = Math.max(0, Math.min(rows.length - 1, i + d));
    feedKey = rows[i].key;
    const y = vl.offsetOf(feedKey);
    if (listEl && y != null) {
      const absTop = listEl.getBoundingClientRect().top + scrollY + y;
      const target = Math.max(0, absTop - (headB > 0 ? headB : 100) - 4);
      const reduce = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' }); } catch { scrollTo(0, target); }
    }
    paintFeed();
    // the row may mount only after the scroll; mark() re-applies the ring then
    const n = vl.nodes().find(x => x._key === feedKey);
    const a = n && n.querySelector('article.tweet');
    if (a) try { a.focus({ preventScroll: true }); } catch {}
  }
  function drawerStep(d) {
    const arts = fast.drawer.articles();
    if (!arts.length) return;
    let i = drawerKey ? arts.findIndex(a => a.dataset.id === drawerKey) : -1;
    if (i < 0) { i = arts.findIndex(a => a.classList.contains('focal')); if (i < 0) i = 0; else i = Math.max(0, Math.min(arts.length - 1, i + d)); }
    else i = Math.max(0, Math.min(arts.length - 1, i + d));
    drawerKey = arts[i].dataset.id;
    paintDrawer();
    const reduce = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { arts[i].scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); } catch {}
    try { arts[i].focus({ preventScroll: true }); } catch {}
  }

  // the post the action keys work on
  function targetId() {
    if (lbOpen()) { const c = fast.lightbox.current(); return c && c.id; }
    if (drOpen()) {
      const arts = fast.drawer.articles();
      if (drawerKey && arts.some(a => a.dataset.id === drawerKey)) return drawerKey;
      return fast.drawer.focal();
    }
    return feedKey;
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (!on()) return;
    const k = e.key;
    // the settings panel (light DOM host) and every field: theirs
    if (typing(e)) return;
    const p = e.composedPath ? e.composedPath() : [];
    if (document.querySelector('.xbb-settings')) return;     // the settings panel is open: nothing here acts
    if (e.defaultPrevented) return;
    let done = true;
    const lb = lbOpen(), dr = drOpen();
    if (k === 'j' || k === 'k') {
      if (lb) done = false;
      else if (dr) drawerStep(k === 'j' ? 1 : -1);
      else feedStep(k === 'j' ? 1 : -1);
    } else if (k === 'o' || k === 'Enter') {
      if (k === 'Enter') {
        // Enter on a button or link is that control's own
        const t = p[0];
        if (t && t.nodeType === 1 && t.closest && t.closest('button, a[href], [role="link"], video, summary')) { done = false; }
      }
      if (done) {
        const id = lb ? null : (dr ? (drawerKey || null) : feedKey);
        if (id && fast.drawer && !(dr && id === fast.drawer.focal())) fast.drawer.open(id);
        else done = false;
      }
    } else if (k === 'm') {
      const id = lb ? null : targetId();
      const t = id && store.tweet(id);
      if (t && t.media && t.media.length && fast.lightbox) fast.lightbox.open(id, 0); else done = false;
    } else if (k === 'l' || k === 't' || k === 'b') {
      const id = targetId();
      if (id && store.tweet(id)) R().toggle(k === 'l' ? 'like' : k === 't' ? 'rt' : 'bm', id); else done = false;
    } else if (k === 'c') {
      const id = targetId();
      if (id && store.tweet(id)) R().copyLink(null, id); else done = false;
    } else if (k === 'Escape') {
      if (lb || dr) done = false;                         // their own listeners
      else if (feedKey) clear(); else done = false;
    } else if (k === '/') {
      const sh = fast.shell && fast.shell.get();
      const inp = sh && sh.root.querySelector('.side .search input, form[data-xbb-search] input');
      if (inp && !lb && !dr && inp.offsetParent !== null) { inp.focus(); try { inp.select(); } catch {} }
      else if (inp && !lb && !dr) { inp.focus(); }
      else done = false;
    } else if (k === '.') {
      const v = fast.view && fast.view();
      if (!lb && !dr && v && v.pending && v.pending() > 0) { v.showPending(); feedKey = null; paintFeed(); } else done = false;
    } else done = false;
    if (done) { last = k; e.preventDefault(); e.stopImmediatePropagation(); return; }
    // anything else that is one plain key: X's hidden page must not act on it (its own j/k/l/n/… shortcuts)
    if (k && k.length === 1 && !lb) e.stopImmediatePropagation();
  }
  addEventListener('keydown', onKey, true);

  function clear() { feedKey = null; drawerKey = null; paintFeed(); paintDrawer(); }
  // a drawer level that changes takes its ring with it; leaving the route takes the feed ring
  fast.ov.onChange(c => { if (!c.drawer.length) drawerKey = null; });
  if (fast.onChange) fast.onChange(s => { if (!s.owned) { feedKey = null; drawerKey = null; } });

  fast.keys = { mark, clear, focusId: () => targetId(), debug: () => ({ feed: feedKey, drawer: drawerKey, last, on: on() }) };
})();

/* X Fast UI: the media lightbox. One native <dialog> in the <xbb-fast> shadow root, opened with showModal(): top layer
   (no z-index fights), ::backdrop, focus kept inside, the page behind inert. Reused for every open.
     XBB.fast.lightbox.open(tweetId, index)   push a history entry and show that tweet's media from `index`
     XBB.fast.lightbox.close()                Back (the entry goes, the feed is exactly where it was)
     XBB.fast.lightbox.step(+1 | -1) / zoom(level) / isOpen() / current() -> { id, i } / debug()
   What it shows: a photo at ?name=large (?name=orig once zoomed), a video in a native <video controls> that joins
   XBB.videoPolicy (the feed's videos behind it pause and stay paused: videoPolicy.scope), a GIF as a muted loop.
   Prev/Next buttons, Left/Right, the mouse wheel, a counter, the alt text bar, a click or +/- to zoom, F for
   fullscreen, Esc / Back / a click outside the picture to close. The bottom bar has the author, the start of the
   text and the Better Browsing actions (Like, Retweet, Like + Retweet, Bookmark, copy embed link, Open thread).
   Which media is open lives in the history entry (XBB.fast.ov); this file only follows it. */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store;
  const R = () => fast.render;
  const ZOOMS = [1, 2, 3];

  let dlg = null, stage, counter, altBar, altBtn, zoomBtn, prevBtn, nextBtn, who, snippet, bar, unsub = null;
  let cur = null;          // { id, i } on screen
  let zoom = 1, closingByUs = false, lastWheel = 0;

  const big = (u, size) => {
    const s = R().safe(u);
    if (!s) return '';
    if (!/pbs\.twimg\.com\/media\//.test(s)) return s;
    try { const x = new URL(s); x.searchParams.set('name', size); return x.href; } catch { return s; }
  };
  // the best MP4 for a screen-sized player (X's MP4s carry the sound)
  function bestMp4(m) {
    const vs = m.variants && m.variants.length ? m.variants : (m.url ? [{ url: m.url, bitrate: m.bitrate }] : []);
    return R().safe((vs.find(v => !v.bitrate || v.bitrate <= 6e6) || vs[0] || {}).url);
  }
  const mediaOf = id => { const t = store.tweet(id); return t && t.type === 'tweet' ? (t.media || []).slice(0, 4) : []; };

  function build(root) {
    const I = (n, c) => R().icon(n, c);
    const btn = (k, label, ic, extra = {}) => h('button', Object.assign({ type: 'button', 'data-lb-act': k, title: label, 'aria-label': label }, extra), ic ? I(ic) : null, extra.text ? h('span', null, extra.text) : null);
    counter = h('span', { class: 'lb-count', 'aria-live': 'polite' });
    altBtn = btn('alt', 'Show the description of this picture', null, { text: 'ALT', 'aria-pressed': 'false', class: 'lb-alt-btn' });
    zoomBtn = btn('zoom', 'Zoom (click the picture, + / -)', 'zoom', { 'aria-pressed': 'false' });
    prevBtn = btn('prev', 'Previous (Left arrow)', 'left', { class: 'lb-nav prev' });
    nextBtn = btn('next', 'Next (Right arrow)', 'right', { class: 'lb-nav next' });
    stage = h('div', { class: 'lb-stage' });
    altBar = h('div', { class: 'lb-alt', hidden: true });
    who = h('div', { class: 'lb-who' });
    snippet = h('div', { class: 'lb-text', dir: 'auto' });
    bar = h('div', { class: 'lb-acts', role: 'group' });
    dlg = h('dialog', { class: 'lb', 'aria-label': 'Media viewer' },
      h('div', { class: 'lb-top' }, counter, h('span', { class: 'spacer' }), altBtn, zoomBtn,
        btn('full', 'Fullscreen (F)', 'full'), btn('close', 'Close (Esc)', 'close', { class: 'lb-close' })),
      stage, prevBtn, nextBtn, altBar,
      h('div', { class: 'lb-bar' }, h('div', { class: 'lb-meta' }, who, snippet), bar));

    dlg.addEventListener('click', onClick);
    dlg.addEventListener('wheel', onWheel, { passive: false });
    dlg.addEventListener('keydown', onKey);
    // Esc: ours (keydown above), the dialog's own cancel only as a fallback; a close we did not ask for (the
    // browser closing it by itself) is put right in the history
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.addEventListener('close', () => { if (!closingByUs && cur && !dlg.open) { cur = null; teardownMedia(); fast.rescope(); if (fast.ov.get().lb) fast.ov.back(1); } });
    root.append(dlg);
  }

  function teardownMedia() {
    if (!stage) return;
    if (XBB.videoPolicy) XBB.videoPolicy.destroy(stage);
    stage.replaceChildren();
  }

  function paintBar(t) {
    const r = R(), s = XBB.settings, v = t.viewer || {};
    who.replaceChildren(r.avatar(t.author, 'sm'), h('b', null, t.author.name || t.author.screenName), r.badge(t.author),
      h('span', { class: 'handle' }, '@' + t.author.screenName), t.createdAtMs ? h('span', { class: 'handle' }, '· ' + r.rel(t.createdAtMs)) : null);
    const txt = String(t.text || '').replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim();
    snippet.textContent = txt.length > 160 ? txt.slice(0, 157) + '…' : txt;
    snippet.hidden = !txt;
    bar.dataset.id = t.id;
    bar.replaceChildren(
      r.act('rt', s.quickRetweet === false ? 'Retweet' : 'Retweet (one click; Shift+click for Quote)', (t.stats || {}).retweets, v.retweeted),
      r.act('like', 'Like', (t.stats || {}).likes, v.liked),
      s.likeRetweet === false ? null : r.act('lrt', v.liked && v.retweeted ? 'Undo like and retweet' : 'Like and retweet', undefined, v.liked && v.retweeted),
      r.act('bm', 'Bookmark', undefined, v.bookmarked),
      s.embedLink === false ? null : r.act('copy', 'Copy link for Discord (shows the tweet and its video in the chat)'),
      h('button', { class: 'lb-thread', type: 'button', 'data-lb-act': 'thread', title: 'Open the thread' }, r.icon('thread'), h('span', null, 'Open thread')));
    if (unsub) unsub();
    unsub = store.sub(t.id, nt => r.syncActions(bar, nt));
  }

  function setZoom(z) {
    const img = stage.querySelector('img');
    z = ZOOMS.includes(z) ? z : 1;
    if (!img) { zoom = 1; dlg.removeAttribute('data-zoom'); zoomBtn.setAttribute('aria-pressed', 'false'); return; }
    if (z > 1 && zoom === 1) {
      // the full-size picture once zoomed; the size it had on screen is the base of the zoom
      const r = img.getBoundingClientRect();
      img.dataset.fitW = String(r.width || img.naturalWidth || 600);
      const orig = img.dataset.orig;
      if (orig && img.getAttribute('src') !== orig) img.src = orig;
    }
    zoom = z;
    if (z === 1) { img.style.width = ''; dlg.removeAttribute('data-zoom'); }
    else { img.style.width = Math.round((+img.dataset.fitW || 600) * z) + 'px'; dlg.setAttribute('data-zoom', String(z)); }
    zoomBtn.setAttribute('aria-pressed', String(z > 1));
  }

  function show(id, i) {
    const t = store.tweet(id), list = mediaOf(id);
    if (!t || !list.length) return false;
    i = Math.max(0, Math.min(list.length - 1, i | 0));
    const same = cur && cur.id === id && cur.i === i && stage.firstChild;
    const newTweet = !cur || cur.id !== id;
    cur = { id, i };
    if (!same) {
      teardownMedia();
      zoom = 1; dlg.removeAttribute('data-zoom'); zoomBtn.setAttribute('aria-pressed', 'false');
      const m = list[i];
      let el;
      if (m.type === 'video' || m.type === 'gif') {
        const src = bestMp4(m), gif = m.type === 'gif';
        if (!src) el = h('a', { class: 'novid', href: R().path(t) }, R().icon('play', 'i fill'), 'Play on X');
        else {
          el = h('video', gif
            ? { 'data-xbb-gif': '', loop: true, autoplay: true, muted: true, playsinline: true, preload: 'auto', poster: R().safe(m.poster), 'aria-label': m.alt || 'GIF' }
            : { controls: true, playsinline: true, preload: 'auto', poster: R().safe(m.poster), 'aria-label': m.alt || 'Video', 'data-xbb-fast-video': '', 'data-xbb-lb-video': '' });
          if (gif) el.muted = true;
          el.src = src;
        }
      } else {
        el = h('img', { src: big(m.url, 'large'), alt: m.alt || '', decoding: 'async', draggable: 'false', 'data-orig': big(m.url, 'orig') });
      }
      stage.replaceChildren(el);
      if (el.tagName === 'VIDEO') {
        if (el.hasAttribute('data-xbb-gif')) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
        else if (XBB.videoPolicy) XBB.videoPolicy.add(el);
      }
      stage.scrollTop = 0; stage.scrollLeft = 0;
    }
    const n = list.length, m = list[i];
    counter.textContent = n > 1 ? `${i + 1} / ${n}` : '';
    counter.hidden = n < 2;
    prevBtn.hidden = nextBtn.hidden = n < 2;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === n - 1;
    altBtn.hidden = !m.alt;
    altBar.textContent = m.alt || '';
    altBar.hidden = !m.alt || altBtn.getAttribute('aria-pressed') !== 'true';
    zoomBtn.hidden = m.type !== 'photo';
    if (newTweet) paintBar(t);
    return true;
  }

  // ---------- following the history entry ----------
  function sync(c) {
    const want = c.lb;
    if (!want) { if (dlg && dlg.open) hideUI(); else cur = null; return; }
    const sh = fast.shell && fast.shell.get();
    if (!sh) return;                       // the shell mounts later; router.js refreshes the overlays then
    if (!dlg || !dlg.isConnected) build(sh.root);
    if (!show(want.id, want.i)) { if (fast.ov.get().lb) fast.ov.back(1); return; }
    if (!dlg.open) {
      try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
      try { dlg.focus({ preventScroll: true }); } catch {}
    }
    fast.rescope();
  }
  function hideUI() {
    closingByUs = true;
    try { if (dlg.open) dlg.close(); } catch {}
    closingByUs = false;
    if (document.fullscreenElement === dlg) { try { document.exitFullscreen(); } catch {} }
    cur = null;
    teardownMedia();
    if (unsub) { unsub(); unsub = null; }
    fast.rescope();
  }
  fast.ov.onChange(sync);

  // ---------- actions ----------
  function open(id, i = 0) {
    if (!mediaOf(id).length) return false;
    const c = fast.ov.get();
    if (c.lb) return fast.ov.replace({ drawer: c.drawer, lb: { id, i } });
    return fast.ov.push({ drawer: c.drawer, lb: { id, i } });
  }
  function close() { if (fast.ov.get().lb) fast.ov.back(1); else if (dlg && dlg.open) hideUI(); }
  function step(d) {
    if (!cur) return;
    const n = mediaOf(cur.id).length, i = Math.max(0, Math.min(n - 1, cur.i + d));
    if (i === cur.i) return;
    const c = fast.ov.get();
    fast.ov.replace({ drawer: c.drawer, lb: { id: cur.id, i } });
  }
  function fullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (dlg.requestFullscreen) { const p = dlg.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    } catch {}
  }
  function thread() {
    if (!cur) return;
    const id = cur.id, c = fast.ov.get();
    if (c.drawer[c.drawer.length - 1] === id) { fast.ov.back(1); return; }
    const t = store.tweet(id);
    fast.ov.replace({ drawer: c.drawer.concat(id), lb: null }, t ? R().path(t) : undefined);
  }

  const firstEl = e => { const p = e.composedPath ? e.composedPath() : [e.target]; return p[0] && p[0].nodeType === 1 ? p[0] : e.target; };
  function onClick(e) {
    const t = firstEl(e);
    e.stopPropagation();                 // the shell's own handlers (links, cards) are not for the viewer
    const a = t.closest('[data-lb-act]');
    if (a) {
      e.preventDefault();
      const k = a.dataset.lbAct;
      if (k === 'close') close();
      else if (k === 'prev') step(-1);
      else if (k === 'next') step(1);
      else if (k === 'zoom') setZoom(zoom > 1 ? 1 : 2);
      else if (k === 'full') fullscreen();
      else if (k === 'thread') thread();
      else if (k === 'alt') {
        const on = altBtn.getAttribute('aria-pressed') !== 'true';
        altBtn.setAttribute('aria-pressed', String(on));
        altBar.hidden = !on || !altBar.textContent;
      }
      return;
    }
    if (t.closest('[data-act]')) { R().click(e, { root: fast.shell.get().root }); return; }
    if (t.tagName === 'IMG' && t.parentElement === stage) { e.preventDefault(); setZoom(zoom > 1 ? 1 : 2); return; }
    if (t.closest('video, a[href], .lb-bar, .lb-top, .lb-alt')) return;
    // the dialog itself (its backdrop) or the empty stage around the picture
    if (t === dlg || t === stage) { e.preventDefault(); close(); }
  }
  function onWheel(e) {
    if (zoom > 1 || e.ctrlKey) return;                       // zoomed: the wheel pans the picture
    if (firstEl(e).closest('.lb-bar')) return;
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = performance.now();
    if (Math.abs(d) < 4 || now - lastWheel < 280) return;
    lastWheel = now;
    step(d > 0 ? 1 : -1);
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = firstEl(e);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key;
    let done = true;
    if (k === 'Escape') close();
    else if (k === 'ArrowLeft') step(-1);
    else if (k === 'ArrowRight') step(1);
    else if (k === '+' || k === '=') setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]);
    else if (k === '-' || k === '_') setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]);
    else if (k === 'f' || k === 'F') fullscreen();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  }
  // Focus can sit outside the dialog (a click on the backdrop): Esc and the arrows still belong to the viewer
  addEventListener('keydown', e => {
    if (!dlg || !dlg.open || e.defaultPrevented) return;
    const p = e.composedPath ? e.composedPath() : [];
    if (p.includes(dlg)) return;           // the dialog's own listener has it
    onKey(e);
  }, true);

  // Which overlay's videos may play: the lightbox's, else the drawer's, else the messages drawer's (none: the feed
  // behind it stays paused), else the feed's
  fast.rescope = () => {
    if (!XBB.videoPolicy || !XBB.videoPolicy.scope) return;
    const d = fast.drawer && fast.drawer.el && fast.drawer.el();
    const m = fast.messages && fast.messages.el && fast.messages.el();
    XBB.videoPolicy.scope((dlg && dlg.open && dlg) || (d && d.open && d) || (m && m.open && m) || null);
  };

  fast.lightbox = {
    open, close, step,
    zoom: setZoom,
    isOpen: () => !!(dlg && dlg.open),
    current: () => cur ? Object.assign({}, cur) : null,
    el: () => dlg,
    debug: () => ({ open: !!(dlg && dlg.open), cur: cur && Object.assign({}, cur), zoom, count: counter ? counter.textContent : '', src: stage && stage.firstChild ? stage.firstChild.getAttribute('src') : null })
  };
})();

/* X Fast UI: the thread drawer. Clicking a post (its card, its time, Reply) opens it in a slide-over panel on top of
   the feed: Home never unmounts and the feed never moves. One native <dialog> (showModal) in the <xbb-fast> shadow
   root: a ~680 px panel on the right (the whole width on a narrow screen), or a centred one (the header toggle).
     XBB.fast.drawer.open(tweetId)   push the post onto the drawer's stack (a history entry, /<user>/status/<id>)
     XBB.fast.drawer.back()          one post back (the header's Back, the browser's Back)
     XBB.fast.drawer.close()         the whole stack (Esc, a click beside the panel, the close button)
     .isOpen() / .focal() / .articles() / .el() / .debug()
   The clicked post paints at once from XBB.fast.store; ancestors (above, with the thread line) and replies (below)
   come from TweetDetail: a response X itself fetched for that post (the tap), else our own call. When TweetDetail
   is not known yet (missing-op, drift, an open breaker for it) the post, its quote, its media and every action still
   work, with a note and an "Open on X" button: X's own page then teaches us the operation. None of this ever counts
   against Home (flag.js only watches HomeTimeline for that). Which posts are open lives in the history entry
   (XBB.fast.ov); this file only follows it. */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store;
  const R = () => fast.render;
  const OP = 'TweetDetail';
  const FRESH_MS = 90 * 1000;
  const MODE_KEY = 'xbb-fast-drawer-mode';
  const BASE_VARS = { with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: true, withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true };

  const cache = new Map();          // focal id -> { at, data } (a TweetDetail first page; failures never cached)
  const inFlight = new Map();       // focal id -> Promise<result> (shared between hover/press prefetch and open)
  let hoverBusy = false;
  let dlg = null, panel, body, backBtn, modeBtn, titleEl;
  let cur = null;                   // the focal id on screen
  let sec = null;                   // { anc, focalBox, banner, replies, more } of the post on screen
  let seq = 0, closingByUs = false, offTap = null, kfocus = null;

  let mode = 'side';
  try { if (localStorage.getItem(MODE_KEY) === 'center') mode = 'center'; } catch {}

  const pathOf = id => { const t = store.tweet(id); return t && t.type === 'tweet' ? R().path(t) : `/i/status/${id}`; };

  function build(root) {
    const I = n => R().icon(n);
    const hb = (k, label, ic, extra = {}) => h('button', Object.assign({ type: 'button', class: 'dr-btn', 'data-dr': k, title: label, 'aria-label': label }, extra), I(ic), extra.text ? h('span', null, extra.text) : null);
    backBtn = hb('back', 'Back', 'back', { hidden: true });
    modeBtn = hb('mode', '', 'center');
    titleEl = h('h2', null, 'Post');
    body = h('div', { class: 'dr-body', tabindex: '-1' });
    panel = h('div', { class: 'dr-panel', role: 'document' },
      h('header', { class: 'dr-head' }, backBtn, titleEl, h('span', { class: 'spacer' }), modeBtn,
        h('button', { type: 'button', class: 'dr-btn dr-native', 'data-dr': 'native', title: "Show this post on X's own page" }, I('ext'), h('span', null, 'Open on X')),
        hb('close', 'Close (Esc)', 'close')),
      body);
    dlg = h('dialog', { class: 'drawer', 'aria-label': 'Post' }, panel);
    applyMode();
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('keydown', onKey);
    // the feed behind never scrolls while the drawer is up (only the panel does)
    dlg.addEventListener('wheel', e => { if (firstEl(e) === dlg) e.preventDefault(); }, { passive: false });
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.addEventListener('close', () => { if (!closingByUs && cur && !dlg.open) { teardown(); fast.rescope(); if (fast.ov.get().drawer.length) fast.ov.closeAll(); } });
    // our videos in the panel follow the same rules as the feed's: the policy needs to hear the panel scroll
    let raf = 0;
    body.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; XBB.videoPolicy && XBB.videoPolicy.evaluate(); }); }, { passive: true });
    root.append(dlg);
  }
  function applyMode() {
    if (!dlg) return;
    dlg.classList.toggle('center', mode === 'center');
    const l = mode === 'center' ? 'Show as a side panel' : 'Show centred';
    modeBtn.title = l; modeBtn.setAttribute('aria-label', l);
    modeBtn.replaceChildren(R().icon(mode === 'center' ? 'panel' : 'center'));
  }

  // ---------- painting ----------
  function teardown() {
    seq++;
    if (body) { R().release(body); body.replaceChildren(); }
    sec = null; cur = null; kfocus = null;
  }
  function card(t, row) {
    const box = h('div', { class: 'dr-row' }, R().tweet(t, row || {}));
    return box;
  }
  function attachAll(node) { R().attach(node); }

  function show(id) {
    if (body) { R().release(body); body.replaceChildren(); }
    seq++;
    cur = id; kfocus = null;
    const t = store.tweet(id);
    if (t) R().expanded.add(id);
    const anc = h('div', { class: 'dr-anc' });
    const focalBox = h('div', { class: 'dr-focal' });
    const banner = h('div', { class: 'dr-banner', hidden: true, role: 'status' });
    const replies = h('div', { class: 'dr-replies' });
    const more = h('div', { class: 'dr-more' });
    sec = { id, anc, focalBox, banner, replies, more, seen: new Set([id]), cursor: null, loading: false };
    if (t) focalBox.append(R().tweet(t, { focal: true }));
    else focalBox.append(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' }));
    body.append(anc, focalBox, banner, replies, more);
    attachAll(focalBox);
    body.scrollTop = 0;
    titleEl.textContent = 'Post';
    load(id, null);
  }

  function setBanner(kind, r) {
    if (!sec) return;
    const b = sec.banner;
    b.className = 'dr-banner ' + kind;
    const nativeBtn = h('button', { type: 'button', class: 'btn', 'data-dr': 'native' }, 'Open on X');
    if (kind === 'learn') b.replaceChildren(h('p', null, 'Replies not loaded yet — Open on X once to learn TweetDetail.'), h('div', { class: 'dr-bbtns' }, nativeBtn));
    else if (kind === 'error') b.replaceChildren(h('p', null, r && r.kind === 'rate-limit' ? 'X is rate limiting requests. Try again in a minute.' : 'Could not load the replies from X.'),
      h('div', { class: 'dr-bbtns' }, h('button', { type: 'button', class: 'btn ghost', 'data-dr': 'retry' }, 'Retry'), nativeBtn));
    else if (kind === 'empty') b.replaceChildren(h('p', null, 'No replies yet.'));
    b.hidden = false;
  }

  function moreBtn() {
    if (!sec) return;
    sec.more.replaceChildren(...(sec.loading ? [h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })]
      : sec.cursor ? [h('button', { type: 'button', class: 'dr-morebtn', 'data-dr': 'more' }, 'Show more replies')] : []));
  }

  // Rows from a TweetDetail response: what came before the focal post are its ancestors, what came after the replies,
  // grouped by conversation module (the thread line joins a reply to the replies under it)
  function paint(id, data, append) {
    if (!sec || sec.id !== id) return 0;
    const tl = XBB.model.extractTimeline(data);
    const items = tl.items.filter(it => it.kind === 'tweet' && it.tweet && it.tweet.id);
    if (!items.length && !tl.cursors.bottom && !append) {
      if (!tl.hasInstructions) { setBanner('error', { kind: 'schema' }); return -1; }
      setBanner('empty');
      return 0;
    }
    let fi = append ? -1 : items.findIndex(it => it.tweet.id === id);
    if (!append && fi >= 0) {
      const ft = store.put(items[fi].tweet);
      R().expanded.add(id);
      // a post we did not have yet (opened from a quote): now it can be drawn
      if (!sec.focalBox.querySelector('article.tweet.focal')) {
        R().release(sec.focalBox);
        sec.focalBox.replaceChildren(R().tweet(ft, { focal: true, threadPrev: fi > 0 || undefined }));
        attachAll(sec.focalBox);
      }
      const ancs = items.slice(0, fi).filter(it => !sec.seen.has(it.tweet.id));
      R().release(sec.anc);
      sec.anc.replaceChildren();
      ancs.forEach(it => { sec.seen.add(it.tweet.id); sec.anc.append(card(store.put(it.tweet), { threadNext: true })); });
      attachAll(sec.anc);
      const fa = sec.focalBox.querySelector('article.tweet.focal');
      if (fa) fa.classList.toggle('thread-prev', ancs.length > 0);
    }
    const rest = append ? items : items.slice(fi + 1);
    const frag = [];
    for (let i = 0; i < rest.length; i++) {
      const it = rest[i];
      if (sec.seen.has(it.tweet.id)) continue;
      sec.seen.add(it.tweet.id);
      const t = store.put(it.tweet);
      const inMod = x => x && x.moduleId && x.moduleId === it.moduleId;
      frag.push(card(t, { threadPrev: inMod(rest[i - 1]) || undefined, threadNext: inMod(rest[i + 1]) || undefined }));
    }
    if (frag.length) {
      const df = document.createDocumentFragment();
      for (const n of frag) df.append(n);
      sec.replies.append(df);
      attachAll(sec.replies);
    }
    const more = tl.cursors.bottom || (tl.cursors.showMore[0] && tl.cursors.showMore[0].value) || null;
    sec.cursor = more && more !== sec.cursor ? more : null;
    if (!append && !rest.length && !sec.cursor) setBanner('empty');
    else sec.banner.hidden = true;
    moreBtn();
    return frag.length;
  }

  function tappedFor(id) {
    const list = XBB.gql.getTapped(OP, { all: true }) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (t && t.status >= 200 && t.status < 300 && t.data && t.variables && String(t.variables.focalTweetId) === id && !t.variables.cursor) return t;
    }
    return null;
  }

  function fetchFirst(id, isHover) {
    if (inFlight.has(id)) return inFlight.get(id);
    if (isHover && hoverBusy) return null;
    if (XBB.gql.breaker && !XBB.gql.breaker.ok(OP)) return null;
    const vars = Object.assign({ focalTweetId: id }, BASE_VARS);
    if (isHover) hoverBusy = true;
    const p = XBB.gql.call(OP, vars).then(r => {
      if (r && r.ok) cache.set(id, { at: Date.now(), data: r.data });
      return r;
    }, () => ({ ok: false, kind: 'network' })).finally(() => {
      inFlight.delete(id);
      if (isHover) hoverBusy = false;
    });
    inFlight.set(id, p);
    return p;
  }

  function prefetch(id, isHover) {
    id = String(id || '');
    if (!/^\d+$/.test(id)) return;
    const c = cache.get(id);
    if ((c && Date.now() - c.at < FRESH_MS) || tappedFor(id) || inFlight.has(id)) return;
    fetchFirst(id, !!isHover);
  }

  async function load(id, cursor) {
    if (!sec || sec.id !== id || sec.loading) return;
    const my = seq;
    if (!cursor) {
      const c = cache.get(id);
      if (c && Date.now() - c.at < FRESH_MS) { paint(id, c.data, false); return; }
      const tp = tappedFor(id);
      if (tp) { cache.set(id, { at: Date.now(), data: tp.data }); paint(id, tp.data, false); return; }
    }
    sec.loading = true;
    moreBtn();
    let r;
    if (!cursor) {
      if (!inFlight.has(id)) fast.extraRequests = (fast.extraRequests || 0) + 1;
      r = await (fetchFirst(id, false) || XBB.gql.call(OP, Object.assign({ focalTweetId: id }, BASE_VARS)));
    } else {
      const vars = Object.assign({ focalTweetId: id }, BASE_VARS, { cursor, referrer: 'tweet' });
      fast.extraRequests = (fast.extraRequests || 0) + 1;
      try { r = await XBB.gql.call(OP, vars); } catch { r = { ok: false, kind: 'network' }; }
    }
    if (my !== seq || !sec || sec.id !== id) return;
    sec.loading = false;
    if (r && r.ok) {
      if (!cursor) cache.set(id, { at: Date.now(), data: r.data });
      paint(id, r.data, !!cursor);
      return;
    }
    console.warn('[XBB fast] TweetDetail failed:', { kind: r && r.kind, status: r && r.status, error: r && r.error });
    // Not learned yet / changed by X: the post itself is still all here; X's own page teaches us the operation
    const learn = r && (r.kind === 'missing-op' || r.kind === 'drift' || r.kind === 'breaker-open' || r.kind === 'no-main-world');
    if (cursor) { sec.cursor = cursor; moreBtn(); fast.toast(learn ? 'More replies need X\'s own page once (Open on X).' : 'Could not load more replies.'); return; }
    setBanner(learn ? 'learn' : 'error', r);
    moreBtn();
  }

  // X fetched TweetDetail itself (its own page, a tab we hand over): paint it if it is the post on screen
  function onTap(t) {
    if (!t || !(t.status >= 200 && t.status < 300) || !t.data || !t.variables || t.variables.cursor) return;
    const id = String(t.variables.focalTweetId || '');
    if (!id) return;
    cache.set(id, { at: Date.now(), data: t.data });
    if (sec && sec.id === id && dlg && dlg.open && !sec.banner.hidden) { sec.banner.hidden = true; paint(id, t.data, false); }
  }

  // ---------- following the history entry ----------
  function sync(c) {
    const ids = c.drawer;
    if (!ids.length) { if (dlg && dlg.open) hideUI(); else if (cur) teardown(); return; }
    const sh = fast.shell && fast.shell.get();
    if (!sh) return;
    if (!dlg || !dlg.isConnected) build(sh.root);
    if (!offTap) offTap = XBB.gql.onTap(OP, onTap);
    const top = ids[ids.length - 1];
    backBtn.hidden = ids.length < 2;
    if (top !== cur) show(top);
    if (!dlg.open) {
      try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
      try { body.focus({ preventScroll: true }); } catch {}
    }
    fast.rescope();
  }
  function hideUI() {
    closingByUs = true;
    try { if (dlg.open) dlg.close(); } catch {}
    closingByUs = false;
    teardown();
    fast.rescope();
  }
  fast.ov.onChange(sync);

  // ---------- actions ----------
  function open(id) {
    id = String(id || '');
    if (!/^\d+$/.test(id)) return false;
    const c = fast.ov.get();
    if (!c.lb && c.drawer[c.drawer.length - 1] === id) return true;
    const next = { drawer: c.drawer.concat(id), lb: null };
    // from the lightbox: that entry becomes the post (Back then goes to where the lightbox was opened from)
    return c.lb ? fast.ov.replace(next, pathOf(id)) : fast.ov.push(next, pathOf(id));
  }
  function back() { if (fast.ov.get().drawer.length) fast.ov.back(1); }
  function close() {
    const c = fast.ov.get();
    if (!c.drawer.length) { if (dlg && dlg.open) hideUI(); return; }
    // every drawer entry (and the lightbox on top, if any) goes: back to the route's own entry
    fast.ov.closeAll();
  }

  const firstEl = e => { const p = e.composedPath ? e.composedPath() : [e.target]; return p[0] && p[0].nodeType === 1 ? p[0] : e.target; };
  function onClick(e) {
    if (e.button !== 0) return;
    const t = firstEl(e);
    if (t === dlg) { e.preventDefault(); e.stopPropagation(); close(); return; }   // beside the panel: the backdrop
    const b = t.closest('[data-dr]');
    if (!b) return;                        // cards, actions, media, links: the shell's delegated handlers
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.dr;
    if (k === 'close') close();
    else if (k === 'back') back();
    else if (k === 'mode') { mode = mode === 'center' ? 'side' : 'center'; try { localStorage.setItem(MODE_KEY, mode); } catch {} applyMode(); }
    else if (k === 'native') { if (cur) fast.toNative(pathOf(cur)); }
    else if (k === 'retry') { if (sec) { sec.banner.hidden = true; load(sec.id, null); } }
    else if (k === 'more') { if (sec && sec.cursor) load(sec.id, sec.cursor); }
  }
  function onKey(e) {
    if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (fast.lightbox && fast.lightbox.isOpen()) return;
    e.preventDefault(); e.stopPropagation();
    close();
  }
  addEventListener('keydown', e => {
    if (!dlg || !dlg.open || e.defaultPrevented || e.key !== 'Escape') return;
    if (fast.lightbox && fast.lightbox.isOpen()) return;
    const p = e.composedPath ? e.composedPath() : [];
    if (p.includes(dlg)) return;
    onKey(e);
  }, true);

  fast.drawer = {
    open, back, close, prefetch,
    isOpen: () => !!(dlg && dlg.open),
    focal: () => cur,
    el: () => dlg,
    body: () => body,
    articles: () => body ? [...body.querySelectorAll('article.tweet[data-id]')] : [],
    debug: () => ({ open: !!(dlg && dlg.open), focal: cur, mode, stack: fast.ov.get().drawer.slice(), banner: sec && !sec.banner.hidden ? sec.banner.textContent : '',
      ancestors: sec ? [...sec.anc.querySelectorAll('article.tweet')].map(a => a.dataset.id) : [],
      replies: sec ? [...sec.replies.querySelectorAll('article.tweet')].map(a => a.dataset.id) : [], cursor: sec && sec.cursor, cached: [...cache.keys()] })
  };
})();

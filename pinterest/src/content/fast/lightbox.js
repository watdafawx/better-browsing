/* Pinterest Fast UI: the pin viewer. A native <dialog> (showModal) in the shadow root that fills the whole viewport
   and only follows PIN.fast.ov: open = ov.push, step = ov.replace, a related pin = ov.push (one more level: Back
   returns to the pin before), close = ov.closeAll. Closing puts the feed back on its exact pixel (flag.js).
     PIN.fast.viewer.open(id, { list })   list(): the ordered ids prev/next walks (the grid keeps its own: it is
                                          virtualized, so the DOM never holds the whole feed)
     PIN.fast.viewer.know(pins)           pins the viewer may show at once (grid, related)
     PIN.fast.viewer.isOpen()
     PIN.fast.viewer.zoom()               { s, tx, ty, w, h } (tests)
   Layout: a 48px top bar, the media stage (all the height left, edge to edge) and a collapsible 360px side panel
   (the top bar button, `i`; remembered in localStorage['pin-fast-lb-side']) with two tabs, "Info & Comments" and
   "More like this", each scrolling on its own.
   The stage paints what is known at once (the grid's thumbnail), then 1200x, and the original only on zoom. The
   media is sized in JS to fit the stage (contain), so zoom is a transform on it, never a scrollbar: { s, tx, ty },
   translate3d(tx, ty, 0) scale(s), the pan clamped so the picture never leaves the stage. A click (not a drag) or
   `z` toggles 1x <-> 2.2x toward the pointer (the centre for `z`), Ctrl/Meta+wheel and +/- zoom 1x..4x toward the
   pointer, a drag pans, a double click or `0` fits again; another pin starts at 1x. The plain wheel over the stage
   steps (the next idea pin page first, then the next pin) at 1x, and pans when zoomed. A video pin plays V_720P
   (a progressive mp4 with AAC audio) in our own <video> with the user's sound settings (PIN.setupOwnVideo); an idea
   pin steps through its pages before moving to the next pin. The panel has the pin's text, author and stats
   (PinResource/get, merged over the grid pin), the comments (UnifiedCommentsResource, keyed by the aggregated id)
   and "More like this" (RelatedModulesResource). Any of those failing is an inline note here, never a reason to
   hand Home back to Pinterest. The top bar has Save (save.js: the last board, the chevron the picker); the author
   and the board are Fast UI links (the viewer closes, then the profile / board view).
   Keys: Esc closes, ←/→ and j/k step, z zooms, + / - / 0 zoom in / out / fit, i the panel, s saves. */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const api = () => fast.api;
  const known = new Map();            // id -> normalized pin (grid, related, full)
  const full = new Map();             // id -> Promise<pin|null>   PinResource/get, once per page
  const related = new Map();          // id -> Promise<{ ok, pins }>
  const comments = new Map();         // aggregated id -> Promise<{ ok, list }>
  const lists = new Map();            // depth -> () => ids   (0: the grid; n: related of the pin at depth n-1)
  const SV = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>'
  };
  const ico = n => { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = SV[n] || (fast.SVG && fast.SVG[n]) || ''; return s; };
  const num = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(n | 0);
  const rendOf = u => { const m = /i\.pinimg\.com\/([^/]+)\//.exec(u || ''); return m ? m[1] : ''; };

  function getFull(id) {
    if (!full.has(id)) {
      const p = api().call('PinResource/get', { id: String(id), field_set_key: 'auth_web_main_pin', noCache: true },
        { vars: { id }, guard: d => !!(d && typeof d === 'object' && !Array.isArray(d)) })
        .then(r => {
          if (!r.ok) { full.delete(id); return null; }
          const n = PIN.model.normalizePin(r.data);
          if (!n) return null;
          const m = PIN.model.merge(known.get(id), n);
          known.set(id, m);
          return m;
        });
      full.set(id, p);
    }
    return full.get(id);
  }
  function getRelated(id) {
    if (!related.has(id)) {
      const p = api().call('RelatedModulesResource/get', { pin_id: String(id), context_pin_ids: [] }, { vars: { id }, guard: PIN.model.isFeed })
        .then(r => {
          if (!r.ok) { related.delete(id); return { ok: false, pins: [], kind: r.kind }; }
          const f = PIN.model.extractFeed(r.data);
          const pins = f.pins.filter(p => p.id !== id).slice(0, 60);
          for (const p of pins) if (!known.has(p.id)) known.set(p.id, p);
          return { ok: true, pins };
        });
      related.set(id, p);
    }
    return related.get(id);
  }
  function getComments(pin) {
    const agg = pin.aggregatedId;
    if (!agg) return Promise.resolve({ ok: true, list: [] });
    if (!comments.has(agg)) {
      const p = api().call('UnifiedCommentsResource/get', { aggregated_pin_id: agg }, { vars: { id: pin.id }, guard: d => Array.isArray(d) || !!(d && Array.isArray(d.results)) })
        .then(r => {
          if (!r.ok) { comments.delete(agg); return { ok: false, list: [] }; }
          const arr = Array.isArray(r.data) ? r.data : r.data.results;
          const list = arr.filter(c => c && typeof c === 'object' && typeof c.text === 'string').slice(0, 50).map(c => {
            const u = c.user && typeof c.user === 'object' ? c.user : {};
            return { text: c.text.slice(0, 1200), name: String(u.full_name || u.username || ''), user: String(u.username || ''), avatar: /^https:\/\//.test(u.image_medium_url || '') ? u.image_medium_url : '' };
          });
          return { ok: true, list };
        });
      comments.set(agg, p);
    }
    return comments.get(agg);
  }

  // ---------- DOM ----------
  const SIDE_KEY = 'pin-fast-lb-side';
  const ZMAX = 4, ZCLICK = 2.2, ZSTEP = 1.4;
  const PANEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg>';
  const pref = () => { try { const v = localStorage.getItem(SIDE_KEY); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } };
  let dlg = null, ui = null, cur = null, page = 0, video = null, token = 0, relGrid = null;
  let sideOpen = true, tab = 'info', lastWheel = 0, drag = null, dragMoved = false;
  // the zoom: scale, pan (px from the stage centre) and the media's fitted size at 1x
  const Z = { s: 1, tx: 0, ty: 0, w: 0, h: 0, aspect: 1, natural: false, orig: false };
  function build() {
    const sh = fast.shell.get() || fast.shell.mount();
    if (!sh) return null;
    const back = h('button', { class: 'ibtn', type: 'button', 'data-lb-act': 'back', 'aria-label': 'Back', hidden: true }, ico('back'));
    const crumb = h('div', { class: 'grow' });
    const copy = h('button', { class: 'ibtn', type: 'button', 'data-lb-act': 'copy', 'aria-label': 'Copy link', title: 'Copy link' }, ico('copy'));
    const open = h('a', { class: 'ibtn', 'data-lb-act': 'open', 'aria-label': 'Open on Pinterest', title: 'Open on Pinterest', href: '/' }, ico('ext'));
    const sideBtn = h('button', { class: 'ibtn sidebtn', type: 'button', 'data-lb-act': 'side', 'aria-label': 'Details (i)', title: 'Details (i)', 'aria-pressed': 'true' });
    sideBtn.innerHTML = PANEL;
    const close = h('button', { class: 'ibtn', type: 'button', 'data-lb-act': 'close', 'aria-label': 'Close (Esc)', title: 'Close (Esc)' }, ico('close'));
    const savePick = h('button', { class: 'savepick lbpick', type: 'button', 'data-save-pick': '', 'aria-label': 'Choose a board', title: 'Choose a board' }, h('span', { class: 'chev', 'aria-hidden': 'true' }));
    const save = h('button', { class: 'savepill', type: 'button', 'data-save': '' }, 'Save');
    const box = h('div', { class: 'st-box' });
    const prev = h('button', { class: 'st-nav prev', type: 'button', 'data-lb-act': 'prev', 'aria-label': 'Previous' }, ico('prev'));
    const next = h('button', { class: 'st-nav next', type: 'button', 'data-lb-act': 'next', 'aria-label': 'Next' }, ico('next'));
    const rend = h('span', { class: 'rend' });
    const stage = h('div', { class: 'stage' }, box, prev, next, rend);
    const cInfo = h('span', { class: 'pcount', 'data-count-info': '' });
    const cRel = h('span', { class: 'pcount', 'data-count-rel': '' });
    const tInfo = h('button', { class: 'ptab', type: 'button', role: 'tab', 'data-lb-tab': 'info' }, 'Info & Comments', cInfo);
    const tRel = h('button', { class: 'ptab', type: 'button', role: 'tab', 'data-lb-tab': 'rel' }, 'More like this', cRel);
    const info = h('div', { class: 'pane pinfo', role: 'tabpanel', 'aria-label': 'Info & Comments' });
    const rgrid = h('div', { class: 'rgrid' });
    const relSec = h('div', { class: 'pane prel related', role: 'tabpanel', 'aria-label': 'More like this', hidden: true }, rgrid);
    const side = h('aside', { class: 'side' }, h('div', { class: 'ptabs', role: 'tablist' }, tInfo, tRel), info, relSec);
    dlg = h('dialog', { class: 'lb', 'aria-label': 'Pin' },
      h('div', { class: 'lb-head' }, back, crumb, h('div', { class: 'lb-save' }, savePick, save), copy, open, sideBtn, close),
      h('div', { class: 'lb-body' }, stage, side));
    sh.root.append(dlg);
    ui = { back, crumb, open, save, savePick, sideBtn, box, prev, next, rend, stage, side, info, tInfo, tRel, cInfo, cRel, rgrid, relSec };

    // keys on window (capture): a click on the stage can leave the focus outside the dialog's subtree
    addEventListener('keydown', e => { if (dlg && dlg.open) onKey(e); }, true);
    dlg.addEventListener('cancel', e => { e.preventDefault(); fast.ov.closeAll(); });
    // an unasked close (the browser closed it): put the history right
    dlg.addEventListener('close', () => { if (fast.ov.get().depth) fast.ov.closeAll(); });
    dlg.addEventListener('click', onClick);
    // the page behind never scrolls while the dialog is up (no scroll lock: the scrollbar would come and go and
    // reflow the grid); only a panel pane that can still scroll that way takes the wheel (a pane that cannot, or one
    // too short to scroll, would chain it to the document), the stage has its own wheel
    dlg.addEventListener('wheel', e => {
      const pane = e.composedPath().find(n => n.classList && n.classList.contains('pane'));
      const dy = e.deltaY;
      const can = pane && (dy > 0 ? pane.scrollTop + pane.clientHeight < pane.scrollHeight - 1 : dy < 0 ? pane.scrollTop > 0 : false);
      if (!can) e.preventDefault();
    }, { passive: false });
    stage.addEventListener('wheel', onWheel, { passive: false });
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);
    box.addEventListener('click', onBoxClick);
    box.addEventListener('dblclick', e => { if (!video) { e.preventDefault(); zoomReset(); } });
    // the stage changes size with the window and the panel: fit the media again
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (dlg.open) refit(); }).observe(stage);
    return dlg;
  }

  const listFor = depth => lists.get(depth) || (() => []);
  function neighbours() {
    const c = fast.ov.get();
    const ids = listFor(c.depth - 1)();
    const i = ids.indexOf(cur.id);
    return { ids, i, prev: i > 0 ? ids[i - 1] : null, next: i >= 0 && i < ids.length - 1 ? ids[i + 1] : null };
  }
  function step(dir) {
    if (!cur) return;
    const pages = cur.storyPages;
    if (pages && pages.length > 1) {
      const np = page + dir;
      if (np >= 0 && np < pages.length) { page = np; paintStage(); return; }
    }
    const n = neighbours();
    const id = dir > 0 ? n.next : n.prev;
    if (!id) return;
    const c = fast.ov.get();
    fast.ov.replace({ stack: c.stack.slice(0, -1).concat(id), i: n.i + dir });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fast.ov.closeAll(); return; }
    if (PIN.settings.fastUiKeys === false) return;
    let a = e.composedPath()[0];
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      if (a && a.tagName === 'VIDEO' && a.controls) return;    // seeking
      e.preventDefault(); step(k === 'ArrowRight' ? 1 : -1);
    } else if (k === 'j' || k === 'k') { e.preventDefault(); step(k === 'j' ? 1 : -1); }
    else if (k === 'z' || k === 'Z') { e.preventDefault(); toggleZoom(); }
    else if (k === '+' || k === '=') { e.preventDefault(); zoomTo(Z.s * ZSTEP); }
    else if (k === '-' || k === '_') { e.preventDefault(); zoomTo(Z.s / ZSTEP); }
    else if (k === '0') { e.preventDefault(); zoomReset(); }
    else if (k === 'i' || k === 'I') { e.preventDefault(); setSide(!sideOpen, true); }
    else if ((k === 's' || k === 'S') && cur && fast.save) { e.preventDefault(); e.stopPropagation(); fast.save.quick(cur.id, ui.save); }
  }
  function onClick(e) {
    const t = e.composedPath()[0];
    const el = t && t.closest ? t.closest('[data-lb-act],[data-lb-pin],[data-lb-tab]') : null;
    if (!el) return;
    if (el.hasAttribute('data-lb-tab')) { e.preventDefault(); setTab(el.getAttribute('data-lb-tab')); return; }
    if (el.hasAttribute('data-lb-pin')) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      const id = el.getAttribute('data-lb-pin');
      const c = fast.ov.get();
      const ids = relIds;
      lists.set(c.depth, () => ids);
      fast.ov.push({ stack: c.stack.concat(id), i: ids.indexOf(id) });
      return;
    }
    const act = el.getAttribute('data-lb-act');
    if (act === 'open') {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      fast.toNative('/pin/' + cur.id + '/');
      return;
    }
    e.preventDefault();
    if (act === 'close') fast.ov.closeAll();
    else if (act === 'back') fast.ov.back();
    else if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'side') setSide(!sideOpen, true);
    else if (act === 'pprev') { page = Math.max(0, page - 1); paintStage(); }
    else if (act === 'pnext') { page = Math.min(cur.storyPages.length - 1, page + 1); paintStage(); }
    else if (act === 'copy') { try { navigator.clipboard.writeText(location.origin + '/pin/' + cur.id + '/'); fast.toast('Link copied'); } catch {} }
  }

  // ---------- the panel ----------
  function setSide(on, remember) {
    sideOpen = !!on;
    if (!dlg) return;
    dlg.classList.toggle('side-off', !sideOpen);
    ui.sideBtn.setAttribute('aria-pressed', String(sideOpen));
    if (remember) try { localStorage.setItem(SIDE_KEY, sideOpen ? '1' : '0'); } catch {}
  }
  function setTab(t) {
    tab = t === 'rel' ? 'rel' : 'info';
    if (!ui) return;
    ui.tInfo.setAttribute('aria-selected', String(tab === 'info'));
    ui.tRel.setAttribute('aria-selected', String(tab === 'rel'));
    ui.tInfo.classList.toggle('on', tab === 'info');
    ui.tRel.classList.toggle('on', tab === 'rel');
    ui.info.hidden = tab !== 'info';
    ui.relSec.hidden = tab !== 'rel';
    if (!sideOpen) setSide(true, false);
  }

  // ---------- the stage ----------
  function stopVideo() {
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch {} video = null; }
  }
  const media = () => video || ui.box.querySelector('img');
  function clampPan() {
    if (Z.s <= 1) { Z.s = 1; Z.tx = 0; Z.ty = 0; return; }
    const W = ui.stage.clientWidth, H = ui.stage.clientHeight;
    const mx = Math.max(0, (Z.w * Z.s - W) / 2), my = Math.max(0, (Z.h * Z.s - H) / 2);
    Z.tx = Math.max(-mx, Math.min(mx, Z.tx));
    Z.ty = Math.max(-my, Math.min(my, Z.ty));
  }
  function applyZoom() {
    const el = ui.box.querySelector('img');
    if (el) el.style.transform = Z.s > 1 ? `translate3d(${Z.tx.toFixed(1)}px,${Z.ty.toFixed(1)}px,0) scale(${Z.s.toFixed(3)})` : '';
    ui.box.classList.toggle('zoomed', Z.s > 1);
  }
  function refit() {
    // contain: the media at its own aspect, as large as the stage allows (one layout read, on paint and on resize)
    const el = media();
    if (!el || !ui) return;
    const W = ui.stage.clientWidth, H = ui.stage.clientHeight;
    if (!W || !H) return;
    const r = Z.aspect > 0 ? Z.aspect : 1;
    let w = W, hh = W * r;
    if (hh > H) { hh = H; w = H / r; }
    Z.w = Math.round(w); Z.h = Math.round(hh);
    el.style.width = Z.w + 'px';
    el.style.height = Z.h + 'px';
    clampPan(); applyZoom();
  }
  function stageCentre() { const r = ui.stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function zoomTo(s2, cx, cy) {
    if (!cur || video) return;
    const img = ui.box.querySelector('img');
    if (!img) return;
    s2 = Math.max(1, Math.min(ZMAX, s2));
    const c = stageCentre();
    // keep the picture's point under (cx, cy) where it is: t' = p - (s'/s)(p - t), p from the stage centre
    const px = cx == null ? 0 : cx - c.x, py = cy == null ? 0 : cy - c.y;
    const k = s2 / Z.s;
    Z.tx = px - k * (px - Z.tx);
    Z.ty = py - k * (py - Z.ty);
    Z.s = s2;
    clampPan(); applyZoom();
    // the original, only now
    if (Z.s > 1 && !Z.orig) {
      Z.orig = true;
      const pg = cur.storyPages && cur.storyPages[page];
      setImg(img, pg ? (pg.full || pg.image) : cur.orig);
    }
  }
  function zoomReset() { Z.s = 1; Z.tx = 0; Z.ty = 0; if (ui) applyZoom(); }
  function toggleZoom(ev) {
    if (Z.s > 1) zoomReset();
    else zoomTo(ZCLICK, ev ? ev.clientX : null, ev ? ev.clientY : null);
  }
  const wheelPx = e => e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  function onWheel(e) {
    e.preventDefault();
    if (!cur) return;
    const u = wheelPx(e), dy = e.deltaY * u, dx = e.deltaX * u;
    if (e.ctrlKey || e.metaKey) {
      if (!video) zoomTo(Z.s * Math.exp(-Math.max(-200, Math.min(200, dy)) * 0.004), e.clientX, e.clientY);
      return;
    }
    if (Z.s > 1) { Z.tx -= dx; Z.ty -= dy; clampPan(); applyZoom(); return; }
    // like the native viewer: one step per notch, a cooldown against trackpad streams, jitter ignored
    if (Math.abs(dy) < 10) return;
    const now = performance.now();
    if (now - lastWheel < 140) return;
    lastWheel = now;
    step(dy > 0 ? 1 : -1);
  }
  function onDown(e) {
    if (video || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: Z.tx, ty: Z.ty, moved: false };
    dragMoved = false;
    if (Z.s > 1) {
      e.preventDefault();
      try { ui.box.setPointerCapture(e.pointerId); } catch {}
      ui.box.classList.add('panning');
    }
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
    if (Z.s > 1 && drag.moved) { Z.tx = drag.tx + dx; Z.ty = drag.ty + dy; clampPan(); applyZoom(); }
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    dragMoved = drag.moved;
    drag = null;
    ui.box.classList.remove('panning');
    try { ui.box.releasePointerCapture(e.pointerId); } catch {}
  }
  function onBoxClick(e) {
    if (video) return;          // the video handles its own clicks (PIN.setupOwnVideo)
    if (dragMoved) { dragMoved = false; return; }
    const t = e.composedPath()[0];
    // at 1x only the picture zooms (not the empty stage around it); zoomed, any click fits again
    if (Z.s > 1 || (t && t.tagName === 'IMG')) toggleZoom(e);
  }
  function setImg(img, url, then) {
    if (!url || img.getAttribute('src') === url) { then && then(); return; }
    const pre = new Image();
    pre.decoding = 'async';
    const my = token;
    pre.onload = () => { if (my !== token || !img.isConnected) return; img.setAttribute('src', url); ui.rend.textContent = rendOf(url); then && then(); };
    pre.onerror = () => { then && then(true); };
    pre.src = url;
  }
  function paintStage() {
    token++;
    stopVideo();
    zoomReset();
    Z.orig = false;
    const p = cur, box = ui.box;
    box.replaceChildren();
    box.className = 'st-box';
    ui.stage.querySelectorAll('.bars,.pgno,.pgbtn').forEach(n => n.remove());
    const pages = p.storyPages;
    const pg = pages && pages.length ? pages[Math.min(page, pages.length - 1)] : null;
    if (pg) {
      box.classList.add('story');
      if (pages.length > 1) {
        ui.stage.append(h('div', { class: 'bars', 'aria-hidden': 'true' }, pages.map((_, k) => h('i', { class: k === page ? 'on' : null }))),
          h('span', { class: 'pgno', 'data-pgno': '' }, `${page + 1} / ${pages.length}`),
          h('button', { class: 'pgbtn pprev', type: 'button', 'data-lb-act': 'pprev', disabled: page === 0 }, 'Previous page'),
          h('button', { class: 'pgbtn pnext', type: 'button', 'data-lb-act': 'pnext', disabled: page === pages.length - 1 }, 'Next page'));
      }
    }
    const ratio = (w, hh) => w > 1 && hh > 1 ? hh / w : 0;
    const vsrc = pg ? pg.video : p.video && p.video.src;
    if (vsrc) {
      box.classList.add('video');
      const vr = pg && page > 0 ? 0 : ratio(p.video && p.video.w || p.w, p.video && p.video.h || p.h);
      Z.aspect = vr || ratio(p.w, p.h) || 16 / 9;
      Z.natural = !vr;
      const v = h('video', { preload: 'auto', poster: (pg && pg.poster) || (p.video && p.video.poster) || p.large || p.thumb });
      v.addEventListener('loadedmetadata', () => { if (Z.natural && v === video && v.videoWidth > 1 && v.videoHeight > 1) { Z.aspect = v.videoHeight / v.videoWidth; refit(); } });
      v.src = vsrc;
      box.append(v);
      video = v;
      PIN.setupOwnVideo(v);
      ui.rend.textContent = /V_720P/.test(vsrc) ? '720p' : 'mp4';
    } else {
      // a later idea pin page may have another shape than the pin: its own pixels decide
      Z.aspect = ratio(p.w, p.h) || 1;
      Z.natural = !ratio(p.w, p.h) || !!(pg && page > 0);
      const img = h('img', { alt: p.title || '', draggable: 'false' });
      const cands = pg ? pg.candidates : null;
      const first = pg ? (pg.image || p.thumb) : p.thumb;
      img.setAttribute('src', first);
      ui.rend.textContent = rendOf(first);
      let k = 0;
      img.addEventListener('error', () => { if (cands && k < cands.length) { const u = cands[k++]; if (u !== img.getAttribute('src')) img.setAttribute('src', u); } });
      img.addEventListener('load', () => { if (Z.natural && img.isConnected && img.naturalWidth > 1 && img.naturalHeight > 1) { const a = img.naturalHeight / img.naturalWidth; if (Math.abs(a - Z.aspect) > 0.01) { Z.aspect = a; refit(); } } });
      box.append(img);
      if (!pg) setImg(img, p.large);
    }
    refit();
    const n = neighbours();
    const multi = pages && pages.length > 1;
    ui.prev.disabled = !n.prev && !(multi && page > 0);
    ui.next.disabled = !n.next && !(multi && page < pages.length - 1);
  }

  // ---------- the info tab ----------
  function av(name, url, cls) {
    const a = h('span', { class: 'av' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    if (url) a.append(h('img', { src: url, alt: '', loading: 'lazy' }));
    else a.textContent = (name[0] || '?').toUpperCase();
    return a;
  }
  function paintSide() {
    const p = cur;
    const kids = [];
    if (p.title) kids.push(h('h2', null, p.title));
    if (p.link) kids.push(h('a', { class: 'dom', href: p.link, target: '_blank', rel: 'noopener noreferrer nofollow' }, p.domain || p.link));
    kids.push(h('a', { class: 'openbtn', href: '/pin/' + p.id + '/', 'data-lb-act': 'open' }, 'Open on Pinterest'));
    const name = p.author.name || p.author.username;
    const uhref = p.author.username && fast.routeOf('/' + p.author.username + '/') === 'profile' ? '/' + p.author.username + '/' : null;
    if (name) kids.push(h('div', { class: 'author' }, av(name, p.author.avatar), h('div', { class: 'nm' },
      uhref ? h('a', { class: 'olink', href: uhref, 'data-go': '', 'data-lb-author': '' }, h('b', null, name)) : h('b', null, name),
      p.author.username ? h('small', null, '@' + p.author.username) : null)));
    if (p.description) kids.push(h('p', { class: 'desc' }, p.description));
    const st = [];
    if (p.saveCount) st.push(h('span', null, num(p.saveCount) + ' saves'));
    if (p.commentCount) st.push(h('span', null, num(p.commentCount) + ' comments'));
    if (p.board && p.board.name) {
      let bp = '';
      try { bp = p.board.url ? new URL(p.board.url, location.origin).pathname : ''; } catch {}
      if (bp && !bp.endsWith('/')) bp += '/';
      st.push(h('span', null, 'in ', fast.routeOf(bp) === 'board' ? h('a', { class: 'olink', href: bp, 'data-go': '', 'data-lb-board': '' }, p.board.name) : p.board.name));
    }
    if (st.length) kids.push(h('div', { class: 'stats' }, st));
    const cmBox = h('div', { class: 'cms', 'data-comments': '' }, h('div', { class: 'note' }, 'Loading comments…'));
    kids.push(h('div', { class: 'cm-h' }, 'Comments', p.commentCount ? h('small', null, num(p.commentCount)) : null), cmBox);
    ui.info.replaceChildren(...kids);
    ui.cInfo.textContent = p.commentCount ? num(p.commentCount) : '';
    const my = token, id = p.id;
    if (!p.aggregatedId) { cmBox.replaceChildren(h('div', { class: 'note' }, p.commentCount ? 'Loading comments…' : 'No comments yet.')); return; }
    getComments(p).then(r => {
      if (my !== token || !cur || cur.id !== id) return;
      if (!r.ok) { cmBox.replaceChildren(h('div', { class: 'note', 'data-cm-err': '' }, "Comments didn't load. ", h('a', { href: '/pin/' + id + '/', 'data-lb-act': 'open' }, 'Open on Pinterest'))); return; }
      if (!r.list.length) { cmBox.replaceChildren(h('div', { class: 'note' }, 'No comments yet.')); return; }
      if (!p.commentCount) ui.cInfo.textContent = num(r.list.length);
      cmBox.replaceChildren(...r.list.map(c => h('div', { class: 'cm' }, av(c.name, c.avatar), h('div', null, h('b', null, c.name), h('span', { class: 'tx' }, c.text)))));
    });
  }

  // ---------- the "More like this" tab ----------
  let relIds = [];
  function paintRelated() {
    const id = cur.id, my = token;
    relIds = [];
    if (relGrid) { relGrid.destroy(); relGrid = null; }
    ui.rgrid.replaceChildren(h('div', { class: 'note' }, 'Loading…'));
    ui.rgrid.style.height = '';
    ui.cRel.textContent = '';
    getRelated(id).then(r => {
      if (my !== token || !cur || cur.id !== id) return;
      if (!r.ok) { ui.rgrid.replaceChildren(h('div', { class: 'note', 'data-rel-err': '' }, "Related pins didn't load.")); return; }
      if (!r.pins.length) { ui.rgrid.replaceChildren(h('div', { class: 'note' }, 'Nothing related yet.')); ui.cRel.textContent = '0'; return; }
      relIds = r.pins.map(p => p.id);
      ui.cRel.textContent = num(relIds.length);
      ui.rgrid.replaceChildren();
      // a small static masonry in the panel (at most 60 cards; the pane scrolls, not the document, so no
      // virtualization). Its width is the panel's, known without a layout read even while the tab is hidden.
      const m = PIN.masonry({ gap: 10, minCol: 140, maxCols: 2, footer: fast.card.footer });
      m.setWidth(Math.max(240, Math.min(360, innerWidth) - 28));
      m.append(r.pins);
      const frag = document.createDocumentFragment();
      r.pins.forEach((p, i) => {
        const node = fast.card.make();
        fast.card.fill(node, p, m.rect(i));
        node.style.transform = `translate3d(${m.rect(i).x}px,${m.rect(i).y}px,0)`;
        node.querySelector('.media').setAttribute('data-lb-pin', p.id);
        node._c.img.setAttribute('loading', 'lazy');
        frag.append(node);
      });
      ui.rgrid.append(frag);
      ui.rgrid.style.height = Math.ceil(m.height()) + 'px';
    });
  }

  // ---------- following the history ----------
  function closeDlg() {
    token++; stopVideo(); shownKey = ''; cur = null; zoomReset();
    ui.box.replaceChildren(); ui.info.replaceChildren();
    if (relGrid) { relGrid.destroy(); relGrid = null; }
    ui.rgrid.replaceChildren();
    dlg.close();
  }
  let shownKey = '';
  function render(c) {
    if (!c.stack.length) {
      if (dlg && dlg.open) closeDlg();
      fast.rescope && fast.rescope();
      return;
    }
    if (!dlg && !build()) return;
    const id = c.stack[c.stack.length - 1];
    const key = c.depth + ':' + id;
    if (key === shownKey && dlg.open) return;
    shownKey = key;
    const base = known.get(id);
    if (!dlg.open) {
      // a fresh open: the panel as the user left it (on wide screens by default), on its first tab
      const pv = pref();
      setSide(pv == null ? innerWidth > 900 : pv, false);
      setTab('info');
      try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    }
    ui.back.hidden = c.depth < 2;
    ui.crumb.replaceChildren(h('span', { class: 'crumb' }, c.depth > 1 ? 'More like this' : (fast.LABEL[fast.state().route] || 'Home')));
    ui.open.setAttribute('href', '/pin/' + id + '/');
    ui.save.setAttribute('data-save-id', id);
    ui.savePick.setAttribute('data-save-id', id);
    if (fast.save) fast.save.paint(ui.save, id);
    page = 0;
    ui.info.scrollTop = 0; ui.relSec.scrollTop = 0;
    if (base) {
      cur = base;
      paintStage(); paintSide(); paintRelated();
    } else {
      // reloaded on /pin/<id>/ inside our entry: nothing known yet
      cur = { id, kind: 'image', title: '', description: '', link: '', domain: '', w: 1, h: 1, thumb: '', large: '', orig: '', sizes: [], video: null, storyPages: null, author: { name: '', username: '' }, board: null, aggregatedId: '', saveCount: 0, commentCount: 0 };
      zoomReset();
      ui.box.replaceChildren(h('div', { class: 'note' }, 'Loading…'));
      ui.info.replaceChildren();
      ui.cInfo.textContent = ''; ui.cRel.textContent = '';
    }
    const my = token;
    getFull(id).then(p => {
      if (!p || !cur || cur.id !== id) {
        if (!p && cur && cur.id === id && !base) ui.box.replaceChildren(h('div', { class: 'note' }, "This pin didn't load. ", h('a', { href: '/pin/' + id + '/', 'data-lb-act': 'open' }, 'Open on Pinterest')));
        return;
      }
      const hadBase = !!base;
      const changed = !hadBase || (p.video && p.video.src) !== (cur.video && cur.video.src) || JSON.stringify(p.storyPages) !== JSON.stringify(cur.storyPages);
      cur = p;
      if (!hadBase || my !== token) { paintStage(); paintSide(); if (!hadBase) paintRelated(); return; }
      if (changed) paintStage();
      paintSide();
    });
    // the next one, ahead of time
    const n = neighbours();
    if (n.next) { const np = known.get(n.next); if (np && np.large) { const im = new Image(); im.decoding = 'async'; im.src = np.large; } }
  }
  fast.ov.onChange(render);
  fast.onChange(s => { if (!s.owned && dlg && dlg.open) closeDlg(); });

  fast.viewer = {
    open(id, { list } = {}) {
      if (list) lists.set(0, list);
      const ids = list ? list() : [];
      return fast.ov.push({ stack: [String(id)], i: ids.indexOf(String(id)) });
    },
    know(pins) { for (const p of pins) if (p && p.id && !known.has(p.id)) known.set(p.id, p); },
    isOpen: () => !!(dlg && dlg.open),
    get: () => cur,
    page: () => page,
    zoom: () => ({ s: Z.s, tx: Z.tx, ty: Z.ty, w: Z.w, h: Z.h }),
    side: () => ({ open: sideOpen, tab }),
    dialog: () => dlg
  };
})();

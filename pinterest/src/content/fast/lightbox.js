/* Pinterest Fast UI: the pin viewer. A native <dialog> (showModal) in the shadow root that only follows PIN.fast.ov:
   open = ov.push, step = ov.replace, a related pin = ov.push (one more level: Back returns to the pin before),
   close = ov.closeAll. Closing puts the feed back on its exact pixel (flag.js).
     PIN.fast.viewer.open(id, { list })   list(): the ordered ids prev/next walks (the grid keeps its own: it is
                                          virtualized, so the DOM never holds the whole feed)
     PIN.fast.viewer.know(pins)           pins the viewer may show at once (grid, related)
     PIN.fast.viewer.isOpen()
   The stage paints what is known at once (the grid's thumbnail), then 1200x, and the original only on zoom. A video
   pin plays V_720P (a progressive mp4 with AAC audio) in our own <video> with the user's sound settings
   (PIN.setupOwnVideo); an idea pin steps through its pages before moving to the next pin. The side panel has the
   pin's text, author and stats (PinResource/get, merged over the grid pin), the comments (UnifiedCommentsResource,
   keyed by the aggregated id) and "More like this" (RelatedModulesResource). Any of those failing is an inline note
   here, never a reason to hand Home back to Pinterest. The top bar has Save (save.js: the last board, the chevron
   the picker); the author and the board are Fast UI links (the viewer closes, then the profile / board view).
   Keys: Esc closes, ←/→ and j/k step, z zooms, s saves. */
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
  let dlg = null, ui = null, cur = null, page = 0, zoomed = false, video = null, token = 0, relGrid = null;
  function build() {
    const sh = fast.shell.get() || fast.shell.mount();
    if (!sh) return null;
    const back = h('button', { class: 'ibtn', type: 'button', 'data-lb-act': 'back', 'aria-label': 'Back', hidden: true }, ico('back'));
    const crumb = h('div', { class: 'grow' });
    const copy = h('button', { class: 'ibtn', type: 'button', 'data-lb-act': 'copy', 'aria-label': 'Copy link', title: 'Copy link' }, ico('copy'));
    const open = h('a', { class: 'ibtn', 'data-lb-act': 'open', 'aria-label': 'Open on Pinterest', title: 'Open on Pinterest', href: '/' }, ico('ext'));
    const close = h('button', { class: 'ibtn', type: 'button', 'data-lb-act': 'close', 'aria-label': 'Close (Esc)', title: 'Close (Esc)' }, ico('close'));
    const savePick = h('button', { class: 'savepick lbpick', type: 'button', 'data-save-pick': '', 'aria-label': 'Choose a board', title: 'Choose a board' }, h('span', { class: 'chev', 'aria-hidden': 'true' }));
    const save = h('button', { class: 'savepill', type: 'button', 'data-save': '' }, 'Save');
    const box = h('div', { class: 'st-box' });
    const prev = h('button', { class: 'st-nav prev', type: 'button', 'data-lb-act': 'prev', 'aria-label': 'Previous' }, ico('prev'));
    const next = h('button', { class: 'st-nav next', type: 'button', 'data-lb-act': 'next', 'aria-label': 'Next' }, ico('next'));
    const rend = h('span', { class: 'rend' });
    const stage = h('div', { class: 'stage' }, prev, box, next, rend);
    const side = h('aside', { class: 'side' });
    const rgrid = h('div', { class: 'rgrid' });
    const relSec = h('section', { class: 'related' }, h('h3', null, 'More like this'), rgrid);
    dlg = h('dialog', { class: 'lb', 'aria-label': 'Pin' },
      h('div', { class: 'lb-head' }, back, crumb, h('div', { class: 'lb-save' }, savePick, save), copy, open, close),
      h('div', { class: 'lb-body' }, stage, side), relSec);
    sh.root.append(dlg);
    ui = { back, crumb, open, save, savePick, box, prev, next, rend, stage, side, rgrid, relSec };

    // keys on window (capture): a click on the stage can leave the focus outside the dialog's subtree
    addEventListener('keydown', e => { if (dlg && dlg.open) onKey(e); }, true);
    dlg.addEventListener('cancel', e => { e.preventDefault(); fast.ov.closeAll(); });
    // an unasked close (the browser closed it): put the history right
    dlg.addEventListener('close', () => { if (fast.ov.get().depth) fast.ov.closeAll(); });
    dlg.addEventListener('click', onClick);
    // the backdrop: a click on the dialog box itself, outside its content
    dlg.addEventListener('pointerdown', e => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg._bd = true; } });
    dlg.addEventListener('pointerup', e => { if (dlg._bd && e.target === dlg) fast.ov.closeAll(); dlg._bd = false; });
    // the page behind never scrolls while the dialog is up (no scroll lock: the scrollbar would come and go and
    // reflow the grid); a wheel over the backdrop is dropped
    dlg.addEventListener('wheel', e => { if (e.target === dlg) e.preventDefault(); }, { passive: false });
    box.addEventListener('click', onBoxClick);
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (a && a.tagName === 'VIDEO' && a.controls) return;    // seeking
      e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'j' || e.key === 'k') { e.preventDefault(); step(e.key === 'j' ? 1 : -1); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); toggleZoom(); }
    else if ((e.key === 's' || e.key === 'S') && cur && fast.save) { e.preventDefault(); e.stopPropagation(); fast.save.quick(cur.id, ui.save); }
  }
  function onClick(e) {
    const t = e.composedPath()[0];
    const el = t && t.closest ? t.closest('[data-lb-act],[data-lb-pin]') : null;
    if (!el) return;
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
    else if (act === 'pprev') { page = Math.max(0, page - 1); paintStage(); }
    else if (act === 'pnext') { page = Math.min(cur.storyPages.length - 1, page + 1); paintStage(); }
    else if (act === 'copy') { try { navigator.clipboard.writeText(location.origin + '/pin/' + cur.id + '/'); fast.toast('Link copied'); } catch {} }
  }

  // ---------- the stage ----------
  function stopVideo() {
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch {} video = null; }
  }
  function fit(w, hh) {
    // the box keeps the pin's own aspect inside the stage (no layout read: the stage height is a CSS value)
    const stageH = Math.min(640, Math.max(320, innerHeight - 140));
    ui.stage.style.setProperty('--stageH', stageH + 'px');
    const maxW = Math.max(200, Math.min(innerWidth - 48, 1240) - (innerWidth > 900 ? 380 : 0) - 140);
    const r = (hh || 1) / (w || 1);
    let bh = stageH - 32, bw = bh / r;
    if (bw > maxW) { bw = maxW; bh = bw * r; }
    ui.box.style.width = Math.round(bw) + 'px';
    ui.box.style.height = Math.round(bh) + 'px';
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
    zoomed = false;
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
    const vsrc = pg ? pg.video : p.video && p.video.src;
    if (vsrc) {
      box.classList.add('video');
      fit(p.video && p.video.w || p.w, p.video && p.video.h || p.h);
      const v = h('video', { preload: 'auto', poster: (pg && pg.poster) || (p.video && p.video.poster) || p.large || p.thumb });
      v.src = vsrc;
      box.append(v);
      video = v;
      PIN.setupOwnVideo(v);
      ui.rend.textContent = /V_720P/.test(vsrc) ? '720p' : 'mp4';
    } else {
      fit(p.w, p.h);
      const img = h('img', { alt: p.title || '', draggable: 'false' });
      const cands = pg ? pg.candidates : null;
      const first = pg ? (pg.image || p.thumb) : p.thumb;
      img.setAttribute('src', first);
      ui.rend.textContent = rendOf(first);
      let k = 0;
      img.addEventListener('error', () => { if (cands && k < cands.length) { const u = cands[k++]; if (u !== img.getAttribute('src')) img.setAttribute('src', u); } });
      box.append(img);
      if (!pg) setImg(img, p.large);
    }
    const n = neighbours();
    const multi = pages && pages.length > 1;
    ui.prev.disabled = !n.prev && !(multi && page > 0);
    ui.next.disabled = !n.next && !(multi && page < pages.length - 1);
  }
  function toggleZoom(ev) {
    if (!cur || video) return;
    const img = ui.box.querySelector('img');
    if (!img) return;
    zoomed = !zoomed;
    if (zoomed && ev) {
      const r = ui.box.getBoundingClientRect();
      img.style.setProperty('--zx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      img.style.setProperty('--zy', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }
    ui.box.classList.toggle('zoomed', zoomed);
    // the original, only now
    if (zoomed) {
      const pg = cur.storyPages && cur.storyPages[page];
      setImg(img, pg ? (pg.full || pg.image) : cur.orig);
    }
  }
  function onBoxClick(e) {
    if (video) return;          // the video handles its own clicks (PIN.setupOwnVideo)
    toggleZoom(e);
  }

  // ---------- the side panel ----------
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
    ui.side.replaceChildren(...kids);
    const my = token, id = p.id;
    if (!p.aggregatedId) { cmBox.replaceChildren(h('div', { class: 'note' }, p.commentCount ? 'Loading comments…' : 'No comments yet.')); return; }
    getComments(p).then(r => {
      if (my !== token || !cur || cur.id !== id) return;
      if (!r.ok) { cmBox.replaceChildren(h('div', { class: 'note', 'data-cm-err': '' }, "Comments didn't load. ", h('a', { href: '/pin/' + id + '/', 'data-lb-act': 'open' }, 'Open on Pinterest'))); return; }
      if (!r.list.length) { cmBox.replaceChildren(h('div', { class: 'note' }, 'No comments yet.')); return; }
      cmBox.replaceChildren(...r.list.map(c => h('div', { class: 'cm' }, av(c.name, c.avatar), h('div', null, h('b', null, c.name), h('span', { class: 'tx' }, c.text)))));
    });
  }

  // ---------- related ----------
  let relIds = [];
  function paintRelated() {
    const id = cur.id, my = token;
    relIds = [];
    if (relGrid) { relGrid.destroy(); relGrid = null; }
    ui.rgrid.replaceChildren(h('div', { class: 'note' }, 'Loading…'));
    ui.rgrid.style.height = '';
    getRelated(id).then(r => {
      if (my !== token || !cur || cur.id !== id) return;
      if (!r.ok) { ui.rgrid.replaceChildren(h('div', { class: 'note', 'data-rel-err': '' }, "Related pins didn't load.")); return; }
      if (!r.pins.length) { ui.relSec.hidden = true; return; }
      ui.relSec.hidden = false;
      relIds = r.pins.map(p => p.id);
      ui.rgrid.replaceChildren();
      // a small static masonry (at most 60 cards; the dialog scrolls, not the document, so no virtualization)
      const m = PIN.masonry({ gap: 12, minCol: 150, maxCols: 5, footer: fast.card.footer });
      const w = Math.max(300, ui.rgrid.clientWidth || (Math.min(innerWidth - 48, 1240) - 44));
      m.setWidth(w);
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
    token++; stopVideo(); shownKey = ''; cur = null;
    ui.box.replaceChildren(); ui.side.replaceChildren();
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
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    ui.back.hidden = c.depth < 2;
    ui.crumb.replaceChildren(h('span', { class: 'crumb' }, c.depth > 1 ? 'More like this' : (fast.LABEL[fast.state().route] || 'Home')));
    ui.open.setAttribute('href', '/pin/' + id + '/');
    ui.save.setAttribute('data-save-id', id);
    ui.savePick.setAttribute('data-save-id', id);
    if (fast.save) fast.save.paint(ui.save, id);
    page = 0;
    dlg.scrollTop = 0;
    if (base) {
      cur = base;
      paintStage(); paintSide(); paintRelated();
    } else {
      // reloaded on /pin/<id>/ inside our entry: nothing known yet
      cur = { id, kind: 'image', title: '', description: '', link: '', domain: '', w: 1, h: 1, thumb: '', large: '', orig: '', sizes: [], video: null, storyPages: null, author: { name: '', username: '' }, board: null, aggregatedId: '', saveCount: 0, commentCount: 0 };
      ui.box.replaceChildren(h('div', { class: 'note' }, 'Loading…'));
      ui.side.replaceChildren();
    }
    const my = token;
    getFull(id).then(p => {
      if (!p || !cur || cur.id !== id) {
        if (!p && cur && cur.id === id && !base) ui.box.replaceChildren(h('div', { class: 'note' }, "This pin didn't load. ", h('a', { href: '/pin/' + id + '/', 'data-lb-act': 'open' }, 'Open on Pinterest')));
        return;
      }
      const hadBase = !!base;
      const media = !hadBase || (p.video && p.video.src) !== (cur.video && cur.video.src) || JSON.stringify(p.storyPages) !== JSON.stringify(cur.storyPages);
      cur = p;
      if (!hadBase || my !== token) { paintStage(); paintSide(); if (!hadBase) paintRelated(); return; }
      if (media) paintStage();
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
    dialog: () => dlg
  };
})();

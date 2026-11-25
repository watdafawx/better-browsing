/* Pinterest Fast UI: saving a pin to a board (the grid card's hover pill and the viewer's top bar).
     PIN.fast.save.quick(pinId, anchor)   Save to the last board used (localStorage['pin-last-board']); no last board
                                          yet: the picker
     PIN.fast.save.open(pinId, anchor)    the board picker (popover="auto"): search, ↑/↓ + Enter, Recent / All
                                          boards, Create board (BoardResource/create, then saved to it)
     PIN.fast.save.paint(btn, pinId)      Save / Saving… / Saved on a [data-save] button (grid.js, lightbox.js)
     PIN.fast.save.close() / isOpen() / boards() / last() / state(pinId)
     PIN.fast.me()                        the signed-in username (Pinterest's header link, the SSR context, the
                                          last one seen) or ''
     PIN.fast.vtoast(msg)                 a toast inside the shell (inside the viewer's dialog while it is open:
                                          the top layer would cover anything else)
   Boards come lazily, on the first picker or quick save without a last board: BoardPickerBoardsResource/get, else
   BoardsResource/get for the signed-in user; cached 5 minutes. A save is RepinResource/create (POST, X-CSRFToken from
   the csrftoken cookie; api.js): "Saved" at once, rolled back with a toast if Pinterest says no. None of these
   resources is a route's primary one: a failure here is a toast or an inline note, never fast.fail. */
(() => {
  const { h } = PIN;
  const fast = PIN.fast;
  const LAST = 'pin-last-board', RECENT = 'pin-recent-boards', ME = 'pin-fast-me';
  const TTL = 5 * 60 * 1000;
  const saved = new Map();              // pin id -> { id, name, pending }
  let boardsP = null, boardsAt = 0, boardsList = [], recentIds = [];
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const LOCK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';

  // ---------- who is signed in ----------
  const userOf = href => {
    try {
      const p = new URL(href, location.href).pathname;
      if (fast.routeOf(p) !== 'profile') return '';
      return p.split('/').filter(Boolean)[0] || '';
    } catch { return ''; }
  };
  function fromSSR() {
    for (const id of ['__PWS_INITIAL_PROPS__', '__PWS_DATA__']) {
      const el = document.getElementById(id);
      if (!el || !el.textContent) continue;
      let j;
      try { j = JSON.parse(el.textContent); } catch { continue; }
      const cands = [j && j.context && j.context.user, j && j.props && j.props.context && j.props.context.user,
        j && j.props && j.props.initialReduxState && j.props.initialReduxState.viewer];
      for (const u of cands) if (u && typeof u.username === 'string' && userOf('/' + u.username + '/')) return u.username;
    }
    return '';
  }
  let meCache = '';
  function me() {
    if (meCache) return meCache;
    let u = '';
    try {
      const a = document.querySelector('[data-test-id="header-profile"] a[href], a[data-test-id="header-profile"][href]');
      if (a) u = userOf(a.getAttribute('href'));
    } catch {}
    if (!u) u = fromSSR();
    if (u) { meCache = u; try { localStorage.setItem(ME, u); } catch {} return u; }
    try { const s = localStorage.getItem(ME) || ''; return userOf('/' + s + '/') ? s : ''; } catch { return ''; }
  }

  // ---------- boards ----------
  const last = () => { const l = lsGet(LAST); return l && typeof l.id === 'string' && /^\d{1,24}$/.test(l.id) ? { id: l.id, name: String(l.name || 'Board').slice(0, 200) } : null; };
  function remember(b) {
    lsSet(LAST, { id: b.id, name: b.name });
    recentIds = [b.id].concat(recentIds.filter(x => x !== b.id)).slice(0, 5);
    lsSet(RECENT, recentIds);
  }
  { const r = lsGet(RECENT); if (Array.isArray(r)) recentIds = r.filter(x => typeof x === 'string' && /^\d{1,24}$/.test(x)).slice(0, 5); }
  function boards(force) {
    if (!force && boardsP && Date.now() - boardsAt < TTL) return boardsP;
    boardsAt = Date.now();
    boardsP = (async () => {
      let r = await fast.api.call('BoardPickerBoardsResource/get', {}, { guard: PIN.model.isBoards });
      if (!r.ok) {
        const u = me();
        if (u) r = await fast.api.call('BoardsResource/get', { username: u, page_size: 100, privacy_filter: 'all', sort: 'last_pinned_to', field_set_key: 'profile_grid_item' },
          { vars: { username: u }, guard: PIN.model.isBoards });
      }
      if (!r.ok) { boardsP = null; return { ok: false, kind: r.kind, status: r.status, boards: [], recent: [] }; }
      const f = PIN.model.extractBoards(r.data);
      boardsList = f.boards;
      for (const b of f.recent.slice().reverse()) if (!recentIds.includes(b.id)) recentIds.push(b.id);
      return { ok: true, boards: boardsList, recent: f.recent };
    })();
    return boardsP;
  }

  // ---------- the buttons ----------
  function paint(btn, id) {
    if (!btn) return;
    const s = saved.get(id);
    const t = !s ? 'Save' : s.pending ? 'Saving…' : 'Saved';
    if (btn.textContent !== t) btn.textContent = t;
    const done = !!s && !s.pending;
    btn.classList.toggle('done', done);
    btn.classList.toggle('busy', !!s && !!s.pending);
    const l = last();
    btn.title = done ? 'Saved to ' + s.name : l ? 'Save to ' + l.name + ' (S)' : 'Save (S)';
    const card = btn.closest && btn.closest('.card');
    if (card) card.classList.toggle('saved', done);
  }
  function paintAll(id) {
    const sh = fast.shell.get();
    if (!sh) return;
    for (const b of sh.root.querySelectorAll('[data-save][data-save-id="' + id + '"]')) paint(b, id);
  }

  // ---------- toast inside the shell ----------
  let tEl = null, tT = 0;
  function vtoast(msg) {
    const sh = fast.shell.get();
    if (!sh) { fast.toast(msg); return; }
    if (!tEl) tEl = h('div', { class: 'vtoast', role: 'status', 'aria-live': 'polite', 'data-vtoast': '' });
    const dlg = fast.viewer && fast.viewer.isOpen() ? fast.viewer.dialog() : null;
    const where = dlg || sh.root;
    if (tEl.parentNode !== where) where.append(tEl);
    tEl.textContent = msg;
    tEl.classList.add('on');
    clearTimeout(tT);
    tT = setTimeout(() => tEl.classList.remove('on'), 3200);
  }

  // ---------- saving ----------
  async function saveTo(id, b) {
    if (!id || !b) return false;
    const prev = saved.get(id);
    saved.set(id, { id: b.id, name: b.name, pending: true });
    paintAll(id);
    const r = await fast.api.call('RepinResource/create',
      { pin_id: String(id), board_id: b.id, section_id: null, description: '', is_buyable_pin: false, carousel_slot_index: 0 },
      { method: 'POST', vars: { id }, guard: d => !!(d && typeof d === 'object') });
    // a refused write must not stop the next one the user asks for (the breaker is for reads)
    if (!r.ok) fast.api.breaker.reset('RepinResource/create');
    if (r.ok) {
      saved.set(id, { id: b.id, name: b.name, pending: false });
      remember(b);
      const lb = boardsList.find(x => x.id === b.id);
      if (lb) lb.pins++;
      paintAll(id);
      vtoast('Saved to ' + b.name);
      return true;
    }
    if (prev && !prev.pending) saved.set(id, prev); else saved.delete(id);
    paintAll(id);
    vtoast(r.kind === 'http' && r.status === 401 ? 'Sign in on Pinterest to save pins' : "Couldn't save to " + b.name + '. Try again');
    return false;
  }
  async function createBoard(name, secret) {
    const r = await fast.api.call('BoardResource/create', { name, description: '', privacy: secret ? 'secret' : 'public', collab_board_email: false },
      { method: 'POST', guard: d => !!PIN.model.normalizeBoard(d) });
    if (!r.ok) { fast.api.breaker.reset('BoardResource/create'); vtoast("Couldn't create the board"); return null; }
    const b = PIN.model.normalizeBoard(r.data);
    boardsList = [b].concat(boardsList.filter(x => x.id !== b.id));
    return b;
  }
  function quick(id, anchor) {
    id = String(id || '');
    if (!id) return;
    const s = saved.get(id);
    if (s && s.pending) return;
    const l = last();
    if (l && !s) saveTo(id, l);
    else open(id, anchor);              // no last board yet, or saved already (to another board, then)
  }

  // ---------- the picker ----------
  let pk = null, pkId = '', pkAnchor = null, rows = [], sel = 0, pkOff = null, onScroll = null, pkMode = 'list';
  const isOpen = () => !!(pk && pk.classList.contains('show'));
  function build() {
    const q = h('input', { class: 'pk-q', type: 'search', placeholder: 'Search your boards', 'aria-label': 'Search your boards', autocomplete: 'off', 'data-pk-q': '' });
    const list = h('div', { class: 'pk-list', role: 'listbox', 'aria-label': 'Boards' });
    const newBtn = h('button', { type: 'button', class: 'pk-new', 'data-pk-new': '' }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'), 'Create board');
    const name = h('input', { class: 'pk-name', type: 'text', placeholder: 'Board name', 'aria-label': 'Board name', maxlength: '100', 'data-pk-name': '' });
    const secret = h('input', { type: 'checkbox', 'data-pk-secret': '' });
    const make = h('button', { type: 'button', class: 'pk-make', 'data-pk-make': '' }, 'Create');
    const cancel = h('button', { type: 'button', class: 'pk-cancel', 'data-pk-cancel': '' }, 'Cancel');
    const create = h('div', { class: 'pk-create', hidden: true },
      name, h('label', { class: 'pk-sec' }, secret, h('span', null, 'Keep this board secret')), h('div', { class: 'pk-acts' }, cancel, make));
    const el = h('div', { class: 'picker', popover: 'auto', role: 'dialog', 'aria-label': 'Save to board', 'data-picker': '' },
      h('h4', null, 'Save to board'), q, list, h('div', { class: 'pk-foot' }, newBtn), create);
    el._u = { q, list, newBtn, create, name, secret, make };
    q.addEventListener('input', () => { sel = 0; paintList(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = rows[sel]; if (r) r.click(); else if (q.value.trim()) showCreate(q.value.trim()); }
    });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); make.click(); } });
    el.addEventListener('click', onPickClick);
    // light dismiss (a click outside, Esc): the toggle event is queued, so a picker opened again meanwhile stays
    el.addEventListener('toggle', e => { let open = false; try { open = el.matches(':popover-open'); } catch {} if (e.newState === 'closed' && !open && isOpen()) cleanup(); });
    // keep Pinterest's hidden page and our own shortcuts away from the fields
    for (const t of ['keyup', 'keypress']) el.addEventListener(t, e => e.stopPropagation());
    return el;
  }
  function move(d) {
    if (!rows.length) return;
    sel = (sel + d + rows.length) % rows.length;
    paintSel(true);
  }
  function paintSel(scroll) {
    rows.forEach((r, i) => { const on = i === sel; r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); });
    if (scroll && rows[sel]) try { rows[sel].scrollIntoView({ block: 'nearest' }); } catch {}
  }
  function row(b) {
    const s = saved.get(pkId);
    const here = s && !s.pending && s.id === b.id;
    const lock = b.secret ? h('span', { class: 'lock', title: 'Secret board' }) : null;
    if (lock) lock.innerHTML = LOCK;
    return h('button', { type: 'button', class: 'pk-row', role: 'option', 'data-pk-board': b.id },
      h('span', { class: 'pk-cov' }, b.cover ? h('img', { src: b.cover, alt: '', loading: 'lazy', decoding: 'async' }) : null),
      h('span', { class: 'pk-nm' }, b.name), lock, here ? h('span', { class: 'pk-here' }, 'Saved') : null);
  }
  function paintList(note) {
    const u = pk._u, q = u.q.value.trim().toLowerCase();
    if (note) { rows = []; u.list.replaceChildren(note); return; }
    const all = boardsList;
    const kids = [];
    if (q) {
      const hit = all.filter(b => b.name.toLowerCase().includes(q));
      rows = hit.map(row);
      if (rows.length) kids.push(...rows);
      else kids.push(h('div', { class: 'pk-none', 'data-pk-none': '' }, 'No board called “' + u.q.value.trim() + '”. Enter creates it.'));
    } else {
      const rec = recentIds.map(id => all.find(b => b.id === id)).filter(Boolean).slice(0, 3);
      const rest = all.filter(b => !rec.includes(b));
      const rr = rec.map(row), ar = rest.map(row);
      rows = rr.concat(ar);
      if (rr.length) kids.push(h('div', { class: 'pk-h' }, 'Recent'), ...rr);
      if (ar.length) kids.push(h('div', { class: 'pk-h' }, 'All boards'), ...ar);
      if (!rows.length) kids.push(h('div', { class: 'pk-none', 'data-pk-none': '' }, 'No boards yet. Create one below.'));
    }
    u.list.replaceChildren(...kids);
    if (sel >= rows.length) sel = 0;
    paintSel(false);
  }
  function showCreate(prefill) {
    const u = pk._u;
    pkMode = 'create';
    u.create.hidden = false;
    u.newBtn.parentElement.hidden = true;
    u.name.value = prefill || '';
    u.name.focus();
  }
  function hideCreate() {
    const u = pk._u;
    pkMode = 'list';
    u.create.hidden = true;
    u.newBtn.parentElement.hidden = false;
    u.q.focus();
  }
  async function onPickClick(e) {
    const t = e.composedPath()[0];
    const el = t && t.closest ? t.closest('[data-pk-board],[data-pk-new],[data-pk-make],[data-pk-cancel],[data-pk-retry]') : null;
    if (!el) return;
    e.preventDefault();
    if (el.hasAttribute('data-pk-board')) {
      const b = boardsList.find(x => x.id === el.getAttribute('data-pk-board'));
      const id = pkId;
      close();
      if (b) saveTo(id, b);
    } else if (el.hasAttribute('data-pk-new')) showCreate(pk._u.q.value.trim());
    else if (el.hasAttribute('data-pk-cancel')) hideCreate();
    else if (el.hasAttribute('data-pk-retry')) load(true);
    else if (el.hasAttribute('data-pk-make')) {
      const u = pk._u, name = u.name.value.trim();
      if (!name) { u.name.focus(); return; }
      u.make.disabled = true;
      const id = pkId;
      const b = await createBoard(name, u.secret.checked);
      u.make.disabled = false;
      if (!b) return;
      close();
      saveTo(id, b);
    }
  }
  function load(force) {
    paintList(h('div', { class: 'pk-none' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' Loading your boards…'));
    const my = pkId;
    boards(force).then(r => {
      if (!isOpen() || pkId !== my) return;
      if (r.ok) { paintList(); return; }
      paintList(h('div', { class: 'pk-none', 'data-pk-err': '' }, r.kind === 'http' && r.status === 401 ? 'Sign in on Pinterest to see your boards. ' : "Your boards didn't load. ",
        h('button', { type: 'button', class: 'pk-retry', 'data-pk-retry': '' }, 'Retry')));
    });
  }
  function place(anchor) {
    const W = Math.min(320, innerWidth - 16), H = Math.min(440, innerHeight - 16);
    let x = innerWidth - W - 8, y = 8;
    try {
      const r = anchor.getBoundingClientRect();
      x = Math.min(Math.max(8, r.right - W), innerWidth - W - 8);
      y = r.bottom + 8 + H > innerHeight ? Math.max(8, r.top - 8 - H) : r.bottom + 8;
    } catch {}
    pk.style.cssText = `position:fixed;inset:auto;margin:0;left:${Math.round(x)}px;top:${Math.round(y)}px;width:${W}px;max-height:${H}px`;
  }
  function open(id, anchor) {
    id = String(id || '');
    if (!id) return;
    const sh = fast.shell.get();
    if (!sh) return;
    if (isOpen()) close();
    if (!pk) pk = build();
    // inside the viewer's modal dialog while it is open (everything outside it is inert), else the shell root
    const dlg = fast.viewer && fast.viewer.isOpen() ? fast.viewer.dialog() : null;
    const where = dlg || sh.root;
    if (pk.parentNode !== where) where.append(pk);
    pkId = id; pkAnchor = anchor || null; sel = 0;
    pk.setAttribute('data-pin-id', id);
    pk._u.q.value = '';
    pk._u.create.hidden = true; pk._u.newBtn.parentElement.hidden = false; pkMode = 'list';
    place(anchor || sh.top);
    pk.classList.add('show');
    try { pk.showPopover(); } catch { pk.classList.add('open'); }
    const card = anchor && anchor.closest && anchor.closest('.card');
    if (card) card.classList.add('picking');
    if (boardsList.length && boardsP) paintList(); else load(false);
    if (boardsP) boards();              // refresh in the background after the TTL
    try { pk._u.q.focus({ preventScroll: true }); } catch {}
    // the picker belongs to its card: a scroll of the page (not the dialog) or a change of pin closes it
    const at = scrollY;
    onScroll = () => { if (!dlg && Math.abs(scrollY - at) > 40) close(); };
    addEventListener('scroll', onScroll, { passive: true });
    pkOff = fast.ov.onChange(c => { const top = c.stack[c.stack.length - 1] || ''; if (dlg ? top !== id : c.depth) close(); });
    // the fallback without the Popover API: a click outside closes it
    if (pk.classList.contains('open')) setTimeout(() => addEventListener('pointerdown', outside, true), 0);
  }
  function outside(e) { if (pk && !e.composedPath().includes(pk)) close(); }
  function cleanup() {
    if (!pk) return;
    pk.classList.remove('show', 'open');
    if (onScroll) { removeEventListener('scroll', onScroll); onScroll = null; }
    if (pkOff) { pkOff(); pkOff = null; }
    removeEventListener('pointerdown', outside, true);
    const sh = fast.shell.get();
    if (sh) for (const c of sh.root.querySelectorAll('.card.picking')) c.classList.remove('picking');
    if (pkAnchor && pkAnchor.isConnected && pkAnchor.focus && fast.state().owned) try { pkAnchor.focus({ preventScroll: true }); } catch {}
    pkAnchor = null;
  }
  function close() {
    if (!pk) return;
    const was = isOpen();
    try { if (pk.matches(':popover-open')) pk.hidePopover(); } catch {}
    if (was) cleanup();
  }
  fast.onChange(s => { if (!s.owned) close(); });

  fast.me = me;
  fast.vtoast = vtoast;
  fast.save = {
    quick, open, close, isOpen, paint, last, me,
    boards: () => boardsList,
    state: id => saved.get(String(id)) || null,
    mode: () => pkMode
  };
})();

/* X Fast UI: the messages drawer. A slide-over <dialog> (showModal) in the shadow root over the current view; the
   view and its scroll never move. Each level is a history entry (XBB.fast.ov, dm: { c: '' } = the inbox,
   { c: <conversation id> } = one conversation), so the browser's Back goes one level back; Esc, a click beside the
   panel and the close button close it all.
     - Inbox: X's REST /i/api/1.1/dm/inbox_initial_state.json (a response X itself just got is used as is), parsed by
       XBB.model.extractDm: avatar, name, last message, time, an unread dot.
     - A conversation: its messages (the inbox's, then /i/api/1.1/dm/conversation/<id>.json), a reply box (Enter
       sends, Shift+Enter is a new line). Sending is /i/api/1.1/dm/new2.json { conversation_id, text, request_id }:
       the message shows at once and goes away again, with its text back in the box, when X refuses it.
     - Encrypted conversations (XChat) and anything we cannot load: one click to X's own page for it. The header's
       "XChat / Calls" is X's /i/chat.
   XBB.fast.messages.open() / openConversation(id) / close() / isOpen() / el() / debug() */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store;
  const R = () => fast.render;
  const FRESH = 30000;
  const INBOX_Q = { nsfw_filtering_enabled: 'false', include_profile_interstitial_type: '1', include_groups: 'true', include_conversation_info: 'true',
    supports_reactions: 'true', dm_users: 'true', include_inbox_timelines: 'true', tweet_mode: 'extended', include_ext_is_blue_verified: '1' };
  const CONV_Q = { include_conversation_info: 'true', context: 'FETCH_DM_CONVERSATION', dm_users: 'true', include_groups: 'true', tweet_mode: 'extended', supports_reactions: 'true' };

  const users = new Map();         // id -> user
  const convs = new Map();         // id -> conversation
  const msgs = new Map();          // conversation id -> Map(message id -> message)
  const inbox = { loading: false, banner: null, at: 0, order: [] };
  const convState = new Map();     // id -> { loading, banner, at, more }
  let dlg = null, panel, titleEl, backBtn, body, foot, input, sendBtn, cur = null, closingByUs = false, offTap = null;

  const meId = () => fast.me().id;
  const cs = id => { if (!convState.has(id)) convState.set(id, { loading: false, banner: null, at: 0, more: '' }); return convState.get(id); };
  const ownMap = id => { if (!msgs.has(id)) msgs.set(id, new Map()); return msgs.get(id); };
  const sorted = id => [...ownMap(id).values()].sort((a, b) => (a.time || 0) - (b.time || 0) || XBB.model.cmpSort(a.id, b.id));
  const others = c => c.participants.filter(p => p !== meId()).map(p => users.get(p)).filter(Boolean);
  const titleOf = c => c.name || others(c).map(u => u.name || u.screenName).join(', ') || 'Conversation';
  const nativeUrl = (c, id) => (c && c.encrypted ? '/i/chat/' : '/messages/') + encodeURIComponent(id);
  const unreadOf = c => !!(c.sortEventId && c.lastRead && XBB.model.cmpSort(c.sortEventId, c.lastRead) > 0);

  function takeDm(data) {
    const d = XBB.model.extractDm(data);
    if (!d.ok) return null;
    for (const id of Object.keys(d.users)) { users.set(id, d.users[id]); store.putProfile(d.users[id]); }
    for (const c of d.conversations) convs.set(c.id, Object.assign(convs.get(c.id) || {}, c));
    for (const m of d.messages) if (m.id && m.convId) {
      const map = ownMap(m.convId);
      // our own optimistic copy (same request id) is replaced by X's
      if (m.requestId) for (const [k, v] of map) if (v.pending && v.requestId === m.requestId) map.delete(k);
      map.set(m.id, m);
    }
    return d;
  }
  function takeInbox(data) {
    const d = takeDm(data);
    if (!d) return false;
    inbox.order = [...convs.values()].sort((a, b) => b.sortTime - a.sortTime || XBB.model.cmpSort(b.sortEventId, a.sortEventId)).map(c => c.id);
    inbox.at = Date.now();
    inbox.banner = null;
    return true;
  }
  const fresh = t => t && t.status >= 200 && t.status < 300 && t.data && Date.now() - (t.t || 0) < FRESH;
  function onTap(t) { if (fresh(t) && takeInbox(t.data)) paint(); }

  async function loadInbox(force) {
    if (inbox.loading || (!force && inbox.order.length && Date.now() - inbox.at < FRESH)) return;
    const t = XBB.gql.getTapped('dm_inbox');
    if (!force && fresh(t) && takeInbox(t.data)) { paint(); return; }
    inbox.loading = true; inbox.banner = null;
    paint();
    fast.extraRequests = (fast.extraRequests || 0) + 1;
    const r = await XBB.gql.rest('/i/api/1.1/dm/inbox_initial_state.json', { query: INBOX_Q });
    inbox.loading = false;
    if (!(r.ok && takeInbox(r.data))) {
      inbox.banner = r.kind === 'rate-limit' ? 'X is rate limiting requests. Try again in a minute.'
        : r.kind === 'auth' ? 'X did not accept the session.' : r.kind === 'no-main-world' ? 'Messages are not available here yet.' : 'Could not load your messages from X.';
      console.warn('[XBB fast] DM inbox failed:', r.kind, r.status);
    }
    paint();
  }
  async function loadConv(id, older) {
    const st = cs(id), c = convs.get(id);
    if (st.loading || (c && c.encrypted)) return;
    if (!older && st.at && Date.now() - st.at < FRESH) return;
    st.loading = true; st.banner = null;
    paint();
    const query = Object.assign({}, CONV_Q);
    if (older && st.more) query.max_id = st.more;
    fast.extraRequests = (fast.extraRequests || 0) + 1;
    const r = await XBB.gql.rest('/i/api/1.1/dm/conversation/' + encodeURIComponent(id) + '.json', { query });
    st.loading = false;
    const d = r.ok ? takeDm(r.data) : null;
    if (d) { st.at = Date.now(); st.more = d.status === 'HAS_MORE' ? d.minEntryId : ''; }
    else if (!ownMap(id).size) st.banner = r.kind === 'rate-limit' ? 'X is rate limiting requests. Try again in a minute.' : 'Could not load this conversation here.';
    paint();
  }

  // ---------- send ----------
  const rid = () => { try { return crypto.randomUUID(); } catch { return 'xbb-' + Date.now().toString(36) + Math.random().toString(36).slice(2); } };
  async function send() {
    const id = cur;
    const text = input.value.replace(/\s+$/, '');
    if (!id || !text.trim()) return;
    const c = convs.get(id);
    if (c && (c.encrypted || c.readOnly)) return;
    const requestId = rid();
    const tmp = { id: 'tmp-' + requestId, convId: id, senderId: meId(), time: Date.now(), text, entities: {}, media: null, requestId, pending: true };
    ownMap(id).set(tmp.id, tmp);
    input.value = '';
    autoGrow();
    paint(true);
    fast.extraRequests = (fast.extraRequests || 0) + 1;
    const r = await XBB.gql.rest('/i/api/1.1/dm/new2.json', {
      method: 'POST', query: { ext: 'mediaColor,altText,mediaStats,highlightedLabel', include_ext_alt_text: 'true', include_reply_count: '1', tweet_mode: 'extended' },
      body: { conversation_id: id, recipient_ids: false, request_id: requestId, text, cards_platform: 'Web-12', include_cards: 1, include_quote_count: true, dm_users: false }
    });
    const map = ownMap(id);
    if (r.ok) {
      const d = takeDm(r.data);
      if (map.has(tmp.id)) { if (d && d.messages.length) map.delete(tmp.id); else map.set(tmp.id, Object.assign({}, tmp, { pending: false })); }
      if (c) { c.sortTime = Date.now(); inbox.order = [id].concat(inbox.order.filter(x => x !== id)); }
    } else {
      map.delete(tmp.id);
      if (cur === id && !input.value) { input.value = text; autoGrow(); }
      fast.toast(`Couldn't send the message on X${r.kind === 'rate-limit' ? ' (rate limited)' : ''}. It was not sent.`);
    }
    if (cur === id) paint(true);
  }

  // ---------- DOM ----------
  function build(root) {
    const I = n => R().icon(n);
    backBtn = h('button', { type: 'button', class: 'dr-btn', 'data-dm': 'back', title: 'Back', 'aria-label': 'Back', hidden: true }, I('back'));
    titleEl = h('h2', null, 'Messages');
    body = h('div', { class: 'dm-body', tabindex: '-1' });
    input = h('textarea', { rows: 1, placeholder: 'Start a new message', 'aria-label': 'Message', maxlength: 10000 });
    sendBtn = h('button', { type: 'button', class: 'dm-send', 'data-dm': 'send', title: 'Send', 'aria-label': 'Send' }, I('send'));
    foot = h('form', { class: 'dm-foot', hidden: true }, input, sendBtn);
    panel = h('div', { class: 'dr-panel dm-panel', role: 'document' },
      h('header', { class: 'dr-head' }, backBtn, titleEl, h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'dr-btn dr-native', 'data-dm': 'chat', title: "X's own XChat and calls" }, I('chat'), h('span', null, 'XChat / Calls on X')),
        h('button', { type: 'button', class: 'dr-btn', 'data-dm': 'close', title: 'Close (Esc)', 'aria-label': 'Close' }, I('close'))),
      body, foot);
    dlg = h('dialog', { class: 'drawer dm', 'aria-label': 'Messages' }, panel);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (e.composedPath ? e.composedPath()[0] : e.target) === input) { e.preventDefault(); send(); }
    });
    foot.addEventListener('submit', e => { e.preventDefault(); send(); });
    input.addEventListener('input', autoGrow);
    dlg.addEventListener('wheel', e => { if ((e.composedPath ? e.composedPath()[0] : e.target) === dlg) e.preventDefault(); }, { passive: false });
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.addEventListener('close', () => { if (!closingByUs && !dlg.open && fast.ov.get().dm) { fast.rescope(); fast.ov.closeAll(); } });
    root.append(dlg);
  }
  function autoGrow() { if (!input) return; input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight || 40) + 'px'; }

  function convRow(c) {
    const o = others(c), u = o[0];
    const ms = sorted(c.id), last = ms[ms.length - 1];
    const who = last && last.senderId === meId() ? 'You: ' : '';
    const preview = c.encrypted ? 'Encrypted conversation' : last ? who + (last.text || (last.media ? 'Sent a photo' : 'Message')) : '';
    const av = u ? R().avatar(u) : h('span', { class: 'av ini' }, (c.name || '?').slice(0, 1).toUpperCase());
    return h('div', { class: 'dm-conv' + (unreadOf(c) ? ' unread' : ''), role: 'listitem', tabindex: '0', 'data-dm-conv': c.id },
      av, h('div', { class: 'dm-c-body' },
        h('div', { class: 'dm-c-head' }, h('b', null, titleOf(c)), u && !c.group ? R().badge(u) : null,
          u && !c.group ? h('span', { class: 'handle' }, '@' + u.screenName) : null,
          c.sortTime ? h('span', { class: 'when' }, '· ' + R().rel(c.sortTime)) : null),
        h('div', { class: 'dm-c-last', dir: 'auto' }, c.encrypted ? R().icon('lock', 'i lock') : null, preview)),
      unreadOf(c) ? h('span', { class: 'dm-dot', 'aria-label': 'Unread' }) : null);
  }
  function bubble(m) {
    const mine = m.senderId && m.senderId === meId();
    let text;
    try { text = R().rich({ text: m.text, entities: m.entities || {} }); } catch { text = document.createTextNode(m.text || ''); }
    const sender = !mine ? users.get(m.senderId) : null;
    return h('div', { class: 'dm-msg' + (mine ? ' mine' : '') + (m.pending ? ' pending' : ''), 'data-mid': m.id },
      sender && convs.get(m.convId) && convs.get(m.convId).group ? h('div', { class: 'dm-from' }, sender.name || sender.screenName) : null,
      m.text ? h('div', { class: 'dm-bub', dir: 'auto' }, text) : null,
      m.media ? h('a', { class: 'dm-media', href: nativeUrl(convs.get(m.convId), m.convId), 'data-dm-native': nativeUrl(convs.get(m.convId), m.convId) }, R().icon('eye'), m.media.type === 'photo' ? 'Photo: open on X' : 'Video: open on X') : null,
      h('div', { class: 'dm-time' }, m.pending ? 'Sending…' : m.time ? R().rel(m.time) : ''));
  }
  const nativeBanner = (msg, url, retry) => h('div', { class: 'fd-banner', 'data-kind': 'learn', role: 'status' }, h('span', null, msg),
    h('span', { class: 'fd-acts' }, retry ? h('button', { class: 'btn', type: 'button', 'data-dm': 'retry' }, 'Retry') : null,
      h('button', { class: 'btn primary', type: 'button', 'data-dm-native': url }, 'Open on X', R().icon('ext'))));

  function paint(toEnd) {
    if (!dlg || !dlg.open) return;
    const kids = [];
    if (!cur) {
      titleEl.textContent = 'Messages';
      backBtn.hidden = true;
      foot.hidden = true;
      if (inbox.banner) kids.push(nativeBanner(inbox.banner, '/messages', true));
      if (inbox.order.length) kids.push(h('div', { class: 'dm-list', role: 'list' }, inbox.order.map(id => convs.get(id)).filter(Boolean).map(convRow)));
      else if (inbox.loading) kids.push(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' }));
      else if (!inbox.banner) kids.push(h('div', { class: 'empty' }, 'No messages yet.'));
      body.replaceChildren(...kids);
      return;
    }
    const c = convs.get(cur), st = cs(cur);
    titleEl.textContent = c ? titleOf(c) : 'Conversation';
    backBtn.hidden = false;
    if (c && c.encrypted) {
      foot.hidden = true;
      kids.push(nativeBanner('This conversation is end-to-end encrypted (XChat): only X\'s own app can open it.', nativeUrl(c, cur), false));
    } else {
      foot.hidden = !!(c && c.readOnly);
      if (st.more) kids.push(h('button', { class: 'btn more', type: 'button', 'data-dm': 'older' }, st.loading ? 'Loading…' : 'Older messages'));
      const ms = sorted(cur);
      if (ms.length) kids.push(h('div', { class: 'dm-thread', role: 'log', 'aria-live': 'polite' }, ms.map(bubble)));
      else if (st.loading) kids.push(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' }));
      if (st.banner) kids.push(nativeBanner(st.banner, nativeUrl(c, cur), true));
    }
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    body.replaceChildren(...kids);
    if (toEnd || atEnd) body.scrollTop = body.scrollHeight;
  }

  function onClick(e) {
    if (e.button !== 0) return;
    const p = e.composedPath ? e.composedPath() : [e.target];
    const t = p[0] && p[0].nodeType === 1 ? p[0] : e.target;
    if (t === dlg) { e.preventDefault(); e.stopPropagation(); close(); return; }    // the backdrop
    const nat = t.closest('[data-dm-native]');
    if (nat) { e.preventDefault(); e.stopPropagation(); fast.toNative(nat.dataset.dmNative); return; }
    const b = t.closest('[data-dm]');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      const k = b.dataset.dm;
      if (k === 'close') close();
      else if (k === 'back') fast.ov.back(1);
      else if (k === 'chat') fast.toNative('/i/chat');
      else if (k === 'send') send();
      else if (k === 'retry') { if (cur) { cs(cur).at = 0; loadConv(cur); } else loadInbox(true); }
      else if (k === 'older' && cur) loadConv(cur, true);
      return;
    }
    const cv = t.closest('[data-dm-conv]');
    if (cv) { e.preventDefault(); e.stopPropagation(); openConversation(cv.dataset.dmConv); return; }
    // a profile link in a message: that profile, the drawer closes (the entry stays for Back)
    const a = t.closest('a[href]');
    if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && a.target !== '_blank') {
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
      if (u.origin !== location.origin) return;
      e.preventDefault(); e.stopPropagation();
      fast.go(u.pathname + u.search);
    }
  }

  // ---------- following the history entry ----------
  function sync(c) {
    const dm = c.dm;
    if (!dm || c.drawer.length || c.lb) {
      if (!dm) { if (dlg && dlg.open) { closingByUs = true; try { dlg.close(); } catch {} closingByUs = false; fast.rescope(); } cur = null; }
      return;
    }
    const sh = fast.shell && fast.shell.get();
    if (!sh) return;
    if (!dlg || !dlg.isConnected) build(sh.root);
    if (!offTap) offTap = XBB.gql.onTap('dm_inbox', onTap);
    const was = cur;
    cur = dm.c || null;
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    fast.rescope();
    paint(cur !== was);
    if (cur) {
      // the conversation on screen is read: its dot goes
      const cv = convs.get(cur);
      if (cv && cv.sortEventId) cv.lastRead = cv.sortEventId;
      loadConv(cur);
      if (!cv) loadInbox();
      try { input.focus({ preventScroll: true }); } catch {}
    } else {
      loadInbox();
      try { body.focus({ preventScroll: true }); } catch {}
    }
  }
  fast.ov.onChange(sync);

  function open() {
    const c = fast.ov.get();
    if (c.dm && !c.drawer.length && !c.lb) { if (c.dm.c) fast.ov.back(1); return true; }
    if (fast.notifications) fast.notifications.close();
    return fast.ov.push({ drawer: [], lb: null, dm: { c: '' } });
  }
  function openConversation(id) {
    id = String(id || '');
    if (!/^[\w:-]{1,80}$/.test(id)) return false;
    const c = fast.ov.get();
    if (c.dm && c.dm.c === id) return true;
    const next = { drawer: [], lb: null, dm: { c: id } };
    return c.dm && c.dm.c ? fast.ov.replace(next) : fast.ov.push(next);
  }
  function close() {
    const c = fast.ov.get();
    if (c.dm) fast.ov.closeAll();
    else if (dlg && dlg.open) { closingByUs = true; try { dlg.close(); } catch {} closingByUs = false; }
  }

  fast.messages = {
    open, openConversation, close,
    isOpen: () => !!(dlg && dlg.open),
    el: () => dlg,
    debug: () => ({ open: !!(dlg && dlg.open), cur, convs: inbox.order.length, msgs: cur ? sorted(cur).map(m => ({ id: m.id, text: m.text, pending: !!m.pending })) : null, banner: cur ? cs(cur).banner : inbox.banner, encrypted: !!(cur && convs.get(cur) && convs.get(cur).encrypted) })
  };
})();

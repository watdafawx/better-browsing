/* Pinterest Fast UI: the API layer over Pinterest's resource endpoints (/resource/<Name>/<action>/).
     PIN.fast.api.call(name, overrides, { source, handler, guard, signal }) -> Promise<{ ok, kind, status, data,
       bookmark, message }>, never throws. The options sent are the template Pinterest itself last sent for that
       resource (localStorage['pin-ops-v1'], learned by main-world-api.js) with `overrides` on top; without one, the
       verified fallback below. The headers are Pinterest's own: x-pinterest-source-url, x-pinterest-pws-handler,
       X-APP-VERSION when learned. `kind`: 'ok' | 'http' | 'failure' (envelope status failure / "Invalid Request") |
       'schema' (guard(data) false) | 'network' | 'breaker' (open: not sent at all).
     PIN.fast.api.breaker   per resource: ok(name), state(name), reset(name), onChange(fn(name, st)). 400/403/404, a
       failure envelope, "Invalid Request" or a schema failure open it; five transient failures in a row open it too;
       401/429 do not. A tapped 2xx of Pinterest's own for that resource closes it again.
     PIN.fast.api.getTapped(name, { maxAge, first }) / onTap(fn)   the last 20 responses tapped from Pinterest's own
       requests (pin-api-tap); `first`: only a first page (no bookmarks in its options).
     PIN.fast.api.learned(name), ready()   what pin-ops-v1 holds; ready() = Home's template and handler are known.
     PIN.fast.api.tap(on)   <html data-pin-api-tap>: main-world-api.js hands responses over only while it is set.
     PIN.fast.api.csrf()    the csrftoken cookie (POSTs send it as X-CSRFToken)
   At most 2 of our requests are in flight; the rest wait in a queue. Failures are never cached. */
(() => {
  const fast = PIN.fast = PIN.fast || {};
  const root = document.documentElement;
  const LS = 'pin-ops-v1';

  // Fallback templates: what a real session sent (PinResource and comments verified, see README), the rest from
  // FAST-UI-PLAN.md §3.2; a learned template always wins.
  const FALLBACK = {
    'UserHomefeedResource/get': { options: { field_set_key: 'hf_grid', in_nux: false, in_news_hub: false, static_feed: false }, source: '/', handler: 'www/index.js' },
    'PinResource/get': { options: { field_set_key: 'auth_web_main_pin', noCache: true }, source: '/pin/{id}/', handler: 'www/pin/[id].js' },
    'UnifiedCommentsResource/get': { options: { comment_featured_ids: [], page_size: 10, redux_normalize_feed: true, is_reversed: false }, source: '/pin/{id}/', handler: 'www/pin/[id].js' },
    'RelatedModulesResource/get': { options: { context_pin_ids: [], search_query: '', source: 'deep_linking', top_level_source: 'deep_linking' }, source: '/pin/{id}/', handler: 'www/pin/[id].js' },
    // M2 (FAST-UI-PLAN.md §3.2; a learned template wins)
    'BaseSearchResource/get': { options: { scope: 'pins', auto_correction_disabled: false, page_size: 25, redux_normalize_feed: true, rs: 'typed' }, source: '/search/pins/?q={q}&rs=typed', handler: 'www/search/[scope].js' },
    'UserResource/get': { options: { field_set_key: 'profile' }, source: '/{username}/', handler: 'www/[username].js' },
    'BoardsResource/get': { options: { page_size: 25, privacy_filter: 'all', sort: 'last_pinned_to', field_set_key: 'profile_grid_item' }, source: '/{username}/_saved/', handler: 'www/[username]/_saved.js' },
    'UserPinsResource/get': { options: { page_size: 25, field_set_key: 'grid_item' }, source: '/{username}/_created/', handler: 'www/[username]/_created.js' },
    'BoardResource/get': { options: { field_set_key: 'detailed' }, source: '/{username}/{slug}/', handler: 'www/[username]/[slug].js' },
    'BoardFeedResource/get': { options: { page_size: 25, field_set_key: 'react_grid_pin' }, source: '/{username}/{slug}/', handler: 'www/[username]/[slug].js' },
    // the signed-in user's boards for the Save picker (BoardsResource for that user is the fallback, save.js)
    'BoardPickerBoardsResource/get': { options: { field_set_key: 'board_picker', filter: 'all', sort: 'last_pinned_to' }, source: '/', handler: 'www/index.js' },
    'RepinResource/create': { options: { section_id: null, description: '', is_buyable_pin: false, carousel_slot_index: 0 }, source: '/pin/{id}/', handler: 'www/pin/[id].js' },
    'BoardResource/create': { options: { description: '', collab_board_email: false }, source: '/', handler: 'www/index.js' }
  };
  // keys of a learned template that belong to that one request (ids, paging, the query, the user), never reused for
  // another
  const PER_CALL = ['bookmarks', 'id', 'pin_id', 'aggregated_pin_id', 'pin_ids', 'context_pin_ids', 'query', 'username', 'slug',
    'board_id', 'board_url', 'source_url', 'name', 'title', 'description', 'privacy', 'link', 'section_id'];

  // ---------- learned templates ----------
  let ops = null;
  const readOps = () => { try { const c = JSON.parse(localStorage.getItem(LS) || 'null'); ops = c && c.v === 1 && c.ops && typeof c.ops === 'object' ? c : { v: 1, ops: {} }; } catch { ops = { v: 1, ops: {} }; } return ops; };
  const learned = name => { const o = (ops || readOps()).ops[name]; return o && typeof o === 'object' ? o : null; };
  const ready = () => { const o = readOps().ops['UserHomefeedResource/get']; return !!(o && o.options && typeof o.options === 'object' && o.handler); };
  addEventListener('storage', e => { if (e.key === LS) ops = null; });

  // ---------- breaker ----------
  const bStates = new Map(), bListeners = new Set();
  const COOLDOWN = 5 * 60 * 1000;
  const bGet = name => bStates.get(name) || { state: 'closed', fails: 0, kind: '', status: 0, at: 0 };
  function bSet(name, st) { bStates.set(name, st); for (const fn of [...bListeners]) { try { fn(name, st); } catch (e) { console.error('[PIN fast]', e); } } }
  const breaker = {
    ok(name) { const s = bGet(name); return s.state !== 'open' || Date.now() - s.at > COOLDOWN; },
    state: name => Object.assign({}, bGet(name)),
    reset(name) { if (name) { if (bStates.has(name)) bSet(name, { state: 'closed', fails: 0, kind: '', status: 0, at: 0 }); } else for (const k of [...bStates.keys()]) breaker.reset(k); },
    onChange(fn) { bListeners.add(fn); return () => bListeners.delete(fn); },
    open(name, kind, status) { bSet(name, { state: 'open', fails: bGet(name).fails, kind, status: status || 0, at: Date.now() }); }
  };
  function record(name, res) {
    const s = bGet(name);
    if (res.ok) { if (s.state !== 'closed' || s.fails) bSet(name, { state: 'closed', fails: 0, kind: '', status: 0, at: 0 }); return; }
    if (res.kind === 'http' && (res.status === 401 || res.status === 429)) return;
    const hard = res.kind === 'failure' || res.kind === 'schema' || (res.kind === 'http' && [400, 403, 404].includes(res.status));
    const fails = s.fails + 1;
    if (hard || fails >= 5) breaker.open(name, res.kind, res.status);
    else bStates.set(name, Object.assign({}, s, { fails }));
  }

  // ---------- requests ----------
  // In Firefox's content realm the page's own fetch (content.fetch) sends the request as the page does; in the page
  // world (userscript) the unwrapped fetch, so main-world-api.js never taps our own calls.
  const doFetch = (() => {
    try { if (typeof content !== 'undefined' && content && typeof content.fetch === 'function') return content.fetch.bind(content); } catch {}
    const raw = window.__pinRawFetch;
    return typeof raw === 'function' ? raw.bind(window) : fetch.bind(globalThis);
  })();
  let inFlight = 0;
  const queue = [];
  const slot = () => new Promise(res => { if (inFlight < 2) { inFlight++; res(); } else queue.push(res); });
  const free = () => { const next = queue.shift(); if (next) next(); else inFlight--; };

  const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] == null ? '' : vars[k]));
  function build(name, overrides, opts) {
    const fb = FALLBACK[name] || { options: {}, source: location.pathname, handler: '' };
    const l = learned(name);
    const base = Object.assign({}, (l && l.options && typeof l.options === 'object') ? l.options : fb.options);
    const hadSrc = Object.prototype.hasOwnProperty.call(base, 'source_url');
    for (const k of PER_CALL) delete base[k];
    const options = Object.assign(base, overrides || {});
    const vars = Object.assign({ id: options.id || options.pin_id || '' }, opts.vars || {});
    const source = opts.source || fill(fb.source, vars) || (l && l.source) || location.pathname;
    // Pinterest repeats the page URL inside some options (search): ours, never the learned one's
    if (hadSrc && !(overrides && 'source_url' in overrides)) options.source_url = source;
    const handler = opts.handler || (l && l.handler) || fb.handler;
    return { options, source, handler, appVersion: (l && l.appVersion) || (ops && ops.appVersion) || '' };
  }
  const csrf = () => { try { const m = /(?:^|;\s*)csrftoken=([^;]*)/.exec(document.cookie || ''); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } };

  // opts.method 'POST' (RepinResource/create, BoardResource/create): the same pair form-encoded in the body, and the
  // csrftoken cookie as X-CSRFToken, the way Pinterest's own app writes
  async function call(name, overrides, opts = {}) {
    if (!breaker.ok(name)) return { ok: false, kind: 'breaker', status: 0, data: null, bookmark: '', message: 'breaker open' };
    const b = build(name, overrides, opts);
    const post = opts.method === 'POST';
    const pair = 'source_url=' + encodeURIComponent(b.source) + '&data=' + encodeURIComponent(JSON.stringify({ options: b.options, context: {} }));
    const headers = { Accept: 'application/json, text/javascript, */*, q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-AppState': 'active', 'x-pinterest-source-url': b.source };
    if (b.handler) headers['x-pinterest-pws-handler'] = b.handler;
    if (b.appVersion) headers['X-APP-VERSION'] = b.appVersion;
    if (post) { headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; const t = csrf(); if (t) headers['X-CSRFToken'] = t; }
    await slot();
    let res;
    try {
      const r = await doFetch(location.origin + '/resource/' + name + '/' + (post ? '' : '?' + pair + '&_=' + Date.now()),
        post ? { method: 'POST', credentials: 'include', headers, body: pair, signal: opts.signal } : { credentials: 'include', headers, signal: opts.signal });
      const status = r.status;
      let text = '';
      try { text = await r.text(); } catch {}
      res = interpret(text, status, opts.guard);
    } catch (e) {
      res = { ok: false, kind: e && e.name === 'AbortError' ? 'abort' : 'network', status: 0, data: null, bookmark: '', message: String(e && e.message || e) };
    } finally { free(); }
    if (res.kind !== 'abort') record(name, res);
    if (!res.ok && res.kind !== 'abort') console.warn('[PIN fast]', name, res.kind, res.status, res.message || '');
    return res;
  }

  // A response text (ours or tapped) -> the call's result
  function interpret(text, status, guard) {
    let j = null;
    try { j = JSON.parse(text || 'null'); } catch {}
    const rr = j && typeof j === 'object' ? j.resource_response : null;
    const message = String((rr && (rr.message || (rr.error && rr.error.message))) || '').slice(0, 200);
    if (status < 200 || status >= 300) {
      // Pinterest answers some bad requests with a failure envelope and a 4xx
      return { ok: false, kind: /invalid request/i.test(message) ? 'failure' : 'http', status, data: null, bookmark: '', message };
    }
    if (!rr || typeof rr !== 'object') return { ok: false, kind: 'schema', status, data: null, bookmark: '', message: 'no resource_response' };
    if (rr.status === 'failure' || /invalid request/i.test(message)) return { ok: false, kind: 'failure', status, data: null, bookmark: '', message };
    const data = rr.data;
    if (guard && !guard(data)) return { ok: false, kind: 'schema', status, data: null, bookmark: '', message: 'schema guard' };
    const bm = typeof rr.bookmark === 'string' ? rr.bookmark : typeof (j.resource && j.resource.options && j.resource.options.bookmarks && j.resource.options.bookmarks[0]) === 'string' ? j.resource.options.bookmarks[0] : '';
    return { ok: true, kind: 'ok', status, data, bookmark: bm, message: '' };
  }

  // ---------- the passive tap (Pinterest's own responses) ----------
  const ring = [], tapListeners = new Set();
  document.addEventListener('pin-api-tap', e => {
    let d = null;
    try { d = JSON.parse(typeof e.detail === 'string' ? e.detail : ''); } catch {}
    if (!d || typeof d.name !== 'string') return;
    const res = interpret(d.body, +d.status || 0, null);
    const entry = { name: d.name, options: d.options && typeof d.options === 'object' ? d.options : {}, t: Date.now(), res };
    ring.push(entry);
    if (ring.length > 20) ring.shift();
    ops = null;                                       // main-world-api.js may have learned a new template
    if (res.ok && bGet(d.name).state === 'open') breaker.reset(d.name);
    for (const fn of [...tapListeners]) { try { fn(entry); } catch (err) { console.error('[PIN fast]', err); } }
  });
  function getTapped(name, { maxAge = 60000, first = false } = {}) {
    for (let i = ring.length - 1; i >= 0; i--) {
      const e = ring[i];
      if (e.name !== name || Date.now() - e.t > maxAge) continue;
      if (first && Array.isArray(e.options.bookmarks) && e.options.bookmarks.length) continue;
      return e;
    }
    return null;
  }
  const tap = on => { if (on) { if (!root.hasAttribute('data-pin-api-tap')) root.setAttribute('data-pin-api-tap', ''); } else if (root.hasAttribute('data-pin-api-tap')) root.removeAttribute('data-pin-api-tap'); };

  fast.api = {
    call, breaker, getTapped, onTap(fn) { tapListeners.add(fn); return () => tapListeners.delete(fn); },
    learned, ready, tap, interpret, FALLBACK, csrf,
    // the number of our own requests so far, per resource (tests, PIN.perf)
    stats: { calls: {} }
  };
  const origCall = call;
  fast.api.call = (name, ...rest) => { fast.api.stats.calls[name] = (fast.api.stats.calls[name] || 0) + 1; return origCall(name, ...rest); };
})();

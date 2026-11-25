/* X Fast UI: the content-script side of the GraphQL bridge (Milestone 1). Talks to main-world-api.js only
   through CustomEvents on `document` whose detail is a JSON string (objects do not cross Firefox's Xray wrappers):
     XBB.gql.call(op, variables, opts)   ask the page world to run a GraphQL operation as X's own client would
     XBB.gql.status(opts)                what the page world has learned: ops, session headers, txid, webpack
     XBB.gql.onTap(op, fn) / getTapped(op)   responses X itself got for its timeline/detail/profile/search calls
     XBB.gql.enableTap(on)               tapping costs the page a clone + JSON parse per response: off until wanted
                                         (on while the `fastUi` setting is on, or something subscribed)
     XBB.gql.breaker                     per-operation circuit breaker; an open breaker means "show native X"
   `call` never throws and never rejects: it resolves { ok, kind, status, data, ... }. `kind` classifies a failure:
     missing-op   the harvester has no queryId for the op (X renamed or dropped it)      trips the breaker
     drift        400/403/404, or a 200 whose only content is a GraphQL validation error  trips the breaker
     auth         401, or no captured session headers yet                                 does not trip
     rate-limit   429                                                                     does not trip
     server / network / timeout   transient; 5 in a row trip the breaker ('unstable')
     breaker-open / no-main-world / parse / graphql-error   (see below)                    do not trip */
(() => {
  const root = document.documentElement;
  const TAP_ATTR = 'data-xbb-api-tap';
  const RING = 4;                       // tapped responses kept per op
  const COOLDOWN = 10 * 60 * 1000;      // an open breaker lets one probe call through after this long
  const SOFT_TRIP = 5;                  // consecutive transient failures that open a breaker

  const gql = XBB.gql = {};
  const parse = d => { try { return typeof d === 'string' ? JSON.parse(d) : null; } catch { return null; } };
  const available = () => root.hasAttribute('data-xbb-api-main');
  gql.available = available;

  // ---------- request / response ----------
  const pending = new Map();
  let seq = 0;
  document.addEventListener('xbb-api-res', e => {
    let r; try { r = parse(e.detail); } catch { r = null; }
    const fn = r && pending.get(r.id);
    if (fn) { pending.delete(r.id); fn(r); }
  });
  const send = (msg, timeout) => new Promise(resolve => {
    const id = 'r' + (++seq) + '.' + Math.random().toString(36).slice(2, 8);
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, status: 0, error: 'timeout' }); }, timeout);
    pending.set(id, r => { clearTimeout(timer); resolve(r); });
    try { document.dispatchEvent(new CustomEvent('xbb-api-req', { detail: JSON.stringify(Object.assign({}, msg, { id })) })); }
    catch { clearTimeout(timer); pending.delete(id); resolve({ ok: false, status: 0, error: 'send-failed' }); }
  });

  gql.status = async (opts = {}) => {
    if (!available()) return { ok: false, error: 'no-main-world' };
    const r = await send({ type: 'status', scan: !!opts.scan }, opts.timeout || 8000);
    return r.ok ? Object.assign({ ok: true }, r.data) : { ok: false, error: r.error || 'failed' };
  };

  // ---------- circuit breaker ----------
  const states = new Map();             // op -> { op, state, kind, status, queryId, reason, t, count, soft, probing }
  const listeners = new Set();
  const drift = [];
  const fire = op => { for (const fn of listeners) { try { fn(op, gql.breaker.get(op)); } catch (e) { console.error('[XBB]', e); } } };
  const copy = s => s ? { op: s.op, state: s.state, kind: s.kind, status: s.status, queryId: s.queryId, reason: s.reason, t: s.t, count: s.count } : null;
  const cooled = s => Date.now() - s.t >= COOLDOWN;

  gql.breaker = {
    // 'closed' | 'open' | 'half-open' (cooled down: one probe call may go through)
    state(op) { const s = states.get(op); return !s ? 'closed' : (s.state === 'open' && cooled(s)) ? 'half-open' : s.state; },
    // null while closed (a closed entry only holds the count of recent transient failures)
    get(op) { const s = states.get(op); return s && s.state === 'open' ? Object.assign(copy(s), { state: gql.breaker.state(op) }) : null; },
    isOpen(op) { return gql.breaker.state(op) === 'open'; },
    // Should the UI use the fast path for this op? Same as "not open".
    ok(op) { return gql.breaker.state(op) !== 'open'; },
    trip(op, info = {}) {
      const s = states.get(op) || { op, count: 0, soft: 0 };
      Object.assign(s, { state: 'open', kind: info.kind || 'drift', status: info.status || 0, queryId: info.queryId || '', reason: info.reason || '', t: Date.now(), probing: false });
      s.count++;
      states.set(op, s);
      drift.push({ t: s.t, op, kind: s.kind, status: s.status, queryId: s.queryId, reason: s.reason });
      if (drift.length > 30) drift.shift();
      fire(op);
    },
    reset(op) {
      if (op === undefined) { for (const k of [...states.keys()]) gql.breaker.reset(k); return; }
      if (states.delete(op)) fire(op);
    },
    all() { return [...states.keys()].map(k => gql.breaker.get(k)).filter(Boolean); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
  // What went wrong and when: queryId rotations, features X now rejects. For a bug report or a status line.
  gql.getDrift = () => drift.slice();

  // ---------- classification ----------
  const VALIDATION = /validation|unknown (?:variable|argument|field)|variable|must be defined|feature|invalid query|persisted/i;
  function classify(res) {
    const d = res.data;
    if (res.error === 'missing-op') return 'missing-op';
    if (res.error === 'no-auth') return 'auth';
    if (res.error === 'timeout') return 'timeout';
    if (res.error === 'network' || res.error === 'send-failed') return 'network';
    if (res.error === 'non-json') return 'parse';
    const s = res.status | 0;
    if (s === 401) return 'auth';
    if (s === 429) return 'rate-limit';
    if (s === 400 || s === 403 || s === 404) return 'drift';
    if (s >= 500) return 'server';
    if (s >= 200 && s < 300) {
      // 200 with errors and nothing else: a rejected query (renamed field, unknown feature flag), or just "no such user"
      const errs = d && Array.isArray(d.errors) ? d.errors : [];
      const empty = !d || d.data === null || d.data === undefined || (typeof d.data === 'object' && Object.keys(d.data).length === 0);
      if (errs.length && empty) {
        const bad = errs.some(e => e && (VALIDATION.test(String(e.message || '')) || /VALIDATION|BAD_USER_INPUT/i.test(String(e.extensions && e.extensions.code || e.code || ''))));
        return bad ? 'drift' : 'graphql-error';
      }
      return 'ok';
    }
    return 'drift';   // 3xx/4xx we do not know: do not keep hammering
  }
  const messageOf = res => {
    const e = res.data && Array.isArray(res.data.errors) && res.data.errors[0];
    return (e && e.message) || res.error || ('HTTP ' + res.status);
  };

  // ---------- call ----------
  gql.call = async function call(op, variables, opts = {}) {
    const fail = (kind, extra) => Object.assign({ ok: false, kind, op, status: 0, data: null }, extra);
    if (typeof op !== 'string' || !op) return fail('missing-op', { error: 'no operation name' });
    const s = states.get(op);
    if (!opts.force && s && s.state === 'open') {
      if (!cooled(s)) return fail('breaker-open', { breaker: gql.breaker.get(op) });
      if (s.probing) return fail('breaker-open', { breaker: gql.breaker.get(op) });
      s.probing = true;                 // half-open: this call is the one probe
    }
    if (!available()) { if (s) s.probing = false; return fail('no-main-world'); }
    const timeout = opts.timeout || 15000;
    const res = await send({ op, variables: variables || {}, method: opts.method, extraHeaders: opts.headers, features: opts.features, fieldToggles: opts.fieldToggles, timeout }, timeout + 3000);
    const kind = classify(res);
    const st = states.get(op);
    const base = { op, status: res.status | 0, data: res.data ?? null, queryId: res.queryId || '', txid: !!res.txid };
    if (kind === 'ok') {
      if (st) { if (st.state === 'open') gql.breaker.reset(op); else st.soft = 0; }
      return Object.assign(base, { ok: true, kind });
    }
    const info = { kind, status: base.status, queryId: base.queryId, reason: messageOf(res) };
    if (kind === 'drift' || kind === 'missing-op') gql.breaker.trip(op, info);
    else if (kind === 'server' || kind === 'network' || kind === 'timeout') {
      const t = st || { op, state: 'closed', count: 0, soft: 0 };
      t.soft = (t.soft || 0) + 1; t.probing = false;
      states.set(op, t);
      if (t.soft >= SOFT_TRIP) gql.breaker.trip(op, Object.assign(info, { kind: 'unstable' }));
    } else if (st) st.probing = false;
    const out = Object.assign(base, { ok: false, kind, error: res.error || messageOf(res) });
    if (res.rateLimitReset) out.rateLimitReset = res.rateLimitReset;
    return out;
  };

  // ---------- passive taps ----------
  const tapped = new Map();             // op -> [newest last]
  const subs = new Map();               // op ('*' = any) -> Set(fn)
  const reasons = new Set();
  const syncTap = () => { if (reasons.size) { if (!root.hasAttribute(TAP_ATTR)) root.setAttribute(TAP_ATTR, '1'); } else root.removeAttribute(TAP_ATTR); };
  const want = (why, on) => { if (on) reasons.add(why); else reasons.delete(why); syncTap(); };

  gql.enableTap = (on = true) => want('api', !!on);
  gql.onTap = (op, fn) => {
    const key = op || '*';
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
    want('sub', true);
    return () => {
      const set = subs.get(key);
      if (set) { set.delete(fn); if (!set.size) subs.delete(key); }
      want('sub', subs.size > 0);
    };
  };
  // Newest tapped response for an op (undefined if none), or the whole ring with { all: true }; no op: a map of the newest
  gql.getTapped = (op, o) => {
    if (op === undefined) { const m = {}; for (const [k, v] of tapped) m[k] = v[v.length - 1]; return m; }
    const r = tapped.get(op);
    return o && o.all ? (r ? r.slice() : []) : (r ? r[r.length - 1] : undefined);
  };
  gql.clearTapped = op => { if (op === undefined) tapped.clear(); else tapped.delete(op); };

  document.addEventListener('xbb-api-tap', e => {
    const t = parse(e.detail);
    if (!t || typeof t.op !== 'string') return;
    let ring = tapped.get(t.op);
    if (!ring) tapped.set(t.op, ring = []);
    ring.push(t);
    if (ring.length > RING) ring.shift();
    // X itself now uses another queryId than the one that failed for us: the drift is over, try again
    const b = states.get(t.op);
    if (b && b.state === 'open' && b.queryId && t.queryId && b.queryId !== t.queryId) gql.breaker.reset(t.op);
    for (const key of [t.op, '*']) {
      const set = subs.get(key);
      if (set) for (const fn of [...set]) { try { fn(t); } catch (err) { console.error('[XBB]', err); } }
    }
  });

  // Opt-in: tapping runs while the Fast UI setting is on
  XBB.onSettings(s => want('setting', !!s.fastUi));
})();

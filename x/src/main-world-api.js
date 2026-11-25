/* X Fast UI engine, page-world half (Milestone 1). Runs in the PAGE's JS world, next to main-world.js.
   It never hardcodes a GraphQL query ID: X rotates them on every deploy. Instead it
     1. HARVESTS them from X's own webpack chunks (`window.webpackChunk_twitter_responsive_web`): every module
        factory that carries `{queryId, operationName, operationType, metadata:{featureSwitches, fieldToggles}}`,
        by reading its source (cheap, no module is executed) and, once webpack's `require` is known, the exports
        of modules that already ran. Found ops are kept in memory and in localStorage['xbb-gql-ops-v1'].
     2. TAPS fetch and XMLHttpRequest, passively: it learns the live session headers (authorization, csrf, ...) and
        the `{queryId, features, fieldToggles}` X itself sends, and (when the content script asked for it) hands
        timeline/detail/profile/search/bookmark responses to the content script.
     3. EXECUTES calls the content script asks for with what 1. and 2. learned.
   Talks to content/api.js only through CustomEvents on `document` whose `detail` is a JSON STRING (an object made
   in the other realm is unreadable across Firefox's Xray wrappers; a string always crosses):
     xbb-api-req  content -> page   { id, op, variables, method, extraHeaders, ... } or { id, type: 'status' }
     xbb-api-res  page -> content   { id, ok, status, data, error, queryId }
     xbb-api-tap  page -> content   { op, queryId, variables, status, t, data }   (only while <html data-xbb-api-tap>)
   Idle cost: a wrapper per fetch/XHR that does one indexOf, and the webpack array hook. Scanning module sources
   only happens when asked (first call, or while tapping is on). Everything of ours is in try/catch: it must
   never break X's own requests. */
(() => {
  if (window.__xbbApiMainWorld) return;
  window.__xbbApiMainWorld = true;

  const root = document.documentElement;
  const LS_KEY = 'xbb-gql-ops-v1';
  const WP_KEY = 'webpackChunk_twitter_responsive_web';
  const TAP_ATTR = 'data-xbb-api-tap';
  const GQL = /\/i\/api\/graphql\/([\w-]+)\/(\w+)/;
  const VALID_ID = /^[\w-]{8,64}$/;
  const TAP_OPS = new Set(['HomeTimeline', 'HomeLatestTimeline', 'TweetDetail', 'UserByScreenName', 'UserTweets',
    'UserTweetsAndReplies', 'UserMedia', 'Likes', 'Bookmarks', 'SearchTimeline']);
  // Headers that make up "the session". Anything else X sends is X's business.
  const SESSION_HEADERS = ['authorization', 'x-csrf-token', 'x-twitter-auth-type', 'x-twitter-client-language',
    'x-xp-forwarded-for', 'x-twitter-active-user'];
  const noop = () => {};
  const isObj = v => v !== null && typeof v === 'object';
  const origFetch = window.fetch;
  const fnToString = Function.prototype.toString;
  const tapOn = () => root.hasAttribute(TAP_ATTR);

  const emit = (type, obj) => {
    try { document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(obj) })); } catch {}
  };

  // ---------- the op store: opName -> record ----------
  // Where a queryId came from decides who wins: what X sends live beats what its bundle contains, which beats
  // last session's cache.
  const RANK = { cache: 1, webpack: 2, live: 3 };
  const ops = Object.create(null);
  const featureValues = Object.create(null);   // feature switch name -> last boolean X sent for it
  const session = Object.create(null);         // captured header (lower case) -> value
  let saveTimer = 0;

  const strList = v => Array.isArray(v) ? v.filter(s => typeof s === 'string') : [];
  const boolMap = v => {
    if (!isObj(v) || Array.isArray(v)) return null;
    const o = {};
    for (const k of Object.keys(v)) if (typeof v[k] === 'boolean') o[k] = v[k];
    return o;
  };

  function learn(name, p, src) {
    if (typeof name !== 'string' || !/^\w{2,80}$/.test(name)) return;
    const rank = RANK[src];
    let o = ops[name];
    if (!o) {
      o = ops[name] = { operationName: name, queryId: '', rank: 0, operationType: '', liveMethod: '',
        featureSwitches: [], fieldToggleNames: [], namesRank: 0, features: null, fieldToggles: null };
    }
    if (p.queryId && VALID_ID.test(p.queryId) && (rank >= o.rank || !o.queryId)) { o.queryId = p.queryId; o.rank = rank; }
    if (/^(query|mutation|subscription)$/.test(p.operationType || '')) o.operationType = p.operationType;
    if (p.liveMethod) o.liveMethod = p.liveMethod;
    const fs = strList(p.featureSwitches), ft = strList(p.fieldToggleNames);
    if ((fs.length || ft.length) && (rank >= o.namesRank || !(o.featureSwitches.length || o.fieldToggleNames.length))) {
      o.featureSwitches = fs; o.fieldToggleNames = ft; o.namesRank = rank;
    }
    if (p.features) { o.features = p.features; for (const k of Object.keys(p.features)) featureValues[k] = p.features[k]; }
    if (p.fieldToggles) o.fieldToggles = p.fieldToggles;
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      try {
        const out = {};
        for (const k of Object.keys(ops)) {
          const o = ops[k];
          if (!o.queryId) continue;
          out[k] = { queryId: o.queryId, operationType: o.operationType, liveMethod: o.liveMethod, featureSwitches: o.featureSwitches,
            fieldToggleNames: o.fieldToggleNames, features: o.features, fieldToggles: o.fieldToggles };
        }
        localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, t: Date.now(), ops: out, fv: featureValues }));
      } catch {}
    }, 1500);
  }

  // Last session's ops: a head start for the first call, replaced by anything fresher
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (c && c.v === 1 && isObj(c.ops)) {
      for (const k of Object.keys(c.ops)) {
        const e = c.ops[k];
        if (isObj(e)) learn(k, { queryId: e.queryId, operationType: e.operationType, liveMethod: e.liveMethod, featureSwitches: e.featureSwitches,
          fieldToggleNames: e.fieldToggleNames, features: boolMap(e.features), fieldToggles: boolMap(e.fieldToggles) }, 'cache');
      }
      if (isObj(c.fv)) for (const k of Object.keys(c.fv)) if (typeof c.fv[k] === 'boolean') featureValues[k] = c.fv[k];
    }
  } catch {}

  // ---------- harvesting from webpack ----------
  const seenMaps = new WeakSet(), seenFns = new WeakSet();
  const maps = [];                 // module maps ({id: factory}) not scanned yet
  let cursor = null;               // the map being scanned: { m, keys, i }
  const txCandidates = [];         // module ids whose source names x-client-transaction-id
  let chunkArr = null, wreq = null;

  // The object literal around a `queryId` key: walk back to its `{`, forward to the matching `}`. Brace counting
  // is enough because an op module holds nothing but names.
  function objectAround(src, at) {
    let depth = 0, s = -1;
    for (let i = at - 1, lim = Math.max(0, at - 1500); i >= lim; i--) {
      const c = src.charCodeAt(i);
      if (c === 125) depth++;
      else if (c === 123) { if (depth === 0) { s = i; break; } depth--; }
    }
    if (s < 0) return src.slice(Math.max(0, at - 300), at + 4000);
    depth = 0;
    for (let i = s, lim = Math.min(src.length, s + 24000); i < lim; i++) {
      const c = src.charCodeAt(i);
      if (c === 123) depth++;
      else if (c === 125 && --depth === 0) return src.slice(s, i + 1);
    }
    return src.slice(s, s + 4000);
  }
  const KEY = k => new RegExp('["\'`]?' + k + '["\'`]?\\s*:\\s*["\'`](\\w+)["\'`]');
  const RE_QID = /["'`]?queryId["'`]?\s*:\s*["'`]([\w-]{8,64})["'`]/g;
  const RE_OPNAME = KEY('operationName'), RE_OPTYPE = KEY('operationType');
  const RE_FS = /["'`]?featureSwitches["'`]?\s*:\s*\[([^\]]*)\]/, RE_FT = /["'`]?fieldToggles["'`]?\s*:\s*\[([^\]]*)\]/;
  const namesIn = s => { const out = []; const re = /["'`]([^"'`\s,]+)["'`]/g; let m; while ((m = re.exec(s))) out.push(m[1]); return out; };

  function scanSource(src, id) {
    if (src.indexOf('queryId') !== -1) {
      RE_QID.lastIndex = 0;
      let m;
      while ((m = RE_QID.exec(src))) {
        const lit = objectAround(src, m.index);
        const name = (RE_OPNAME.exec(lit) || [])[1];
        if (!name) continue;
        const fs = RE_FS.exec(lit), ft = RE_FT.exec(lit);
        learn(name, { queryId: m[1], operationType: (RE_OPTYPE.exec(lit) || [])[1],
          featureSwitches: fs ? namesIn(fs[1]) : [], fieldToggleNames: ft ? namesIn(ft[1]) : [] }, 'webpack');
      }
    }
    if (src.indexOf('x-client-transaction-id') !== -1 && txCandidates.length < 20) txCandidates.push(id);
  }

  // A module that already ran: its exports may be the op descriptor itself (or sit under `default`)
  function scanExports(ex, depth) {
    if (!ex || (typeof ex !== 'object' && typeof ex !== 'function')) return;
    const q = ex.queryId, n = ex.operationName;
    if (typeof q === 'string' && typeof n === 'string') {
      const md = isObj(ex.metadata) ? ex.metadata : {};
      learn(n, { queryId: q, operationType: ex.operationType, featureSwitches: md.featureSwitches, fieldToggleNames: md.fieldToggles }, 'webpack');
    } else if (!depth && ex.default) scanExports(ex.default, 1);
  }
  function scanCache() {
    const c = wreq && wreq.c;
    if (!isObj(c)) return;
    for (const id of Object.keys(c)) { try { scanExports(c[id] && c[id].exports, 0); } catch {} }
  }

  function scanFactory(id, f) {
    if (typeof f === 'function') {
      if (seenFns.has(f)) return;
      seenFns.add(f);
      scanSource(fnToString.call(f), id);
    } else if (isObj(f)) scanExports(f, 0);
  }

  function enqueue(mods) {
    if (!isObj(mods) || seenMaps.has(mods)) return;
    seenMaps.add(mods);
    maps.push(mods);
  }

  // Scan for up to `budget` ms. True when nothing is left.
  function step(budget) {
    const t0 = performance.now();
    for (;;) {
      if (!cursor) {
        const m = maps.shift();
        if (!m) return true;
        cursor = { m, keys: Object.keys(m), i: 0 };
      }
      while (cursor.i < cursor.keys.length) {
        const k = cursor.keys[cursor.i++];
        try { scanFactory(k, cursor.m[k]); } catch {}
        if ((cursor.i & 15) === 0 && performance.now() - t0 > budget) return false;
      }
      cursor = null;
    }
  }
  let draining = null;
  const drainAll = () => draining || (draining = new Promise(done => {
    const tick = () => { let fin = true; try { fin = step(12); } catch {} if (fin) { draining = null; done(); } else setTimeout(tick, 0); };
    tick();
  }));
  let idleTimer = 0;
  const drainSoon = () => {
    if (idleTimer || !tapOn()) return;
    idleTimer = setTimeout(() => { idleTimer = 0; getRequire(); drainAll(); }, 250);
  };

  function onChunk(d) {
    if (!Array.isArray(d)) return;
    enqueue(d[1]);
    drainSoon();
  }

  // webpack's own `require` (for the module cache and the full module list): pushing a chunk with a runtime
  // callback is how webpack hands it out. Before webpack's runtime exists the push just sits in the array, and
  // the callback runs when the runtime starts.
  function gotRequire(r) {
    if (wreq || typeof r !== 'function') return;
    wreq = r;
    try { enqueue(r.m); } catch {}
    try { scanCache(); } catch {}
  }
  let reqPushed = false;
  function getRequire() {
    if (wreq || !chunkArr || reqPushed) return wreq;
    reqPushed = true;   // once: if webpack's runtime is not up yet this push waits in the array for it
    try { chunkArr.push([['__xbbApi' + Math.random().toString(36).slice(2)], {}, gotRequire]); } catch {}
    return wreq;
  }

  function hookArray(arr) {
    if (!Array.isArray(arr) || chunkArr === arr) return;
    chunkArr = arr;
    try { for (const d of arr) onChunk(d); } catch {}
    const prev = arr.push;
    arr.push = function () {
      try { for (let i = 0; i < arguments.length; i++) onChunk(arguments[i]); } catch {}
      return prev.apply(this, arguments);
    };
  }
  try {
    const existing = window[WP_KEY];
    if (Array.isArray(existing)) hookArray(existing);
    else {
      // Not there yet: X's first chunk does `(self.webpackChunk_... = self.webpackChunk_... || []).push(...)`
      let store;
      Object.defineProperty(window, WP_KEY, {
        configurable: true, enumerable: true,
        get() { return store; },
        set(v) { store = v; try { hookArray(v); } catch {} }
      });
    }
  } catch {}

  async function ensureHarvest() {
    getRequire();
    await drainAll();
    scanCache();
  }

  // ---------- session + live learning ----------
  const hget = (h, name) => {
    try {
      if (!h) return null;
      if (typeof h.get === 'function') return h.get(name);
      if (Array.isArray(h)) { for (const p of h) if (p && String(p[0]).toLowerCase() === name) return p[1]; return null; }
      for (const k in h) if (k.toLowerCase() === name) return h[k];
    } catch {}
    return null;
  };
  function captureHeaders(h) {
    for (const k of SESSION_HEADERS) {
      const v = hget(h, k);
      if (typeof v === 'string' && v) session[k] = v;
    }
  }
  const cookieCsrf = () => { const m = /(?:^|;\s*)ct0=([^;]+)/.exec(document.cookie); return m ? m[1] : ''; };

  // A graphql request X makes itself: learn its queryId and the exact feature flags it sends
  function learnGraphql(url, body, method) {
    const m = GQL.exec(url);
    if (!m) return null;
    let vars, feats, toggles;
    try {
      if (body) { const b = JSON.parse(body); vars = b.variables; feats = b.features; toggles = b.fieldToggles; }
      else {
        const sp = new URL(url, location.href).searchParams;
        const j = k => { const s = sp.get(k); return s ? JSON.parse(s) : undefined; };
        vars = j('variables'); feats = j('features'); toggles = j('fieldToggles');
      }
    } catch {}
    learn(m[2], { queryId: m[1], liveMethod: method, features: boolMap(feats), fieldToggles: boolMap(toggles) }, 'live');
    return { op: m[2], queryId: m[1], variables: vars, tap: TAP_OPS.has(m[2]) && tapOn() };
  }

  const emitTap = (g, status, data) => emit('xbb-api-tap', { op: g.op, queryId: g.queryId, variables: g.variables, status, t: Date.now(), data });

  // ---------- fetch ----------
  window.fetch = function fetch(input, init) {
    let g = null;
    try {
      const url = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
      if (url.indexOf('/i/api/') !== -1) {
        captureHeaders((init && init.headers) || (input && input.headers));
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        g = learnGraphql(url, init && typeof init.body === 'string' ? init.body : null, method);
      }
    } catch {}
    const p = origFetch.apply(this, arguments);
    if (g && g.tap) {
      // A side branch: the promise X gets back is the browser's own, and ours runs first so the body is unread
      p.then(res => {
        try {
          if (res.ok && !res.bodyUsed) res.clone().json().then(data => emitTap(g, res.status, data), noop);
        } catch {}
      }, noop);
    }
    return p;
  };

  // ---------- XMLHttpRequest ----------
  try {
    const XP = XMLHttpRequest.prototype;
    const xOpen = XP.open, xSet = XP.setRequestHeader, xSend = XP.send;
    const xinfo = new WeakMap();
    XP.open = function (method, url) {
      try { const u = String(url); xinfo.set(this, { m: String(method || 'GET').toUpperCase(), u, h: {}, api: u.indexOf('/i/api/') !== -1 }); } catch {}
      return xOpen.apply(this, arguments);
    };
    XP.setRequestHeader = function (k, v) {
      try { const i = xinfo.get(this); if (i && i.api) i.h[String(k).toLowerCase()] = String(v); } catch {}
      return xSet.apply(this, arguments);
    };
    XP.send = function (body) {
      try {
        const i = xinfo.get(this);
        if (i && i.api) {
          captureHeaders(i.h);
          const g = learnGraphql(i.u, typeof body === 'string' ? body : null, i.m);
          if (g && g.tap) {
            const xhr = this;
            xhr.addEventListener('load', () => {
              try {
                if (xhr.status < 200 || xhr.status >= 300) return;
                const rt = xhr.responseType;
                const data = rt === 'json' ? xhr.response : (rt === '' || rt === 'text') ? JSON.parse(xhr.responseText) : null;
                if (data) emitTap(g, xhr.status, data);
              } catch {}
            });
          }
        }
      } catch {}
      return xSend.apply(this, arguments);
    };
  } catch {}

  // ---------- x-client-transaction-id ----------
  // X signs some calls with a generated id. Its generator lives in X's bundle under a name that changes, so:
  // `window.__xbbApiTxid(path, method)` if somebody supplies one, else a conservative look through the modules
  // that mention the header for an exported function that looks like a pure generator (no fetch, uses crypto) and
  // returns a base64-ish string. No match: calls go out without it, which is fine for most operations.
  let txFn = null, txTried = false;
  const TX_OK = /^[A-Za-z0-9+/=_-]{40,200}$/;
  async function findTxid() {
    txTried = true;
    if (!wreq) return;
    for (const id of txCandidates) {
      let ex;
      try { ex = wreq.c[id].exports; } catch { continue; }   // modules that already ran: never execute one ourselves
      if (!ex || (typeof ex !== 'object' && typeof ex !== 'function')) continue;
      const fns = typeof ex === 'function' ? [ex] : Object.keys(ex).map(k => { try { return ex[k]; } catch { return null; } });
      for (const f of fns) {
        if (typeof f !== 'function' || f.length < 2 || f.length > 3) continue;
        let s = '';
        try { s = fnToString.call(f); } catch { continue; }
        if (/fetch|XMLHttpRequest|\.send\(|localStorage|document\./.test(s) || !/crypto|subtle|btoa|Uint8Array/.test(s)) continue;
        try {
          const v = await Promise.race([Promise.resolve(f('/i/api/graphql/x/x', 'GET')), new Promise((_, no) => setTimeout(no, 1500))]);
          if (typeof v === 'string' && TX_OK.test(v)) { txFn = f; return; }
        } catch {}
      }
    }
  }
  async function txid(path, method) {
    try {
      if (typeof window.__xbbApiTxid === 'function') { const v = await window.__xbbApiTxid(path, method); if (typeof v === 'string' && v) return v; }
      if (!txTried) await findTxid();
      if (txFn) { const v = await txFn(path, method); if (typeof v === 'string' && TX_OK.test(v)) return v; }
    } catch {}
    return '';
  }

  // ---------- executing a call ----------
  // Feature flags: what X last sent for this op, topped up from the op's declared switch list with the values
  // seen on any other request, then X's own initial state, else false.
  function initialFeature(name) {
    try {
      const st = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.featureSwitch;
      const c = st && ((st.user && st.user.config) || (st.defaultConfig));
      const v = c && c[name] && c[name].value;
      if (typeof v === 'boolean') return v;
    } catch {}
    return undefined;
  }
  function buildFeatures(o) {
    const f = Object.assign({}, o.features || {});
    for (const n of o.featureSwitches) {
      if (n in f) continue;
      const v = featureValues[n] !== undefined ? featureValues[n] : initialFeature(n);
      f[n] = v === undefined ? false : v;
    }
    return f;
  }
  function buildToggles(o) {
    const f = Object.assign({}, o.fieldToggles || {});
    for (const n of o.fieldToggleNames) if (!(n in f)) f[n] = false;
    return f;
  }

  const enc = encodeURIComponent;
  async function execute(req) {
    const name = String(req.op || '');
    if (!ops[name] || !ops[name].queryId) await ensureHarvest();
    const o = ops[name];
    if (!o || !o.queryId) return { ok: false, status: 0, error: 'missing-op' };
    const csrf = session['x-csrf-token'] || cookieCsrf();
    if (!session.authorization || !csrf) return { ok: false, status: 0, error: 'no-auth', queryId: o.queryId };

    const method = String(req.method || (o.operationType === 'mutation' ? 'POST' : o.liveMethod) || 'GET').toUpperCase();
    const variables = isObj(req.variables) ? req.variables : {};
    const features = boolMap(req.features) || buildFeatures(o);
    const toggles = boolMap(req.fieldToggles) || buildToggles(o);
    const hasToggles = Object.keys(toggles).length > 0;
    const base = '/i/api/graphql/' + o.queryId + '/' + name;
    let url = base, body;
    if (method === 'GET') {
      url = base + '?variables=' + enc(JSON.stringify(variables)) + '&features=' + enc(JSON.stringify(features)) +
        (hasToggles ? '&fieldToggles=' + enc(JSON.stringify(toggles)) : '');
    } else {
      const b = { variables, features, queryId: o.queryId };
      if (hasToggles) b.fieldToggles = toggles;
      body = JSON.stringify(b);
    }

    const headers = { authorization: session.authorization, 'x-csrf-token': csrf, 'content-type': 'application/json' };
    for (const k of SESSION_HEADERS) if (session[k] && !headers[k]) headers[k] = session[k];
    const tx = await txid(base, method);
    if (tx) headers['x-client-transaction-id'] = tx;
    if (isObj(req.extraHeaders)) for (const k of Object.keys(req.extraHeaders)) if (typeof req.extraHeaders[k] === 'string') headers[k.toLowerCase()] = req.extraHeaders[k];

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(500, Math.min(60000, +req.timeout || 15000)));
    try {
      const res = await origFetch(url, { method, headers, body, credentials: 'include', signal: ctl.signal });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      const out = { ok: res.ok, status: res.status, data, queryId: o.queryId, txid: !!tx };
      if (res.ok && data === null) { out.ok = false; out.error = 'non-json'; }
      const reset = res.headers.get('x-rate-limit-reset');
      if (reset) out.rateLimitReset = +reset || null;
      return out;
    } catch (e) {
      return { ok: false, status: 0, queryId: o.queryId, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { clearTimeout(timer); }
  }

  async function statusInfo(scan) {
    if (scan) await ensureHarvest();
    const names = Object.keys(ops).filter(k => ops[k].queryId);
    return {
      main: true,
      ops: names.length,
      opNames: names,
      auth: !!session.authorization,
      csrf: !!(session['x-csrf-token'] || cookieCsrf()),
      captured: Object.keys(session),
      txid: { candidates: txCandidates.length, ready: !!(txFn || typeof window.__xbbApiTxid === 'function') },
      webpack: { hooked: !!chunkArr, require: !!wreq, pending: maps.length + (cursor ? 1 : 0) },
      tap: tapOn()
    };
  }

  document.addEventListener('xbb-api-req', async e => {
    let req = null;
    try { req = typeof e.detail === 'string' ? JSON.parse(e.detail) : null; } catch {}
    if (!isObj(req) || typeof req.id !== 'string') return;
    let out;
    try {
      out = req.type === 'status' ? { ok: true, status: 200, data: await statusInfo(!!req.scan) } : await execute(req);
    } catch (err) {
      out = { ok: false, status: 0, error: 'internal' };
    }
    emit('xbb-api-res', Object.assign({ id: req.id }, out));
  });

  // Tapping switched on after load: pick up what was pushed before
  try {
    new MutationObserver(() => { if (tapOn()) { getRequire(); drainSoon(); } }).observe(root, { attributes: true, attributeFilter: [TAP_ATTR] });
  } catch {}

  root.setAttribute('data-xbb-api-main', '1');
})();

/* Runs in the PAGE's JS world, after main-world.js: the Fast UI's passive tap on Pinterest's resource API.
   Pinterest addresses its API by name (/resource/<Name>/<action>/?source_url=…&data={"options":…}), so there is no
   query id to harvest: what we learn from its own requests is the exact `options` it sends per resource and the
   headers that make the API answer (x-pinterest-source-url, x-pinterest-pws-handler, X-APP-VERSION).
     - fetch and XMLHttpRequest are wrapped once. Idle cost: one indexOf('/resource/') per request. Everything is in
       try/catch and Pinterest's own promise / XHR is returned unchanged.
     - a successful response teaches localStorage['pin-ops-v1'] = { v: 1, ops: { '<Name>/<action>': { options,
       source, handler, appVersion, t } } } (kept for the next load: the Zero-JS extension mode has no app to learn from)
     - while <html data-pin-api-tap> is set, the responses of the route resources are handed to the content script
       as CustomEvent('pin-api-tap', { detail: JSON string }) on document: a string, because objects made in this
       realm do not cross Firefox's Xray wrappers.
     - window.__pinRawFetch is the unwrapped fetch: our own calls (userscript in the page world) use it, so they are
       never tapped. */
(() => {
  if (window.__pinApiTap) return;
  window.__pinApiTap = true;
  const root = document.documentElement;
  const LS = 'pin-ops-v1';
  // what the content script may want handed over (the rest is only learned)
  const TAP = /^(UserHomefeedResource|PinResource|UnifiedCommentsResource|RelatedModulesResource|BaseSearchResource|BoardFeedResource|UserPinsResource)\//;
  const origFetch = window.fetch;
  try { Object.defineProperty(window, '__pinRawFetch', { value: origFetch, configurable: true }); } catch {}

  // /resource/<Name>/<action>/ + the data/source_url pair, from the URL (GET) or a form body (POST)
  function parse(url, body) {
    let u;
    try { u = new URL(url, location.href); } catch { return null; }
    if (u.origin !== location.origin) return null;
    const m = /^\/resource\/([A-Za-z0-9]+)\/([a-z_]+)\/?$/.exec(u.pathname);
    if (!m) return null;
    let q = u.searchParams;
    if (typeof body === 'string' && body.indexOf('data=') !== -1) { try { q = new URLSearchParams(body); } catch {} }
    let options = null;
    try { const d = JSON.parse(q.get('data') || 'null'); options = d && typeof d.options === 'object' ? d.options : null; } catch {}
    return { name: m[1] + '/' + m[2], options, source: q.get('source_url') || '' };
  }
  const hget = (h, k) => {
    if (!h) return '';
    try {
      if (typeof h.get === 'function') return h.get(k) || '';
      const lk = k.toLowerCase();
      for (const key of Object.keys(h)) if (key.toLowerCase() === lk) return String(h[key]);
    } catch {}
    return '';
  };

  let cache = null;
  function learn(req, headers) {
    try {
      cache = cache || JSON.parse(localStorage.getItem(LS) || 'null') || {};
      if (!cache || typeof cache !== 'object' || cache.v !== 1) cache = { v: 1, ops: {} };
      cache.ops = cache.ops || {};
      const op = {
        options: req.options || {},
        source: hget(headers, 'x-pinterest-source-url') || req.source || '',
        handler: hget(headers, 'x-pinterest-pws-handler') || '',
        appVersion: hget(headers, 'x-app-version') || '',
        t: Date.now()
      };
      if (!op.handler && cache.ops[req.name]) op.handler = cache.ops[req.name].handler || '';
      cache.ops[req.name] = op;
      if (op.appVersion) cache.appVersion = op.appVersion;
      localStorage.setItem(LS, JSON.stringify(cache));
    } catch {}
  }
  function emit(req, status, text) {
    if (!root.hasAttribute('data-pin-api-tap') || !TAP.test(req.name)) return;
    try {
      document.dispatchEvent(new CustomEvent('pin-api-tap', { detail: JSON.stringify({ name: req.name, options: req.options, source: req.source, status, body: text, t: Date.now() }) }));
    } catch {}
  }
  // A 2xx whose envelope says success is something to learn from; the content script gets every tapped answer
  function seen(req, headers, status, text) {
    try {
      if (status >= 200 && status < 300 && text && text.indexOf('"status":"success"') !== -1) learn(req, headers);
      emit(req, status, text);
    } catch {}
  }

  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (!url || String(url).indexOf('/resource/') === -1) return p;
      const req = parse(String(url), init && typeof init.body === 'string' ? init.body : null);
      if (!req) return p;
      const headers = (init && init.headers) || (input && typeof input === 'object' && input.headers) || null;
      p.then(r => {
        try { r.clone().text().then(t => seen(req, headers, r.status, t), () => {}); } catch {}
      }, () => {});
    } catch {}
    return p;
  };

  const XP = XMLHttpRequest.prototype;
  const xOpen = XP.open, xSend = XP.send, xSet = XP.setRequestHeader;
  XP.open = function (method, url) {
    try { this.__pinUrl = url && String(url).indexOf('/resource/') !== -1 ? String(url) : ''; this.__pinH = null; } catch {}
    return xOpen.apply(this, arguments);
  };
  XP.setRequestHeader = function (k, v) {
    try { if (this.__pinUrl) (this.__pinH || (this.__pinH = {}))[k] = v; } catch {}
    return xSet.apply(this, arguments);
  };
  XP.send = function (body) {
    try {
      if (this.__pinUrl) {
        const req = parse(this.__pinUrl, typeof body === 'string' ? body : null);
        if (req) {
          const h = this.__pinH;
          this.addEventListener('load', () => {
            try {
              const t = this.responseType === '' || this.responseType === 'text' ? this.responseText
                : this.responseType === 'json' ? JSON.stringify(this.response) : '';
              if (t) seen(req, h, this.status, t);
            } catch {}
          });
        }
      }
    } catch {}
    return xSend.apply(this, arguments);
  };
})();

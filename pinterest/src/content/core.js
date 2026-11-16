/* Core helpers: settings, one shared DOM observer, DOM builder, Pinterest resource requests */
(() => {
  const listeners = new Set();
  // Last known settings in the page's localStorage, so the first video gets the right audio
  // before the async storage read finishes.
  const SNAP = 'pin-settings-snapshot';
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(SNAP) || 'null'); } catch {}
  PIN.settings = PIN.mergeSettings(snap);
  PIN.onSettings = fn => { listeners.add(fn); fn(PIN.settings); };

  const publish = s => {
    PIN.settings = s;
    try { localStorage.setItem(SNAP, JSON.stringify(s)); } catch {}
    listeners.forEach(fn => { try { fn(s); } catch (e) { console.error('[PIN]', e); } });
  };
  // Always publish once after the storage read: it writes the snapshot (so the next page load has settings
  // synchronously) and gives every subscriber the merged values.
  PIN.ready = PIN.loadSettings().then(publish);
  PIN.api?.storage?.onChanged.addListener(async (changes, area) => {
    if (area === 'sync' && changes.settings) publish(await PIN.loadSettings());
  });

  // One MutationObserver for everything; each subscriber runs at most once per `delay` ms.
  // With `localStorage['pin-perf'] = '1'` the runs and time per subscriber are counted (PIN.perf()).
  let PERF = false;
  try { PERF = localStorage.getItem('pin-perf') === '1'; } catch {}
  const perfData = { runs: {}, ms: {}, longTasks: 0, since: Date.now() };
  if (PERF && typeof PerformanceObserver === 'function') {
    try { new PerformanceObserver(list => { perfData.longTasks += list.getEntries().length; }).observe({ entryTypes: ['longtask'] }); } catch {}
  }
  PIN.count = (name, ms) => {
    if (!PERF) return;
    perfData.runs[name] = (perfData.runs[name] || 0) + 1;
    perfData.ms[name] = +((perfData.ms[name] || 0) + ms).toFixed(1);
  };
  // PIN.perf() -> a snapshot; empty counts unless localStorage['pin-perf'] = '1' at load time.
  PIN.perf = () => ({
    uptimeMs: Date.now() - perfData.since,
    nodes: document.querySelectorAll('*').length,
    longTasks: perfData.longTasks,
    runs: { ...perfData.runs },
    ms: { ...perfData.ms },
  });

  const subs = [];
  PIN.onDomChange = (fn, delay = 250, name = 'dom') => subs.push({ fn, delay, name, t: 0 });
  new MutationObserver(() => {
    if (document.hidden) return;            // nothing on screen: don't scan in the background
    for (const s of subs) {
      if (s.t) continue;
      s.t = setTimeout(() => {
        s.t = 0;
        const t0 = performance.now();
        try { s.fn(); } catch (e) { console.error('[PIN]', e); } finally { PIN.count(s.name, performance.now() - t0); }
      }, s.delay);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  PIN.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  };

  PIN.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let toastT = 0;
  PIN.toast = function (msg) {
    let t = document.getElementById('pin-toast');
    if (!t) {
      t = PIN.h('div', { id: 'pin-toast' });
      document.documentElement.append(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  };

  // ---- Pinterest's own data API -------------------------------------------------------------
  // Every call is /resource/<NameResource>/<action>/?source_url=…&data=… with the page's cookies and the
  // headers the site itself sends. The last two are not optional: without them the API answers
  // "Invalid Request". The envelope is { resource_response: { data, bookmark, status, … } }.
  PIN.getJSON = async function (pathOrUrl, { handler, source, headers } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : location.origin + pathOrUrl;
    const h = { Accept: 'application/json, text/javascript, */*, q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-AppState': 'active', ...(headers || {}) };
    if (source) h['x-pinterest-source-url'] = source;
    if (handler) h['x-pinterest-pws-handler'] = handler;
    const r = await fetch(url, { credentials: 'include', headers: h });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url.slice(0, 120));
    return r.json();
  };

  PIN.resource = function (name, options, { source = location.pathname, handler } = {}) {
    const q = 'source_url=' + encodeURIComponent(source) + '&data=' + encodeURIComponent(JSON.stringify({ options, context: {} }));
    return PIN.getJSON(`/resource/${name}/?${q}`, { source, handler })
      .then(j => j?.resource_response?.data);
  };

  // One pin, in the shape the pin page uses (images, videos, story_pin_data, comment_count).
  PIN.getPin = id => PIN.resource('PinResource/get', { id: String(id), field_set_key: 'auth_web_main_pin', noCache: true },
    { source: '/pin/' + id + '/', handler: 'www/pin/[id].js' });

  // Cached per page: the lightbox and the grid share it.
  const pinCache = new Map();
  PIN.pinData = function (id) {
    if (!pinCache.has(id)) {
      const p = PIN.getPin(id).catch(e => { console.warn('[PIN] pin load failed', id, e?.message || e); return null; });
      pinCache.set(id, p);
    }
    return pinCache.get(id);
  };

  // Comments. They hang off the pin's *aggregated* id (aggregated_pin_data.id), not the pin id, and the resource
  // returns an array of { text, user: { username, full_name, image_medium_url }, created_at, … }.
  const commentCache = new Map();
  PIN.comments = function (pin) {
    const agg = pin?.aggregated_pin_data?.id;
    if (!agg) return Promise.resolve([]);
    const key = String(agg);
    if (!commentCache.has(key)) {
      commentCache.set(key, PIN.resource('UnifiedCommentsResource/get',
        { aggregated_pin_id: key, comment_featured_ids: [], page_size: 10, redux_normalize_feed: true, is_reversed: false },
        { source: '/pin/' + (pin.id || '') + '/', handler: 'www/pin/[id].js' })
        .then(d => Array.isArray(d) ? d : [])
        .catch(e => { console.warn('[PIN] comments failed', e?.message || e); return []; }));
    }
    return commentCache.get(key);
  };

  // Promoted pins: the card carries the label. The API's `is_promotable` is something else entirely, and the
  // grid card is the only place the marker shows up.
  const AD_LABEL = /(^|[\s·•|])(promoted|sponsored|gesponsert|sponsorisé|patrocinado|sponsorizzato|promosso|anuncio)([\s·•|]|$)/i;
  PIN.isPromoted = el => AD_LABEL.test(el?.textContent || '');   // textContent: cheap enough to run over a whole grid
})();

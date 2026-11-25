/* Extension build only: the content script's side of the extension, for every site. ext/build.js puts it right
   after `<ns>.api` is set (and the site's shadow CSS), so `__BB_NS__` (RBE, IGB, XBB or PIN) exists.
     - `__BB_NS__.ext` ({ isExt, dev, site, version, send, log }); X adds block control (ext/bridge-x.js)
     - answers the worker and the popup: `bb-open-settings` (opens the site's in-page settings panel) and
       `bb-status`
     - dev builds (`__BB_DEV__` true): forwards the site's [TAG ...] warnings/errors, uncaught errors and long
       tasks (>50 ms) to the dev server's log through the worker (it can reach 127.0.0.1, the page's CSP can't). */
(() => {
  const { api, send, DEV, SITE, VERSION } = bbExt;
  const NS = __BB_NS__, TAG = '[' + __BB_NS_STR__;
  const ser = a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean' || a == null) return a;
    try { return JSON.parse(JSON.stringify(a)); } catch { return String(a); }
  };
  const log = (level, ...args) => { if (DEV) send({ type: 'bb-dev-log', site: SITE, level, args: args.map(ser) }); };
  NS.ext = Object.assign(NS.ext || {}, { isExt: true, dev: DEV, site: SITE, version: VERSION, send, log });

  // Reddit's panel is RBE.openSettingsInPage, the other sites' <ns>.openSettings (both are set after this runs)
  const openSettings = () => { const f = NS.openSettings || NS.openSettingsInPage; if (typeof f !== 'function') return false; f(); return true; };
  if (api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'bb-open-settings' || msg.type === 'xbb-open-settings') {
        reply({ ok: openSettings(), site: SITE });
      } else if (msg.type === 'bb-status') {
        reply({ ok: true, site: SITE, version: VERSION, dev: DEV, by: document.documentElement.getAttribute('data-bb-by') || '', blocking: !!(NS.ext.blocking && NS.ext.blocking()) });
      }
    });
  }

  if (DEV) {
    for (const lvl of ['warn', 'error']) {
      const orig = console[lvl];
      console[lvl] = function (...args) {
        try { if (args.some(a => typeof a === 'string' && a.indexOf(TAG) !== -1)) log(lvl, ...args); } catch {}
        return orig.apply(this, args);
      };
    }
    try {
      let n = 0;
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.duration >= 50 && n++ < 60) log('perf', 'LONG TASK', Math.round(e.duration) + 'ms', { path: location.pathname });
      }).observe({ type: 'longtask', buffered: false });
    } catch {}
    window.addEventListener('error', e => log('error', 'window.error', e.message, e.filename + ':' + e.lineno));
    log('info', TAG + ' ext] content script loaded', { path: location.pathname, version: VERSION });
  }
})();

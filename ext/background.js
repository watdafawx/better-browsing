/* Better Browsing MV3 background (Chrome service worker / Firefox event page). ext/build.js fills in the
   __BB_* tokens. Event-driven, no state in module variables that must survive: the worker can sleep at any time.
     1. DNR: a per-site table of rules that block a site's own JS while that site's Fast UI owns the page
        (X 1001..1003, Pinterest 2001..2002; Reddit and Instagram are tweak-in-place and have none). The
        state per site lives in storage.local (`bb:block:<site>`); content scripts read and set it by message (bb-ext-get/set; xbb-*, pin-* aliases).
     2. `bb-load-hls`: injects reddit/hls.js into the asking tab on first Reddit video (scripting.executeScript).
     3. `bb-open-site-settings`: opens a site in a new tab and its settings panel once the page is ready.
     4. Dev builds only: polls the dev server (/version) to hot-reload the extension and the active covered tabs,
        and forwards the content scripts' logs to its /log (tagged [site]). */
(() => {
  const DEV = __BB_DEV__;
  const BUILD_ID = __BB_BUILD_ID__;
  const SITES = __BB_SITES__;
  const DEV_URL = 'http://127.0.0.1:47910';
  const api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;

  // ---- sites: which one a URL belongs to (patterns come from build-lib.js SITES) ----
  const res = SITES.map(s => ({ key: s.key, match: s.match.map(m => new RegExp(m)), exclude: s.exclude.map(m => new RegExp(m)) }));
  const siteOf = url => {
    if (!url) return '';
    for (const s of res) if (s.match.some(r => r.test(url)) && !s.exclude.some(r => r.test(url))) return s.key;
    return '';
  };
  const homeOf = key => (SITES.find(s => s.key === key) || {}).home || '';

  // ---- DNR rule registry. Rule ID ranges: X 1000-1099, Pinterest 2000-2099, Reddit 3000, Instagram 4000. ----
  const blockRule = (id, urlFilter, initiatorDomains, resourceTypes) => ({
    id, priority: 1, action: { type: 'block' },
    condition: Object.assign({ urlFilter, initiatorDomains }, resourceTypes ? { resourceTypes } : {})
  });
  const DNR = {
    x: {
      ids: [1001, 1002, 1003],
      rules: [
        blockRule(1001, '||abs.twimg.com/responsive-web/client-web/', ['x.com'], ['script']),
        blockRule(1002, '||api.x.com/live_pipeline/', ['x.com']),
        blockRule(1003, '||ingest.us.sentry.io/', ['x.com'])
      ]
    },
    // Pinterest Fast UI (Zero-JS): its app bundle and the bundle's CSS, only when a Pinterest page asks for them
    pinterest: {
      ids: [2001, 2002, 2003],
      rules: [
        blockRule(2001, '||s.pinimg.com/webapp/', ['www.pinterest.com', 'pinterest.com'], ['script']),
        blockRule(2002, '||s.pinimg.com/webapp/', ['www.pinterest.com', 'pinterest.com'], ['stylesheet'])
      ]
    },
    reddit: { ids: [], rules: [] },
    instagram: { ids: [], rules: [] }
  };
  const blockKey = site => 'bb:block:' + site;

  function devLog(level, args, meta) {
    if (!DEV) return;
    try {
      fetch(DEV_URL + '/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: Date.now(), level: level || 'log', args: args || [], meta: meta || null })
      }).catch(() => {});
    } catch {}
  }

  async function applyBlock(site, on) {
    const d = DNR[site];
    const blocking = !!(on && d && d.rules.length);
    try { await api.storage.local.set({ [blockKey(site)]: blocking }); } catch {}
    if (d && d.ids.length) {
      try { await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: d.ids, addRules: blocking ? d.rules : [] }); }
      catch (e) { devLog('error', ['DNR updateDynamicRules failed:', site, String(e)]); }
    }
    return blocking;
  }
  async function getBlock(site) {
    try { const r = await api.storage.local.get(blockKey(site)); return !!r[blockKey(site)]; } catch { return false; }
  }
  // Restore every site's last state on worker start (the dynamic rules persist, but re-applying keeps them equal to the stored state)
  (async () => { for (const site of Object.keys(DNR)) if (DNR[site].rules.length) await applyBlock(site, await getBlock(site)); })();

  // ---- open a site's settings: new tab, then ask its content script once it has loaded ----
  async function openSiteSettings(site) {
    const url = homeOf(site);
    if (!url) return { ok: false };
    const tab = await api.tabs.create({ url });
    await new Promise(done => {
      const to = setTimeout(finish, 20000);
      function finish() { clearTimeout(to); api.tabs.onUpdated.removeListener(on); done(); }
      function on(id, info) { if (id === tab.id && info.status === 'complete') finish(); }
      api.tabs.onUpdated.addListener(on);
    });
    for (let i = 0; i < 10; i++) {
      try { const r = await api.tabs.sendMessage(tab.id, { type: 'bb-open-settings' }); if (r && r.ok) return { ok: true }; } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
    return { ok: false };
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    const tab = sender && sender.tab, tabId = tab && tab.id;
    const site = msg.site || siteOf(tab && tab.url) || (/^xbb-/.test(msg.type) ? 'x' : /^pin-/.test(msg.type) ? 'pinterest' : '');
    switch (msg.type) {
      case 'bb-ext-get':
      case 'xbb-ext-get':
      case 'pin-ext-get':
        getBlock(site).then(b => sendResponse({ ok: true, blocking: b, dev: DEV, buildId: BUILD_ID }));
        return true;
      case 'bb-ext-set':
      case 'xbb-ext-set':
      case 'pin-ext-set':
        (async () => {
          const next = await applyBlock(site, !!msg.block);
          devLog('info', ['[' + site + ']', 'DNR block ->', next, msg.reason || ''], { site, tab: tabId });
          sendResponse({ ok: true, blocking: next });
          if (msg.reload && tabId != null) {
            try { if (msg.url) await api.tabs.update(tabId, { url: msg.url }); else await api.tabs.reload(tabId); } catch {}
          }
        })();
        return true;
      case 'bb-load-hls':
        if (tabId == null) { sendResponse({ ok: false, error: 'no tab' }); return; }
        api.scripting.executeScript({ target: { tabId, frameIds: [sender.frameId || 0] }, files: ['reddit/hls.js'], world: 'ISOLATED' })
          .then(() => sendResponse({ ok: true }), e => { devLog('error', ['[reddit]', 'hls inject failed', String(e)]); sendResponse({ ok: false, error: String(e) }); });
        return true;
      case 'bb-open-site-settings':
        openSiteSettings(msg.site).then(sendResponse, () => sendResponse({ ok: false }));
        return true;
      case 'bb-dev-log':
      case 'xbb-dev-log':
        devLog(msg.level, msg.args, { site, url: tab && tab.url });
        sendResponse({ ok: true });
        return;
    }
  });

  // ---- dev: hot reload + live log ----
  if (DEV) {
    let reloading = false;
    const patterns = SITES.flatMap(s => s.patterns);
    const checkReload = async () => {
      if (reloading) return;
      try {
        const r = await fetch(DEV_URL + '/version', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (j && j.id && String(j.id) !== String(BUILD_ID)) {
          reloading = true;
          devLog('info', ['Hot reload triggered:', BUILD_ID, '->', j.id]);
          try {
            for (const t of await api.tabs.query({ active: true, url: patterns })) if (t.id != null) api.tabs.reload(t.id).catch(() => {});
          } catch {}
          setTimeout(() => { try { api.runtime.reload(); } catch {} }, 120);
        }
      } catch {}
    };
    setInterval(checkReload, 1200);
    if (api.alarms) {
      try {
        api.alarms.create('bb-dev-poll', { periodInMinutes: 0.5 });
        api.alarms.onAlarm.addListener(a => { if (a && a.name === 'bb-dev-poll') checkReload(); });
      } catch {}
    }
    devLog('info', ['Extension worker ready', { buildId: BUILD_ID }]);
  }
})();

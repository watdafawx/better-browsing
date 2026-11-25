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
  // Uses session rules (`updateSessionRules`) with `excludedTabIds` so escaping to Native X / Native Pinterest
  // in one tab leaves every other tab of that site in Zero-JS mode.
  const blockRule = (id, urlFilter, initiatorDomains, resourceTypes, excludedTabIds) => {
    const condition = Object.assign({ urlFilter, initiatorDomains }, resourceTypes ? { resourceTypes } : {});
    if (excludedTabIds && excludedTabIds.length) condition.excludedTabIds = excludedTabIds;
    return { id, priority: 1, action: { type: 'block' }, condition };
  };
  const DNR = {
    x: {
      ids: [1001, 1002, 1003],
      build: excl => [
        blockRule(1001, '||abs.twimg.com/responsive-web/client-web/', ['x.com'], ['script'], excl),
        blockRule(1002, '||api.x.com/live_pipeline/', ['x.com'], null, excl),
        blockRule(1003, '||ingest.us.sentry.io/', ['x.com'], null, excl)
      ]
    },
    // Pinterest Fast UI (Zero-JS): `pinterest.com` covers www.pinterest.com and all regional subdomains (de., uk., …)
    pinterest: {
      ids: [2001, 2002, 2003],
      build: excl => [
        blockRule(2001, '||s.pinimg.com/webapp/', ['pinterest.com'], ['script'], excl),
        blockRule(2002, '||s.pinimg.com/webapp/', ['pinterest.com'], ['stylesheet'], excl)
      ]
    },
    reddit: { ids: [], build: () => [] },
    instagram: { ids: [], build: () => [] }
  };
  // Always-on verified telemetry & ad endpoints for Reddit (3001..3005) and Instagram (4001..4002)
  const NOISE_RULES = [
    blockRule(3001, '||id.rlcdn.com/', ['reddit.com']),
    blockRule(3002, '||pi.reddit.com/', ['reddit.com']),
    blockRule(3003, '||w3-reporting.reddit.com/', ['reddit.com']),
    blockRule(3004, '||www.reddit.com/svc/events', ['reddit.com']),
    blockRule(3005, '||www.redditstatic.com/shreddit/sentry-', ['reddit.com'], ['script']),
    blockRule(4001, '||graph.instagram.com/logging_client_events', ['instagram.com']),
    blockRule(4002, '||www.instagram.com/ads/igwww_ads_graphql', ['instagram.com'])
  ];
  const NOISE_IDS = NOISE_RULES.map(r => r.id);
  const blockKey = site => 'bb:block:' + site;
  const exclKey = site => 'bb:excl:' + site;
  const sess = api.storage && api.storage.session ? api.storage.session : api.storage.local;

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

  async function getExcl(site) {
    try { const r = await sess.get(exclKey(site)); return Array.isArray(r[exclKey(site)]) ? r[exclKey(site)] : []; } catch { return []; }
  }
  async function setExcl(site, list) {
    const clean = [...new Set(list.filter(n => typeof n === 'number' && n >= 0))];
    try { await sess.set({ [exclKey(site)]: clean }); } catch {}
    return clean;
  }
  async function syncRules(site, on, excl) {
    const d = DNR[site];
    if (!d || !d.ids.length) return false;
    const blocking = !!on;
    const rules = blocking ? d.build(excl) : [];
    const dnr = api.declarativeNetRequest;
    try {
      if (dnr.updateSessionRules) {
        await dnr.updateSessionRules({ removeRuleIds: d.ids, addRules: rules });
        // Clean up any legacy dynamic rules from pre-0.3.0 installs
        if (dnr.updateDynamicRules) await dnr.updateDynamicRules({ removeRuleIds: d.ids }).catch(() => {});
      } else if (dnr.updateDynamicRules) {
        await dnr.updateDynamicRules({ removeRuleIds: d.ids, addRules: rules });
      }
    } catch (e) { devLog('error', ['DNR update failed:', site, String(e)]); }
    return blocking;
  }
  async function getBlock(site) {
    try { const r = await api.storage.local.get(blockKey(site)); return !!r[blockKey(site)]; } catch { return false; }
  }
  async function applyBlock(site, on, opts = {}) {
    const d = DNR[site];
    if (!d || !d.ids.length) return false;
    const tabId = opts.tabId;
    const tabOnly = opts.tabOnly && tabId != null && !on;
    let excl = await getExcl(site);
    if (tabOnly) {
      // Unblock ONLY this tab; keep global blocking active for every other tab of this site
      if (!excl.includes(tabId)) excl = await setExcl(site, [...excl, tabId]);
      const globalOn = await getBlock(site);
      await syncRules(site, globalOn, excl);
      return false;
    }
    if (on && tabId != null && excl.includes(tabId)) {
      excl = await setExcl(site, excl.filter(id => id !== tabId));
    }
    const blocking = !!on;
    try { await api.storage.local.set({ [blockKey(site)]: blocking }); } catch {}
    await syncRules(site, blocking, excl);
    return blocking;
  }
  // Clean up closed tabs from excludedTabIds so session rules stay compact
  if (api.tabs && api.tabs.onRemoved) {
    api.tabs.onRemoved.addListener(async closedId => {
      for (const site of Object.keys(DNR)) {
        if (!DNR[site].ids.length) continue;
        const excl = await getExcl(site);
        if (!excl.includes(closedId)) continue;
        const next = await setExcl(site, excl.filter(id => id !== closedId));
        await syncRules(site, await getBlock(site), next);
      }
    });
  }
  // Restore every site's session rules + verified telemetry/ad rules on worker start
  (async () => {
    for (const site of Object.keys(DNR)) {
      if (DNR[site].ids.length) await syncRules(site, await getBlock(site), await getExcl(site));
    }
    try {
      const dnr = api.declarativeNetRequest;
      if (dnr.updateSessionRules) await dnr.updateSessionRules({ removeRuleIds: NOISE_IDS, addRules: NOISE_RULES });
      else if (dnr.updateDynamicRules) await dnr.updateDynamicRules({ removeRuleIds: NOISE_IDS, addRules: NOISE_RULES });
    } catch (e) { devLog('error', ['DNR noise rules failed:', String(e)]); }
  })();

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
        Promise.all([getBlock(site), getExcl(site)]).then(([b, excl]) => {
          const excluded = tabId != null && excl.includes(tabId);
          sendResponse({ ok: true, blocking: b && !excluded, globalBlocking: b, dev: DEV, buildId: BUILD_ID });
        });
        return true;
      case 'bb-ext-set':
      case 'xbb-ext-set':
      case 'pin-ext-set':
        (async () => {
          // Tab-scoped unblock when escaping to Native in one tab; global when enabling or explicitly global
          const tabOnly = !msg.block && msg.scope !== 'global' && tabId != null && msg.reason !== 'need-learn';
          const next = await applyBlock(site, !!msg.block, { tabId, tabOnly });
          devLog('info', ['[' + site + ']', 'DNR block ->', next, tabOnly ? '(tab-only)' : '(global)', msg.reason || ''], { site, tab: tabId });
          sendResponse({ ok: true, blocking: next });
          if (msg.reload && tabId != null) {
            try { if (msg.url) await api.tabs.update(tabId, { url: msg.url }); else await api.tabs.reload(tabId); } catch {}
          }
        })();
        return true;
      case 'bb-download':
        (async () => {
          try {
            const u = new URL(String(msg.url || ''));
            if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
            if (!api.downloads || !api.downloads.download) throw new Error('downloads API unavailable');
            const id = await api.downloads.download({ url: u.href, filename: String(msg.filename || 'download').replace(/^[\\/]+/, ''), saveAs: false });
            sendResponse({ ok: true, id });
          } catch (e) {
            sendResponse({ ok: false, error: String(e) });
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

  // ---- host permission badge (Firefox MV3 leaves new host_permissions opt-in on install/update) ----
  async function syncPermBadge() {
    if (!api.permissions || !api.permissions.contains || !api.action || !api.action.setBadgeText) return;
    const origins = (api.runtime.getManifest().host_permissions || []).filter(o => !o.startsWith('http://127.0.0.1'));
    if (!origins.length) return;
    let ok = true;
    try { ok = await api.permissions.contains({ origins }); } catch { ok = true; }
    try {
      await api.action.setBadgeText({ text: ok ? '' : '!' });
      if (!ok && api.action.setBadgeBackgroundColor) await api.action.setBadgeBackgroundColor({ color: '#f0b429' });
      if (api.action.setTitle) await api.action.setTitle({ title: ok ? 'Better Browsing' : 'Better Browsing — click to grant new site permissions' });
    } catch {}
  }
  if (api.runtime && api.runtime.onInstalled) api.runtime.onInstalled.addListener(() => syncPermBadge());
  if (api.permissions && api.permissions.onAdded) api.permissions.onAdded.addListener(() => syncPermBadge());
  if (api.permissions && api.permissions.onRemoved) api.permissions.onRemoved.addListener(() => syncPermBadge());
  syncPermBadge();

  // ---- unpacked Chrome auto-reload: if manifest.json on disk has a newer version, reload automatically ----
  if (!DEV) {
    let lastDiskCheck = 0, diskReloading = false;
    const loadedVer = api.runtime.getManifest().version;
    const checkDiskManifest = async () => {
      const now = Date.now();
      if (diskReloading || now - lastDiskCheck < 10000) return;
      lastDiskCheck = now;
      try {
        const r = await fetch(api.runtime.getURL('manifest.json'), { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (j && j.version && j.version !== loadedVer) {
          diskReloading = true;
          api.runtime.reload();
        }
      } catch {}
    };
    if (api.tabs && api.tabs.onActivated) api.tabs.onActivated.addListener(() => checkDiskManifest());
    if (api.tabs && api.tabs.onUpdated) api.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'loading') checkDiskManifest(); });
  }

  // ---- dev: hot reload + live log ----
  if (DEV) {
    let reloading = false;
    const patterns = SITES.flatMap(s => s.patterns);
    // If the previous worker triggered a hot reload, refresh active covered tabs now that the NEW build is live
    api.storage.local.get('bb:devReloadTabs').then(async r => {
      if (!r || !r['bb:devReloadTabs']) return;
      await api.storage.local.remove('bb:devReloadTabs');
      try {
        for (const t of await api.tabs.query({ active: true, url: patterns })) if (t.id != null) api.tabs.reload(t.id).catch(() => {});
      } catch {}
    }).catch(() => {});
    const checkReload = async () => {
      if (reloading) return;
      try {
        const r = await fetch(DEV_URL + '/version', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (j && j.id && String(j.id) !== String(BUILD_ID)) {
          reloading = true;
          devLog('info', ['Hot reload triggered:', BUILD_ID, '->', j.id]);
          try { await api.storage.local.set({ 'bb:devReloadTabs': 1 }); } catch {}
          try { api.runtime.reload(); } catch {}
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

/* X Fast UI MV3 background service worker (Chrome + Firefox).
   1. Manages declarativeNetRequest dynamic rules that block X's heavy React/Relay JS bundles
      (abs.twimg.com/responsive-web/client-web/*.js), Sentry, and live_pipeline while Fast UI
      owns the page — giving 0 ms X JS overhead and true 120/144fps scroll.
   2. Lets content scripts pause blocking for Native X / Escape Hatch / auto-learn reloads.
   3. In dev builds (__XBB_DEV__ === true), polls the local dev server for hot-reload and
      forwards console/perf logs to http://127.0.0.1:47910/log (bypassing x.com's CSP). */
(() => {
  const DEV = __XBB_DEV__;
  const BUILD_ID = __XBB_BUILD_ID__;
  const DEV_URL = 'http://127.0.0.1:47910';
  const BLOCK_KEY = 'xbbExtBlock';

  const RULES = [
    {
      id: 1001,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: '||abs.twimg.com/responsive-web/client-web/',
        resourceTypes: ['script'],
        initiatorDomains: ['x.com']
      }
    },
    {
      id: 1002,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: '||api.x.com/live_pipeline/',
        initiatorDomains: ['x.com']
      }
    },
    {
      id: 1003,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: '||ingest.us.sentry.io/',
        initiatorDomains: ['x.com']
      }
    }
  ];
  const RULE_IDS = RULES.map(r => r.id);

  const api = typeof browser !== 'undefined' ? browser : chrome;

  let blocking = false;

  async function applyBlock(on) {
    blocking = !!on;
    try { await api.storage.local.set({ [BLOCK_KEY]: blocking }); } catch {}
    try {
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: RULE_IDS,
        addRules: blocking ? RULES : []
      });
    } catch (e) {
      devLog('error', ['DNR updateDynamicRules failed:', String(e)]);
    }
    return blocking;
  }

  // Restore last blocking state on service worker startup
  (async () => {
    try {
      const r = await api.storage.local.get(BLOCK_KEY);
      blocking = !!r[BLOCK_KEY];
      await applyBlock(blocking);
    } catch {}
  })();

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

  // Message handler from content scripts
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'xbb-ext-get') {
      api.storage.local.get(BLOCK_KEY).then(r => sendResponse({ ok: true, blocking: !!r[BLOCK_KEY], dev: DEV, buildId: BUILD_ID }))
        .catch(() => sendResponse({ ok: true, blocking, dev: DEV, buildId: BUILD_ID }));
      return true;
    }
    if (msg.type === 'xbb-ext-set') {
      (async () => {
        const next = await applyBlock(!!msg.block);
        devLog('info', ['DNR block ->', next, msg.reason || ''], { tab: sender && sender.tab && sender.tab.id });
        sendResponse({ ok: true, blocking: next });
        if (msg.reload && sender && sender.tab && sender.tab.id != null) {
          const tabId = sender.tab.id;
          if (msg.url) {
            try { await api.tabs.update(tabId, { url: msg.url }); } catch {}
          } else {
            try { await api.tabs.reload(tabId); } catch {}
          }
        }
      })();
      return true;
    }
    if (msg.type === 'xbb-dev-log') {
      devLog(msg.level, msg.args, { url: sender && sender.tab && sender.tab.url });
      sendResponse({ ok: true });
      return false;
    }
  });

  // Clicking the toolbar icon toggles settings on the active x.com tab
  if (api.action && api.action.onClicked) {
    api.action.onClicked.addListener(tab => {
      if (tab && tab.id != null) api.tabs.sendMessage(tab.id, { type: 'xbb-open-settings' }).catch(() => {});
    });
  }

  // Dev hot-reload poller (stripped in production builds)
  if (DEV) {
    let reloading = false;
    async function checkReload() {
      if (reloading) return;
      try {
        const res = await fetch(DEV_URL + '/version', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        if (j && j.id && String(j.id) !== String(BUILD_ID)) {
          reloading = true;
          devLog('info', ['Hot reload triggered:', BUILD_ID, '->', j.id]);
          try {
            const tabs = await api.tabs.query({ url: 'https://x.com/*' });
            for (const t of tabs) if (t.id != null) api.tabs.reload(t.id).catch(() => {});
          } catch {}
          setTimeout(() => { try { api.runtime.reload(); } catch {} }, 120);
        }
      } catch {}
    }
    setInterval(checkReload, 1200);
    if (api.alarms) {
      try {
        api.alarms.create('xbb-dev-poll', { periodInMinutes: 0.5 });
        api.alarms.onAlarm.addListener(a => { if (a && a.name === 'xbb-dev-poll') checkReload(); });
      } catch {}
    }
    devLog('info', ['Extension worker ready', { buildId: BUILD_ID, blocking }]);
  }
})();

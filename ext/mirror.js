/* Extension build only (right after ext/bridge.js): mirrors page localStorage into chrome/browser.storage.local
   so settings, custom Hopper themes, Zen transparency, and learned Fast UI op caches survive site-data clears,
   sync custom themes + transparency across X and Pinterest, and power 1-click Export/Import in the toolbar popup.
   Non-destructive: never overwrites non-empty localStorage with an older mirror. */
(() => {
  const { api, SITE } = bbExt;
  if (!api || !api.storage || !api.storage.local) return;
  const NS = __BB_NS__;
  const SETTINGS_KEY = {
    reddit: 'rbe-userscript-storage',
    instagram: 'igb-userscript-settings',
    x: 'xbb-userscript-settings',
    pinterest: 'pin-userscript-settings'
  }[SITE];
  const OPS_KEY = SITE === 'x' ? 'xbb-gql-ops-v1' : SITE === 'pinterest' ? 'pin-ops-v1' : '';
  const HAS_THEMES = SITE === 'x' || SITE === 'pinterest';
  const M_SET = 'bb:mirror:settings:' + SITE;
  const M_OPS = OPS_KEY ? 'bb:mirror:ops:' + SITE : '';
  const M_SHARED = 'bb:mirror:shared';
  const MAX_BYTES = 512 * 1024;

  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch { return false; } };
  const stGet = keys => new Promise(r => { try { Promise.resolve(api.storage.local.get(keys)).then(r, () => r({})); } catch { r({}); } });
  const stSet = obj => { try { Promise.resolve(api.storage.local.set(obj)).catch(() => {}); } catch {} };

  let lastSettings = SETTINGS_KEY ? lsGet(SETTINGS_KEY) : null;
  let lastOps = OPS_KEY ? lsGet(OPS_KEY) : null;
  let lastCustom = HAS_THEMES ? lsGet('bb-custom-themes') : null;
  let lastTr = HAS_THEMES ? lsGet('bb-fast-transparent') : null;
  let timer = 0;

  function flushSettings() {
    if (!SETTINGS_KEY) return;
    const raw = lsGet(SETTINGS_KEY);
    if (!raw || raw.length > MAX_BYTES) return;
    lastSettings = raw;
    stSet({ [M_SET]: { v: 1, ts: Date.now(), raw } });
  }
  function flushOps() {
    if (!OPS_KEY) return;
    const raw = lsGet(OPS_KEY);
    if (!raw || raw === lastOps || raw.length > MAX_BYTES) return;
    lastOps = raw;
    stSet({ [M_OPS]: { v: 1, ts: Date.now(), raw } });
  }
  function flushShared() {
    if (!HAS_THEMES) return;
    const customThemes = lsGet('bb-custom-themes') || '';
    const transparent = lsGet('bb-fast-transparent') === '1';
    if (customThemes === (lastCustom || '') && (transparent ? '1' : null) === lastTr) return;
    if (customThemes.length > MAX_BYTES) return;
    lastCustom = customThemes || null;
    lastTr = transparent ? '1' : null;
    stSet({ [M_SHARED]: { v: 1, ts: Date.now(), customThemes, transparent } });
  }
  const scheduleFlush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; flushSettings(); flushShared(); flushOps(); }, 400);
  };

  // Boot sync: restore from mirror if localStorage is empty (or if mirror is newer from an Import), else seed mirror
  const wantKeys = [M_SET];
  if (M_OPS) wantKeys.push(M_OPS);
  if (HAS_THEMES) wantKeys.push(M_SHARED);

  stGet(wantKeys).then(res => {
    if (!res) return;
    // 1. Settings
    const ms = res[M_SET];
    const curS = SETTINGS_KEY ? lsGet(SETTINGS_KEY) : null;
    const curEmpty = !curS || curS === '{}' || curS === '{"sync":{}}';
    if (ms && ms.raw && (curEmpty || (ms.importedAt && ms.importedAt > (Number(lsGet('bb-mirror-imp-ts') || 0))))) {
      if (lsSet(SETTINGS_KEY, ms.raw)) {
        lastSettings = ms.raw;
        if (ms.importedAt) lsSet('bb-mirror-imp-ts', String(ms.importedAt));
        try { window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY, newValue: ms.raw })); } catch {}
      }
    } else if (!curEmpty && (!ms || ms.raw !== curS)) {
      flushSettings();
    }

    // 2. Shared themes & Zen transparency across X <-> Pinterest
    if (HAS_THEMES) {
      const sh = res[M_SHARED];
      const curC = lsGet('bb-custom-themes') || '';
      const curT = lsGet('bb-fast-transparent');
      if (sh && sh.v === 1) {
        let changed = false;
        if (sh.customThemes && sh.customThemes !== curC && (!curC || (sh.ts || 0) > Number(lsGet('bb-shared-ts') || 0))) {
          lsSet('bb-custom-themes', sh.customThemes); lastCustom = sh.customThemes; changed = true;
        }
        const wantT = sh.transparent ? '1' : null;
        if (wantT !== curT && (curT === null || (sh.ts || 0) > Number(lsGet('bb-shared-ts') || 0))) {
          lsSet('bb-fast-transparent', wantT); lastTr = wantT; changed = true;
        }
        if (changed) {
          lsSet('bb-shared-ts', String(sh.ts || Date.now()));
          try { const shl = NS.fast && NS.fast.shell && NS.fast.shell.get && NS.fast.shell.get(); if (shl && shl.applyTheme) shl.applyTheme(); } catch {}
        }
      }
      if (!sh && (curC || curT === '1')) flushShared();
    }

    // 3. Learned Fast UI op cache backup (survives site-data clears)
    if (M_OPS) {
      const mo = res[M_OPS];
      const curO = lsGet(OPS_KEY);
      if (mo && mo.raw && !curO) {
        if (lsSet(OPS_KEY, mo.raw)) lastOps = mo.raw;
      } else if (curO && (!mo || mo.raw !== curO)) {
        flushOps();
      }
    }
  });

  // Live sync when settings change in this tab or another tab
  if (NS && NS.api && NS.api.storage && NS.api.storage.onChanged) {
    NS.api.storage.onChanged.addListener(() => scheduleFlush());
  }
  addEventListener('storage', e => {
    if (e.key === SETTINGS_KEY || e.key === OPS_KEY || e.key === 'bb-custom-themes' || e.key === 'bb-fast-transparent') scheduleFlush();
  });
  addEventListener('bb-shared-changed', () => scheduleFlush());
  // Flush op caches & shared theme changes when tab hides or unloads
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flushSettings(); flushShared(); flushOps(); } });
  addEventListener('pagehide', () => { flushSettings(); flushShared(); flushOps(); });

  // Live cross-site theme/transparency updates from another tab (e.g. X <-> Pinterest)
  if (api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (HAS_THEMES && changes[M_SHARED] && changes[M_SHARED].newValue) {
        const sh = changes[M_SHARED].newValue;
        lsSet('bb-custom-themes', sh.customThemes || null);
        lsSet('bb-fast-transparent', sh.transparent ? '1' : null);
        lsSet('bb-shared-ts', String(sh.ts || Date.now()));
        lastCustom = sh.customThemes || null;
        lastTr = sh.transparent ? '1' : null;
        try { const shl = NS.fast && NS.fast.shell && NS.fast.shell.get && NS.fast.shell.get(); if (shl && shl.applyTheme) shl.applyTheme(); } catch {}
      }
    });
  }
})();

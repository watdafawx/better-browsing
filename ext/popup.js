/* Toolbar popup. On one of the four covered sites it asks that tab to open its in-page settings panel and
   closes. Anywhere else (or when the tab's content script is not running yet) it stays open as a hub: the four
   sites, each with a status dot, "Open" (the site in a new tab) and "Settings" (the site, then its panel).
   ext/build.js fills in __BB_SITES__ (key, label, home, version, match/exclude regexes, host patterns). */
(() => {
  const api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const SITES = __BB_SITES__;
  const $ = id => document.getElementById(id);
  const wrap = p => { try { return Promise.resolve(p).catch(() => null); } catch { return Promise.resolve(null); } };
  const siteOf = url => {
    for (const s of SITES) if (s.match.some(m => new RegExp(m).test(url)) && !s.exclude.some(m => new RegExp(m).test(url))) return s;
    return null;
  };
  const el = (tag, props, ...kids) => {
    const n = Object.assign(document.createElement(tag), props || {});
    n.append(...kids);
    return n;
  };

  $('ver').textContent = 'Extension ' + api.runtime.getManifest().version;

  async function granted(s) {
    if (!api.permissions || !api.permissions.contains) return true;
    return !!(await wrap(api.permissions.contains({ origins: s.patterns })));
  }

  async function render(current) {
    const list = $('sites');
    list.textContent = '';
    for (const s of SITES) {
      const ok = await granted(s);
      const st = current && current.key === s.key ? current.status : null;
      const dot = el('span', { className: 'dot ' + (ok ? 'ok' : 'warn') });
      let text = 'v' + s.version;
      if (!ok) text = 'Not allowed yet';
      else if (st && st.blocking) text = 'Zero-JS on, v' + s.version;
      const actions = el('div', { className: 'actions' });
      if (!ok) {
        const allow = el('button', { type: 'button', textContent: 'Allow', title: 'Allow Better Browsing on ' + s.label });
        allow.onclick = async () => { await wrap(api.permissions.request({ origins: s.patterns })); render(current); };
        actions.append(allow);
      } else {
        const open = el('button', { type: 'button', textContent: 'Open', title: 'Open ' + s.label + ' in a new tab' });
        open.onclick = () => { api.tabs.create({ url: s.home }); window.close(); };
        const set = el('button', { type: 'button', textContent: 'Settings', title: 'Open ' + s.label + ' and its settings panel' });
        set.onclick = () => { wrap(api.runtime.sendMessage({ type: 'bb-open-site-settings', site: s.key })); window.close(); };
        actions.append(open, set);
      }
      const icon = el('img', { src: '../icons/sites/' + s.key + '.png', alt: '', width: 24, height: 24 });
      list.append(el('li', { className: current && current.key === s.key ? 'here' : '' }, icon,
        el('div', null, el('div', { className: 'name', textContent: s.label }), el('div', { className: 'status' }, dot, text)), actions));
    }
  }

  async function main() {
    const tabs = await wrap(api.tabs.query({ active: true, currentWindow: true }));
    const tab = tabs && tabs[0];
    const site = tab && tab.url ? siteOf(tab.url) : null;
    if (!site) { render(null); return; }
    // a covered tab: open its settings panel and get out of the way
    const r = await wrap(api.tabs.sendMessage(tab.id, { type: 'bb-open-settings' }));
    if (r && r.ok) { window.close(); return; }
    const note = $('note');
    note.hidden = false;
    note.textContent = site.label + ' is open here, but Better Browsing is not running on this tab yet. Reload the tab to start it.';
    const reload = el('button', { type: 'button', textContent: 'Reload tab' });
    reload.onclick = () => { api.tabs.reload(tab.id); window.close(); };
    note.append(document.createElement('br'), reload);
    const status = await wrap(api.tabs.sendMessage(tab.id, { type: 'bb-status' }));
    render({ key: site.key, status });
  }
  // Export / Import all 4 sites' mirrored settings + shared Hopper themes & transparency
  const ioMsg = $('ioMsg');
  const sayIo = t => { if (ioMsg) ioMsg.textContent = t; };
  const expBtn = $('exportBtn'), impBtn = $('importBtn'), impFile = $('importFile');
  if (expBtn) expBtn.onclick = async () => {
    const keys = [...SITES.map(s => 'bb:mirror:settings:' + s.key), 'bb:mirror:shared'];
    const data = (await wrap(api.storage.local.get(keys))) || {};
    const out = { v: 1, exportedAt: new Date().toISOString(), settings: {}, shared: data['bb:mirror:shared'] || null };
    for (const s of SITES) { const m = data['bb:mirror:settings:' + s.key]; if (m && m.raw) out.settings[s.key] = m.raw; }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: u, download: 'better-browsing-settings.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
    sayIo('Exported ' + Object.keys(out.settings).length + ' site(s)');
  };
  if (impBtn && impFile) {
    impBtn.onclick = () => impFile.click();
    impFile.onchange = async () => {
      const f = impFile.files && impFile.files[0];
      impFile.value = '';
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (!j || j.v !== 1 || typeof j.settings !== 'object') throw new Error('Invalid backup file');
        const now = Date.now(), patch = {};
        let n = 0;
        for (const s of SITES) {
          const raw = j.settings[s.key];
          if (typeof raw === 'string' && raw.length) { JSON.parse(raw); patch['bb:mirror:settings:' + s.key] = { v: 1, ts: now, importedAt: now, raw }; n++; }
        }
        if (j.shared && typeof j.shared === 'object') patch['bb:mirror:shared'] = Object.assign({}, j.shared, { v: 1, ts: now });
        await wrap(api.storage.local.set(patch));
        sayIo('Imported ' + n + ' site(s) — reload open tabs');
      } catch (e) { sayIo('Import failed: ' + (e.message || 'bad JSON')); }
    };
  }

  main();
})();

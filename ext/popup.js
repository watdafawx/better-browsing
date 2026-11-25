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
  main();
})();

/* Shared by every site: the settings form (each site's popup/popup.html + popup.js) in a shadow-DOM
   panel over the page. build.js puts this once at the top of the userscript; each site makes its own:
     bbPanel({ cls, html, css, mount(root, close), onToggle(open) }) -> toggle()
   cls: the host's classes (the tests find the panel by them). Esc, the ✕ and a click on the backdrop close it. */
const bbPanel = ({ cls, html, css, mount, onToggle }) => {
  let host = null, obs = null;
  const onKey = e => { if (e.key === 'Escape' && host) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); } };

  // Mirror the active Fast UI / Hopper theme when present on X or Pinterest, so the settings modal matches live
  function syncTheme(panelHost) {
    const fastHost = document.querySelector('xbb-fast, pin-fast');
    if (!fastHost) return;
    const cs = getComputedStyle(fastHost);
    const pick = (...ks) => { for (const k of ks) { const v = cs.getPropertyValue(k).trim(); if (v) return v; } return ''; };
    const bg = pick('--bg'), card = pick('--bg-2', '--bg2', '--card'), field = pick('--bg-3', '--bg3', '--bg-hover');
    const text = pick('--text', '--fg'), weak = pick('--muted', '--fg2'), line = pick('--line');
    const accent = pick('--accent'), mode = fastHost.getAttribute('data-theme');
    if (bg) panelHost.style.setProperty('--bg', bg);
    if (card) panelHost.style.setProperty('--card', card);
    if (field || card) panelHost.style.setProperty('--field', field || card);
    if (text) panelHost.style.setProperty('--text', text);
    if (weak) panelHost.style.setProperty('--weak', weak);
    if (line) panelHost.style.setProperty('--line', line);
    if (accent) panelHost.style.setProperty('--accent', accent);
    if (mode === 'light') panelHost.style.colorScheme = 'light';
    else if (mode) panelHost.style.colorScheme = 'dark';
  }

  const MODERN_CSS = `
    :host {
      all: initial;
      --bg: #f8f9fb; --card: #ffffff; --field: #eef1f6; --text: #181a20; --weak: #5f6675;
      --line: rgba(15, 20, 30, .10); --accent: #1d9bf0;
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #14161c; --card: #1a1d26; --field: #232734; --text: #dfe2ea; --weak: #8f96a6;
        --line: rgba(255, 255, 255, .09); --accent: #7eb8f0;
      }
    }
    * { box-sizing: border-box; }
    .panel {
      width: min(860px, calc(100vw - 32px)); max-height: 84vh;
      border-radius: 16px; border: 1px solid var(--line); background: var(--bg); color: var(--text);
      box-shadow: 0 24px 64px rgba(0, 0, 0, .48); overflow: hidden;
      font: 13.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .panel:has(#tabs) { width: min(640px, calc(100vw - 32px)); }
    .panel > div { width: 100% !important; display: flex; flex-direction: column; max-height: 84vh; min-height: 0; background: var(--bg); color: var(--text); }
    header {
      flex: none; display: flex; align-items: center; gap: 10px;
      padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--bg);
    }
    header img { width: 22px; height: 22px; border-radius: 6px; flex: none; }
    h1 { font-size: 15.5px; font-weight: 700; letter-spacing: -.01em; margin: 0; flex: 1; color: var(--text); }
    .saved {
      font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
      color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent);
      opacity: 0; transition: opacity .18s ease;
    }
    .saved.on { opacity: 1; }
    .x {
      flex: none; width: 30px; height: 30px; margin-left: 4px; border: 0; border-radius: 999px;
      background: transparent; color: var(--weak); font-size: 15px; line-height: 1;
      display: grid; place-items: center; cursor: pointer; transition: background .15s, color .15s;
    }
    .x:hover { background: var(--field); color: var(--text); }
    nav#tabs {
      flex: none; display: flex; gap: 4px; padding: 8px 16px;
      border-bottom: 1px solid var(--line); background: var(--bg); overflow-x: auto;
    }
    nav#tabs button {
      flex: 1; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent;
      color: var(--weak); font: 600 12.5px/1.2 inherit; cursor: pointer; white-space: nowrap;
      transition: background .14s, color .14s;
    }
    nav#tabs button:hover { background: var(--field); color: var(--text); }
    nav#tabs button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); border: 0; }
    main {
      flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 20px;
      scrollbar-width: thin; scrollbar-color: var(--line) transparent;
    }
    @media (min-width: 720px) {
      main:not(:has([data-panel])) {
        display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px; align-items: start;
      }
      main:not(:has([data-panel])) > section { margin-bottom: 0; }
    }
    section:not([data-panel]) {
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      padding: 14px 16px; margin: 0 0 12px;
    }
    section:not([data-panel]):last-child { margin-bottom: 0; }
    section[data-panel] { padding: 2px 2px 4px; border: 0; }
    h2 {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
      color: var(--weak); margin: 0 0 10px;
    }
    section[data-panel] h2 { margin-top: 14px; }
    section[data-panel] h2:first-child { margin-top: 0; }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin: 0; padding: 8px 0; color: var(--text);
    }
    .row span { display: flex; align-items: center; gap: 8px; flex: none; }
    .check {
      display: flex; align-items: center; justify-content: space-between;
      gap: 14px; margin: 0; padding: 8px 0; cursor: pointer; color: var(--text);
    }
    .check .lbl { flex: 1; min-width: 0; line-height: 1.4; }
    .check + .check, .row + .check, .check + .row, .row + .row { border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
    .check input[type=checkbox] {
      order: 2; -webkit-appearance: none; appearance: none; flex: none; margin: 0;
      width: 36px; height: 20px; border-radius: 999px;
      background: var(--field); border: 1px solid var(--line);
      position: relative; cursor: pointer; transition: background .16s ease, border-color .16s ease;
    }
    .check input[type=checkbox]::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: var(--weak);
      transition: transform .16s ease, background .16s ease;
    }
    .check input[type=checkbox]:checked {
      background: var(--accent); border-color: var(--accent);
    }
    .check input[type=checkbox]:checked::after {
      transform: translateX(16px); background: #fff;
    }
    .check input[type=checkbox]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    select, input[type=text], input[type=number], textarea {
      background: var(--field); color: var(--text); border: 1px solid var(--line);
      border-radius: 8px; padding: 6px 10px; font: inherit; outline: none;
      transition: border-color .14s, box-shadow .14s;
    }
    select { max-width: 250px; cursor: pointer; }
    input[type=text] { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; width: 215px; }
    input[type=number].num { width: 84px; text-align: right; }
    textarea { width: 100%; min-height: 92px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
    select:focus, input[type=text]:focus, input[type=number]:focus, textarea:focus {
      border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 26%, transparent);
    }
    input[type=range] { accent-color: var(--accent); width: 148px; cursor: pointer; }
    output { min-width: 2.4em; text-align: right; font-variant-numeric: tabular-nums; color: var(--weak); font-size: 12.5px; }
    .hint { color: var(--weak); font-size: 12px; line-height: 1.45; margin: 9px 0 0; }
    code {
      font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace;
      background: var(--field); padding: 1px 5px; border-radius: 5px; color: var(--text);
    }
    kbd {
      background: var(--field); border: 1px solid var(--line); border-radius: 5px;
      padding: 1px 5px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
    }
    .seg { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--field); border: 1px solid var(--line); }
    .seg button { flex: 1; padding: 6px 8px; border: 0; border-radius: 7px; background: transparent; color: var(--weak); font: 600 12.5px inherit; cursor: pointer; }
    .seg button.on { background: var(--accent); color: #fff; }
    .lang-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .lang-chips button {
      padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line);
      background: var(--field); color: var(--weak); font: 500 12px/1.3 inherit; cursor: pointer;
      transition: background .14s, color .14s, border-color .14s;
    }
    .lang-chips button:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
    .lang-chips button.on {
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      border-color: var(--accent); color: var(--accent); font-weight: 600;
    }
    .btn {
      margin-top: 8px; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--field); color: var(--text); font: 600 12.5px inherit; cursor: pointer;
    }
    .btn:hover { border-color: var(--accent); }
    .link { background: none; border: 0; color: var(--accent); font: 500 12.5px inherit; cursor: pointer; padding: 2px 4px; }
    .link:hover { text-decoration: underline; }
    .link.danger { color: #f87171; }
    .split { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
  `;

  function toggle() {
    if (host) {
      if (obs) { obs.disconnect(); obs = null; }
      host.remove(); host = null; removeEventListener('keydown', onKey, true);
      onToggle?.(false);
      return;
    }
    host = document.createElement('div');
    host.className = cls;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(8,10,16,.58);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-start;justify-content:center;padding-top:7vh';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${css}\n${MODERN_CSS}</style><div class="panel"><div>${html}</div></div>`;
    // wrap label text/inline <kbd> inside .check in one span so flex keeps natural inline flow + toggle on the right
    for (const label of root.querySelectorAll('label.check')) {
      const inp = label.querySelector('input[type=checkbox]');
      if (!inp) continue;
      const span = document.createElement('span');
      span.className = 'lbl';
      for (const n of [...label.childNodes]) if (n !== inp) span.append(n);
      label.append(span);
    }
    const x = document.createElement('button');
    x.className = 'x'; x.title = 'Close (Esc)'; x.setAttribute('aria-label', 'Close'); x.textContent = '✕'; x.onclick = toggle;
    root.querySelector('header').append(x);
    host.addEventListener('click', e => { if (e.composedPath()[0] === host) toggle(); });   // clicks inside the shadow root also report target === host
    // keep the site's own key handlers (shortcuts) away from the form's text fields
    ['keydown', 'keyup', 'keypress'].forEach(t => host.addEventListener(t, e => e.stopPropagation()));
    document.documentElement.append(host);
    syncTheme(host);
    const fastHost = document.querySelector('xbb-fast, pin-fast');
    if (fastHost) {
      obs = new MutationObserver(() => host && syncTheme(host));
      obs.observe(fastHost, { attributes: true, attributeFilter: ['style', 'data-theme', 'data-bb-theme'] });
    }
    addEventListener('keydown', onKey, true);
    mount(root, toggle);
    onToggle?.(true);
  }
  return toggle;
};

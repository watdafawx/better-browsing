/* Shared by X Fast UI and Pinterest Fast UI (build-lib.js inlines it for those two sites; ext/build.js does the same
   in each site's content.js). The theme registry, the Hopper-style Appearance picker and the way a theme becomes
   CSS variables on a Fast UI host element. Plain JS, no dependencies, nothing runs until a function is called.

   Palettes are the ones in Hopper (X:\Dev\hopper\src\gpui\theme.rs + theme.json): Hopper Dark, 12 more dark ones,
   Hopper Light and 5 more light ones, the same hex values. Each is  bg (page) / panel (bars) / surface (inputs) /
   raised (hover, picked) / border / fg / muted / accent / accentFg. The four classic themes of the Fast UIs stay
   exactly as their stylesheets define them (the picker only sets data-theme for those; no inline variables).

     bbThemes.LIST                        every built-in theme: { id, name, dark, classic?, bg, panel, ... }
     bbThemes.byId(id)                    built-in or imported theme, or null ('auto' is not a theme)
     bbThemes.classOf(id, autoClass)      'black' | 'dim' | 'light': the class a stylesheet keyed on data-theme knows
                                          (a Hopper/imported theme maps to black or light by its mode)
     bbThemes.apply(host, id, opts)       theme -> CSS variables + data-theme/data-bb-theme on `host`.
                                          opts: { auto: 'black'|'dim'|'light' (what "auto" means here), site: 'x'|'pin',
                                          page: true (also the page behind the shadow root while Fast UI owns it) }
     bbThemes.importJson(text)            Hopper / Zed / gpui-component theme JSON -> localStorage['bb-custom-themes']
     bbThemes.custom() / removeCustom(id) the imported themes
     bbThemes.mountPicker(root, opts)     { el, update(), close() }: the Appearance button + popover
     bbThemes.fillSelect(select)          options for the settings form's <select data-key="fastUiTheme">
     bbThemes.CSS                         the picker's styles (the shell adds them to its shadow stylesheet) */
const bbThemes = (() => {
  const CUSTOM_KEY = 'bb-custom-themes';
  const MAX_CUSTOM = 24;

  // ---------- colour helpers ----------
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  // #rgb / #rgba / #rrggbb / #rrggbbaa -> '#rrggbb' (alpha dropped), or '' when it is not a colour
  function norm(c) {
    if (typeof c !== 'string') return '';
    c = c.trim();
    if (!HEX.test(c)) return '';
    let h = c.slice(1);
    if (h.length <= 4) h = h.split('').map(x => x + x).join('');
    return '#' + h.slice(0, 6).toLowerCase();
  }
  const rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return '#' + [0, 1, 2].map(i => hex2(x[i] + (y[i] - x[i]) * t)).join(''); };
  const rgba = (c, a) => { const x = rgb(c); return `rgb(${x[0]} ${x[1]} ${x[2]} / ${a})`; };
  const lum = c => { const v = rgb(c).map(n => { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // ---------- the registry ----------
  const P = (id, name, dark, bg, panel, surface, raised, border, fg, muted, accent, accentFg) =>
    ({ id, name, dark, bg, panel, surface, raised, border, fg, muted, accent, accentFg });
  const CLASSIC = [
    { id: 'black', name: 'Lights Out', dark: true, classic: true, bg: '#000000', panel: '#000000', surface: '#16181c', raised: '#2f3336', border: '#2f3336', fg: '#e7e9ea', muted: '#71767b', accent: '#1d9bf0', accentFg: '#ffffff' },
    { id: 'dim', name: 'Dim', dark: true, classic: true, bg: '#15202b', panel: '#15202b', surface: '#1e2732', raised: '#38444d', border: '#38444d', fg: '#f7f9f9', muted: '#8b98a5', accent: '#1d9bf0', accentFg: '#ffffff' },
    { id: 'light', name: 'Light', dark: false, classic: true, bg: '#ffffff', panel: '#f7f9f9', surface: '#f7f9f9', raised: '#eff3f4', border: '#eff3f4', fg: '#0f1419', muted: '#536471', accent: '#1d9bf0', accentFg: '#ffffff' }
  ];
  const HOPPER = [
    P('hopper-dark', 'Hopper Dark', true, '#121214', '#0e0e10', '#1f1f23', '#28282d', '#26262b', '#ededef', '#9a9aa3', '#f97316', '#1c0d02'),
    P('catppuccin-mocha', 'Catppuccin Mocha', true, '#1e1e2e', '#181825', '#262637', '#313244', '#313244', '#cdd6f4', '#a6adc8', '#cba6f7', '#1e1e2e'),
    P('catppuccin-macchiato', 'Catppuccin Macchiato', true, '#24273a', '#1e2030', '#2b2e43', '#363a4f', '#363a4f', '#cad3f5', '#a5adcb', '#c6a0f6', '#181926'),
    P('rose-pine', 'Rosé Pine', true, '#191724', '#16141f', '#1f1d2e', '#26233a', '#26233a', '#e0def4', '#908caa', '#ebbcba', '#191724'),
    P('rose-pine-moon', 'Rosé Pine Moon', true, '#232136', '#1d1b2e', '#2a273f', '#393552', '#393552', '#e0def4', '#908caa', '#ea9a97', '#232136'),
    P('tokyo-night', 'Tokyo Night', true, '#1a1b26', '#16161e', '#1f2335', '#292e42', '#292e42', '#c0caf5', '#9aa5ce', '#7aa2f7', '#1a1b26'),
    P('dracula', 'Dracula', true, '#282a36', '#21222c', '#303241', '#44475a', '#44475a', '#f8f8f2', '#a3a7c2', '#bd93f9', '#282a36'),
    P('nord', 'Nord', true, '#2e3440', '#272c36', '#353c4a', '#434c5e', '#3b4252', '#eceff4', '#a3acbf', '#88c0d0', '#2e3440'),
    P('gruvbox-dark', 'Gruvbox Dark', true, '#282828', '#1d2021', '#32302f', '#3c3836', '#3c3836', '#ebdbb2', '#a89984', '#fabd2f', '#282828'),
    P('everforest', 'Everforest', true, '#2d353b', '#272e33', '#343f44', '#3d484d', '#3d484d', '#d3c6aa', '#9da9a0', '#a7c080', '#2d353b'),
    P('one-dark', 'One Dark', true, '#282c34', '#21252b', '#2c313a', '#3a3f4b', '#3a3f4b', '#abb2bf', '#8b92a0', '#61afef', '#1e2127'),
    P('ristretto', 'Ristretto', true, '#2c2525', '#211c1c', '#352e2e', '#403838', '#403838', '#fff1f3', '#c3b7b8', '#f9cc6c', '#2c2525'),
    P('kanagawa', 'Kanagawa', true, '#1f1f28', '#16161d', '#2a2a37', '#363646', '#363646', '#dcd7ba', '#a09c8c', '#7e9cd8', '#1f1f28'),
    P('hopper-light', 'Hopper Light', false, '#fafafa', '#f1f1f3', '#f4f4f5', '#e7e7ea', '#e4e4e7', '#18181b', '#5f5f69', '#ea580c', '#141414'),
    P('catppuccin-latte', 'Catppuccin Latte', false, '#eff1f5', '#e6e9ef', '#e6e9ef', '#ccd0da', '#ccd0da', '#4c4f69', '#6c6f85', '#8839ef', '#eff1f5'),
    P('rose-pine-dawn', 'Rosé Pine Dawn', false, '#faf4ed', '#f2e9e1', '#fffaf3', '#dfdad9', '#dfdad9', '#575279', '#797593', '#d7827e', '#141414'),
    P('tokyo-night-day', 'Tokyo Night Day', false, '#e1e2e7', '#d0d5e3', '#e9e9ed', '#c4c8da', '#c4c8da', '#3760bf', '#6172b0', '#2e7de9', '#141414'),
    P('gruvbox-light', 'Gruvbox Light', false, '#fbf1c7', '#f2e5bc', '#f9f5d7', '#ebdbb2', '#d5c4a1', '#3c3836', '#7c6f64', '#af3a03', '#fbf1c7'),
    P('solarized-light', 'Solarized Light', false, '#fdf6e3', '#eee8d5', '#f5efdc', '#e4ddc8', '#e0d8c0', '#475b62', '#657b83', '#268bd2', '#141414')
  ];
  // menu order: Lights Out and Dim lead the dark list, Light leads the light one
  const LIST = [CLASSIC[0], CLASSIC[1], ...HOPPER.filter(t => t.dark), CLASSIC[2], ...HOPPER.filter(t => !t.dark)];
  const isClassic = id => id === 'black' || id === 'dim' || id === 'light';

  // ---------- imported themes ----------
  let customCache = null;
  const readCustom = () => {
    if (customCache) return customCache;
    let list = [];
    try {
      const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      if (Array.isArray(v)) list = v.map(sane).filter(Boolean).slice(0, MAX_CUSTOM);
    } catch {}
    return (customCache = list);
  };
  const writeCustom = list => {
    customCache = list;
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); return true; } catch { return false; }
  };
  // a stored/imported theme as a full, validated palette (or null)
  function sane(t) {
    if (!t || typeof t !== 'object') return null;
    const bg = norm(t.bg), fg = norm(t.fg);
    if (!bg || !fg) return null;
    const dark = typeof t.dark === 'boolean' ? t.dark : lum(bg) < 0.4;
    const accent = norm(t.accent) || (dark ? '#7aa2f7' : '#2563eb');
    const panel = norm(t.panel) || mix(bg, dark ? '#000000' : '#000000', dark ? 0.25 : 0.04);
    const surface = norm(t.surface) || mix(bg, fg, 0.06);
    const raised = norm(t.raised) || mix(bg, fg, 0.12);
    const id = typeof t.id === 'string' && /^custom-[a-z0-9-]{1,48}$/.test(t.id) ? t.id : 'custom-' + (slug(t.name) || 'theme');
    return {
      id, name: String(t.name || 'Custom').slice(0, 40), dark, custom: true, bg, panel, surface, raised,
      border: norm(t.border) || raised, fg, muted: norm(t.muted) || mix(fg, bg, 0.35), accent,
      accentFg: norm(t.accentFg) || (lum(accent) > 0.45 ? '#141414' : '#ffffff')
    };
  }
  const custom = () => readCustom().slice();
  const byId = id => LIST.find(t => t.id === id) || readCustom().find(t => t.id === id) || null;

  // one theme object of Hopper's / Zed's / gpui-component's shape -> a palette
  function fromThemeObject(o) {
    if (!o || typeof o !== 'object') return null;
    const c = o.colors && typeof o.colors === 'object' ? o.colors : o.style && typeof o.style === 'object' ? o.style : null;
    if (!c) return null;
    const g = (...keys) => { for (const k of keys) { const v = norm(c[k]); if (v) return v; } return ''; };
    const bg = g('background', 'editor.background'), fg = g('foreground', 'text', 'editor.foreground');
    if (!bg || !fg) return null;
    const mode = String(o.mode || o.appearance || '').toLowerCase();
    return sane({
      name: o.name || o.id || 'Custom', dark: mode === 'dark' ? true : mode === 'light' ? false : undefined,
      bg, fg,
      panel: g('sidebar.background', 'title_bar.background', 'popover.background', 'panel.background'),
      surface: g('muted.background', 'secondary.background', 'input.background', 'element.background'),
      raised: g('secondary.hover.background', 'accent.background', 'secondary.active.background', 'element.hover'),
      border: g('border', 'window.border'),
      muted: g('muted.foreground', 'text.muted'),
      accent: g('primary.background', 'ring', 'link.foreground', 'text.accent'),
      accentFg: g('primary.foreground')
    });
  }
  // Hopper / gpui-component theme files ({ name, themes: [...] }), a bare array of themes, or one theme.
  // Never throws: { ok, added: [names], error?: text }.
  function importJson(text) {
    let data;
    try { data = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { return { ok: false, added: [], error: 'That is not valid JSON.' }; }
    const items = Array.isArray(data) ? data : data && Array.isArray(data.themes) ? data.themes : [data];
    const made = items.map(fromThemeObject).filter(Boolean);
    if (!made.length) return { ok: false, added: [], error: 'No theme found: it needs a name and colors with at least background and foreground.' };
    const list = readCustom().slice();
    for (const t of made) {
      if (LIST.some(b => b.id === t.id)) continue;
      const i = list.findIndex(x => x.id === t.id);
      if (i >= 0) list[i] = t; else list.push(t);
    }
    if (list.length > MAX_CUSTOM) list.splice(0, list.length - MAX_CUSTOM);
    if (!writeCustom(list)) return { ok: false, added: [], error: 'The browser would not store the theme.' };
    return { ok: true, added: made.map(t => t.name), ids: made.map(t => t.id) };
  }
  function removeCustom(id) { writeCustom(readCustom().filter(t => t.id !== id)); }

  // ---------- applying a theme ----------
  const classOfTheme = t => (t.classic ? t.id : t.dark ? 'black' : 'light');
  // 'black' | 'dim' | 'light' for a requested id: the stylesheet's own classes are what data-theme carries
  function classOf(id, autoClass) {
    const t = id && id !== 'auto' ? byId(id) : null;
    return t ? classOfTheme(t) : isClassic(autoClass) ? autoClass : 'black';
  }
  // every variable a Hopper/imported theme sets (X's and Pinterest's Fast UI stylesheets; a classic theme sets none)
  const VAR_NAMES = ['--bg', '--bg-2', '--bg-hover', '--bg-elev', '--line', '--text', '--muted', '--accent', '--accent-soft', '--note-bg', '--shadow',
    '--bg2', '--bg3', '--fg', '--fg2', '--fg3', '--card', '--accent-h', '--on-accent', '--overlay', '--hud', '--hud-fg'];
  function varsOf(t, site) {
    const d = t.dark;
    return {
      '--bg': t.bg, '--bg-2': t.surface, '--bg-hover': mix(t.bg, t.surface, 0.55), '--bg-elev': t.panel, '--line': t.border,
      '--text': t.fg, '--muted': t.muted, '--accent': t.accent, '--accent-soft': rgba(t.accent, 0.14), '--note-bg': t.bg,
      '--bg2': t.surface, '--bg3': t.raised, '--fg': t.fg, '--fg2': t.muted, '--fg3': mix(t.muted, t.bg, 0.2), '--card': t.surface,
      '--accent-h': mix(t.accent, d ? '#ffffff' : '#000000', 0.15), '--on-accent': t.accentFg,
      '--overlay': d ? 'rgba(0,0,0,.72)' : 'rgba(0,0,0,.55)',
      '--hud': rgba(d ? t.panel : t.fg, 0.92), '--hud-fg': d ? t.fg : t.bg,
      '--shadow': site === 'pin'
        ? (d ? '0 8px 28px rgba(0,0,0,.6)' : '0 8px 28px rgba(0,0,0,.16)')
        : (d ? '0 0 15px rgb(0 0 0 / .6), 0 0 3px 1px rgb(255 255 255 / .08)' : '0 0 15px rgb(101 119 134 / 0.2), 0 0 3px 1px rgb(101 119 134 / 0.15)')
    };
  }
  const applied = new WeakMap();
  function apply(host, id, opts) {
    opts = opts || {};
    const auto = isClassic(opts.auto) ? opts.auto : 'black';
    let t = id && id !== 'auto' ? byId(id) : null;
    if (!t) t = byId(auto);
    const cls = classOfTheme(t);
    const vars = t.classic ? null : varsOf(t, opts.site);
    const key = [cls, t.id, opts.site || '', opts.page ? 1 : 0, vars ? JSON.stringify(vars) : ''].join('|');
    const out = { id: t.id, requested: id || 'auto', cls, theme: t };
    if (applied.get(host) === key) return out;
    applied.set(host, key);
    const st = host.style;
    for (const n of VAR_NAMES) st.removeProperty(n);
    if (vars) for (const n of VAR_NAMES) st.setProperty(n, vars[n]);
    st.colorScheme = vars ? (t.dark ? 'dark' : 'light') : '';
    if (host.getAttribute('data-theme') !== cls) host.setAttribute('data-theme', cls);
    if (host.getAttribute('data-bb-theme') !== t.id) host.setAttribute('data-bb-theme', t.id);
    if (opts.page) {
      // the page behind the shadow root (a CSS rule in the site's content.css reads these only while Fast UI owns it):
      // no white/black flash around the Fast UI
      const r = document.documentElement;
      if (vars) { r.style.setProperty('--bb-page-bg', t.bg); r.setAttribute('data-bb-page', t.id); }
      else { r.style.removeProperty('--bb-page-bg'); r.removeAttribute('data-bb-page'); }
      if (opts.site === 'pin' && r.getAttribute('data-pin-theme') !== cls) r.setAttribute('data-pin-theme', cls);
    }
    return out;
  }

  // ---------- the settings form's <select> ----------
  function fillSelect(sel) {
    if (!sel) return;
    const keep = sel.querySelector('option[value="auto"]');
    const mk = t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; return o; };
    const group = (label, items) => { if (!items.length) return null; const g = document.createElement('optgroup'); g.label = label; items.forEach(t => g.append(mk(t))); return g; };
    const all = [...LIST, ...readCustom()];
    sel.replaceChildren(...[keep, group('Dark', all.filter(t => t.dark && !t.custom)), group('Light', all.filter(t => !t.dark && !t.custom)), group('Imported', readCustom())].filter(Boolean));
  }

  // ---------- the picker ----------
  const CSS = `
.bt-wrap{position:relative;display:inline-flex;flex:none}
.bt-btn,.bt-pop{--b-bg:var(--bg,#000);--b-surface:var(--bg-2,var(--bg2,#16181c));--b-fg:var(--text,var(--fg,#e7e9ea));--b-muted:var(--muted,var(--fg2,#71767b));--b-line:var(--line,#2f3336);--b-accent:var(--accent,#1d9bf0)}
.bt-btn{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px 0 6px;border-radius:999px;border:1px solid var(--b-line);background:var(--b-surface);color:var(--b-fg);font-size:13px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer}
.bt-btn:hover{border-color:var(--b-muted)}
.bt-btn[aria-expanded="true"]{border-color:var(--b-accent)}
.bt-btn .bt-cur{max-width:150px;overflow:hidden;text-overflow:ellipsis}
.bt-btn svg.bt-caret{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;opacity:.7}
.bt-pill{display:inline-flex;align-items:center;gap:3px;flex:none;width:30px;height:20px;padding:0 4px;border-radius:7px;border:1px solid rgb(128 128 128 / .45);box-sizing:border-box}
.bt-pill i{display:block;border-radius:50%;width:7px;height:7px;flex:none}
.bt-pill b{display:block;height:3px;width:10px;border-radius:2px;flex:none}
.bt-split{background:linear-gradient(135deg,#000 50%,#fff 50%)!important;width:22px;height:22px;border-radius:50%;flex:none;border:1px solid rgb(128 128 128 / .55);box-sizing:border-box}
.bt-pop{position:fixed;inset:auto;margin:0;width:392px;max-width:calc(100vw - 16px);max-height:min(82vh,620px);overflow:auto;box-sizing:border-box;padding:12px;border-radius:14px;border:1px solid var(--b-line);background:var(--b-bg);color:var(--b-fg);box-shadow:0 14px 44px rgba(0,0,0,.45);font:13px/1.35 var(--font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);text-align:left}
.bt-top{display:flex;align-items:center;gap:6px;margin-bottom:10px}
.bt-top h3{margin:0 auto 0 4px;font-size:14px;font-weight:700;color:var(--b-fg)}
.bt-small{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--b-line);background:var(--b-surface);color:var(--b-fg);font-size:12px;font-weight:600;cursor:pointer}
.bt-small:hover{border-color:var(--b-muted)}
.bt-sys{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:1px solid var(--b-line);background:var(--b-surface);color:var(--b-fg);text-align:left;cursor:pointer}
.bt-sys span.bt-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-weight:600}
.bt-sys small{font-size:11px;font-weight:500;color:var(--b-muted)}
.bt-sw{flex:none;width:34px;height:20px;border-radius:999px;background:rgb(128 128 128 / .45);position:relative;transition:background .12s}
.bt-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .12s}
.bt-sys[aria-checked="true"] .bt-sw{background:var(--b-accent)}
.bt-sys[aria-checked="true"] .bt-sw::after{transform:translateX(14px)}
.bt-sys[aria-checked="true"]{border-color:var(--b-accent)}
.bt-h{margin:14px 4px 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--b-muted)}
.bt-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bt-row{position:relative;display:flex;min-width:0}
.bt-item{display:flex;align-items:center;gap:8px;flex:1;min-width:0;box-sizing:border-box;padding:7px 8px;border-radius:10px;border:1px solid transparent;background:var(--b-surface);color:var(--b-fg);font-size:12.5px;font-weight:600;text-align:left;cursor:pointer}
.bt-item:hover{border-color:var(--b-muted)}
.bt-item .bt-name{flex:1;min-width:0;line-height:1.15;overflow-wrap:anywhere}
.bt-item svg.bt-check{width:14px;height:14px;flex:none;fill:none;stroke:var(--b-accent);stroke-width:3;stroke-linecap:round;stroke-linejoin:round;visibility:hidden}
.bt-item[aria-pressed="true"]{border-color:var(--b-accent);box-shadow:0 0 0 1px var(--b-accent)}
.bt-item[aria-pressed="true"] svg.bt-check{visibility:visible}
.bt-del{position:absolute;right:30px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;border:0;background:rgb(128 128 128 / .3);color:var(--b-fg);font-size:12px;line-height:1;cursor:pointer;padding:0}
.bt-del:hover{background:#dc2626;color:#fff}
.bt-imp{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.bt-imp[hidden]{display:none}
.bt-imp textarea{width:100%;box-sizing:border-box;min-height:96px;resize:vertical;border-radius:8px;border:1px solid var(--b-line);background:var(--b-surface);color:var(--b-fg);font:12px/1.4 ui-monospace,Consolas,monospace;padding:8px}
.bt-imp .bt-actions{display:flex;gap:6px;align-items:center}
.bt-msg{font-size:12px;color:var(--b-muted);min-height:16px}
.bt-msg.err{color:#f87171}
@media (max-width:700px){.bt-btn .bt-cur{display:none}.bt-btn{padding:0 8px 0 6px}}`;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function mk(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : String(v)); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  function svg(cls, d) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
    const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  }
  function pill(t) {
    const p = mk('span', { class: 'bt-pill', 'aria-hidden': 'true' }, mk('i'), mk('b'));
    p.style.background = t.bg;
    p.firstChild.style.background = t.accent;
    p.lastChild.style.background = t.fg;
    return p;
  }

  /* The Appearance button and its popover, appended by the caller (`el`). opts:
       get()        the saved theme id ('auto' or an id)
       onChange(id) called with 'auto' or a theme id after a click (the caller saves it and calls apply)
       auto()       'black'|'dim'|'light' that "Follow system" means on this site
       systemLabel  the second line of the Follow system row
       accent       the site's accent for the classic themes' preview pills
     update() re-reads get() (call it after a setting changes), close() closes the popover. */
  function mountPicker(root, opts) {
    opts = opts || {};
    const cur = () => { const v = opts.get && opts.get(); return typeof v === 'string' && v ? v : 'auto'; };
    const autoCls = () => { const a = opts.auto && opts.auto(); return isClassic(a) ? a : 'black'; };
    const shown = t => (t.classic && opts.accent ? Object.assign({}, t, { accent: opts.accent }) : t);
    const supported = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

    const pillSlot = mk('span', { class: 'bt-slot', style: 'display:contents' });
    const label = mk('span', { class: 'bt-cur' });
    const btn = mk('button', { class: 'bt-btn', type: 'button', 'data-bt-open': '', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Appearance' },
      pillSlot, label, svg('bt-caret', 'm6 9 6 6 6-6'));
    const pop = mk('div', { class: 'bt-pop', role: 'dialog', 'aria-label': 'Appearance', popover: supported ? 'auto' : null, hidden: supported ? null : true, 'data-bt-pop': '' });
    const wrap = mk('div', { class: 'bt-wrap' }, btn, pop);

    const importBox = mk('div', { class: 'bt-imp', hidden: true });
    const ta = mk('textarea', { placeholder: 'Paste a Hopper / Zed theme JSON here ({ "name", "mode", "colors": { "background", "foreground", … } } or { "themes": [ … ] })', 'aria-label': 'Theme JSON', spellcheck: 'false' });
    const file = mk('input', { type: 'file', accept: '.json,application/json', hidden: true });
    const msg = mk('div', { class: 'bt-msg', 'aria-live': 'polite' });
    importBox.append(ta, mk('div', { class: 'bt-actions' },
      mk('button', { class: 'bt-small', type: 'button', 'data-bt-file': '' }, 'Choose file…'),
      mk('button', { class: 'bt-small', type: 'button', 'data-bt-add': '' }, 'Add theme'), file), msg);
    const body = mk('div', { class: 'bt-body' });
    pop.append(
      mk('div', { class: 'bt-top' }, mk('h3', null, 'Theme'),
        mk('button', { class: 'bt-small', type: 'button', 'data-bt-import': '' }, 'Import JSON'),
        mk('button', { class: 'bt-small', type: 'button', 'data-bt-reset': '', title: 'Back to following the system' }, 'Reset')),
      importBox, body);

    const item = (t, sel) => {
      const b = mk('button', { class: 'bt-item', type: 'button', 'data-theme-pick': t.id, 'aria-pressed': String(sel === t.id), title: t.name },
        pill(shown(t)), mk('span', { class: 'bt-name' }, t.name), svg('bt-check', 'm5 12.5 4.5 4.5L19 7.5'));
      return mk('div', { class: 'bt-row' }, b, t.custom ? mk('button', { class: 'bt-del', type: 'button', 'data-bt-del': t.id, 'aria-label': 'Remove ' + t.name, title: 'Remove' }, '×') : null);
    };
    let last = '';
    const keyOf = () => [cur(), autoCls(), readCustom().map(t => t.id + t.bg + t.accent).join(',')].join('|');
    function render() {
      last = keyOf();
      const id = cur(), isAuto = id === 'auto' || !byId(id);
      const sel = isAuto ? '' : id;
      const real = byId(isAuto ? autoCls() : id) || CLASSIC[0];
      pillSlot.replaceChildren(pill(shown(real)));
      label.textContent = isAuto ? 'Follow system' : real.name;
      btn.setAttribute('aria-label', 'Appearance: ' + (isAuto ? 'follow system (' + real.name + ')' : real.name));
      const sys = mk('button', { class: 'bt-sys', type: 'button', role: 'switch', 'aria-checked': String(isAuto), 'data-theme-pick': 'auto' },
        mk('span', { class: 'bt-split', 'aria-hidden': 'true' }),
        mk('span', { class: 'bt-t' }, 'Follow system', mk('small', null, opts.systemLabel || 'Light or dark as your system is')), mk('span', { class: 'bt-sw', 'aria-hidden': 'true' }));
      const cus = readCustom();
      body.replaceChildren(sys,
        mk('div', { class: 'bt-h' }, 'Dark'), mk('div', { class: 'bt-grid' }, LIST.filter(t => t.dark).map(t => item(t, sel))),
        mk('div', { class: 'bt-h' }, 'Light'), mk('div', { class: 'bt-grid' }, LIST.filter(t => !t.dark).map(t => item(t, sel))),
        cus.length ? mk('div', { class: 'bt-h' }, 'Custom') : null,
        cus.length ? mk('div', { class: 'bt-grid' }, cus.map(t => item(t, sel))) : null);
    }

    const isOpen = () => { try { return supported ? pop.matches(':popover-open') : pop.classList.contains('bt-open'); } catch { return false; } };
    function place() {
      const r = btn.getBoundingClientRect(), w = Math.min(392, innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
      pop.style.top = Math.min(r.bottom + 8, Math.max(8, innerHeight - 120)) + 'px';
      pop.style.right = 'auto'; pop.style.bottom = 'auto';
    }
    function open() {
      if (isOpen()) return;
      render(); place();
      if (supported) { try { pop.showPopover(); } catch { pop.classList.add('bt-open'); } }
      else { pop.hidden = false; pop.classList.add('bt-open'); }
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      if (supported) { try { if (pop.matches(':popover-open')) pop.hidePopover(); } catch {} }
      pop.classList.remove('bt-open');
      if (!supported) pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    pop.addEventListener('toggle', () => btn.setAttribute('aria-expanded', String(isOpen())));
    const pick = id => { close(); try { opts.onChange && opts.onChange(id); } catch (e) { console.error('[bbThemes]', e); } };

    const say = (text, err) => { msg.textContent = text; msg.classList.toggle('err', !!err); };
    function add(text) {
      const r = importJson(text);
      if (!r.ok) { say(r.error, true); return; }
      say('Added ' + r.added.join(', ') + '.');
      ta.value = '';
      render();
      if (r.ids && r.ids[0]) pick(r.ids[0]);
    }
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 512 * 1024) { say('That file is too big for a theme.', true); return; }
      f.text().then(add, () => say('Could not read the file.', true));
      file.value = '';
    });

    // the picker handles its own clicks; the shell's delegated handlers never see them
    wrap.addEventListener('click', e => {
      const p = e.composedPath ? e.composedPath() : [e.target];
      const t = p[0] && p[0].nodeType === 1 ? p[0] : e.target;
      if (!t || !t.closest) return;
      e.stopPropagation();
      if (t.closest('[data-bt-open]')) { isOpen() ? close() : open(); return; }
      if (t.closest('[data-bt-import]')) { importBox.hidden = !importBox.hidden; say(''); if (!importBox.hidden) ta.focus(); place(); return; }
      if (t.closest('[data-bt-file]')) { file.click(); return; }
      if (t.closest('[data-bt-add]')) { if (ta.value.trim()) add(ta.value); else say('Paste a theme first, or choose a file.', true); return; }
      if (t.closest('[data-bt-reset]')) { pick('auto'); return; }
      const del = t.closest('[data-bt-del]');
      if (del) {
        const id = del.getAttribute('data-bt-del'), wasCur = cur() === id;
        removeCustom(id); render();
        if (wasCur) pick('auto');
        return;
      }
      const pk = t.closest('[data-theme-pick]');
      if (pk) {
        const id = pk.getAttribute('data-theme-pick');
        // the Follow system switch: on -> the theme it resolves to, off -> follow again
        if (id === 'auto' && cur() === 'auto') pick(autoCls()); else pick(id);
      }
    });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); btn.focus(); } });
    if (!supported) root.addEventListener('click', e => { if (isOpen() && !wrap.contains(e.composedPath ? e.composedPath()[0] : e.target)) close(); }, true);

    render();
    return { el: wrap, update() { if (keyOf() !== last) render(); }, close, open, isOpen };
  }

  return { LIST, CLASSIC, byId, custom, removeCustom, importJson, classOf, apply, fillSelect, mountPicker, CSS, isClassic };
})();

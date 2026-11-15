/* Settings without leaving Pinterest: an entry in the left nav (like Instagram's sidebar gear), an optional
   floating button, and Alt+W — all opening the settings form in a panel over the page
   (PIN.openSettings, made in build.js with userscript/panel.js). */
(() => {
  const LABEL = 'Better Browsing';
  const GEAR = '<path d="M19.14 12.94a7.1 7.1 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.1 7.1 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.34.61.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.19.12.47.02.61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z"/>';

  PIN.settingsOpen = () => !!document.querySelector('.pin-settings');

  function openPanel(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    PIN.openSettings();
  }

  // ---------- left nav entry ----------
  // Pinterest's nav is a column of identical wrappers ([data-test-id="vertical-nav-icon"], one icon + link each).
  // Clone one so ours matches the current look (collapsed rail or with labels), then swap the icon, label and
  // behaviour. Class names are generated, so nothing here depends on them.
  // The column that holds the logo button and the icon wrappers (Pinterest's left rail). Anchor on the logo,
  // then walk up until the nav items are inside it.
  function navColumn() {
    const logo = document.querySelector('[data-test-id="pinterest-logo-home-button"]');
    const first = document.querySelector('[data-test-id="vertical-nav-icon"]');
    if (!first) return null;
    let col = logo ? logo.parentElement : first.parentElement;
    for (let i = 0; i < 3 && col && !col.contains(first); i++) col = col.parentElement;
    return col && col.contains(first) ? col : null;
  }

  function mountNavEntry() {
    const old = document.querySelector('.pin-nav-entry');
    if (!PIN.settings.sidebarEntry) { old?.remove(); return; }
    const col = navColumn();
    if (!col) return;                       // page without the nav (or it has not rendered yet)
    if (old) {
      if (col.contains(old)) return;        // already in place
      old.remove();                         // re-rendered nav: drop the stale one and add a fresh clone
    }
    const src = col.querySelector('[data-test-id="vertical-nav-icon"]');
    if (!src) return;
    const node = src.cloneNode(true);
    node.classList.add('pin-nav-entry');
    node.removeAttribute('data-test-id');
    node.querySelectorAll('[data-test-id]').forEach(el => el.removeAttribute('data-test-id'));
    node.querySelectorAll('[aria-label]').forEach(el => el.setAttribute('aria-label', LABEL));
    const a = node.querySelector('a');
    if (!a) return;
    a.setAttribute('href', '#');
    a.setAttribute('role', 'button');
    a.setAttribute('title', LABEL + ' settings (Alt+W)');
    a.addEventListener('click', openPanel);
    const svg = a.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.removeAttribute('fill');
      svg.setAttribute('fill', 'currentColor');
      svg.setAttribute('aria-label', LABEL);
      svg.innerHTML = GEAR;
    }
    // any visible or screen-reader text of the original entry
    const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const t = walk.currentNode.textContent.trim();
      if (t && !walk.currentNode.parentElement.closest('svg')) walk.currentNode.textContent = LABEL;
    }
    col.append(node);
  }

  // ---------- floating button ----------
  let btn = null;
  function mountButton() {
    if (!PIN.settings.settingsButton) { btn?.remove(); btn = null; return; }
    if (btn?.isConnected) return;
    btn = PIN.h('button', {
      class: 'pin-gear', type: 'button', title: LABEL + ' settings (Alt+W)', 'aria-label': LABEL + ' settings',
      onclick: openPanel
    });
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">' + GEAR + '</svg>';
    document.documentElement.append(btn);
  }

  function apply() { mountNavEntry(); mountButton(); }
  PIN.onSettings(apply);
  PIN.onDomChange(apply, 600);

  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') {
      e.preventDefault(); e.stopPropagation();
      PIN.openSettings();
    }
  }, true);
})();

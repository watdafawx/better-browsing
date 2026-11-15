/* Settings without leaving Pinterest: a floating button in the bottom-right corner and Alt+W, both opening
   the settings form in a panel over the page (PIN.openSettings, made in build.js with userscript/panel.js). */
(() => {
  const GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  PIN.settingsOpen = () => !!document.querySelector('.pin-settings');
  let btn = null;

  function mountButton() {
    if (!PIN.settings.settingsButton) {
      btn?.remove(); btn = null;
      return;
    }
    if (btn?.isConnected) return;
    btn = PIN.h('button', {
      class: 'pin-gear', type: 'button', title: 'Better Browsing settings (Alt+W)', 'aria-label': 'Better Browsing settings',
      onclick: e => { e.preventDefault(); e.stopPropagation(); PIN.openSettings(); }
    });
    btn.innerHTML = GEAR;
    document.documentElement.append(btn);
  }

  PIN.onSettings(mountButton);
  PIN.onDomChange(mountButton, 600);

  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') {
      e.preventDefault(); e.stopPropagation();
      PIN.openSettings();
    }
  }, true);
})();

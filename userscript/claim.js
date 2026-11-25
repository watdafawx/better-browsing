/* Shared by every bundle: one copy per page. Each site is published as its own script (Better Browsing for
   Reddit, Instagram, X, Pinterest), the old combined script is still published while users move over, and the
   MV3 extension (ext/) runs the same site code. With two of them installed, two copies would patch the same
   players, so each site block first claims the page:
   bbClaim(site, mode) sets <html data-bb-site="<site>" data-bb-by="<site>|combined|ext"> and returns true, or
   returns false when this copy must not run. mode: false (a per-site script), true or 'combined' (the combined
   script), 'ext' (the extension). See "One copy per page" in CLAUDE.md.
   - A per-site script exits when the page is already claimed. If the combined script claimed it, it leaves
     the mark `bb-split-<site>` in localStorage, so the combined script stands aside from the next load on.
   - The combined script exits when the page is claimed, or when that mark is set (a per-site script ran
     here before; managers run scripts in install order, so the older combined one usually goes first).
     If no copy has claimed the page by DOMContentLoaded, the per-site script is gone (removed, disabled):
     the mark is dropped and the combined script runs again from the next load.
   - The extension beats every userscript: it sets the mark `bb-ext-<site>` whenever it runs, and a userscript
     (per-site or combined) exits when <html data-bb-by="ext"> is set or that mark exists, whatever the install
     order. The mark goes stale when the extension is removed or disabled: the same DOMContentLoaded rule drops
     it (no copy claimed the page) and the userscript runs again from the next load. If a userscript got to the
     page first, the extension leaves it be for that one load (it cannot take the page back) and the mark makes
     the userscript stand aside from the next load on. The extension's page-world file may already have
     claimed the page (data-bb-by="ext"), which its content script then counts as its own. */
const bbClaim = (site, mode) => {
  const root = document.documentElement, mark = 'bb-split-' + site, extMark = 'bb-ext-' + site;
  const ext = mode === 'ext', combined = mode === true || mode === 'combined';
  const claimed = () => root.hasAttribute('data-bb-site');
  const store = (fn, fallback) => { try { return fn(localStorage); } catch { return fallback; } };
  const stale = m => {
    const check = () => { if (!claimed()) store(s => s.removeItem(m)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
    else setTimeout(check, 0);
  };
  if (ext) {
    store(s => s.setItem(extMark, '1'));
    if (claimed() && root.getAttribute('data-bb-by') !== 'ext') return false;
  } else {
    if (root.getAttribute('data-bb-by') === 'ext') return false;
    if (store(s => s.getItem(extMark), null)) { stale(extMark); return false; }
  }
  if (ext) { /* claim below */ } else if (combined) {
    if (claimed()) return false;
    if (store(s => s.getItem(mark), null)) { stale(mark); return false; }
  } else {
    if (claimed()) {
      if (root.getAttribute('data-bb-by') === 'combined') store(s => s.setItem(mark, '1'));
      return false;
    }
    store(s => s.setItem(mark, '1'));
  }
  root.setAttribute('data-bb-site', site);
  root.setAttribute('data-bb-by', ext ? 'ext' : combined ? 'combined' : site);
  return true;
};

/* The combined script, running on a site other than Reddit, says once (per site, localStorage
   `bb-split-notice`) that this site has its own script now. A manual popover in a shadow root (no light
   dismiss, the site's CSS can't reach it), with a close button; nothing moves, so no reduced-motion case.
   The same text is in the README's install section. */
const bbSplitNotice = (label, installUrl, readmeUrl) => {
  const key = 'bb-split-notice';
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  const show = () => {
    const host = document.createElement('div');
    host.className = 'bb-split-notice';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Better Browsing');
    const root = host.attachShadow({ mode: 'open' });
    const pop = Object.hasOwn(HTMLElement.prototype, 'popover');
    const text = `Better Browsing now has one script per site. Install Better Browsing for ${label} to keep this site's features up to date, then remove the combined "Better Browsing (Reddit + Instagram)" script once you have the scripts you want.`;
    root.innerHTML = `<style>
      .box { position: fixed; inset: auto 16px 16px auto; margin: 0; max-width: min(380px, calc(100vw - 32px)); box-sizing: border-box;
        padding: 14px 16px; border: 1px solid #8884; border-radius: 10px; background: #1e1f22; color: #f2f3f5;
        font: 14px/1.45 system-ui, sans-serif; box-shadow: 0 6px 24px #0006; z-index: 2147483647; }
      p { margin: 0 0 10px; } a { color: #8ab4ff; } .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
      button { margin-left: auto; font: inherit; padding: 4px 12px; border-radius: 6px; border: 1px solid #8886; background: #2b2d31; color: inherit; cursor: pointer; }
    </style><div class="box" id="box"${pop ? ' popover="manual"' : ''}><p></p><div class="row">
      <a class="install" target="_blank" rel="noopener">Install for ${label}</a><a class="more" target="_blank" rel="noopener">Why?</a>
      <button type="button"${pop ? ' popovertarget="box" popovertargetaction="hide"' : ''}>Close</button></div></div>`;
    const box = root.getElementById('box');
    root.querySelector('p').textContent = text;
    root.querySelector('.install').href = installUrl;
    root.querySelector('.more').href = readmeUrl;
    const close = () => host.remove();
    if (pop) box.addEventListener('toggle', e => { if (e.newState === 'closed') close(); });
    else root.querySelector('button').addEventListener('click', close);
    document.body.append(host);
    if (pop) box.showPopover();
    if (typeof document.ariaNotify === 'function') document.ariaNotify(text + ' Actions available.');
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
};

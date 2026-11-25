/* Extension build only (ext/build.js puts this once at the top of each site's content.js, after claim.js).
   The extension API of this browser (Firefox: `browser`, promises; Chrome: `chrome`) and one `send(msg)` that
   resolves with the worker's answer, or null when there is none (worker gone, extension reloaded, no
   handler). Promise form on purpose: Firefox's `browser.*` ignores callbacks. */
const bbExt = (() => {
  const api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const send = msg => {
    try { return Promise.resolve(api.runtime.sendMessage(msg)).then(r => r || null, () => null); } catch { return Promise.resolve(null); }
  };
  return { api, send, DEV: __BB_DEV__, SITE: __BB_SITE__, VERSION: __BB_VERSION__ };
})();

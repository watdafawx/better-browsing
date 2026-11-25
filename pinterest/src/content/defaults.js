/* Pinterest Better Browsing: shared defaults (loaded by content scripts and the popup) */
var PIN = globalThis.PIN || (globalThis.PIN = {});

PIN.DEFAULTS = {
  // Video
  videoMode: 'volume',        // default (Pinterest decides) | volume | muted | off (no autoplay)
  videoVolume: 40,            // 0-100
  feedSound: false,           // feed/grid videos play with sound (off: they stay muted, as Pinterest intends)
  nativeControls: true,       // browser controls on pin videos
  videoLoop: true,
  videoPauseOffscreen: true,
  videoPauseOnHide: true,     // pause when the tab is hidden or the window loses focus

  // Lightbox
  lightbox: true,             // click a pin in the grid and open it in our viewer
  lightboxText: true,         // description, author and stats side panel
  lightboxComments: true,     // the pin's comments in that panel
  lightboxFilmstrip: true,

  // Feed
  hidePromoted: true,         // promoted (ad) pins out of the grid

  // Page
  sidebarEntry: true,         // settings entry in Pinterest's left nav (like Instagram's sidebar gear)
  settingsButton: false,      // floating button in the bottom-right corner (Alt+W always works)

  // Fast UI (beta, content/fast/): our own Home grid and pin viewer instead of Pinterest's page
  fastUi: false,              // the whole mode (opt-in)
  fastUiTheme: 'auto',        // auto | black | dim | light
  fastUiNativeButton: true,   // 'Native Pinterest' button in the top bar
  fastUiKeys: true            // Alt+Shift+P and the viewer's keys
};

PIN.mergeSettings = stored => Object.assign({}, PIN.DEFAULTS, stored || {});

PIN.loadSettings = async function () {
  const sync = await PIN.api?.storage?.sync.get('settings').catch(() => ({}));
  return PIN.mergeSettings(sync?.settings);
};

/* Promoted pins: mark the cards, and let one class on <html> hide them, so nothing is restyled per card. */
(() => {
  function apply() {
    const on = !!PIN.settings.hidePromoted;
    document.documentElement.classList.toggle('pin-hide-promoted', on);
    document.querySelectorAll('[data-test-id="pin"]').forEach(el => el.classList.toggle('pin-ad', PIN.isPromoted(el)));
  }
  PIN.onSettings(apply);
  PIN.onDomChange(apply, 400);
})();

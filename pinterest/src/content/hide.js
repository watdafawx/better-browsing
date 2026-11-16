/* Promoted pins: mark the cards, and let one class on <html> hide them, so nothing is restyled per card.
   Reading every card's text on every mutation was the cost in Firefox's content realm, so a card is only
   inspected when its content actually changed (child count differs) or when the setting is switched. */
(() => {
  const seen = new WeakMap();     // card -> [epoch, childElementCount] it was last judged at
  let epoch = 0;

  function apply() {
    const on = !!PIN.settings.hidePromoted;
    document.documentElement.classList.toggle('pin-hide-promoted', on);
    if (!on) return;
    document.querySelectorAll('[data-test-id="pin"]').forEach(el => {
      const n = el.childElementCount, prev = seen.get(el);
      if (prev && prev[0] === epoch && prev[1] === n) return;     // unchanged since the last look
      seen.set(el, [epoch, n]);
      el.classList.toggle('pin-ad', PIN.isPromoted(el));
    });
  }

  PIN.onSettings(() => { epoch++; apply(); });
  PIN.onDomChange(apply, 700, 'promoted');
  PIN.ready.then(apply);          // one pass after the settings read, in case the page stopped mutating
})();

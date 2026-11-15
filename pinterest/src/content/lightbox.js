/* Pin viewer: click a pin in the grid and it opens over the page. Wheel / arrows / the buttons step through the
   pins (and through an idea pin's pages), click the media to zoom, Esc or the ✕ closes. Data comes from
   PIN.getPin (PinResource/get), because the grid is virtualised: the DOM cannot be the source of truth. */
(() => {
  const h = (...a) => PIN.h(...a);
  let lb = null;

  // Ordered pin ids from the grid, with the card element so we can put the feed back where it was.
  function gridEntries() {
    const out = [], seen = new Set();
    document.querySelectorAll('[data-test-id="pin"]').forEach(el => {
      const id = el.getAttribute('data-test-pin-id');
      if (!id || seen.has(id)) return;
      if (PIN.settings.hidePromoted && PIN.isPromoted(el)) return;
      seen.add(id);
      const img = el.querySelector('img');
      out.push({ id, el, thumb: img?.currentSrc || img?.src || '' });
    });
    return out;
  }

  const imgOf = p => p?.images?.orig?.url || p?.images?.originals?.url || p?.images?.['1200x']?.url || p?.images?.['750x']?.url || p?.images?.['736x']?.url || '';
  const num = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

  // One pin -> what the viewer shows. `pages` is an idea pin (story_pin_data).
  function toItem(p) {
    if (!p) return null;
    const story = p.story_pin_data;
    if (story?.pages?.length) {
      const pages = story.pages.map(pg => {
        const vid = pg.video?.video_list?.V_720P?.url || pg.video?.video_list?.V_HLSV4?.url || '';
        const img = imgOf(pg.image) || (pg.blocks || []).map(b => imgOf(b.image)).find(Boolean) || '';
        return { video: vid, image: img };
      }).filter(x => x.video || x.image);
      if (pages.length) return { type: 'story', pages, pin: p };
    }
    const list = p.videos?.video_list;
    const video = list ? (list.V_720P?.url || Object.values(list).map(v => v?.url).find(u => /\.mp4/i.test(u || '')) || '') : '';
    if (video) return { type: 'video', src: video, poster: imgOf(p), pin: p };
    const img = imgOf(p);
    return img ? { type: 'image', src: img, pin: p } : null;
  }

  class Viewer {
    constructor(entries, pi) {
      this.entries = entries;
      this.pi = pi;
      this.pg = 0;
      this.items = new Map();
      this.lastStep = 0;

      this.count = h('span', { class: 'pin-lb-count' });
      this.title = h('span', { class: 'pin-lb-title' });
      this.open = h('a', { class: 'pin-lb-btn', target: '_blank', rel: 'noopener', title: 'Open on Pinterest' }, '↗');
      this.copy = h('button', { class: 'pin-lb-btn', title: 'Copy link', onclick: () => this.copyLink() }, '📋');
      this.closeBtn = h('button', { class: 'pin-lb-btn', title: 'Close (Esc)', onclick: () => this.close() }, '✕');
      this.stage = h('div', { class: 'pin-lb-stage' });
      this.side = h('aside', { class: 'pin-lb-side' });
      this.film = h('div', { class: 'pin-lb-film' });
      this.prev = h('button', { class: 'pin-lb-nav prev', title: 'Previous', onclick: () => this.step(-1) }, '‹');
      this.next = h('button', { class: 'pin-lb-nav next', title: 'Next', onclick: () => this.step(1) }, '›');

      this.root = h('div', { class: 'pin-root pin-lb', tabindex: '-1' },
        h('div', { class: 'pin-lb-bar' }, this.count, this.title, this.open, this.copy, this.closeBtn),
        h('div', { class: 'pin-lb-main' },
          h('div', { class: 'pin-lb-stagewrap' }, this.stage, this.prev, this.next),
          this.side),
        this.film);

      this.onKey = this.onKey.bind(this);
      document.documentElement.append(this.root);
      document.documentElement.classList.add('pin-noscroll');
      document.documentElement.setAttribute('data-pin-lb', '');   // main-world.js stops page videos
      window.addEventListener('keydown', this.onKey, true);
      this.root.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      this.root.addEventListener('click', e => {
        if (e.target === this.root || e.target === this.stage || e.target.classList.contains('pin-lb-stagewrap')) this.close();
      });
      this.root.focus({ preventScroll: true });
      this.show();
    }

    async item(i = this.pi) {
      const id = this.entries[i]?.id;
      if (!id) return null;
      if (!this.items.has(id)) this.items.set(id, toItem(await PIN.pinData(id)));
      return this.items.get(id);
    }

    async show() {
      const item = await this.item();
      this.cur = item;
      const pin = item?.pin;
      PIN.destroyVideos(this.stage);
      this.stage.replaceChildren();
      if (!this.cur) {
        this.stage.append(h('div', { class: 'pin-lb-err' }, 'Could not load this pin. ',
          h('a', { href: 'https://www.pinterest.com/pin/' + this.entries[this.pi]?.id + '/', target: '_blank', rel: 'noopener' }, 'Open on Pinterest')));
      } else {
        const pg = this.cur.type === 'story' ? Math.min(this.pg, this.cur.pages.length - 1) : 0;
        this.pg = pg;
        const media = this.mediaFor(this.cur, pg);
        if (media) this.stage.append(media);
      }
      const pages = this.cur?.type === 'story' ? this.cur.pages.length : 0;
      this.count.textContent = `pin ${this.pi + 1} / ${this.entries.length}` + (pages ? ` · page ${this.pg + 1} / ${pages}` : '');
      this.title.textContent = pin?.title || pin?.grid_title || pin?.closeup_unified_title || '';
      const id = this.entries[this.pi]?.id || '';
      this.open.href = 'https://www.pinterest.com/pin/' + id + '/';
      this.renderSide(pin);
      this.renderFilm();
      this.prev.disabled = this.pi === 0 && !(this.cur?.type === 'story' && this.pg > 0);
      this.next.disabled = false;
    }

    mediaFor(item, pg) {
      if (item.type === 'story') {
        const p = item.pages[pg] || {};
        return p.video ? this.video(p.video, p.image) : this.image(p.image);
      }
      if (item.type === 'video') return this.video(item.src, item.poster);
      return this.image(item.src);
    }

    image(src) {
      if (!src) return null;
      const img = h('img', { class: 'pin-lb-media', src, alt: '', draggable: 'false' });
      img.addEventListener('click', e => this.zoom(e, img));
      return img;
    }

    video(src, poster) {
      const v = h('video', { class: 'pin-lb-media pin-lb-video', poster: poster || null, playsinline: true });
      v.src = src;
      PIN.setupOwnVideo(v);
      return v;
    }

    zoom(e, img) {
      if (img.classList.contains('zoomed')) { img.classList.remove('zoomed'); img.style.transformOrigin = ''; return; }
      const r = img.getBoundingClientRect();
      img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
      img.classList.add('zoomed');
    }

    renderSide(pin) {
      const show = PIN.settings.lightboxText !== false && (pin?.description || pin?.pinner?.username || pin?.comment_count != null || pin?.title);
      this.side.hidden = !show;
      this.root.classList.toggle('no-side', !show);
      if (!show) return this.side.replaceChildren();
      const d = pin || {};
      const comments = d.comment_count || 0;
      this.side.replaceChildren(...[
        d.pinner?.username ? h('div', { class: 'pin-lb-author' }, 'by @' + d.pinner.username) : null,
        h('h2', null, d.title || d.grid_title || ''),
        d.description ? h('p', { class: 'pin-lb-desc' }, d.description) : null,
        h('div', { class: 'pin-lb-stats' },
          d.repin_count != null ? `▲ ${num(d.repin_count)} saves` : '',
          comments ? ` · 💬 ${num(comments)} comments` : ''),
        comments
          ? h('a', { class: 'pin-lb-comments', href: 'https://www.pinterest.com/pin/' + this.entries[this.pi].id + '/', target: '_blank', rel: 'noopener' }, 'Read the comments on Pinterest ↗')
          : h('div', { class: 'pin-lb-muted' }, 'No comments yet.'),
      ].filter(Boolean));
    }

    renderFilm() {
      const on = PIN.settings.lightboxFilmstrip !== false && this.entries.length > 1;
      this.film.hidden = !on;
      if (!on) return this.film.replaceChildren();
      this.film.replaceChildren(...this.entries.map((e, i) => h('img', {
        src: e.thumb || '', class: i === this.pi ? 'on' : '', loading: 'lazy', alt: '',
        onclick: ev => { ev.stopPropagation(); this.pi = i; this.pg = 0; this.show(); }
      })));
      this.film.children[this.pi]?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    copyLink() {
      const id = this.entries[this.pi]?.id;
      const url = 'https://www.pinterest.com/pin/' + id + '/';
      navigator.clipboard?.writeText(url).then(() => PIN.toast('Link copied'), () => PIN.toast(url));
    }

    onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); this.step(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); this.step(-1); }
    }

    onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey) return;
      const now = Date.now();
      if (Math.abs(e.deltaY) < 20 || now - this.lastStep < 180) return;
      this.lastStep = now;
      this.step(e.deltaY > 0 ? 1 : -1);
    }

    async step(dir) {
      if (this.busy) return;
      this.busy = true;
      try {
        const item = this.cur;
        if (item?.type === 'story' && this.pg + dir >= 0 && this.pg + dir < item.pages.length) {
          this.pg += dir; await this.show(); return;
        }
        let pi = this.pi + dir;
        if (pi < 0) return;
        if (pi >= this.entries.length && !(await this.more())) { PIN.toast('End of the loaded pins'); return; }
        if (pi >= this.entries.length) return;
        this.pi = pi; this.pg = 0;
        await this.show();
      } finally { this.busy = false; }
    }

    // The grid is virtualised: scrolling the page below the overlay loads more pins.
    async more() {
      const have = new Set(this.entries.map(e => e.id));
      const before = this.entries.length;
      window.scrollTo(0, document.documentElement.scrollHeight);
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 350));
        const now = gridEntries();
        const add = now.filter(e => !have.has(e.id));
        if (add.length) { this.entries.push(...add); return true; }
      }
      return this.entries.length > before;
    }

    close() {
      window.removeEventListener('keydown', this.onKey, true);
      PIN.destroyVideos(this.root);
      this.root.remove();
      document.documentElement.removeAttribute('data-pin-lb');
      document.documentElement.classList.remove('pin-noscroll');
      const el = this.entries[this.pi]?.el;
      if (el?.isConnected) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (lb === this) lb = null;
    }
  }

  PIN.openLightbox = function ({ pinId, el } = {}) {
    lb?.close();
    if (PIN.settings.lightbox === false) return;
    let entries = gridEntries();
    let pi = entries.findIndex(e => e.id === pinId);
    if (pi < 0) {
      entries = [{ id: pinId, el }];
      pi = 0;
    }
    lb = new Viewer(entries, pi);
  };
  PIN.lightboxOpen = () => !!lb;
  PIN.closeLightbox = () => lb?.close();

  // Open on a click of a grid card's link. Capture phase, so Pinterest's router never sees it.
  addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (PIN.settings.lightbox === false) return;
    const a = e.target.closest?.('a[href*="/pin/"]');
    const card = a?.closest('[data-test-id="pin"]');
    if (!card) return;                                  // nav links, the close-up's own links, our overlay
    const id = (a.getAttribute('href') || '').match(/\/pin\/(\d+)/)?.[1];
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    PIN.openLightbox({ pinId: id, el: card });
  }, true);
})();

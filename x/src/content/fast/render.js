/* X Fast UI: tweet cards, built with XBB.h from XBB.model records. Text from X is only ever a text node or an
   attribute (never innerHTML); the only markup strings here are our own constant icons. Links are http(s) only.
     render.tweet(t, row)    one card (any shape: text, photos 1-4, video, GIF, quote, poll, link card, community
                             note, sensitive media, long-form text, retweeted-by, reply-to; tombstones and records
                             we cannot read become a one-line "Open on X" card)
     render.attach(node)     after the node is in the shadow root: its videos join XBB.videoPolicy, its action bar
                             follows the store
     render.release(node)    before the node goes back to the pool: videos stopped and unloaded, subscriptions off
     render.click(e, ctx)    the delegated click handler (actions, "Show more", sensitive reveal; a photo or a video's
                             expand button opens the media lightbox, the card, its time or Reply the thread drawer)
     render.estimate(row)    first guess of a row's height, until the ResizeObserver measures it
   Actions (Reply, Retweet, Like, Like + Retweet, Bookmark, copy embed link) update the store first and undo
   themselves with a toast when X refuses the mutation. */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store;

  // ---------- icons: our constant markup, parsed once, cloned per use ----------
  const P = {
    reply: '<path d="M4 12a8 8 0 0 1 8-7h1a7 7 0 0 1 0 14H9l-5 3v-4.5A7.9 7.9 0 0 1 4 12z"/>',
    rt: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5H16a3 3 0 0 1 3 3V12M17 20l3.5-3.5L17 13M20.5 16.5H8a3 3 0 0 1-3-3V12"/>',
    like: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    lrt: '<path d="M8.5 18s-5-3-5-6.8a2.8 2.8 0 0 1 5-1.7 2.8 2.8 0 0 1 5 1.7c0 3.8-5 6.8-5 6.8z"/><path d="M15 6.5 17.5 4 20 6.5M17.5 4v7.5a2.5 2.5 0 0 1-2.5 2.5"/>',
    bm: '<path d="M6.5 4h11v16.5L12 16.8l-5.5 3.7z"/>',
    copy: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    dl: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
    share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    views: '<path d="M5 20v-7M10 20V6M15 20v-9M20 20V9"/>',
    badge: '<path d="M12 2.5l2.4 1.8 3-.2.9 2.9 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.9-3-.2L12 21.5l-2.4-1.8-3 .2-.9-2.9-2.4-1.8 1-2.8-1-2.8 2.4-1.8.9-2.9 3 .2z"/><path d="m8.5 12 2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    play: '<path d="M7 4.5v15l13-7.5z"/>',
    note: '<circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.4"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 14.5a4.5 4.5 0 0 1 6 4.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    home: '<path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10"/>',
    explore: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    quote: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    back: '<path d="M20 12H5M11 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
    thread: '<path d="M4 12a8 8 0 0 1 8-7h1a7 7 0 0 1 0 14H9l-5 3v-4.5A7.9 7.9 0 0 1 4 12z"/><path d="M8.5 10h7M8.5 13.5h4.5"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
    center: '<rect x="5" y="4" width="14" height="16" rx="2"/>',
    pin: '<path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3zM12 14.5V21"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6.5zM12 13.5 20 4"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    loc: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
  };
  const tpl = new Map();
  function icon(name, cls = 'i') {
    const k = name + '|' + cls;
    let t = tpl.get(k);
    if (!t) {
      t = document.createElement('template');
      t.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
      tpl.set(k, t);
    }
    return t.content.firstChild.cloneNode(true);
  }

  // ---------- small helpers ----------
  const safe = u => { const s = String(u || '').trim(); if (!s) return ''; try { const x = new URL(s, location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  const fmt = n => {
    n = +n || 0;
    if (n <= 0) return '';
    if (n < 1000) return String(n);
    const [d, s] = n < 1e6 ? [1e3, 'K'] : n < 1e9 ? [1e6, 'M'] : [1e9, 'B'];
    const v = n / d;
    return (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.floor(v)) + s;
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const rel = ms => {
    if (!ms) return '';
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return Math.max(1, Math.floor(s)) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    const d = new Date(ms), y = new Date().getFullYear();
    return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== y ? ', ' + d.getFullYear() : '');
  };
  const full = ms => { try { return new Date(ms).toLocaleString(); } catch { return ''; } };
  const path = t => `/${t.author.screenName || 'i'}/status/${t.id}`;
  const withVar = (el, k, v) => { el.style.setProperty(k, v); return el; };
  const hue = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };

  function avatar(u, cls = '') {
    const src = safe(XBB.model.avatarSize(u.avatar, cls.includes('sm') ? 'normal' : 'bigger'));
    if (src) return h('img', { class: 'av ' + cls, src, alt: '', loading: 'lazy', decoding: 'async', width: 40, height: 40 });
    const ini = (u.name || u.screenName || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
    return withVar(h('span', { class: 'av ini ' + cls, 'aria-hidden': 'true' }, ini), '--h', String(hue(u.screenName || u.id)));
  }
  function badge(u) {
    if (!u.verified) return null;
    const vt = String(u.verifiedType || '');
    const b = icon('badge', 'i fill badge' + (vt === 'Business' ? ' gold' : vt === 'Government' ? ' grey' : ''));
    b.setAttribute('aria-label', 'Verified');
    b.removeAttribute('aria-hidden');
    return b;
  }
  function head(t, small) {
    const u = t.author, p = path(t);
    return h('div', { class: 'head' },
      small ? avatar(u, 'sm') : null,
      h('a', { class: 'name', href: '/' + u.screenName }, u.name || u.screenName),
      badge(u),
      h('span', { class: 'handle' }, '@' + u.screenName),
      t.createdAtMs ? h('span', { class: 'dot' }, '·') : null,
      t.createdAtMs ? h('a', { class: 'when', href: p }, h('time', { datetime: t.createdAt || '', title: full(t.createdAtMs) }, rel(t.createdAtMs))) : null);
  }

  // ---------- rich text: mentions, hashtags and links from the entities, found by their text ----------
  // X's index ranges count different units in different responses; the literal token is what is certain.
  function rich(t, opts = {}) {
    const frag = document.createDocumentFragment();
    let text = String(t.text || '');
    const ents = t.entities || {};
    // media links, and the link to the quoted tweet, are shown as the media / quote card instead
    const drop = new Set((t.media || []).map(m => m.tcoUrl).filter(Boolean));
    for (const u of ents.urls || []) if (t.quote && t.quote.id && new RegExp('/status/' + t.quote.id + '(?:\\D|$)').test(u.expandedUrl || '')) drop.add(u.url);
    for (const d of drop) text = text.split(d).join('');
    text = text.replace(/[ \t]+$/gm, '').trim();
    const toks = [];
    for (const u of ents.urls || []) if (u.url && !drop.has(u.url)) toks.push({ s: u.url, kind: 'url', u });
    for (const m of ents.mentions || []) if (m.screenName) toks.push({ s: '@' + m.screenName, kind: 'mention', m, ci: true });
    for (const g of ents.hashtags || []) if (g.text) toks.push({ s: '#' + g.text, kind: 'tag', g, ci: true });
    const low = text.toLowerCase();
    const word = c => /[\w]/.test(c || '');
    let i = 0;
    while (i < text.length) {
      let best = null, at = -1;
      for (const k of toks) {
        let j = (k.ci ? low : text).indexOf(k.ci ? k.s.toLowerCase() : k.s, i);
        while (j >= 0 && k.kind !== 'url' && word(text[j + k.s.length])) j = (k.ci ? low : text).indexOf(k.ci ? k.s.toLowerCase() : k.s, j + 1);
        if (j >= 0 && (at < 0 || j < at || (j === at && k.s.length > best.s.length))) { best = k; at = j; }
      }
      if (!best) { frag.append(text.slice(i)); break; }
      if (at > i) frag.append(text.slice(i, at));
      const raw = text.slice(at, at + best.s.length);
      if (best.kind === 'url') {
        const href = safe(best.u.expandedUrl || best.u.url);
        frag.append(href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', title: best.u.expandedUrl || '' }, best.u.displayUrl || best.u.expandedUrl || raw) : raw);
      } else if (best.kind === 'mention') frag.append(opts.plain ? raw : h('a', { href: '/' + best.m.screenName }, raw));
      else frag.append(opts.plain ? raw : h('a', { href: '/hashtag/' + encodeURIComponent(best.g.text) + '?src=hashtag_click' }, raw));
      i = at + best.s.length;
    }
    return frag;
  }

  // ---------- media ----------
  const photoSrc = (u, size) => { const s = safe(u); if (!s) return ''; return /pbs\.twimg\.com\/media\//.test(s) && !s.includes('?') ? s + '?name=' + size : s; };
  // The best MP4 at or under 720p (1080p on a wide player); X's MP4s carry the sound, so no HLS needed
  function mp4(m) {
    const vs = m.variants && m.variants.length ? m.variants : (m.url ? [{ url: m.url, bitrate: m.bitrate }] : []);
    const cap = innerWidth > 1600 ? 6e6 : 2.5e6;
    return safe((vs.find(v => v.bitrate <= cap) || vs[vs.length - 1] || {}).url);
  }
  const ratio = m => m.aspectRatio || (m.width && m.height ? m.width / m.height : 16 / 9);
  function videoEl(m, t) {
    const src = mp4(m);
    if (!src) return h('a', { class: 'novid', href: path(t) }, icon('play', 'i fill'), 'Play on X');
    const gif = m.type === 'gif';
    const v = h('video', gif
      ? { 'data-xbb-gif': '', loop: true, autoplay: true, muted: true, playsinline: true, preload: 'auto', poster: safe(m.poster), 'aria-label': m.alt || 'GIF' }
      : { controls: true, preload: 'none', playsinline: true, poster: safe(m.poster), 'aria-label': m.alt || 'Video', 'data-xbb-fast-video': '' });
    if (gif) v.muted = true;
    v.src = src;
    return v;
  }
  // The button that opens a video in the lightbox (a GIF opens on a click anywhere: it has no controls)
  const expandBtn = i => h('button', { class: 'expand', type: 'button', 'data-lb': String(i), title: 'Open in the viewer', 'aria-label': 'Open in the viewer' }, icon('expand'));
  function videoBox(m, t) {
    const r = ratio(m), gif = m.type === 'gif';
    return h('div', { class: 'vid' + (gif ? ' gif' : ''), 'data-testid': 'videoPlayer', 'data-lb': gif ? '0' : null, style: { aspectRatio: String(Math.max(r, 0.8)) } },
      h('div', { class: 'vc', 'data-testid': 'videoComponent' }, videoEl(m, t)),
      gif ? h('span', { class: 'tag' }, 'GIF') : expandBtn(0));
  }
  function cell(m, t, i, n) {
    const gif = m.type === 'gif';
    if (m.type === 'video' || gif) return h('div', { class: 'ph v' + (gif ? ' gif' : ''), 'data-testid': 'videoPlayer', 'data-lb': gif ? String(i) : null }, h('div', { class: 'vc', 'data-testid': 'videoComponent' }, videoEl(m, t)), gif ? null : expandBtn(i));
    const src = photoSrc(m.url, n === 1 ? 'medium' : 'small');
    return h('a', { class: 'ph', href: path(t) + '/photo/' + (i + 1), 'data-lb': String(i), 'aria-label': m.alt || `Photo ${i + 1} of ${n}`, style: n === 1 ? { aspectRatio: String(Math.max(ratio(m), 0.75)) } : null },
      src ? h('img', { src, alt: m.alt || '', loading: 'lazy', decoding: 'async', width: m.width || null, height: m.height || null }) : null,
      m.alt ? h('span', { class: 'alt', title: m.alt }, 'ALT') : null);
  }
  const revealed = new Set();
  function media(t, small) {
    const list = (t.media || []).slice(0, 4);
    if (!list.length) return null;
    const hidden = t.sensitive && !(XBB.settings && XBB.settings.fastUiShowSensitive) && !revealed.has(t.id);
    let box;
    if (list.length === 1 && (list[0].type === 'video' || list[0].type === 'gif') && !hidden && !small) box = videoBox(list[0], t);
    else if (hidden || small) {
      // covered (sensitive) or inside a quote: pictures only, nothing that plays
      box = h('div', { class: 'media n' + list.length }, list.map((m, i) => {
        const src = photoSrc(m.type === 'photo' ? m.url : m.poster, 'small');
        return h('div', { class: 'ph', style: list.length === 1 ? { aspectRatio: String(Math.max(ratio(m), 0.75)) } : null },
          src ? h('img', { src, alt: m.alt || '', loading: 'lazy', decoding: 'async' }) : null,
          !hidden && m.type !== 'photo' ? h('span', { class: 'playmark' }, icon('play', 'i fill')) : null);
      }));
    } else box = h('div', { class: 'media n' + list.length }, list.map((m, i) => cell(m, t, i, list.length)));
    if (!hidden) return box;
    return h('div', { class: 'sens' }, box,
      h('div', { class: 'reveal' },
        icon('eye'),
        h('span', { class: 'sens-title' }, 'Sensitive content'),
        h('div', { class: 'sens-acts' },
          h('button', { class: 'sens-btn primary', type: 'button', 'data-act': 'reveal', 'data-id': t.id }, 'Show'),
          h('button', { class: 'sens-btn', type: 'button', 'data-act': 'reveal-always', 'data-id': t.id }, 'Always show'))));
  }

  // ---------- cards ----------
  function quote(q) {
    if (!q) return null;
    if (q.unavailable || q.type !== 'tweet') return h('div', { class: 'quote tomb' }, q.reason || 'This post is unavailable.');
    return h('div', { class: 'quote', 'data-href': path(q), 'data-qid': q.id, role: 'link', tabindex: '0' },
      head(q, true),
      q.text ? h('div', { class: 'text' }, rich(q, { plain: true })) : null,
      media(q, true));
  }
  function poll(c) {
    const total = c.total || 0, max = Math.max(0, ...c.choices.map(x => x.count));
    const ends = c.final ? 'Final results' : c.endTimeMs ? (c.endTimeMs > Date.now() ? 'Ends ' + full(c.endTimeMs) : 'Final results') : '';
    return h('div', { class: 'poll voted' },
      c.choices.map(x => {
        const pct = total ? Math.round(x.count / total * 100) : 0;
        return withVar(h('div', { class: 'opt' + (x.count === max && total ? ' win' : '') }, h('span', null, x.label), h('span', { class: 'pc' }, pct + '%')), '--p', pct + '%');
      }),
      h('div', { class: 'meta' }, `${total.toLocaleString('en-US')} vote${total === 1 ? '' : 's'}${ends ? ' · ' + ends : ''}`));
  }
  function linkCard(c) {
    const href = safe(c.url);
    if (!href || !(c.title || c.domain)) return null;
    const img = c.thumb && safe(c.thumb.url);
    return h('a', { class: 'lcard' + (img ? '' : ' noimg'), href, target: '_blank', rel: 'noopener noreferrer nofollow' },
      img ? h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', style: c.thumb.width && c.thumb.height ? { aspectRatio: c.thumb.width + ' / ' + c.thumb.height } : null }) : null,
      h('span', { class: 'lc-body' },
        c.domain ? h('small', null, c.domain) : null,
        c.title ? h('b', null, c.title) : null,
        c.description ? h('span', { class: 'desc' }, c.description) : null));
  }
  function note(n) {
    if (!n || !n.text) return null;
    const href = safe(n.url);
    return h('div', { class: 'cnote' },
      h('header', null, icon('note'), n.title || 'Readers added context they thought people might want to know'),
      h('p', null, n.text),
      href ? h('footer', null, h('span', null, 'Do you find this helpful?'), h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, 'Rate it')) : null);
  }

  // ---------- the action bar ----------
  function act(k, label, n, pressed) {
    return h('button', { class: 'act', type: 'button', 'data-act': k, 'aria-label': label, title: label, 'aria-pressed': pressed === undefined ? null : String(!!pressed) },
      h('span', { class: 'ic' }, icon(k)), n === undefined ? null : h('span', { class: 'n' }, fmt(n)));
  }
  // The first video/GIF of a post that has a plain MP4 (best bitrate first, from the model)
  const videoOf = t => ((t && t.media) || []).find(m => (m.type === 'video' || m.type === 'gif') && safe(m.url));
  async function download(btn, id) {
    const t = store.tweet(id), m = videoOf(t);
    if (!m) { fast.toast('No downloadable video in this post'); return; }
    const url = safe(m.url), name = (t.author.screenName || 'x') + '-' + t.id + '.mp4';
    btn.classList.add('busy');
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error(r.status);
      const a = h('a', { href: URL.createObjectURL(await r.blob()), download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      fast.toast('Downloaded ' + name);
    } catch {
      // the CDN refused a cross-origin read: let the browser open the file itself (right-click, Save as)
      window.open(url, '_blank', 'noopener');
      fast.toast('Opened the video in a new tab: Save as…');
    } finally { btn.classList.remove('busy'); }
  }
  function actions(t) {
    const s = XBB.settings, v = t.viewer || {}, st = t.stats || {};
    return h('div', { class: 'actions', role: 'group', 'data-id': t.id },
      act('reply', 'Reply', st.replies),
      act('rt', s.quickRetweet === false ? 'Retweet' : 'Retweet (one click; Shift+click for Quote)', st.retweets, v.retweeted),
      act('like', 'Like', st.likes, v.liked),
      st.views != null ? h('span', { class: 'act views', 'data-act': 'views', title: 'Views' }, h('span', { class: 'ic' }, icon('views')), h('span', { class: 'n' }, fmt(st.views))) : null,
      h('span', { class: 'group' },
        s.likeRetweet === false ? null : act('lrt', v.liked && v.retweeted ? 'Undo like and retweet' : 'Like and retweet', undefined, v.liked && v.retweeted),
        act('bm', 'Bookmark', undefined, v.bookmarked),
        videoOf(t) ? act('dl', 'Download video') : null,
        s.embedLink === false ? null : act('copy', 'Copy link for Discord (shows the tweet and its video in the chat)'),
        act('share', 'Copy link to post')));
  }
  function syncActions(bar, t) {
    if (!bar || !t) return;
    const v = t.viewer || {}, st = t.stats || {};
    const set = (k, pressed, n) => {
      const b = bar.querySelector(`[data-act="${k}"]`);
      if (!b) return;
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
      const c = b.querySelector('.n');
      if (c && n !== undefined) c.textContent = fmt(n);
    };
    set('like', v.liked, st.likes);
    set('rt', v.retweeted, st.retweets);
    set('reply', undefined, st.replies);
    set('bm', v.bookmarked);
    set('lrt', v.liked && v.retweeted);
    const lrt = bar.querySelector('[data-act="lrt"]');
    if (lrt) { const l = v.liked && v.retweeted ? 'Undo like and retweet' : 'Like and retweet'; lrt.title = l; lrt.setAttribute('aria-label', l); }
  }

  // ---------- the card ----------
  const expanded = new Set();
  const trCache = new Map();        // id -> { text, srcLang, provider, open }
  const trBusy = new Set();
  const trFailed = new Set();       // ids that failed auto-translate this session (manual click still retries)
  const trQueue = [];               // [{ id, root }] for rate-limited background auto-translate
  let trInFlight = 0, trRateUntil = 0;
  const TR_AUTO_MAX = 2, TR_CACHE_MAX = 500;
  const UI_LANG = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase().split('-')[0];
  const NON_LANG = new Set(['', 'und', 'zxx', 'qme', 'qht', 'qam', 'qst', 'art']);
  const TR_ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
  const unescTr = s => String(s || '').replace(/&(?:amp|lt|gt|quot|apos|#39);/g, m => TR_ENT[m]);
  function autoLangs() {
    const raw = String((XBB.settings && XBB.settings.fastUiAutoTranslate) || '').trim().toLowerCase();
    if (!raw) return null;
    const parts = raw.split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) return null;
    if (parts.includes('*') || parts.includes('all')) return 'all';
    return new Set(parts.map(p => p.split('-')[0]));
  }
  function canTranslate(t) {
    if (!t || !t.id || !t.text) return false;
    const l = String(t.lang || '').toLowerCase().split('-')[0];
    if (l && l === UI_LANG) return false;
    if (t.translatable) return true;
    return !!(l && !NON_LANG.has(l));
  }
  function shouldAutoTr(t) {
    if (!canTranslate(t) || trCache.has(t.id) || trBusy.has(t.id) || trFailed.has(t.id) || Date.now() < trRateUntil) return false;
    const want = autoLangs();
    if (!want) return false;
    if (want === 'all') return true;
    const l = String(t.lang || '').toLowerCase().split('-')[0];
    return !!(l && want.has(l));
  }
  function parseTr(d) {
    if (!d || typeof d !== 'object') return null;
    const o = typeof d.translation === 'string' ? d
      : (d.result && typeof d.result.translation === 'string' ? d.result
      : (d.data && (d.data.tweet_result_by_rest_id || d.data.grok_translation || d.data.translate_tweet)) || d);
    const raw = typeof o.translation === 'string' ? o.translation
      : typeof o.translated_text === 'string' ? o.translated_text
      : typeof o.text === 'string' ? o.text : '';
    if (!raw.trim()) return null;
    return {
      text: unescTr(raw.trim()),
      srcLang: String(o.localizedSourceLanguage || o.source_language || o.sourceLanguage || ''),
      provider: String(o.translationSource || o.provider || '')
    };
  }
  function trWrap(t) {
    if (!canTranslate(t)) return null;
    const c = trCache.get(t.id), loading = trBusy.has(t.id);
    if (c && c.open) {
      const meta = 'Translated' + (c.srcLang ? ' from ' + c.srcLang : '') + (c.provider ? ' by ' + c.provider : '');
      const l = String(t.lang || '').toLowerCase().split('-')[0];
      const want = autoLangs();
      const alreadyAuto = want === 'all' || (want && l && want.has(l));
      const canPin = !!(l && !NON_LANG.has(l) && !alreadyAuto);
      return h('div', { class: 'tr-wrap', 'data-tr-id': t.id },
        h('span', { class: 'tr-meta' }, meta, ' ·'),
        h('button', { class: 'tr-btn', type: 'button', 'data-act': 'translate', 'data-id': t.id }, 'Show original'),
        canPin ? h('span', { class: 'tr-meta' }, '·') : null,
        canPin ? h('button', { class: 'tr-btn', type: 'button', 'data-act': 'tr-auto', 'data-id': t.id, 'data-lang': l, 'data-name': c.srcLang || l.toUpperCase() }, 'Always translate ' + (c.srcLang || l.toUpperCase())) : null);
    }
    return h('div', { class: 'tr-wrap', 'data-tr-id': t.id },
      h('button', { class: 'tr-btn', type: 'button', 'data-act': 'translate', 'data-id': t.id, disabled: loading || null }, loading ? 'Translating…' : 'Translate post'));
  }
  function paintTr(id, root) {
    const t = store.tweet(id);
    if (!t || !root) return;
    const c = trCache.get(id), show = !!(c && c.open);
    for (const art of root.querySelectorAll(`article.tweet[data-id="${id}"]`)) {
      const txt = art.querySelector(':scope > .body > .text');
      if (txt) {
        if (show) { txt.textContent = c.text; txt.removeAttribute('lang'); }
        else { txt.replaceChildren(rich(t)); if (t.lang) txt.setAttribute('lang', t.lang); else txt.removeAttribute('lang'); }
      }
      const old = art.querySelector(`:scope > .body > .tr-wrap[data-tr-id="${id}"]`);
      if (old) { const next = trWrap(t); if (next) old.replaceWith(next); }
    }
  }
  async function translate(id, root, auto) {
    if (!id || trBusy.has(id)) return;
    const existing = trCache.get(id);
    if (existing) { if (!auto) { existing.open = !existing.open; paintTr(id, root); } return; }
    trBusy.add(id);
    paintTr(id, root);
    let r = null, parsed = null;
    try {
      const p = '/i/api/1.1/strato/column/None/tweetId=' + encodeURIComponent(id) +
        ',destinationLanguage=None,translationSource=Some(Google),feature=None,satelliteTweetId=None/translation/service/translateTweet';
      r = await XBB.gql.rest(p);
      if (r && r.ok) parsed = parseTr(r.data);
      if (!parsed && (!r || r.kind !== 'rate-limit') && XBB.gql.knows) {
        for (const op of ['GrokTranslation', 'TranslateTweet']) {
          if (await XBB.gql.knows(op)) {
            const g = await XBB.gql.call(op, { tweet_id: id, id });
            if (g && g.ok) { parsed = parseTr(g.data); if (parsed) break; }
          }
        }
      }
    } catch {}
    trBusy.delete(id);
    if (parsed) {
      if (trCache.size >= TR_CACHE_MAX) trCache.delete(trCache.keys().next().value);
      trCache.set(id, Object.assign({ open: true }, parsed));
      trFailed.delete(id);
      paintTr(id, root);
    } else {
      if (r && r.kind === 'rate-limit') trRateUntil = Date.now() + 60000;
      if (auto) trFailed.add(id);
      paintTr(id, root);
      if (!auto) fast.toast('Could not translate this post' + (r && r.kind === 'rate-limit' ? ' (rate limited)' : ''));
    }
  }
  function pumpAutoTr() {
    while (trInFlight < TR_AUTO_MAX && trQueue.length) {
      if (Date.now() < trRateUntil) { trQueue.length = 0; return; }
      const job = trQueue.shift();
      const t = store.tweet(job.id);
      if (!t || !shouldAutoTr(t)) continue;
      if (!job.root || !job.root.querySelector(`.tr-wrap[data-tr-id="${job.id}"]`)) continue;
      trInFlight++;
      translate(job.id, job.root, true).finally(() => { trInFlight--; pumpAutoTr(); });
    }
  }
  function queueAutoTr(id, root) {
    if (!id || !root || trQueue.some(q => q.id === id)) return;
    trQueue.push({ id, root });
    pumpAutoTr();
  }
  function scanAuto(root) {
    if (!root || !autoLangs()) return;
    for (const a of root.querySelectorAll('article.tweet[data-id]')) {
      const t = store.tweet(a.dataset.id);
      if (t && shouldAutoTr(t)) queueAutoTr(t.id, root);
    }
  }
  function fallback(id, why) {
    return h('article', { class: 'tweet tomb', 'data-id': id || '' },
      h('div', { class: 'body' }, h('span', null, why || 'This post is unavailable.'),
        id ? h('a', { class: 'open-x', href: `/i/status/${id}` }, 'Open on X', icon('ext')) : null));
  }
  function tweet(t, row = {}) {
    if (!t) return fallback(row.id, 'This post could not be shown here.');
    if (t.unavailable || t.type !== 'tweet') return fallback(t.id, t.reason);
    try {
      const long = t.isLongform && !expanded.has(t.id) && !row.focal;
      const st = t.stats || {};
      const node = h('article', { class: 'tweet' + (row.threadNext ? ' thread-next' : '') + (row.threadPrev ? ' thread-prev' : '') + (row.focal ? ' focal' : ''), tabindex: '0', 'data-id': t.id, 'data-href': path(t), 'aria-label': `${t.author.name}: ${String(t.text || '').slice(0, 80)}` },
        row.pinned ? h('div', { class: 'ctx' }, icon('pin'), 'Pinned') : null,
        t.retweetedBy ? h('div', { class: 'ctx' }, icon('rt'), h('a', { href: '/' + t.retweetedBy.screenName }, `${t.retweetedBy.name || t.retweetedBy.screenName} reposted`)) : null,
        h('a', { class: 'avl', href: '/' + t.author.screenName, tabindex: '-1', 'aria-hidden': 'true' }, avatar(t.author)),
        h('div', { class: 'body' },
          head(t),
          t.replyTo && t.replyTo.screenName && !row.threadPrev ? h('div', { class: 'reply-to' }, 'Replying to ', h('a', { href: '/' + t.replyTo.screenName }, '@' + t.replyTo.screenName)) : null,
          t.text ? (() => {
            const tr = trCache.get(t.id), showTr = !!(tr && tr.open);
            return h('div', { class: 'text' + (long ? ' clamp' : ''), lang: showTr ? null : (t.lang || null), dir: 'auto' }, showTr ? tr.text : rich(t));
          })() : null,
          long ? h('button', { class: 'show-more', type: 'button', 'data-act': 'more', 'data-id': t.id }, 'Show more') : null,
          trWrap(t),
          media(t),
          quote(t.quote),
          t.card && t.card.kind === 'poll' ? poll(t.card) : t.card && t.card.kind === 'link' && !(t.media || []).length ? linkCard(t.card) : null,
          note(t.communityNote),
          t.interstitial ? h('div', { class: 'inter' }, t.interstitial) : null,
          row.focal && t.createdAtMs ? h('div', { class: 'fulldate' }, h('time', { datetime: t.createdAt || '' }, full(t.createdAtMs)),
            st.views != null ? h('span', null, ' · ', h('b', null, fmt(st.views)), ' Views') : null) : null,
          actions(t)));
      return node;
    } catch (e) {
      const r = fast.state().route;
      if (r === 'home') fast.fail('home', 'render: ' + (e && e.message), false);
      else console.error('[XBB fast] render', e);
      return fallback(t.id, 'This post could not be shown here.');
    }
  }

  function attach(node) {
    const root = node.getRootNode ? node.getRootNode() : null;
    for (const a of node.querySelectorAll('article.tweet[data-id]')) {
      const id = a.dataset.id, bar = a.querySelector(':scope > .body > .actions');
      if (id && bar && !a._unsub) a._unsub = store.sub(id, t => syncActions(bar, t));
      const t = id && store.tweet(id);
      if (t && root && shouldAutoTr(t)) queueAutoTr(id, root);
    }
    for (const v of node.querySelectorAll('video')) {
      if (v.hasAttribute('data-xbb-gif')) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      else XBB.videoPolicy && XBB.videoPolicy.add(v);
    }
  }
  function release(node) {
    for (const a of node.querySelectorAll('article.tweet')) { if (a._unsub) { a._unsub(); a._unsub = null; } }
    if (XBB.videoPolicy) XBB.videoPolicy.destroy(node);
  }

  function estimate(row) {
    const t = store.tweet(row.id);
    if (!t || t.type !== 'tweet') return 64;
    let y = 104 + Math.min(6, Math.ceil(String(t.text || '').length / 60)) * 20;
    if ((t.media || []).length) y += 320;
    if (t.quote) y += 120 + ((t.quote.media || []).length ? 200 : 0);
    if (t.card) y += t.card.kind === 'poll' ? 170 : 300;
    if (t.communityNote) y += 130;
    if (t.retweetedBy) y += 20;
    return y;
  }

  // ---------- actions ----------
  const MUT = {
    like: { key: 'liked', stat: 'likes', on: 'FavoriteTweet', off: 'UnfavoriteTweet', vars: (id, on) => ({ tweet_id: id }), what: 'like' },
    rt: { key: 'retweeted', stat: 'retweets', on: 'CreateRetweet', off: 'DeleteRetweet', vars: (id, on) => on ? { tweet_id: id, dark_request: false } : { source_tweet_id: id, dark_request: false }, what: 'retweet' },
    bm: { key: 'bookmarked', stat: 'bookmarks', on: 'CreateBookmark', off: 'DeleteBookmark', vars: (id, on) => ({ tweet_id: id }), what: 'bookmark' }
  };
  const busy = new Set();
  fast.extraRequests = fast.extraRequests || 0;
  async function toggle(kind, id, want) {
    const m = MUT[kind], t = store.tweet(id);
    if (!t || busy.has(kind + id)) return false;
    const cur = !!(t.viewer && t.viewer[m.key]);
    if (want === undefined) want = !cur;
    if (want === cur) return true;
    busy.add(kind + id);
    const n = (t.stats && t.stats[m.stat]) || 0;
    const undo = store.patch(id, { viewer: { [m.key]: want }, stats: { [m.stat]: Math.max(0, n + (want ? 1 : -1)) } });
    fast.extraRequests++;
    let r;
    try { r = await XBB.gql.call(want ? m.on : m.off, m.vars(id, want)); } catch (e) { r = { ok: false }; }
    busy.delete(kind + id);
    if (r && r.ok) return true;
    undo();
    fast.toast(`Couldn't ${want ? '' : 'undo '}${m.what} on X${r && r.kind === 'rate-limit' ? ' (rate limited)' : ''}. Nothing changed.`);
    return false;
  }
  async function likeRetweet(id) {
    const t = store.tweet(id);
    if (!t) return;
    const v = t.viewer || {};
    if (v.liked && v.retweeted) { await Promise.all([toggle('like', id, false), toggle('rt', id, false)]); return; }
    if (!v.liked) await toggle('like', id, true);
    if (!(store.tweet(id).viewer || {}).retweeted) await toggle('rt', id, true);
  }
  async function copyLink(btn, id, plain) {
    const t = store.tweet(id);
    if (!t) return;
    const url = plain ? ('https://x.com/' + (t.author.screenName || 'i') + '/status/' + t.id) : XBB.embedUrl(t.author.screenName || 'i', t.id);
    fast.lastCopy = url;
    const ok = XBB.copyText ? await XBB.copyText(url) : false;
    if (!ok) { fast.toast('Could not copy the link'); return false; }
    if (!btn) { fast.toast('Link copied: ' + url.replace(/^https:\/\//, '')); return true; }
    btn.classList.add('done');
    btn.querySelector('.ic').replaceChildren(icon('check'));
    setTimeout(() => { btn.classList.remove('done'); btn.querySelector('.ic').replaceChildren(icon(plain ? 'share' : 'copy')); }, 1400);
    return true;
  }

  // Shift+click on Retweet: a small Repost / Quote menu (Popover API: top layer, light dismiss, Esc)
  let menu = null;
  function rtMenu(btn, id, root) {
    if (!menu || !menu.isConnected) {
      menu = h('div', { class: 'menu', popover: 'auto' },
        h('button', { type: 'button', 'data-menu': 'repost' }, icon('rt'), h('span', null, 'Repost')),
        h('button', { type: 'button', 'data-menu': 'quote' }, icon('quote'), h('span', null, 'Quote on X')));
      menu.addEventListener('click', e => {
        const b = e.target.closest('[data-menu]');
        if (!b) return;
        try { menu.hidePopover(); } catch {}
        const t = store.tweet(menu.dataset.id);
        if (b.dataset.menu === 'repost') toggle('rt', menu.dataset.id);
        else if (t) fast.toNative(path(t));
      });
      root.append(menu);
    }
    if (typeof menu.showPopover !== 'function') { toggle('rt', id); return; }
    const t = store.tweet(id);
    menu.dataset.id = id;
    menu.querySelector('[data-menu="repost"] span').textContent = t && t.viewer && t.viewer.retweeted ? 'Undo repost' : 'Repost';
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, r.left) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    try { menu.showPopover(); } catch { toggle('rt', id); }
  }

  // ---------- delegated clicks (one listener on the shadow root, see shell.js) ----------
  // ctx: { root, refresh(id) } from the view. Returns true when it handled the click.
  function click(e, ctx) {
    const path0 = e.composedPath ? e.composedPath() : [e.target];
    const t0 = path0[0] && path0[0].nodeType === 1 ? path0[0] : e.target;
    const btn = t0.closest('[data-act]');
    const art = t0.closest('article.tweet');
    const mod = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
    // a photo, a GIF, or a video's expand button: the media lightbox (a modified click on a photo stays a link;
    // a click on a video's own controls stays the player's)
    const lbT = t0.closest('[data-lb]');
    const vidT = t0.closest('video');
    if (lbT && art && fast.lightbox && !(mod && lbT.tagName === 'A') && !(vidT && vidT.controls)) {
      e.preventDefault(); e.stopPropagation();
      fast.lightbox.open(art.dataset.id, +lbT.dataset.lb || 0);
      return true;
    }
    if (btn && btn.tagName === 'BUTTON') {
      e.preventDefault(); e.stopPropagation();
      const holder = btn.closest('[data-id]');
      const id = btn.dataset.id || (art && art.dataset.id) || (holder && holder.dataset.id);
      const k = btn.dataset.act;
      if (k === 'more') {
        expanded.add(id);
        const txt = art && art.querySelector('.text.clamp');
        if (txt) txt.classList.remove('clamp');
        btn.remove();
      } else if (k === 'reveal') { revealed.add(id); ctx && ctx.refresh && ctx.refresh(id); }
      else if (k === 'reveal-always') {
        if (XBB.settings) XBB.settings.fastUiShowSensitive = true;
        XBB.saveSetting && XBB.saveSetting('fastUiShowSensitive', true);
        fast.toast('Showing sensitive media (toggle in Settings)');
        if (ctx && ctx.refresh) {
          const root = (ctx && ctx.root) || (art && art.getRootNode());
          const ids = new Set([id]);
          if (root && root.querySelectorAll) for (const a of root.querySelectorAll('article.tweet[data-id]')) if (a.querySelector('.sens')) ids.add(a.dataset.id);
          for (const tid of ids) ctx.refresh(tid);
        }
      }
      else if (k === 'translate') translate(id, (ctx && ctx.root) || (art && art.getRootNode()));
      else if (k === 'tr-auto') {
        const lang = btn.dataset.lang, name = btn.dataset.name || lang;
        const root = (ctx && ctx.root) || (art && art.getRootNode());
        if (lang) {
          const cur = String((XBB.settings && XBB.settings.fastUiAutoTranslate) || '').trim().toLowerCase().split(/[\s,;]+/).filter(Boolean);
          const set = new Set(cur.filter(x => x !== 'all' && x !== '*'));
          set.add(lang);
          const next = [...set].join(', ');
          if (XBB.settings) XBB.settings.fastUiAutoTranslate = next;
          XBB.saveSetting && XBB.saveSetting('fastUiAutoTranslate', next);
          fast.toast('Auto-translating ' + name + ' posts');
          paintTr(id, root);
          scanAuto(root);
        }
      }
      else if (k === 'like') toggle('like', id);
      else if (k === 'bm') toggle('bm', id);
      else if (k === 'rt') { if (e.shiftKey || XBB.settings.quickRetweet === false) rtMenu(btn, id, ctx.root); else toggle('rt', id); }
      else if (k === 'lrt') likeRetweet(id);
      else if (k === 'dl') download(btn, id);
      else if (k === 'copy') copyLink(btn, id, false);
      else if (k === 'share') copyLink(btn, id, true);
      else if (k === 'reply') {
        // Reply on a post: its thread in the drawer. On the post the drawer already shows: X's own composer.
        const t = store.tweet(id);
        if (t && fast.drawer && !(art && art.classList.contains('focal'))) fast.drawer.open(id);
        else if (t) fast.toNative(path(t));
      }
      return true;
    }
    // the time is a link to the post: the drawer, unless the user asked for a new tab or window
    const when = t0.closest('a.when');
    if (when && art && fast.drawer && !mod) { e.preventDefault(); if (!art.classList.contains('focal')) fast.drawer.open(art.dataset.id); return true; }
    if (t0.closest('a[href], video, button, input, .vc, [popover]')) return false;   // links: the router; players: theirs
    const q = t0.closest('.quote[data-href]');
    if (q) { e.preventDefault(); if (fast.drawer && q.dataset.qid) fast.drawer.open(q.dataset.qid); else fast.toNative(q.dataset.href); return true; }
    if (art && art.dataset.href && !(getSelection && String(getSelection()).length)) {
      e.preventDefault();
      if (art.classList.contains('focal')) return true;
      if (fast.drawer) fast.drawer.open(art.dataset.id); else fast.toNative(art.dataset.href);
      return true;
    }
    return false;
  }

  // ---------- a user as a row (People search, notifications) ----------
  function userCard(u, opts = {}) {
    if (!u || !u.id) return fallback('', 'This account could not be shown here.');
    return h('article', { class: 'ucard', tabindex: '0', 'data-uid': u.id, 'data-href': '/' + u.screenName },
      h('a', { class: 'avl', href: '/' + u.screenName, tabindex: '-1', 'aria-hidden': 'true' }, avatar(u)),
      h('div', { class: 'body' },
        h('div', { class: 'head' }, h('a', { class: 'name', href: '/' + u.screenName }, u.name || u.screenName), badge(u),
          u.followedBy ? h('span', { class: 'follows-you' }, 'Follows you') : null),
        h('div', { class: 'handle' }, '@' + u.screenName),
        u.bio && !opts.short ? h('div', { class: 'bio', dir: 'auto' }, u.bio) : null));
  }

  fast.render = { videoOf, tweet, userCard, attach, release, estimate, click, icon, fmt, rel, full, rich, toggle, likeRetweet, copyLink, expanded, revealed, path,
    act, syncActions, avatar, badge, safe, photoSrc, mp4, ratio, scanAuto };
})();

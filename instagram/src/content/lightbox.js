/* Lightbox: grid tiles and feed photos open full screen. Wheel / arrows step through a post's
   slides and on into the next posts; Esc, Back or a click beside the media closes it. */
(() => {
  const h = IGB.h;
  const CODE_RE = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;
  const codeOf = href => (href && href.match(CODE_RE)?.[1]) || null;

  // ---------- data ----------
  // Shortcode → numeric media id (base64 alphabet). Private-post codes are longer; the id is in the first 11.
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  IGB.mediaId = code => { let n = 0n; for (const c of code.slice(0, 11)) n = n * 64n + BigInt(ALPHA.indexOf(c)); return n.toString(); };

  const biggest = list => (list || []).reduce((b, c) => (!b || c.width * c.height > b.width * b.height ? c : b), null);
  const one = m => {
    const img = biggest(m.image_versions2?.candidates)?.url || '';
    const vid = biggest(m.video_versions)?.url;
    return vid ? { type: 'video', src: vid, poster: img } : { type: 'image', src: img };
  };
  const normComment = c => ({
    id: String(c.pk || ''),
    user: c.user?.username || '',
    text: c.text || '',
    likes: c.comment_like_count || 0,
    created: c.created_at_utc || c.created_at || 0,
    replyCount: c.child_comment_count || 0
  });
  function normalize(it) {
    if (!it) throw new Error('no media in response');
    return {
      pk: String(it.pk || ''),
      code: it.code || String(it.pk || ''),
      user: it.user?.username || '',
      caption: it.caption?.text || '',
      likes: it.like_count, comments: it.comment_count,
      taken: it.taken_at || 0,
      previewComments: Array.isArray(it.preview_comments) ? it.preview_comments.map(normComment).filter(c => c.text) : [],
      items: (it.carousel_media?.length ? it.carousel_media : [it]).map(one)
    };
  }
  const commentCache = new Map();
  const relTime = sec => {
    if (!sec) return '';
    const d = Math.max(1, Math.floor(Date.now() / 1000 - sec));
    if (d < 60) return d + 's';
    if (d < 3600) return Math.floor(d / 60) + 'm';
    if (d < 86400) return Math.floor(d / 3600) + 'h';
    if (d < 604800) return Math.floor(d / 86400) + 'd';
    return Math.floor(d / 604800) + 'w';
  };
  // One request per post, cached for the page. Failures are not cached.
  // Posts are addressed by shortcode; stories by their numeric id (it's in the story URL).
  const cache = new Map();
  IGB.getPostById = id => {
    let p = cache.get(id);
    if (!p) {
      p = IGB.getJSON(`/api/v1/media/${id}/info/`).then(j => normalize(j.items?.[0]));
      cache.set(id, p);
      p.catch(() => cache.delete(id));
    }
    return p;
  };
  IGB.getPost = code => IGB.getPostById(IGB.mediaId(code));
  IGB.codeOf = codeOf;

  // ---------- what's on the page ----------
  const isGridTile = a => !a.closest('article, [role="dialog"], .igb-root') && codeOf(a.getAttribute('href')) && a.querySelector('img, video');
  const tileThumb = a => a.querySelector('img')?.currentSrc || a.querySelector('img')?.src || '';
  function gridEntries() {
    return [...document.querySelectorAll('a[href]')].filter(a => isGridTile(a) && a.getBoundingClientRect().width > 60)
      .map(a => ({ code: codeOf(a.getAttribute('href')), el: a, thumb: tileThumb(a) }));
  }
  function articleCode(art) {
    const t = art.querySelector('a[href] time')?.closest('a');
    return codeOf(t?.getAttribute('href')) || [...art.querySelectorAll('a[href]')].map(a => codeOf(a.getAttribute('href'))).find(Boolean) || null;
  }
  const bigImgs = art => [...art.querySelectorAll('img')].filter(i => i.getBoundingClientRect().width > 200);
  function feedEntries() {
    return [...document.querySelectorAll('article')].map(art => {
      const code = articleCode(art);
      const img = bigImgs(art).find(i => { const r = i.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
      return code && { code, el: art, thumb: img?.currentSrc || '' };
    }).filter(Boolean);
  }
  const dedupe = list => { const seen = new Set(); return list.filter(e => !seen.has(e.code) && seen.add(e.code)); };
  // Active carousel slide: Instagram marks its dot with aria-current (language-independent)
  function activeSlide(art) {
    const dot = art.querySelector('[aria-current="step"], [aria-current="true"]');
    return dot ? [...dot.parentElement.children].indexOf(dot) : 0;
  }

  // ---------- lightbox ----------
  let lb = null;

  function open(source, list, pi, ii = 0) {
    if (lb) close();
    list = dedupe(list);
    if (!list.length) return;
    const stage = h('div', { class: 'igb-lb-stage' });
    const dots = h('div', { class: 'igb-lb-dots' });
    // Caption, user and actions live in a panel beside the media (under it on narrow windows)
    const bar = h('aside', { class: 'igb-lb-bar' });
    const main = h('div', { class: 'igb-lb-main' }, stage, dots);
    const el = h('div', { class: 'igb-root igb-lb', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
      h('button', { class: 'igb-lb-close', title: 'Close (Esc)', onclick: () => close() }, '✕'),
      main, bar);
    stage.append(
      h('button', { class: 'igb-lb-nav igb-lb-prev', title: 'Previous (←)', onclick: e => { e.stopPropagation(); step(-1); } }, '‹'),
      h('button', { class: 'igb-lb-nav igb-lb-next', title: 'Next (→)', onclick: e => { e.stopPropagation(); step(1); } }, '›'));
    lb = { source, list, pi, ii, el, stage, dots, bar, media: null, pushed: false };

    // Page videos stop and may not restart while we're open (main-world.js checks this attribute)
    document.documentElement.setAttribute('data-igb-lb', '');
    document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });

    el.addEventListener('click', e => { if (e.target === el || e.target === stage || e.target === main) close(); });
    el.addEventListener('wheel', onWheel, { passive: false });
    document.body.append(el);
    el.focus({ preventScroll: true });
    try { history.pushState({ ...(history.state || {}), igbLb: 1 }, ''); lb.pushed = true; } catch {}
    render();
  }

  let commentTimer = 0;
  function close(fromPop) {
    clearTimeout(commentTimer);
    if (!lb) return;
    const { el, pushed } = lb;
    lb = null;
    IGB.destroyVideos(el);
    el.remove();
    document.documentElement.removeAttribute('data-igb-lb');
    if (pushed && !fromPop && history.state?.igbLb) history.back();
  }
  addEventListener('popstate', () => { if (lb && !history.state?.igbLb) close(true); });

  function setMedia(node) {
    if (lb.media) { IGB.destroyVideos(lb.media); lb.media.remove(); }
    lb.media = node;
    lb.el.classList.remove('igb-zoom');
    lb.stage.querySelector('.igb-lb-next').before(node);
  }

  function render() {
    const entry = lb.list[lb.pi];
    const cached = entry.data;
    if (cached) return draw(entry);
    // Show the thumbnail we already have at once, swap in full quality when the API answers
    setMedia(entry.thumb ? h('img', { src: entry.thumb, alt: '' }) : h('div', { class: 'igb-spin' }));
    drawBar(entry, null);
    const want = entry;
    IGB.getPost(entry.code).then(d => {
      want.data = d;
      if (lb && lb.list[lb.pi] === want) draw(want);
    }, err => {
      if (!lb || lb.list[lb.pi] !== want) return;
      console.warn('[IGB] post load failed', want.code, err);
      if (!want.thumb) setMedia(h('div', { class: 'igb-lb-msg' }, 'Could not load this post. ', h('a', { href: `/p/${want.code}/` }, 'Open it on Instagram')));
    });
    prefetch();
  }

  function draw(entry) {
    const d = entry.data;
    if (lb.ii < 0) lb.ii = d.items.length - 1;
    lb.ii = Math.min(lb.ii, d.items.length - 1);
    const item = d.items[lb.ii];
    if (item.type === 'video') {
      const v = h('video', { src: item.src, poster: item.poster || null, preload: 'auto' });
      setMedia(v);
      IGB.setupOwnVideo(v);
    } else {
      // keep the low-res image up until the full one has decoded, so there's no blank flash
      const img = h('img', { alt: '', src: lb.ii === (entry.thumbIdx || 0) && entry.thumb ? entry.thumb : item.src });
      img.addEventListener('click', e => { e.stopPropagation(); lb.el.classList.toggle('igb-zoom'); });
      setMedia(img);
      if (img.src !== item.src) {
        const full = new Image();
        full.onload = () => { if (lb && lb.media === img) img.src = item.src; };
        full.src = item.src;
      }
    }
    lb.dots.replaceChildren(...(d.items.length > 1 ? d.items.map((_, i) => h('i', { class: i === lb.ii ? 'on' : null })) : []));
    drawBar(entry, d);
    prefetch();
  }

  function renderCommentNode(d, c, isReply) {
    const s = IGB.settings;
    const body = s.captionLinks && IGB.linkify ? IGB.linkify(c.text) : c.text;
    const repliesBox = !isReply && c.replyCount > 0 ? h('div', { class: 'igb-lb-replies' }) : null;
    let replyBtn = null;
    if (repliesBox) {
      replyBtn = h('button', {
        class: 'igb-lb-more', type: 'button',
        onclick: async () => {
          replyBtn.disabled = true; replyBtn.textContent = 'Loading replies…';
          try {
            const j = await IGB.getJSON(`/api/v1/media/${d.pk}/comments/${c.id}/child_comments/?max_id=`);
            const list = (j.child_comments || []).map(normComment).filter(x => x.text);
            repliesBox.replaceChildren(...list.map(r => renderCommentNode(d, r, true)));
            replyBtn.remove();
          } catch {
            replyBtn.disabled = false; replyBtn.textContent = `View ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'} (retry)`;
          }
        }
      }, `View ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}`);
    }
    return h('div', { class: 'igb-lb-c' + (isReply ? ' reply' : '') },
      h('div', { class: 'igb-lb-c-body' },
        c.user ? h('a', { class: 'igb-lb-c-user', href: `/${c.user}/` }, c.user) : '',
        ' ', body),
      h('div', { class: 'igb-lb-c-meta' },
        c.created ? h('span', null, relTime(c.created)) : '',
        c.likes > 0 ? h('span', null, '♥ ' + c.likes.toLocaleString()) : '',
        replyBtn),
      repliesBox);
  }

  function paintComments(box, d) {
    const st = commentCache.get(d.pk);
    const list = st?.list?.length ? st.list : d.previewComments;
    const kids = [];
    if (list.length) {
      for (const c of list) kids.push(renderCommentNode(d, c, false));
    } else if (st?.loading) {
      kids.push(h('div', { class: 'igb-lb-c-empty' }, 'Loading comments…'));
    } else if (st?.err) {
      kids.push(h('div', { class: 'igb-lb-c-empty' }, 'Could not load comments. ',
        h('button', { class: 'igb-lb-more', type: 'button', onclick: () => loadComments(d, box, false) }, 'Retry')));
    } else if (d.comments === 0 || (st && st.done)) {
      kids.push(h('div', { class: 'igb-lb-c-empty' }, 'No comments yet.'));
    }
    if (st?.next && !st.loading) {
      kids.push(h('button', { class: 'igb-lb-more', type: 'button', onclick: () => loadComments(d, box, true) }, 'Load more comments'));
    } else if (st?.loading && list.length) {
      kids.push(h('div', { class: 'igb-lb-c-empty' }, 'Loading…'));
    }
    box.replaceChildren(...kids);
  }

  async function loadComments(d, box, more) {
    if (!d?.pk) return;
    let st = commentCache.get(d.pk);
    if (!st) { st = { list: [], next: null, done: false, loading: false, err: false }; commentCache.set(d.pk, st); }
    if (st.loading || (more && !st.next) || (!more && st.done)) return;
    st.loading = true; st.err = false;
    if (box.isConnected) paintComments(box, d);
    try {
      const q = more && st.next ? `&min_id=${encodeURIComponent(st.next)}` : '';
      const j = await IGB.getJSON(`/api/v1/media/${d.pk}/comments/?can_support_threading=true&permalink_enabled=false${q}`);
      const seen = new Set(st.list.map(c => c.id));
      for (const raw of (j.comments || [])) {
        const c = normComment(raw);
        if (c.text && (!c.id || !seen.has(c.id))) { seen.add(c.id); st.list.push(c); }
      }
      st.next = j.next_min_id || null;
      st.done = !st.next;
    } catch {
      st.err = true;
      if (!st.list.length) commentCache.delete(d.pk);
    } finally {
      st.loading = false;
      if (lb && lb.list[lb.pi]?.data?.pk === d.pk && box.isConnected) paintComments(box, d);
    }
  }

  function drawBar(entry, d) {
    clearTimeout(commentTimer);
    const s = IGB.settings;
    const cbox = d ? h('div', { class: 'igb-lb-comments' }) : null;
    if (cbox) {
      paintComments(cbox, d);
      const st = commentCache.get(d.pk);
      if (d.pk && d.comments !== 0 && (!st || (!st.done && !st.loading && !st.list.length))) {
        const wantPk = d.pk;
        commentTimer = setTimeout(() => {
          if (lb && lb.list[lb.pi]?.data?.pk === wantPk && cbox.isConnected) loadComments(d, cbox, false);
        }, 350);
      }
    }
    lb.bar.replaceChildren(
      h('div', { class: 'igb-lb-head' },
        d?.user ? h('a', { class: 'igb-lb-user', href: `/${d.user}/` }, d.user) : h('span', { class: 'igb-lb-user' }, '…'),
        d?.taken ? h('span', { class: 'igb-lb-when' }, new Date(d.taken * 1000).toLocaleDateString()) : ''),
      h('div', { class: 'igb-lb-scroll' },
        d && s.lightboxCaption && d.caption
          ? h('div', { class: 'igb-lb-cap' }, s.captionLinks && IGB.linkify ? IGB.linkify(d.caption) : d.caption)
          : null,
        cbox),
      h('div', { class: 'igb-lb-meta' },
        d?.likes != null ? h('span', null, '♥ ' + d.likes.toLocaleString()) : '',
        d?.comments != null ? h('span', null, d.comments.toLocaleString() + ' comments') : '',
        h('span', null, `${lb.pi + 1} / ${lb.list.length}`),
        h('a', { href: `/p/${entry.code}/`, onclick: () => close(true) }, 'Open post')),
      d && IGB.mediaTools ? h('div', { class: 'igb-lb-actions' }, IGB.mediaTools(d, () => lb?.ii ?? 0)) : '');
  }

  // Warm the next posts' data and the next image, so stepping feels instant
  function prefetch() {
    const { list, pi } = lb;
    [pi + 1, pi + 2, pi - 1].forEach(i => list[i] && IGB.getPost(list[i].code).then(d => { list[i].data = d; }, () => {}));
    const d = list[pi].data;
    const next = d?.items[lb.ii + 1] || list[pi + 1]?.data?.items[0];
    if (next?.type === 'image') new Image().src = next.src;
  }

  // Bring more posts in: Instagram loads (and drops) posts as the page scrolls
  function refill() {
    const fresh = lb.source === 'grid' ? gridEntries() : feedEntries();
    const have = new Set(lb.list.map(e => e.code));
    const added = fresh.filter(e => !have.has(e.code));
    lb.list.push(...added);
    return added.length;
  }

  function goPost(pi, ii = 0) {
    if (pi < 0) return;
    if (pi >= lb.list.length) {
      const last = lb.list[lb.list.length - 1].el;
      if (last?.isConnected) last.scrollIntoView({ block: 'end' });
      if (!refill()) { setTimeout(() => lb && refill() && drawBar(lb.list[lb.pi], lb.list[lb.pi].data), 1200); return; }
    }
    lb.pi = pi; lb.ii = ii;
    const el = lb.list[pi].el;
    if (el?.isConnected) el.scrollIntoView({ block: 'center' }); // keeps Instagram loading what comes next
    if (pi >= lb.list.length - 3) setTimeout(() => lb && refill(), 800);
    render();
  }

  function step(dir) {
    if (!lb) return;
    const d = lb.list[lb.pi].data;
    const n = lb.ii + dir;
    if (d && n >= 0 && n < d.items.length) { lb.ii = n; draw(lb.list[lb.pi]); return; }
    goPost(lb.pi + dir, dir < 0 ? -1 : 0);
  }

  let wheelAt = 0;
  function onWheel(e) {
    if (lb.el.classList.contains('igb-zoom')) return;      // zoomed: wheel scrolls the image
    if (e.target.closest('.igb-lb-bar')) return;           // long captions scroll
    e.preventDefault();
    if (Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4 || Date.now() - wheelAt < 220) return;
    wheelAt = Date.now();
    step((Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) > 0 ? 1 : -1);
  }

  addEventListener('keydown', e => {
    if (!lb || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const k = e.key;
    let used = true;
    if (k === 'Escape') close();
    else if (k === 'ArrowRight' || k === 'l') step(1);
    else if (k === 'ArrowLeft' || k === 'h') step(-1);
    else if (k === 'ArrowDown' || k === 'j' || k === 'PageDown') goPost(lb.pi + 1);
    else if (k === 'ArrowUp' || k === 'k' || k === 'PageUp') goPost(lb.pi - 1);
    else if (k === ' ' && lb.media?.tagName === 'VIDEO') lb.media.paused ? lb.media.play() : lb.media.pause();
    else if (k === 'd' && lb.list[lb.pi].data && IGB.downloadItems) IGB.downloadItems(lb.list[lb.pi].data, [lb.ii]);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- opening ----------
  let feedTimer = 0;
  addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || lb) return;
    if (IGB.dragging()) return;   // a carousel swipe still fires a click where it's released
    const t = e.target;
    if (!(t instanceof Element) || t.closest('.igb-root')) return;
    const s = IGB.settings;

    const a = t.closest('a[href]');
    if (a && s.lightboxGrid && isGridTile(a)) {
      e.preventDefault(); e.stopPropagation();
      const list = gridEntries();
      const code = codeOf(a.getAttribute('href'));
      let pi = list.findIndex(x => x.code === code);
      if (pi < 0) { list.unshift({ code, el: a, thumb: tileThumb(a) }); pi = 0; }
      open('grid', list, pi);
      return;
    }

    // Feed photo: single click opens; a double click (Instagram's like) cancels it
    const art = s.lightboxFeed && !a && t.closest('article');
    if (!art || t.tagName === 'VIDEO') return;
    const ctl = t.closest('button, [role="button"]');
    if (ctl && ctl.getBoundingClientRect().width < 150) return;   // chevrons, tags, like button
    const inside = r => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if ([...art.querySelectorAll('video')].some(v => inside(v.getBoundingClientRect()))) return;
    const img = bigImgs(art).find(i => inside(i.getBoundingClientRect()));
    if (!img) return;
    const code = articleCode(art);
    if (!code) return;
    clearTimeout(feedTimer);
    feedTimer = setTimeout(() => {
      const list = feedEntries();
      let pi = list.findIndex(x => x.code === code);
      if (pi < 0) { list.unshift({ code, el: art }); pi = 0; }
      const slide = activeSlide(art);
      Object.assign(list[pi], { thumb: img.currentSrc || img.src, thumbIdx: slide });
      open('feed', list, pi, slide);
    }, 260);
  }, true);
  addEventListener('dblclick', () => clearTimeout(feedTimer), true);

  IGB.lightboxNext = () => lb && goPost(lb.pi + 1);
  IGB.lightboxItem = () =>lb && lb.list[lb.pi].data ? { data: lb.list[lb.pi].data, ii: lb.ii } : null;
  IGB.articleCode = articleCode;
  IGB.activeSlide = activeSlide;
  IGB.openLightbox = open;
  IGB.closeLightbox = close;
})();

/* Pinterest Fast UI: the model. Pure and defensive: never throws, reads every field through safe getters.
     PIN.model.normalizePin(raw) -> Pin | null
       { id, kind: 'image'|'video'|'story', title, description, link, domain, color,
         w, h,                       exact layout input: the grid thumbnail's own pixels (474x/236x/736x, else video, else page 1)
         thumb, large, orig,         474x|736x for the grid, 1200x|750x|736x for the viewer, orig|originals for zoom
         sizes: [urls],              every sized rendition, largest first (the viewer's fallback chain)
         video: { src, w, h, dur, poster } | null       V_720P progressive mp4 (AAC audio), else any V_* .mp4; never HLS
         storyPages: [{ video, image, full, candidates, poster }] | null     an idea pin (story_pin_data.pages)
         author: { id, username, name, avatar }, board: { id, name, url } | null,
         aggregatedId, saveCount, commentCount, isPromoted }
       A pin without usable dimensions is dropped (null): it cannot be laid out exactly, and a card that shifts is
       worse than a missing one. Video is detected by videos.video_list, never by `is_video` (it lies).
     PIN.model.isPromotedData(raw)   is_promoted, promoted_is_removable, ad_match_reason, promoter, is_ad, sponsorship,
                                     plus the label fallback (core.js's text match) on grid_title_label / attribution
     PIN.model.extractFeed(data)     -> { pins, promoted, dropped }: an allowlist (type 'pin', or no type and an
                                     `images` map); modules, carousels, shopping units and ads never reach the grid
     PIN.model.isFeed(data)          the schema guard: an array of objects (empty is fine), or { results: [...] } */
(() => {
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const str = v => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '');
  const num = v => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? +v : NaN; return isFinite(n) && n >= 0 ? n : 0; };
  const get = (o, ...path) => { let c = o; for (const k of path) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; };
  const url = v => { const s = str(v); return /^https:\/\//.test(s) ? s : ''; };

  const BUCKETS = ['1200x', '750x', '736x', '564x', '474x', '236x'];
  const img = (images, k) => obj(obj(images) && images[k]);
  const imgUrl = (images, k) => url(get(img(images, k), 'url'));
  // every sized rendition (largest first), then the sized twins of an `originals` URL (Pinterest 403s `originals`
  // for many story pages while the sized buckets of the same file still work), then the original itself
  function sizes(images) {
    const out = [];
    for (const k of BUCKETS) { const u = imgUrl(images, k); if (u) out.push(u); }
    const orig = imgUrl(images, 'orig') || imgUrl(images, 'originals');
    const m = orig && /^(https:\/\/i\.pinimg\.com\/)(?:orig|originals)(\/.+)$/.exec(orig);
    if (m) for (const k of BUCKETS) out.push(m[1] + k + m[2]);
    if (orig) out.push(orig);
    return [...new Set(out)];
  }
  const dims = o => { const w = num(get(o, 'width')), h = num(get(o, 'height')); return w > 0 && h > 0 ? { w, h } : null; };

  // only a progressive mp4 plays in our own <video> (an HLS rendition is a black box in Chrome and Firefox)
  function mp4(list) {
    const l = obj(list);
    if (!l) return null;
    const pick = obj(l.V_720P) && /\.mp4(\?|$)/i.test(str(l.V_720P.url)) ? l.V_720P
      : Object.values(l).find(v => obj(v) && /\.mp4(\?|$)/i.test(str(v.url)));
    if (!pick || !url(pick.url)) return null;
    return { src: url(pick.url), w: num(pick.width), h: num(pick.height), dur: num(pick.duration), poster: url(pick.thumbnail) };
  }

  const AD_LABEL = /(^|[\s·•|])(promoted|sponsored|gesponsert|sponsorisé|patrocinado|sponsorizzato|promosso|anuncio)([\s·•|]|$)/i;
  function isPromotedData(p) {
    try {
      if (!obj(p)) return false;
      if (p.is_promoted === true || p.is_ad === true) return true;
      if (p.promoted_is_removable != null || p.ad_match_reason != null) return true;
      if (obj(p.promoter) || (typeof p.promoter === 'string' && p.promoter)) return true;
      if (obj(p.sponsorship) || p.sponsorship === true) return true;
      const label = str(p.grid_title_label) + ' ' + str(get(p, 'attribution', 'title')) + ' ' + str(p.promoted_label);
      return AD_LABEL.test(label.trim());
    } catch { return false; }
  }

  function normalizePin(raw) {
    try {
      const p = obj(raw);
      if (!p) return null;
      const id = str(p.id);
      if (!/^\d{1,24}$/.test(id)) return null;
      const images = obj(p.images);
      const all = images ? sizes(images) : [];
      const video = mp4(get(p, 'videos', 'video_list'));

      // idea pin pages: a page video (mp4 only), else the page image, else its first image block
      let storyPages = null;
      const pages = get(p, 'story_pin_data', 'pages');
      if (Array.isArray(pages) && pages.length) {
        storyPages = pages.slice(0, 40).map(pg => {
          const pgImages = obj(get(pg, 'image', 'images'));
          const block = Array.isArray(get(pg, 'blocks')) ? pg.blocks.find(b => obj(get(b, 'image', 'images'))) : null;
          const bImages = block ? block.image.images : null;
          const base = pgImages && sizes(pgImages).length ? pgImages : bImages;
          const cand = [...new Set([...(base ? sizes(base) : []), ...(bImages ? sizes(bImages) : []), ...all])];
          const v = mp4(get(pg, 'video', 'video_list'));
          return { video: v ? v.src : '', poster: (v && v.poster) || cand[0] || '', image: cand[0] || '', candidates: cand,
            full: base ? (imgUrl(base, 'orig') || imgUrl(base, 'originals') || cand[0] || '') : '',
            dims: dims(img(base, '474x')) || dims(img(base, '736x')) || dims(img(base, 'orig')) || dims(img(base, 'originals')) || (v && v.w ? { w: v.w, h: v.h } : null) };
        }).filter(x => x.video || x.image);
        if (!storyPages.length) storyPages = null;
      }

      // the grid's rendition and its exact pixels
      const thumbKey = ['474x', '736x', '236x', '564x'].find(k => imgUrl(images, k) && dims(img(images, k)));
      let thumb = thumbKey ? imgUrl(images, thumbKey) : (imgUrl(images, '474x') || imgUrl(images, '736x') || imgUrl(images, '236x'));
      let d = thumbKey ? dims(img(images, thumbKey)) : null;
      d = d || dims(img(images, 'orig')) || dims(img(images, 'originals')) || dims(img(images, '1200x'))
        || (video && video.w ? { w: video.w, h: video.h } : null) || (storyPages && storyPages[0].dims) || null;
      if (!thumb && storyPages) thumb = storyPages[0].candidates.find(u => /\/(474x|736x|236x)\//.test(u)) || storyPages[0].image;
      if (!thumb && video) thumb = video.poster;
      if (!d || !thumb) return null;

      const large = ['1200x', '750x', '736x'].map(k => imgUrl(images, k)).find(Boolean) || all[0] || thumb;
      const orig = imgUrl(images, 'orig') || imgUrl(images, 'originals') || large;
      const pinner = obj(p.pinner) || obj(p.native_creator) || obj(p.origin_pinner) || {};
      const board = obj(p.board);
      const link = url(p.link);
      let domain = str(p.domain);
      if (!domain && link) { try { domain = new URL(link).hostname.replace(/^www\./, ''); } catch {} }
      const agg = obj(p.aggregated_pin_data);
      return {
        id,
        kind: storyPages ? 'story' : video ? 'video' : 'image',
        title: (str(p.title) || str(p.grid_title) || str(p.closeup_unified_title)).trim().slice(0, 300),
        description: (str(p.description) || str(p.closeup_unified_description)).trim().slice(0, 2000),
        link, domain,
        color: /^#[0-9a-f]{3,8}$/i.test(str(p.dominant_color)) ? p.dominant_color : '',
        w: d.w, h: d.h,
        thumb, large, orig, sizes: all,
        video: video ? { src: video.src, w: video.w, h: video.h, dur: video.dur, poster: video.poster || large || thumb } : null,
        storyPages: storyPages ? storyPages.map(({ dims: _d, ...rest }) => rest) : null,
        author: { id: str(pinner.id), username: str(pinner.username), name: str(pinner.full_name) || str(pinner.username), avatar: url(pinner.image_medium_url) || url(pinner.image_small_url) },
        board: board ? { id: str(board.id), name: str(board.name), url: str(board.url) } : null,
        aggregatedId: str(agg && agg.id),
        saveCount: num(get(agg, 'aggregated_stats', 'saves')) || num(p.repin_count) || num(p.save_count),
        commentCount: num(p.comment_count) || num(get(agg, 'comment_count')),
        isPromoted: isPromotedData(p)
      };
    } catch { return null; }
  }

  const isFeed = data => Array.isArray(data) ? data.every(x => x == null || typeof x === 'object')
    : !!(obj(data) && Array.isArray(data.results));

  function extractFeed(data) {
    const out = { pins: [], promoted: 0, dropped: 0 };
    try {
      const list = Array.isArray(data) ? data : obj(data) && Array.isArray(data.results) ? data.results : [];
      for (const raw of list) {
        const p = obj(raw);
        if (!p) { out.dropped++; continue; }
        // allowlist: pins only (modules, story carousels, shopping units, "more ideas" banners are dropped)
        if (!(p.type === 'pin' || (p.type == null && obj(p.images)))) { out.dropped++; continue; }
        if (isPromotedData(p)) { out.promoted++; continue; }
        const pin = normalizePin(p);
        if (pin) out.pins.push(pin); else out.dropped++;
      }
    } catch {}
    return out;
  }

  // Merge the full PinResource answer over what the grid had (the grid's w/h stay: the card was laid out with them)
  const merge = (base, full) => {
    if (!full) return base;
    if (!base) return full;
    const m = Object.assign({}, base, full, { w: base.w, h: base.h, thumb: base.thumb || full.thumb });
    for (const k of ['title', 'description', 'link', 'domain', 'aggregatedId']) if (!full[k]) m[k] = base[k];
    if (!full.author.username) m.author = base.author;
    m.saveCount = full.saveCount || base.saveCount;
    m.commentCount = full.commentCount || base.commentCount;
    return m;
  };

  PIN.model = { normalizePin, isPromotedData, extractFeed, isFeed, merge, sizes };
})();

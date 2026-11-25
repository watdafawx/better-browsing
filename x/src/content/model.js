/* X Fast UI: the domain model. Pure functions that turn X's raw GraphQL payloads into flat records.
   X changes these shapes without notice (fields move, get renamed, disappear), so nothing here trusts anything:
   every read goes through a safe getter, a missing or odd field becomes an empty value, and no function throws
   (a record we cannot make sense of comes back as null or as { unavailable: true }).
     XBB.model.normalizeTweet(raw, opts)   Tweet / TweetWithVisibilityResults / TweetTombstone / TweetUnavailable
     XBB.model.normalizeUser(raw)          User / UserUnavailable
     XBB.model.extractTimeline(data, opts) instructions -> { items, cursors, rawEntryCount, skippedPromoted }
     XBB.model.extractUser(data)           the user of a UserByScreenName-like response
   Tweet record: { type:'tweet', id, conversationId, url, createdAt (ISO), createdAtMs, text, lang, isLongform,
     author, entities:{urls,mentions,hashtags}, media[], quote, retweetedBy, replyTo, card, communityNote, stats,
     viewer, source, sensitive, interstitial }. A retweet is the ORIGINAL tweet with `retweetedBy` set. */
(() => {
  const isObj = v => v !== null && typeof v === 'object';
  const isArr = Array.isArray;
  const arr = v => isArr(v) ? v : [];
  const str = v => typeof v === 'string' ? v : (typeof v === 'number' && isFinite(v) ? String(v) : '');
  const num = v => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && isFinite(n) ? n : 0; };
  const has = v => v !== undefined && v !== null && v !== '';
  const get = (o, ...path) => { let c = o; for (const k of path) { if (!isObj(c)) return undefined; c = c[k]; } return c; };
  const idx = v => isArr(v) && v.length >= 2 ? [num(v[0]), num(v[1])] : null;
  const MAX_DEPTH = 3;

  const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
  const unescapeHtml = s => s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, m => ENT[m]);

  // "Wed Oct 10 20:19:24 +0000 2018" (what X sends) or anything Date.parse takes -> ms, or null. The first form is
  // parsed by hand: browsers disagree on it.
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const toMs = v => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string' || !v) return null;
    const m = /^\w{3} (\w{3}) (\d{1,2}) (\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d) (\d{4})$/.exec(v);
    if (m && m[1] in MONTHS) {
      const off = (m[6] === '-' ? -1 : 1) * (+m[7] * 60 + +m[8]) * 60000;
      return Date.UTC(+m[9], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5]) - off;
    }
    const p = Date.parse(v);
    return isFinite(p) ? p : null;
  };
  const iso = ms => { try { return ms === null ? null : new Date(ms).toISOString(); } catch { return null; } };

  // ---------- users ----------
  // `result` wrappers: user_results / user_result / { result: {...} }
  function unwrap(raw) {
    let r = raw;
    for (let i = 0; i < 4 && isObj(r); i++) {
      if (isObj(r.result)) { r = r.result; continue; }
      if (r.__typename || r.rest_id || r.legacy || r.details) break;
      if (isObj(r.user_results)) r = r.user_results;
      else if (isObj(r.user_result)) r = r.user_result;
      else if (isObj(r.tweet_results)) r = r.tweet_results;
      else break;
    }
    return isObj(r) ? r : null;
  }

  function normalizeUser(raw) {
    try {
      const u = unwrap(raw);
      if (!u) return null;
      if (u.__typename === 'UserUnavailable') return { type: 'user', unavailable: true, id: str(u.rest_id) || null, reason: str(u.reason) || str(get(u, 'unavailable_message', 'text')) || 'unavailable' };
      const l = isObj(u.legacy) ? u.legacy : {};
      const core = isObj(u.core) ? u.core : {};
      const vt = str(get(u, 'verification', 'verified_type')) || str(l.verified_type) || '';
      const blue = u.is_blue_verified === true || get(u, 'verification', 'is_blue_verified') === true || get(u, 'verification', 'verified') === true || l.verified === true || !!vt;
      const rel = isObj(u.relationship_perspectives) ? u.relationship_perspectives : {};
      const rcnt = isObj(u.relationship_counts) ? u.relationship_counts : {};
      const tcnt = isObj(u.tweet_counts) ? u.tweet_counts : {};
      const following = rel.following ?? u.is_following ?? l.following;
      const requested = rel.follow_request_sent ?? u.follow_request_sent ?? l.follow_request_sent;
      const ms = toMs(core.created_at ?? l.created_at);
      const urlEnt = get(l, 'entities', 'url', 'urls', 0);
      return {
        type: 'user',
        id: str(u.rest_id) || str(l.id_str),
        name: str(core.name ?? l.name),
        screenName: str(core.screen_name ?? l.screen_name),
        bio: unescapeHtml(str(l.description ?? get(u, 'profile_bio', 'description'))),
        avatar: str(get(u, 'avatar', 'image_url') ?? l.profile_image_url_https),
        banner: str(l.profile_banner_url),
        followers: num(rcnt.followers ?? l.followers_count ?? l.normal_followers_count),
        following: num(rcnt.following ?? l.friends_count),
        tweetsCount: num(tcnt.tweets ?? l.statuses_count),
        likesCount: num(l.favourites_count),
        mediaCount: num(l.media_count),
        verified: blue,
        verifiedType: vt || (u.is_blue_verified === true ? 'Blue' : (l.verified === true ? 'Legacy' : null)),
        createdAt: iso(ms),
        createdAtMs: ms,
        followingState: following === true ? 'following' : requested === true ? 'requested' : 'none',
        followedBy: (rel.followed_by ?? l.followed_by) === true,
        blocking: (rel.blocking ?? l.blocking) === true,
        muting: (rel.muting ?? l.muting) === true,
        protected: (get(u, 'privacy', 'protected') ?? l.protected) === true,
        location: str(get(u, 'location', 'location') ?? l.location),
        url: str(get(urlEnt, 'expanded_url') ?? l.url),
        pinnedTweetIds: arr(l.pinned_tweet_ids_str).map(str).filter(Boolean)
      };
    } catch { return null; }
  }

  // The few user fields a tweet carries about its author
  function authorOf(u) {
    const n = normalizeUser(u);
    if (!n) return { id: '', name: '', screenName: '', avatar: '', verified: false, verifiedType: null };
    return { id: n.id, name: n.name, screenName: n.screenName, avatar: n.avatar, verified: !!n.verified, verifiedType: n.verifiedType || null };
  }

  // ---------- tweets ----------
  function entitiesOf(e) {
    e = isObj(e) ? e : {};
    return {
      urls: arr(e.urls).filter(isObj).map(u => ({ url: str(u.url), expandedUrl: str(u.expanded_url) || str(u.url), displayUrl: str(u.display_url), indices: idx(u.indices) })),
      mentions: arr(e.user_mentions).filter(isObj).map(m => ({ id: str(m.id_str), screenName: str(m.screen_name), name: str(m.name), indices: idx(m.indices) })),
      hashtags: arr(e.hashtags).filter(isObj).map(h => ({ text: str(h.text), indices: idx(h.indices) }))
    };
  }

  function mediaOf(m) {
    const type = str(m.type);
    const oi = isObj(m.original_info) ? m.original_info : {};
    const base = { id: str(m.id_str), tcoUrl: str(m.url), width: num(oi.width), height: num(oi.height), alt: str(m.ext_alt_text) || null };
    if (type === 'video' || type === 'animated_gif') {
      const vi = isObj(m.video_info) ? m.video_info : {};
      const vars = arr(vi.variants).filter(v => isObj(v) && typeof v.url === 'string');
      const mp4 = vars.filter(v => v.content_type === 'video/mp4').sort((a, b) => num(b.bitrate) - num(a.bitrate));
      const hls = vars.find(v => /mpegurl/i.test(str(v.content_type)));
      const ar = isArr(vi.aspect_ratio) && num(vi.aspect_ratio[1]) > 0 ? num(vi.aspect_ratio[0]) / num(vi.aspect_ratio[1]) : (base.height ? base.width / base.height : null);
      return Object.assign(base, {
        type: type === 'video' ? 'video' : 'gif',
        url: mp4.length ? mp4[0].url : null,
        bitrate: mp4.length ? num(mp4[0].bitrate) : 0,
        variants: mp4.map(v => ({ url: v.url, bitrate: num(v.bitrate) })),   // every MP4, best first
        hls: hls ? hls.url : null,
        duration: num(vi.duration_millis),
        poster: str(m.media_url_https),
        aspectRatio: ar
      });
    }
    return Object.assign(base, { type: type === 'photo' ? 'photo' : (type || 'unknown'), url: str(m.media_url_https) });
  }

  // Card binding values: [{ key, value: { string_value | boolean_value | image_value, type } }] (or a key->value map)
  function bindingsOf(bv) {
    const out = {};
    const put = (k, v) => {
      if (typeof k !== 'string' || !isObj(v)) return;
      out[k] = has(v.string_value) ? v.string_value : v.boolean_value !== undefined ? v.boolean_value : (v.image_value ?? v.user_value ?? null);
    };
    if (isArr(bv)) for (const b of bv) { if (isObj(b)) put(b.key, b.value); }
    else if (isObj(bv)) for (const k of Object.keys(bv)) put(k, bv[k]);
    return out;
  }
  const IMG_KEYS = ['thumbnail_image_original', 'thumbnail_image_large', 'summary_photo_image_original', 'photo_image_full_size_original',
    'thumbnail_image', 'summary_photo_image', 'player_image_original', 'player_image'];
  function cardOf(c) {
    if (!isObj(c)) return null;
    const leg = isObj(c.legacy) ? c.legacy : c;
    const name = str(leg.name ?? c.name);
    const b = bindingsOf(leg.binding_values ?? c.binding_values);
    const poll = /^poll(\d)choice/.exec(name);
    if (poll) {
      const choices = [];
      for (let i = 1; i <= +poll[1]; i++) choices.push({ label: str(b['choice' + i + '_label']), count: num(b['choice' + i + '_count']) });
      const end = toMs(b.end_datetime_utc);
      return { kind: 'poll', name, choices, total: choices.reduce((n, x) => n + x.count, 0), endTime: iso(end), endTimeMs: end, final: b.counts_are_final === true };
    }
    let thumb = null;
    for (const k of IMG_KEYS) { if (isObj(b[k]) && str(b[k].url)) { thumb = { url: str(b[k].url), width: num(b[k].width), height: num(b[k].height) }; break; } }
    const title = str(b.title), url = str(b.card_url) || str(leg.url);
    if (title || url) return { kind: 'link', name, title, description: str(b.description), domain: str(b.vanity_url) || str(b.domain), url, thumb };
    return { kind: 'other', name };
  }

  function communityNoteOf(bw) {
    if (!isObj(bw)) return null;
    return { noteId: str(get(bw, 'note', 'rest_id')), title: str(bw.title), shortTitle: str(bw.shorttitle), text: unescapeHtml(str(get(bw, 'subtitle', 'text'))), url: str(bw.destinationUrl), visualStyle: str(bw.visualStyle) };
  }

  const unavailable = (reason, kind, id) => ({ type: 'unavailable', unavailable: true, id: id || null, kind, reason: reason || 'This post is unavailable.' });

  // `raw` may be a tweet_results wrapper ({ result }), the result itself, a TweetWithVisibilityResults ({ tweet }),
  // or a tombstone. Nothing here throws.
  function normalizeTweet(raw, opts) {
    try { return tweetRecord(raw, (opts && opts._d) || 0); } catch { return null; }
  }

  function tweetRecord(raw, depth) {
    if (depth > MAX_DEPTH) return null;
    let t = unwrap(raw), interstitial = null;
    if (!t) return null;
    // TweetWithVisibilityResults wraps the real tweet one level down
    for (let i = 0; i < 3 && t && !t.legacy && (t.__typename === 'TweetWithVisibilityResults' || isObj(t.tweet)); i++) {
      interstitial = str(get(t, 'tweetInterstitial', 'text', 'text')) || interstitial;
      t = unwrap(t.tweet);
    }
    if (!t) return null;
    if (t.__typename === 'TweetTombstone' || (!t.legacy && isObj(t.tombstone))) return unavailable(str(get(t, 'tombstone', 'text', 'text')), 'tombstone');
    if (t.__typename === 'TweetUnavailable') return unavailable(str(t.reason) || 'Unavailable', 'unavailable');
    const l = isObj(t.legacy) ? t.legacy : null;
    const det = isObj(t.details) ? t.details : {};
    const cnt = isObj(t.counts) ? t.counts : {};
    const per = isObj(t.perspective) ? t.perspective : {};
    const id = str(t.rest_id) || str(get(l, 'id_str'));
    if (!l && !id) return null;
    const lg = l || {};

    // A retweet is the retweeter's tweet pointing at the original: return the original, say who retweeted it
    const rtRaw = get(t, 'retweeted_status_result') ?? get(lg, 'retweeted_status_result');
    if (rtRaw && depth < MAX_DEPTH) {
      const inner = tweetRecord(rtRaw, depth + 1);
      if (inner) {
        const who = authorOf(get(t, 'core', 'user_results'));
        const rms = toMs(det.created_at_ms ?? lg.created_at);
        inner.retweetedBy = { id: who.id, name: who.name, screenName: who.screenName, tweetId: id, createdAt: iso(rms), createdAtMs: rms };
        return inner;
      }
    }

    const author = authorOf(get(t, 'core', 'user_results'));
    const note = get(t, 'note_tweet', 'note_tweet_results', 'result');
    const isLong = isObj(note) && typeof note.text === 'string' && note.text.length > 0;
    let text, ents;
    if (isLong) { text = unescapeHtml(note.text); ents = note.entity_set; }
    else {
      text = unescapeHtml(str(det.full_text ?? lg.full_text ?? lg.text));
      ents = (isArr(t.url_entities) || isArr(t.mention_entities) || isArr(det.hashtag_entities))
        ? { urls: t.url_entities, user_mentions: t.mention_entities, hashtags: det.hashtag_entities }
        : lg.entities;
      // What X shows: without the reply mentions in front and the media link behind (positions count code points)
      const r = idx(det.display_text_range ?? lg.display_text_range);
      if (r && r[1] > r[0]) { const cps = Array.from(text); if (r[1] <= cps.length) text = cps.slice(r[0], r[1]).join(''); }
    }
    const mediaRaw = isArr(t.media_entities2) ? t.media_entities2 : isArr(get(lg, 'extended_entities', 'media')) ? lg.extended_entities.media : get(lg, 'entities', 'media');
    const ms = toMs(det.created_at_ms ?? lg.created_at);
    const sn = author.screenName;
    const views = get(t, 'views', 'count');

    const quoteRaw = get(t, 'quoted_status_result');
    const replyId = str(lg.in_reply_to_status_id_str ?? det.in_reply_to_status_id_str);
    return {
      type: 'tweet',
      id,
      conversationId: str(lg.conversation_id_str) || id,
      url: 'https://x.com/' + (sn || 'i') + '/status/' + id,
      createdAt: iso(ms),
      createdAtMs: ms,
      text: text.trim(),
      lang: str(lg.lang),
      isLongform: isLong,
      author,
      entities: entitiesOf(ents),
      media: arr(mediaRaw).filter(isObj).map(mediaOf),
      quote: quoteRaw ? tweetRecord(quoteRaw, depth + 1) : null,
      retweetedBy: null,
      replyTo: replyId || str(lg.in_reply_to_screen_name) ? { tweetId: replyId || null, userId: str(lg.in_reply_to_user_id_str) || null, screenName: str(lg.in_reply_to_screen_name) || null } : null,
      card: cardOf(t.card),
      communityNote: communityNoteOf(t.birdwatch_pivot),
      stats: {
        replies: num(cnt.reply_count ?? lg.reply_count),
        retweets: num(cnt.retweet_count ?? lg.retweet_count),
        quotes: num(cnt.quote_count ?? lg.quote_count),
        likes: num(cnt.favorite_count ?? lg.favorite_count),
        bookmarks: num(cnt.bookmark_count ?? lg.bookmark_count),
        views: has(views) ? num(views) : null
      },
      viewer: {
        liked: (per.favorited ?? lg.favorited) === true,
        retweeted: (per.retweeted ?? lg.retweeted) === true,
        bookmarked: (per.bookmarked ?? lg.bookmarked) === true
      },
      source: str(t.source).replace(/<[^>]*>/g, '').trim(),
      sensitive: lg.possibly_sensitive === true,
      interstitial
    };
  }

  // ---------- timelines ----------
  // `instructions` sits at a different depth in every response (home_timeline_urt, threaded_conversation_with_
  // injections_v2, user.result.timeline.timeline, search_by_raw_query.search_timeline.timeline, bookmark_timeline_v2.
  // timeline, ...): find it instead of naming the path. Breadth first, bounded.
  function findInstructions(root) {
    if (isArr(root)) return root;
    const q = [root];
    let empty = null;
    for (let n = 0; q.length && n < 3000; n++) {
      const c = q.shift();
      if (!isObj(c)) continue;
      if (isArr(c.instructions)) {
        if (c.instructions.length) return c.instructions;
        if (!empty) empty = c.instructions;
      }
      for (const k in c) { const v = c[k]; if (isObj(v) && !isArr(v)) q.push(v); }
    }
    return empty;
  }

  const isPromoted = (ic, entryId) => !!(ic && (ic.promotedMetadata || ic.promoted_metadata || get(ic, 'tweet_results', 'result', 'promotedMetadata') || get(ic, 'tweet_results', 'result', 'promoted_metadata'))) || /(^|-)(promoted|ad)-|promotedtweet/i.test(entryId || '');

  function extractTimeline(data, opts) {
    const keepPromoted = !!(opts && opts.keepPromoted);
    const out = { items: [], cursors: { top: null, bottom: null, showMore: [] }, rawEntryCount: 0, skippedPromoted: 0, hasInstructions: false, instructionTypes: [] };
    try {
      const ins = findInstructions(data);
      if (!ins) return out;
      out.hasInstructions = true;
      const cursor = (c, entryId) => {
        const v = str(c.value);
        if (!v) return;
        const type = str(c.cursorType ?? c.cursor_type) || (/^cursor-top/.test(entryId || '') ? 'Top' : /^cursor-bottom/.test(entryId || '') ? 'Bottom' : '');
        if (type === 'Top') out.cursors.top = v;
        else if (type === 'Bottom') out.cursors.bottom = v;
        else if (/^ShowMore/.test(type)) out.cursors.showMore.push({ type, value: v });
      };
      const item = (ic, meta) => {
        if (!isObj(ic)) return;
        const kind = str(ic.itemType) || str(ic.__typename);
        if (kind === 'TimelineTweet') {
          const promoted = isPromoted(ic, meta.entryId);
          if (promoted && !keepPromoted) { out.skippedPromoted++; return; }
          const tweet = normalizeTweet(ic.tweet_results);
          if (!tweet) return;
          out.items.push({ kind: 'tweet', entryId: meta.entryId, sortIndex: meta.sortIndex, tweet, promoted, display: str(ic.tweetDisplayType ?? ic.display_type) || null,
            pinned: !!meta.pinned, moduleId: meta.moduleId || null, moduleIndex: meta.moduleIndex ?? null });
        } else if (kind === 'TimelineUser') {
          const user = normalizeUser(ic.user_results);
          if (user) out.items.push({ kind: 'user', entryId: meta.entryId, sortIndex: meta.sortIndex, user, promoted: isPromoted(ic, meta.entryId), moduleId: meta.moduleId || null, moduleIndex: meta.moduleIndex ?? null });
        } else if (kind === 'TimelineTimelineCursor') cursor(ic, meta.entryId);
      };
      const moduleItems = (items, moduleId, sortIndex) => {
        arr(items).forEach((it, i) => {
          out.rawEntryCount++;
          if (!isObj(it)) return;
          const ic = get(it, 'item', 'itemContent') ?? get(it, 'item', 'content') ?? it.itemContent ?? it.content;
          item(ic, { entryId: str(it.entryId ?? it.entry_id) || moduleId, sortIndex, moduleId, moduleIndex: i });
        });
      };
      const entry = (e, pinned) => {
        out.rawEntryCount++;
        if (!isObj(e) || !isObj(e.content)) return;
        const c = e.content, entryId = str(e.entryId ?? e.entry_id), sortIndex = str(e.sortIndex ?? e.sort_index) || null;
        const type = str(c.entryType) || str(c.__typename);
        if (type === 'TimelineTimelineCursor' || has(c.cursorType) || has(c.cursor_type)) cursor(c, entryId);
        else if (type === 'TimelineTimelineModule' || isArr(c.items)) {
          if (isPromoted(null, entryId) && !keepPromoted) { out.skippedPromoted++; return; }
          moduleItems(c.items, entryId, sortIndex);
        } else item(c.itemContent ?? c.content, { entryId, sortIndex, pinned });
      };
      for (const i of ins) {
        if (!isObj(i)) continue;
        const t = i.type || i.__typename;
        if (t) out.instructionTypes.push(t);
        if (t === 'TimelineAddEntries' || (!t && isArr(i.entries)) || (isArr(i.entries) && !t.includes('Remove'))) {
          for (const e of arr(i.entries)) entry(e, false);
        } else if (t === 'TimelineReplaceEntry') {
          entry(i.entry, false);
        } else if (t === 'TimelinePinEntry') {
          entry(i.entry, true);
        } else if (t === 'TimelineAddToModule' || isArr(i.moduleItems)) {
          moduleItems(i.moduleItems, str(i.moduleEntryId), null);
        }
      }
    } catch {}
    return out;
  }

  // The user in a UserByScreenName-like response: the first `User` object under `data`
  function extractUser(data) {
    try {
      const q = [data];
      for (let n = 0; q.length && n < 3000; n++) {
        const c = q.shift();
        if (!isObj(c) || isArr(c)) { if (isArr(c)) for (const v of c) if (isObj(v)) q.push(v); continue; }
        if ((c.__typename === 'User' || c.__typename === 'UserUnavailable') && (c.rest_id || c.reason)) return normalizeUser(c);
        for (const k in c) { const v = c[k]; if (isObj(v)) q.push(v); }
      }
    } catch {}
    return null;
  }

  // pbs.twimg.com avatars come as `_normal` (48 px); `_bigger`, `_200x200`, `_400x400` are the other sizes
  const avatarSize = (url, size) => typeof url === 'string' ? url.replace(/_(?:normal|bigger|mini|200x200|400x400|reasonably_small)(\.\w+)$/, '_' + size + '$1') : '';

  XBB.model = { normalizeTweet, normalizeUser, extractTimeline, extractUser, avatarSize, toMs };
})();

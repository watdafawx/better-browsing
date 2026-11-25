/* X Fast UI: the entity store. Tweets and users by id, timelines as lists of row entries, and per-id
   subscribers so a like re-renders one action bar, not the list.
     store.put(tweet)              a XBB.model tweet record (its quote and author go in too); returns the stored one
     store.tweet(id) / store.user(id)
     store.patch(id, { viewer: {...}, stats: {...} })   optimistic change; returns undo() that puts the old values back
     store.sub(id, fn)             fn(tweet) after every put/patch of that id; returns unsubscribe
     store.list(name)              a named timeline: { rows: [{ key, id, ... }], keys: Set, cursors, ... } */
(() => {
  const tweets = new Map(), users = new Map(), subs = new Map(), lists = new Map();
  const fire = id => {
    const set = subs.get(id);
    if (!set) return;
    const t = tweets.get(id);
    for (const fn of [...set]) { try { fn(t); } catch (e) { console.error('[XBB fast]', e); } }
  };
  const store = {
    put(t) {
      if (!t || !t.id) return t;
      if (t.quote && t.quote.id && !t.quote.unavailable) store.put(t.quote);
      if (t.author && t.author.id) users.set(t.author.id, Object.assign(users.get(t.author.id) || {}, t.author));
      tweets.set(t.id, t);
      fire(t.id);
      return t;
    },
    tweet: id => tweets.get(id),
    user: id => users.get(id),
    patch(id, p) {
      const t = tweets.get(id);
      if (!t) return () => {};
      // Only the fields this patch touched are put back, so two overlapping actions (like, then retweet) undo apart
      const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
      const before = {};
      const next = Object.assign({}, t);
      for (const k of Object.keys(p)) {
        if (isMap(p[k])) {
          before[k] = {};
          for (const sk of Object.keys(p[k])) before[k][sk] = t[k] ? t[k][sk] : undefined;
          next[k] = Object.assign({}, t[k], p[k]);
        } else { before[k] = t[k]; next[k] = p[k]; }
      }
      tweets.set(id, next);
      fire(id);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const cur = tweets.get(id);
        if (!cur) return;
        const back = Object.assign({}, cur);
        for (const k of Object.keys(before)) back[k] = isMap(p[k]) ? Object.assign({}, cur[k], before[k]) : before[k];
        tweets.set(id, back);
        fire(id);
      };
    },
    sub(id, fn) {
      if (!subs.has(id)) subs.set(id, new Set());
      subs.get(id).add(fn);
      return () => { const s = subs.get(id); if (s) { s.delete(fn); if (!s.size) subs.delete(id); } };
    },
    list(name) {
      if (!lists.has(name)) lists.set(name, { name, rows: [], keys: new Set(), heights: new Map(), cursors: { top: null, bottom: null }, vars: null, loadedAt: 0, scroll: 0 });
      return lists.get(name);
    },
    stats: () => ({ tweets: tweets.size, users: users.size, subs: subs.size, lists: [...lists.values()].map(l => [l.name, l.rows.length]) })
  };
  XBB.fast.store = store;
})();

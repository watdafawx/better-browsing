/* X Fast UI: a profile, /<handle>, /<handle>/with_replies, /<handle>/media.
     - The account: the store (kept for 5 minutes), else X's own UserByScreenName for this handle (X's router renders
       the profile underneath and fetches it: the tap), else ours after a short wait (at once in Zero-JS mode).
     - Header: Back, banner, avatar, name + badge, @handle, bio, location, website, joined, following / followers,
       and Follow / Following (optimistic, /i/api/1.1/friendships/create|destroy.json, undone when X refuses).
     - Tabs: Posts (UserOriginalsTimeline when X has it, else UserTweets), Replies (UserTweetsAndReplies), Media
       (UserMedia), in XBB.fast.feed. A tab switch replaces the URL, so Back leaves the profile.
     - Not learned, gone, suspended, protected: the header says so, "Open on X" is one click; Home is never touched.
   XBB.fast.views.profile(shell, { url }) -> feed view + { setUrl(url), user() } */
(() => {
  const { h } = XBB;
  const fast = XBB.fast, store = fast.store, render = fast.render;
  const TAP_WAIT = 700, FRESH = 5 * 60 * 1000;
  const TAB_OF = { '': 'posts', with_replies: 'replies', media: 'media' };
  const SUFFIX = { posts: '', replies: '/with_replies', media: '/media' };
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const userVars = (op, uid, sn) => op === 'UserMedia'
    ? { userId: uid, screenName: sn, count: 20, includePromotedContent: false, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true }
    : op === 'UserTweetsAndReplies'
      ? { userId: uid, screenName: sn, count: 20, includePromotedContent: true, withCommunity: true, withVoice: true }
      : { userId: uid, screenName: sn, count: 20, includePromotedContent: true, withQuickPromoteEligibilityTweetFields: true, withVoice: true };

  fast.views = fast.views || {};
  fast.views.profile = function profile(shell, ctx) {
    const parse = url => { const u = new URL(url || location.href, location.href); return fast.handleOf(u.pathname) || { handle: '', tab: '' }; };
    const first = parse(ctx && ctx.url);
    const sn = first.handle;
    let user = store.profile(sn) || null;
    if (user && Date.now() - (user.at || 0) > FRESH) user = Object.assign({}, user, { stale: true });
    let uState = user ? 'ok' : 'loading';      // loading | ok | learn | drift | gone | error
    let uMsg = '', dead = false, waitT = 0, busy = false;
    const uid = () => (user && user.id) || '';

    // ---------- header ----------
    const titleName = h('b', null, sn);
    const titleSub = h('small', null, '');
    const bar = h('div', { class: 'pf-bar' },
      h('button', { class: 'icon-btn', type: 'button', 'data-pf': 'back', title: 'Back', 'aria-label': 'Back' }, render.icon('back')),
      h('div', { class: 'pf-title' }, titleName, titleSub));
    const hero = h('section', { class: 'pf-hero', 'aria-label': 'Profile' });

    function paint() {
      if (dead) return;
      const u = user || { screenName: sn, name: '' };
      titleName.textContent = u.name || '@' + sn;
      titleSub.textContent = u.tweetsCount ? `${render.fmt(u.tweetsCount)} posts` : '';
      const kids = [];
      const banner = render.safe(u.banner ? (/\/\d+x\d+$/.test(u.banner) ? u.banner : u.banner + '/1500x500') : '');
      kids.push(h('div', { class: 'pf-banner' }, banner ? h('img', { src: banner, alt: '', decoding: 'async' }) : null));
      const me = fast.me();
      const mine = !!(user && ((me.id && me.id === user.id) || (me.screenName && me.screenName.toLowerCase() === sn.toLowerCase())));
      let act = null;
      if (user && user.id && !user.unavailable) {
        if (mine) act = h('button', { class: 'btn', type: 'button', 'data-fd-native': '/settings/profile' }, 'Edit profile');
        else if (user.blocking) act = h('button', { class: 'btn', type: 'button', 'data-fd-native': '/' + sn }, 'Blocked');
        else {
          const st = user.followingState;
          act = h('button', { class: 'btn follow' + (st === 'none' ? ' primary' : ' on'), type: 'button', 'data-pf': 'follow', 'aria-pressed': String(st !== 'none'), disabled: busy || null },
            st === 'following' ? h('span', { class: 'when-off' }, 'Following') : st === 'requested' ? 'Pending' : 'Follow',
            st === 'following' ? h('span', { class: 'when-on' }, 'Unfollow') : null);
        }
      }
      const av = user && user.avatar ? h('img', { class: 'pf-av', src: render.safe(XBB.model.avatarSize(user.avatar, '400x400')), alt: '', decoding: 'async' })
        : h('span', { class: 'pf-av ini' }, (u.name || sn || '?').slice(0, 1).toUpperCase());
      kids.push(h('div', { class: 'pf-row' }, av, h('span', { class: 'spacer' }), act));
      kids.push(h('div', { class: 'pf-names' },
        h('div', { class: 'pf-name' }, h('span', null, u.name || sn), user ? render.badge(user) : null, user && user.protected ? render.icon('lock', 'i lock') : null),
        h('div', { class: 'handle' }, '@' + (u.screenName || sn), user && user.followedBy ? h('span', { class: 'follows-you' }, 'Follows you') : null)));
      if (uState === 'ok' && user) {
        if (user.bio) kids.push(h('div', { class: 'pf-bio', dir: 'auto' }, user.bio));
        const meta = [];
        if (user.location) meta.push(h('span', null, render.icon('loc'), user.location));
        const site = render.safe(user.url);
        if (site) meta.push(h('span', null, render.icon('link'), h('a', { href: site, target: '_blank', rel: 'noopener noreferrer' }, site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))));
        if (user.createdAtMs) { const d = new Date(user.createdAtMs); meta.push(h('span', null, render.icon('cal'), `Joined ${MON[d.getMonth()]} ${d.getFullYear()}`)); }
        if (meta.length) kids.push(h('div', { class: 'pf-meta' }, meta));
        kids.push(h('div', { class: 'pf-counts' },
          h('a', { href: `/${sn}/following`, 'data-fd-native': `/${sn}/following` }, h('b', null, render.fmt(user.following) || '0'), ' Following'),
          h('a', { href: `/${sn}/verified_followers`, 'data-fd-native': `/${sn}/verified_followers` }, h('b', null, render.fmt(user.followers) || '0'), ' Followers')));
      } else if (uState !== 'loading') {
        kids.push(h('div', { class: 'fd-banner', 'data-kind': uState === 'gone' ? 'gone' : 'learn', role: 'status' },
          h('span', null, uMsg), h('span', { class: 'fd-acts' },
            uState === 'error' ? h('button', { class: 'btn', type: 'button', 'data-pf': 'retry' }, 'Retry') : null,
            h('button', { class: 'btn primary', type: 'button', 'data-fd-native': '/' + sn }, 'Open on X', render.icon('ext')))));
      } else kids.push(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' }));
      hero.replaceChildren(...kids);
    }

    // ---------- the timeline ----------
    const TABS = {
      posts: { label: 'Posts', learn: 'Posts', ops: ['UserOriginalsTimeline', 'UserTweets'] },
      replies: { label: 'Replies', learn: 'Replies', ops: ['UserTweetsAndReplies'] },
      media: { label: 'Media', learn: 'Media', ops: ['UserMedia'] }
    };
    for (const k in TABS) Object.assign(TABS[k], {
      vars: () => uid() && uState === 'ok' ? userVars(TABS[k].ops[TABS[k].ops.length - 1], uid(), sn) : null,
      match: v => (v.userId && String(v.userId) === uid()) || (v.screenName && String(v.screenName).toLowerCase() === sn.toLowerCase()),
      list: () => `profile:${uid() || sn.toLowerCase()}:${k}`,
      native: () => '/' + sn + SUFFIX[k]
    });
    const feed = fast.feed(shell, {
      cls: 'profile', label: 'profile', head: bar, hero, tabs: TABS, tab: TAB_OF[first.tab] || 'posts',
      onSelect: k => fast.go('/' + sn + SUFFIX[k], { replace: true }),
      empty: k => k === 'media' ? 'No photos or videos yet.' : k === 'replies' ? 'No replies yet.' : 'No posts yet.',
      click(e, t) {
        const b = t.closest('[data-pf]');
        if (!b) return false;
        e.preventDefault();
        const k = b.dataset.pf;
        if (k === 'back') fast.back();
        else if (k === 'follow') follow();
        else if (k === 'retry') { uState = 'loading'; paint(); request(); }
        return true;
      }
    });

    // ---------- the account ----------
    function take(u, from) {
      if (dead) return false;
      if (!u) { uState = 'gone'; uMsg = `@${sn} doesn't exist, or X could not find it.`; paint(); return true; }
      if (u.unavailable) { uState = 'gone'; uMsg = /suspend/i.test(u.reason || '') ? `@${sn} is suspended.` : `@${sn} is not available (${u.reason || 'unavailable'}).`; paint(); return true; }
      user = store.putProfile(u);
      uState = 'ok';
      clearTimeout(waitT);
      paint();
      feed.kick();
      return true;
    }
    const tapMatch = t => t && t.status >= 200 && t.status < 300 && t.data && String((t.variables && (t.variables.screenName || t.variables.screen_name)) || '').toLowerCase() === sn.toLowerCase();
    function onTap(t) { if (tapMatch(t) && (uState === 'loading' || (user && user.stale))) take(XBB.model.extractUser(t.data), 'tap'); }
    const offTap = XBB.gql.onTap('UserByScreenName', onTap);
    async function request() {
      fast.extraRequests = (fast.extraRequests || 0) + 1;
      const r = await XBB.gql.call('UserByScreenName', { screen_name: sn, screenName: sn, withGrokTranslatedBio: false });
      if (dead) return;
      if (r.ok) { take(XBB.model.extractUser(r.data), 'call'); return; }
      if (user && user.stale) return;      // keep what we had
      const bk = r.kind === 'breaker-open' && r.breaker ? r.breaker.kind : r.kind;
      if (bk === 'missing-op' || bk === 'no-main-world') { uState = 'learn'; uMsg = 'Profiles not learned yet. Open this profile on X once to learn them.'; }
      else if (bk === 'drift') { uState = 'learn'; uMsg = 'X changed how profiles load. Open this profile on X for now.'; }
      else if (r.kind === 'graphql-error') { uState = 'gone'; uMsg = `@${sn} doesn't exist, or X could not find it.`; }
      else { uState = 'error'; uMsg = r.kind === 'rate-limit' ? 'X is rate limiting requests. Try again in a minute.' : 'Could not load this profile from X.'; }
      console.warn('[XBB fast] profile failed:', sn, { kind: r.kind, status: r.status });
      paint();
    }
    function start() {
      if (user) feed.kick();
      if (user && !user.stale) return;
      const tapped = XBB.gql.getTapped('UserByScreenName', { all: true }).filter(tapMatch).pop();
      if (tapped && Date.now() - (tapped.t || 0) < FRESH) { take(XBB.model.extractUser(tapped.data), 'tap'); return; }
      if (XBB.ext && XBB.ext.blocking()) { request(); return; }
      waitT = setTimeout(() => { if (!dead && (uState === 'loading' || (user && user.stale))) request(); }, TAP_WAIT);
    }

    // ---------- Follow ----------
    async function follow() {
      if (!user || busy) return;
      const was = user.followingState || 'none';
      const want = was === 'none';
      const before = { followingState: was, followers: user.followers };
      busy = true;
      user = store.putProfile(Object.assign({}, user, { followingState: want ? (user.protected ? 'requested' : 'following') : 'none', followers: Math.max(0, (user.followers || 0) + (want ? (user.protected ? 0 : 1) : -1)) }));
      paint();
      fast.extraRequests = (fast.extraRequests || 0) + 1;
      const r = await XBB.gql.rest(want ? '/i/api/1.1/friendships/create.json' : '/i/api/1.1/friendships/destroy.json',
        { method: 'POST', form: true, body: { include_profile_interstitial_type: '1', skip_status: 'true', user_id: user.id } });
      busy = false;
      if (dead) return;
      if (!r.ok) {
        user = store.putProfile(Object.assign({}, user, before));
        fast.toast(`Couldn't ${want ? 'follow' : 'unfollow'} @${sn} on X${r.kind === 'rate-limit' ? ' (rate limited)' : ''}. Nothing changed.`);
      }
      paint();
    }

    paint();
    start();

    return Object.assign({}, feed, {
      el: feed.el,
      user: () => user,
      setUrl(url) {
        const p = parse(url);
        if (p.handle.toLowerCase() !== sn.toLowerCase()) return false;
        feed.select(TAB_OF[p.tab] || 'posts', true);
        return true;
      },
      destroy() { dead = true; clearTimeout(waitT); offTap(); feed.destroy(); },
      debug: () => Object.assign(feed.debug(), { view: 'profile', handle: sn, user: uState, uid: uid(), following: user && user.followingState })
    });
  };
})();

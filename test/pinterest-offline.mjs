// Offline smoke test: the userscript on Pinterest. Answers every pinterest.com / pinimg.com request from
// fixtures, so it never touches the site. Run: node test/pinterest-offline.mjs  (BROWSER=firefox for Firefox)
import { chromium, firefox } from 'playwright';
import path from 'path'; import fs from 'fs';
import { idleMutations, churnCost, costOk } from './lib/perf.mjs';

const usFile = path.resolve('dist/better-browsing.user.js');
if (!fs.existsSync(usFile)) { console.log('FAIL userscript built: ' + usFile + ' missing (npm run build)'); process.exit(1); }
const FF = process.env.BROWSER === 'firefox', bt = FF ? firefox : chromium;
const browser = await bt.launch(FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0 } } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// pins in grid order: image, video, idea (2 pages), image, then a promoted one
const cards = [
  { id: '111111', label: 'Image pin' },
  { id: '222222', label: 'Video pin' },
  { id: '333333', label: 'Idea pin' },
  { id: '444444', label: 'Second image' },
  { id: '555555', label: 'Promoted' },
];
const PINS = {
  '111111': {
    id: '111111', title: 'Image pin', description: 'A description here',
    images: { orig: { url: 'https://i.pinimg.com/originals/a.jpg', width: 800, height: 1200 }, '736x': { url: 'https://i.pinimg.com/736x/a.jpg' } },
    pinner: { username: 'alice' }, repin_count: 1234, comment_count: 2,
    aggregated_pin_data: { id: 'AGG111' },
  },
  '222222': {
    id: '222222', title: 'Video pin', description: 'Moving pictures',
    videos: { video_list: { V_720P: { url: 'https://v1.pinimg.com/videos/x.mp4', width: 640, height: 360 }, V_HLSV4: { url: 'https://v1.pinimg.com/videos/x.m3u8' } } },
    images: { '736x': { url: 'https://i.pinimg.com/736x/v.jpg' } }, pinner: { username: 'bob' }, repin_count: 7, comment_count: 0,
  },
  '333333': {
    id: '333333', title: 'Idea pin', description: 'Two pages',
    story_pin_data: { page_count: 2, pages: [
      { image: { images: { orig: { url: 'https://i.pinimg.com/originals/p1.jpg' } } }, blocks: [], video: null },
      { image: { images: { orig: { url: 'https://i.pinimg.com/originals/p2.jpg' } } }, blocks: [], video: null },
    ] },
    pinner: { username: 'carol' }, comment_count: 0,
  },
  '444444': { id: '444444', title: 'Second image', images: { orig: { url: 'https://i.pinimg.com/originals/b.jpg' } }, pinner: { username: 'dave' } },
  // a story page whose only rendition is `originals`, which Pinterest 403s for many pages
  '777777': { id: '777777', title: 'Broken original', pinner: { username: 'x' },
    story_pin_data: { page_count: 1, pages: [{ image: { images: { orig: { url: 'https://i.pinimg.com/originals/broken.jpg' } } }, blocks: [], video: null }] } },
  // a story page with only an HLS rendition: no progressive mp4, so the page image must be used
  '888888': { id: '888888', title: 'HLS only page', pinner: { username: 'y' },
    story_pin_data: { page_count: 1, pages: [{ image: { images: { orig: { url: 'https://i.pinimg.com/originals/hls.jpg' } } }, blocks: [],
      video: { video_list: { V_HLSV4: { url: 'https://v1.pinimg.com/videos/iht/hls/x.m3u8' } } } }] } },
};

const feed = `<!doctype html><html><head><title>Pinterest fixture</title></head><body>
<header style="height:64px"><div data-test-id="header">header</div></header>
<div class="navcol" style="display:flex;flex-direction:column;gap:24px;width:80px">
  <div data-test-id="pinterest-logo-home-button"><div><a href="/" aria-label="Home"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></a></div></div>
  <div data-test-id="vertical-nav-icon"><div><div aria-label="Home"><a href="/" aria-label="Home"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></a></div></div></div>
  <div data-test-id="vertical-nav-icon"><div><div aria-label="Explore"><a href="/explore/" aria-label="Explore"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></a></div></div></div>
</div>
<div id="grid">
${cards.map(({ id, label }, i) => `<div data-test-id="pin" id="pin-${id}" data-test-pin-id="${id}" data-test-pin-slot-index="${i}">
  <div data-test-id="pinWrapper"><a href="/pin/${id}/"><div data-test-id="pincard-image-with-link"><img src="https://i.pinimg.com/236x/${id}.jpg" alt=""></div></a></div>
  <button data-test-id="more-actions-button" aria-label="More options">…</button>
  ${label === 'Promoted' ? '<span>Promoted</span>' : `<span>${label}</span>`}
</div>`).join('\n')}
</div>
<div style="height:2000px"></div></body></html>`;

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// a big, busy feed for the CPU guards: 120 cards that keep changing (Pinterest's real grid is far bigger)
const perfFeed = `<!doctype html><html><head><title>Pinterest perf fixture</title></head><body>
<header style="height:64px"><div data-test-id="header">header</div></header>
<div id="grid">${Array.from({ length: 120 }, (_, i) => `<div data-test-id="pin" id="pin-p${i}" data-test-pin-id="9${String(i).padStart(5, '0')}" data-test-pin-slot-index="${i}">
  <div data-test-id="pinWrapper"><a href="/pin/9${String(i).padStart(5, '0')}/"><div data-test-id="pincard-image-with-link"><img src="https://i.pinimg.com/236x/p/${i}.jpg" alt=""></div></a></div>
  <button data-test-id="more-actions-button" aria-label="More options">…</button><span>Pin ${i}</span>
</div>`).join('\n')}</div>
<div style="height:4000px"></div></body></html>`;

const fixtureRoute = route => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/resource/')) {
    if (/UnifiedCommentsResource/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resource_response: { status: 'success', code: 0, data: [
        { text: 'first comment here', user: { username: 'bob' }, is_edited: false },
        { text: 'second comment', user: { username: 'carol' }, is_edited: true },
      ] } }) });
    }
    let id = null;
    try { id = JSON.parse(u.searchParams.get('data') || '{}')?.options?.id; } catch {}
    const perfPin = pid => ({
      id: pid, title: 'Perf pin ' + pid, pinner: { username: 'perf' }, description: 'perf',
      images: {
        orig: { url: 'https://i.pinimg.com/originals/perf.jpg' },
        '1200x': { url: 'https://i.pinimg.com/1200x/perf.jpg' },
        '736x': { url: 'https://i.pinimg.com/736x/perf.jpg' },
      },
    });
    const data = id ? (PINS[id] || (String(id).startsWith('9') ? perfPin(id) : null)) : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resource_response: { status: 'success', code: 0, data } }) });
  }
  if (/\/originals\//.test(u.pathname)) return route.fulfill({ status: 403, body: '' });   // Pinterest 403s `originals` for many pins
  if (/\.(jpg|jpeg|png|webp)$/i.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  if (/\.(mp4|m3u8)$/i.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'video/mp4', body: '' });
  if (u.pathname === '/perf') return route.fulfill({ status: 200, contentType: 'text/html', body: perfFeed });
  return route.fulfill({ status: 200, contentType: 'text/html', body: feed });
};
await ctx.route(/pinterest\.com|pinimg\.com/, fixtureRoute);
await ctx.addInitScript({ path: usFile });

const logs = [];
const page = await ctx.newPage();
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('dialog', d => { logs.push('[DIALOG!] ' + d.message()); d.dismiss(); });
page.on('console', m => { if (m.type() === 'error' && /\[PIN\]|Uncaught/.test(m.text())) logs.push('[error] ' + m.text().slice(0, 200)); });

const r = {};
await page.goto('https://www.pinterest.com/');
await page.waitForTimeout(1200);

r.boot = await page.evaluate(() => {
  const entry = document.querySelector('.pin-nav-entry');
  const a = entry?.querySelector('a');
  return {
    pin: !!window.PIN,
    volume: window.PIN?.settings?.videoVolume,
    nav: !!entry && !!entry.closest('.navcol'),
    navLabel: a?.getAttribute('aria-label') || '',
    gear: !!document.querySelector('.pin-gear'),
    videoAttr: document.documentElement.dataset.pinVideo || '',
    native: document.documentElement.classList.contains('pin-native'),
    snap: !!localStorage.getItem('pin-settings-snapshot'),
    pins: document.querySelectorAll('[data-test-id="pin"]').length,
  };
});

// the feed-sound switch is published to the page (main-world leaves feed videos muted unless it is on)
r.feed = await page.evaluate(async () => {
  const { settings = {} } = await PIN.api.storage.sync.get('settings');
  await PIN.api.storage.sync.set({ settings: { ...settings, feedSound: true } });
  await new Promise(r => setTimeout(r, 250));
  const on = document.documentElement.dataset.pinVideo;
  await PIN.api.storage.sync.set({ settings: { ...settings, feedSound: false } });
  await new Promise(r => setTimeout(r, 250));
  return { on, off: document.documentElement.dataset.pinVideo };
});

// promoted pin is marked and hidden
r.promoted = await page.evaluate(() => {
  const ad = document.querySelector('#pin-555555');
  return { marked: ad?.classList.contains('pin-ad'), display: ad ? getComputedStyle(ad).display : '', value: window.PIN?.settings?.hidePromoted };
});

// click the first image pin: our viewer opens, not Pinterest's page
await page.click('#pin-111111 a');
await page.waitForTimeout(1300);
r.image = await page.evaluate(() => {
  const lb = document.querySelector('.pin-lb');
  const img = lb?.querySelector('img.pin-lb-media');
  return {
    open: !!lb,
    url: location.href,
    src: img?.getAttribute('src') || '',
    count: lb?.querySelector('.pin-lb-count')?.textContent || '',
    title: lb?.querySelector('.pin-lb-title')?.textContent || '',
    side: lb?.querySelector('.pin-lb-side')?.innerText.replace(/\s+/g, ' ').slice(0, 120) || '',
    film: lb?.querySelectorAll('.pin-lb-film img').length || 0,
    comments: lb?.querySelector('.pin-lb-comments-list')?.innerText.replace(/\s+/g, ' ').slice(0, 120) || '',
    locked: document.documentElement.classList.contains('pin-noscroll'),
    attr: document.documentElement.hasAttribute('data-pin-lb'),
  };
});

// next: the video pin (our own player, sound per settings)
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(900);
r.video = await page.evaluate(() => {
  const v = document.querySelector('.pin-lb video');
  return { there: !!v, src: v?.getAttribute('src') || '', vol: v?.volume, muted: v?.muted, controls: v?.controls, own: v?.dataset.pinOwn || '', poster: v?.getAttribute('poster') || '', toggles: typeof v?._pinToggle === 'function' };
});

// next: the idea pin, page 1 then page 2
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
r.story1 = await page.evaluate(() => ({ count: document.querySelector('.pin-lb-count')?.textContent || '', src: document.querySelector('.pin-lb img.pin-lb-media')?.getAttribute('src') || '' }));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
r.story2 = await page.evaluate(() => ({ count: document.querySelector('.pin-lb-count')?.textContent || '', src: document.querySelector('.pin-lb img.pin-lb-media')?.getAttribute('src') || '' }));

// page 2 is the last page: the next press moves to the next pin
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
r.nextPin = await page.evaluate(() => ({ count: document.querySelector('.pin-lb-count')?.textContent || '', src: document.querySelector('.pin-lb img.pin-lb-media')?.getAttribute('src') || '' }));

// Esc closes and gives the page back
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
r.closed = await page.evaluate(() => ({ gone: !document.querySelector('.pin-lb'), unlocked: !document.documentElement.classList.contains('pin-noscroll'), attr: document.documentElement.hasAttribute('data-pin-lb') }));

// the promoted switch shows them again
await page.evaluate(async () => {
  const { settings = {} } = await PIN.api.storage.sync.get('settings');
  await PIN.api.storage.sync.set({ settings: { ...settings, hidePromoted: false } });
});
await page.waitForTimeout(500);
r.unhidden = await page.evaluate(() => {
  const ad = document.querySelector('#pin-555555');
  return { display: ad ? getComputedStyle(ad).display : '', marked: ad?.classList.contains('pin-ad') };
});

// a video that was playing when it left the viewport comes back when it returns (Pinterest pauses grid
// videos itself, so the resume cannot rely on our own pause having done it)
r.resume = await page.evaluate(() => new Promise(res => {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;top:0;left:0;width:320px;height:200px;z-index:2';
  const v = document.createElement('video');
  v.style.cssText = 'width:320px;height:200px';
  box.append(v);
  document.body.prepend(box);
  let playing = false; const calls = [];
  Object.defineProperty(v, 'paused', { configurable: true, get: () => !playing });
  v.play = () => { playing = true; calls.push('play'); v.dispatchEvent(new Event('play')); v.dispatchEvent(new Event('playing')); return Promise.resolve(); };
  v.pause = () => { if (!playing) return; playing = false; calls.push('pause'); v.dispatchEvent(new Event('pause')); };
  setTimeout(() => {
    v.play();
    setTimeout(() => {
      v.pause();                                      // the site pauses it as it leaves
      box.style.top = '5000px';
      setTimeout(() => {
        const marked = v.dataset.pinPausedOffscreen || null;
        box.style.top = '0px';
        setTimeout(() => {
          const out = { marked, resumed: playing, plays: calls.filter(c => c === 'play').length };
          box.remove();
          res(out);
        }, 1200);
      }, 900);
    }, 500);
  }, 900);
}));

// renditions that fail: `originals` 403s for many story pages, and an HLS-only page video cannot play here
r.fallback = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  PIN.openLightbox({ pinId: '777777' });
  await wait(900);
  const img = document.querySelector('.pin-lb-stage img');
  const out = { src: img?.getAttribute('src') || '', natural: img?.naturalWidth || 0 };
  PIN.openLightbox({ pinId: '888888' });
  await wait(900);
  out.hlsImg = !!document.querySelector('.pin-lb-stage img');
  out.hlsVideo = !!document.querySelector('.pin-lb-stage video');
  out.hlsSrc = document.querySelector('.pin-lb-stage img')?.getAttribute('src') || '';
  PIN.closeLightbox?.();
  return out;
});
await page.waitForTimeout(300);

// viewer on the big grid: opening must not block, and a step must not rebuild the filmstrip or pull an original
await page.goto('https://www.pinterest.com/perf');
await page.waitForTimeout(1200);
r.viewer = await page.evaluate(async () => {
  const link = document.querySelector('#pin-p0 a');
  const t0 = performance.now();
  link.click();                                  // our capture handler opens the viewer synchronously
  const openSync = performance.now() - t0;
  await new Promise(r => setTimeout(r, 500));
  const first = document.querySelector('.pin-lb-film img');
  const stage1 = document.querySelector('.pin-lb-stage img');
  const t1 = performance.now();
  for (let i = 0; i < 8; i++) {
    document.querySelector('.pin-lb-nav.next').click();
    await new Promise(r => setTimeout(r, 120));
  }
  const last = document.querySelector('.pin-lb-stage img');
  return {
    openSync: Math.round(openSync),
    stepAvg: Math.round((performance.now() - t1) / 8),
    filmStable: first === document.querySelector('.pin-lb-film img'),
    filmCount: document.querySelectorAll('.pin-lb-film img').length,
    count: document.querySelector('.pin-lb-count')?.textContent || '',
    usesDisplaySize: /1200x|736x|750x/.test(last?.getAttribute('src') || ''),
    fullOnZoom: last?.getAttribute('data-full') || '',
    stageChanged: stage1 !== last,
  };
});
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// CPU guards: nothing changes on an idle page by itself, and the script's own work stays small while a big
// grid keeps changing and the user scrolls.
r.perfApi = await page.evaluate(() => ({ fn: typeof PIN.perf === 'function', snap: PIN.perf() }));
r.idle = await idleMutations(page, 2000);
r.cost = await churnCost({ browserType: bt, name: FF ? 'firefox' : 'chromium', launchOpts: FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0 } } : {}, route: { re: /pinterest\.com|pinimg\.com/, fn: fixtureRoute }, url: 'https://www.pinterest.com/perf', usFile });
console.log(`PERF ${FF ? 'firefox' : 'chromium'}  idle=${r.idle}  script/CPU  with=${r.cost.with.toFixed(2)}  without=${r.cost.without.toFixed(2)}  viewer open=${r.viewer?.openSync}ms step=${r.viewer?.stepAvg}ms film=${r.viewer?.filmCount}`);

// "no autoplay": the viewer opens paused, and clicking the picture starts it (no control-bar hit needed)
await page.evaluate(async () => {
  const { settings = {} } = await PIN.api.storage.sync.get('settings');
  await PIN.api.storage.sync.set({ settings: { ...settings, videoMode: 'off' } });
});
await page.waitForTimeout(250);
await page.evaluate(() => PIN.openLightbox({ pinId: '222222' }));
await page.waitForTimeout(900);
r.offMode = await page.evaluate(async () => {
  const v = document.querySelector('.pin-lb video');
  if (!v) return { there: false };
  const calls = [];
  v.play = () => { calls.push('play'); return Promise.resolve(); };   // the fixture mp4 has no bytes
  const before = v.paused;
  v.click();                                                          // click the picture, not the bar
  await new Promise(r => setTimeout(r, 300));
  return { there: true, before, calls: calls.length };
});
await page.keyboard.press('Escape');
await page.evaluate(async () => {
  const { settings = {} } = await PIN.api.storage.sync.get('settings');
  await PIN.api.storage.sync.set({ settings: { ...settings, videoMode: 'volume' } });
});
await page.waitForTimeout(250);

const checks = {
  'userscript loads with settings, sidebar entry and the video attribute': r.boot?.pin && r.boot.volume === 40 && r.boot.nav && r.boot.navLabel === 'Better Browsing' && !r.boot.gear && r.boot.videoAttr === '{"mode":"volume","volume":40,"feed":false}' && r.boot.native && r.boot.snap,
  'the feed-sound switch is published (off by default, on when set)': /"feed":true/.test(r.feed?.on || '') && /"feed":false/.test(r.feed?.off || ''),
  'promoted pins are marked and hidden': r.promoted?.value === true && r.promoted.marked && r.promoted.display === 'none',
  'a pin opens our viewer, not Pinterest\'s page (image, title, side panel, filmstrip)': r.image?.open && /\/$/.test(new URL(r.image.url).pathname) && /(1200x|750x|736x|originals)\/a\.jpg$/.test(r.image.src) && /pin 1 \/ 4/.test(r.image.count) && r.image.title === 'Image pin' && /alice/.test(r.image.side) && /saves/.test(r.image.side) && r.image.film === 4 && r.image.locked && r.image.attr,
  'the pin\'s comments load in the side panel': /@bob/.test(r.image?.comments || '') && /first comment here/.test(r.image?.comments || '') && /second comment/.test(r.image?.comments || ''),
  'stepping to a video uses our own player with the volume setting': r.video?.there && /x\.mp4$/.test(r.video.src) && Math.abs(r.video.vol - 0.4) < 0.01 && r.video.muted === false && r.video.controls === true && r.video.own === '1' && r.video.toggles,
  'with no autoplay the viewer opens paused and clicking the picture starts it': r.offMode?.there && r.offMode.before === true && r.offMode.calls === 1,
  'an idea pin is a page sequence': /page 1 \/ 2/.test(r.story1?.count || '') && /p1\.jpg$/.test(r.story1?.src || '') && /page 2 \/ 2/.test(r.story2?.count || '') && /p2\.jpg$/.test(r.story2?.src || ''),
  'after the last page it moves to the next pin': /pin 4 \/ 4/.test(r.nextPin?.count || '') && /(1200x|750x|736x|originals)\/b\.jpg$/.test(r.nextPin?.src || ''),
  'Esc closes and unlocks the page': r.closed?.gone && r.closed.unlocked && !r.closed.attr,
  'the promoted switch brings them back': r.unhidden?.display !== 'none',
  'a video that was playing when it left the view comes back when it returns': r.resume?.marked === '1' && r.resume.resumed === true && r.resume.plays >= 2,
  ['idle page, the script changes nothing on its own (' + (FF ? 'firefox' : 'chromium') + ')']: r.idle <= 10,
  'the opt-in perf probe answers with a snapshot': r.perfApi?.fn && r.perfApi.snap?.uptimeMs > 0 && typeof r.perfApi.snap.runs === 'object',
  'the viewer opens without blocking and steps cheaply (120 pins)': r.viewer?.openSync < 500 && r.viewer.stepAvg < 400 && r.viewer.stageChanged && /pin 9 \/ 120/.test(r.viewer.count || ''),
  'the filmstrip is built once and reused across steps': r.viewer?.filmStable === true && r.viewer.filmCount === 120,
  'the stage uses a screen-sized image and keeps a larger one for zoom': r.viewer?.usesDisplaySize === true && /(1200x|750x|736x)\//.test(r.viewer?.fullOnZoom || ''),
  'a story page whose only rendition 403s falls back to a sized bucket of the same file': /1200x\/broken\.jpg$/.test(r.fallback?.src || '') && r.fallback?.natural > 0,
  'a page video with only an HLS rendition shows the page image instead of a black player': r.fallback?.hlsImg === true && r.fallback?.hlsVideo === false && /(1200x|736x)\/hls\.jpg$/.test(r.fallback?.hlsSrc || ''),
  ['on a page that keeps changing, the script adds little work (' + (FF ? 'firefox' : 'chromium') + ')']: costOk(FF ? 'firefox' : 'chromium', r.cost),
  'no page errors or dialogs': !logs.some(l => /pageerror|DIALOG/.test(l)),
};

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
if (failed) { console.log(JSON.stringify({ r, logs }, null, 2)); process.exit(1); }
await browser.close();

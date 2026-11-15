// Offline smoke test: the userscript on Pinterest. Answers every pinterest.com request from fixtures, so it
// never touches the site. Run: node test/pinterest-offline.mjs  (BROWSER=firefox for Firefox)
import { chromium, firefox } from 'playwright';
import path from 'path'; import fs from 'fs';

const usFile = path.resolve('dist/better-browsing.user.js');
if (!fs.existsSync(usFile)) { console.log('FAIL userscript built: ' + usFile + ' missing (npm run build)'); process.exit(1); }
const FF = process.env.BROWSER === 'firefox', bt = FF ? firefox : chromium;
const browser = await bt.launch(FF ? { firefoxUserPrefs: { 'media.autoplay.default': 0 } } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const pins = ['111111', '222222', '333333', '444444'];
const feed = `<!doctype html><html><head><title>Pinterest fixture</title></head><body>
<header style="height:64px"><div data-test-id="header">header</div></header>
<div class="navcol" style="display:flex;flex-direction:column;gap:24px;width:80px">
  <div data-test-id="pinterest-logo-home-button"><div><a href="/" aria-label="Home"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></a></div></div>
  <div data-test-id="vertical-nav-icon"><div><div aria-label="Home"><a href="/" aria-label="Home"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></a></div></div></div>
  <div data-test-id="vertical-nav-icon"><div><div aria-label="Explore"><a href="/explore/" aria-label="Explore"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></a></div></div></div>
</div>
<div id="grid">
${pins.map((id, i) => `<div data-test-id="pin" data-test-pin-id="${id}" data-test-pin-slot-index="${i}">
  <div data-test-id="pinWrapper"><a href="/pin/${id}/"><div data-test-id="pincard-image-with-link"><img src="https://i.pinimg.com/236x/x/${id}.jpg" alt=""></div></a></div>
  <button data-test-id="more-actions-button" aria-label="More options">…</button>
</div>`).join('\n')}
</div>
<div style="height:2000px"></div></body></html>`;

await ctx.route(/pinterest\.com/, route => {
  const u = new URL(route.request().url());
  if (/^\/resource\//.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resource_response: { status: 'success', data: {} } }) });
  return route.fulfill({ status: 200, contentType: 'text/html', body: feed });
});
await ctx.addInitScript({ path: usFile });

const logs = [];
const page = await ctx.newPage();
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('dialog', d => { logs.push('[DIALOG!] ' + d.message()); d.dismiss(); });
page.on('console', m => { if (m.type() === 'error') logs.push('[error] ' + m.text().slice(0, 200)); });

const r = {};
await page.goto('https://www.pinterest.com/');
await page.waitForTimeout(1200);

r.boot = await page.evaluate(() => {
  const entry = document.querySelector('.pin-nav-entry');
  const a = entry?.querySelector('a');
  return {
    pin: !!window.PIN,
    volume: window.PIN?.settings?.videoVolume,
    nav: !!entry,
    navLabel: a?.getAttribute('aria-label') || '',
    navIcon: !!a?.querySelector('svg path'),
    inNav: !!entry?.closest('.navcol'),
    gear: !!document.querySelector('.pin-gear'),
    snap: !!localStorage.getItem('pin-settings-snapshot'),
    pins: document.querySelectorAll('[data-test-id="pin"]').length,
  };
});

// the sidebar entry opens the panel
await page.click('.pin-nav-entry a');
await page.waitForTimeout(400);
r.panel = await page.evaluate(() => {
  const host = document.querySelector('.pin-settings');
  const root = host?.shadowRoot;
  return {
    open: !!host,
    inputs: root ? root.querySelectorAll('[data-key]').length : 0,
    title: root ? root.querySelector('h1')?.textContent : '',
    fixed: host ? getComputedStyle(host).position : '',
  };
});

// a change in the panel is saved and applied live
await page.evaluate(() => {
  const root = document.querySelector('.pin-settings').shadowRoot;
  const el = root.querySelector('[data-key="videoVolume"]');
  el.value = 12;
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
r.saved = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('pin-userscript-settings') || '{}')?.settings?.videoVolume,
  live: window.PIN?.settings?.videoVolume,
  out: document.querySelector('.pin-settings').shadowRoot.querySelector('[data-key="videoVolume"]').parentElement.querySelector('output')?.textContent,
}));

// Esc closes, Alt+W reopens
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
r.escClosed = await page.evaluate(() => !document.querySelector('.pin-settings'));
await page.keyboard.press('Alt+KeyW');
await page.waitForTimeout(400);
r.altW = await page.evaluate(() => !!document.querySelector('.pin-settings'));

// the floating button switch adds and removes it live; so does the sidebar switch
await page.evaluate(async () => {
  const { settings = {} } = await PIN.api.storage.sync.get('settings');
  await PIN.api.storage.sync.set({ settings: { ...settings, settingsButton: true } });
});
await page.waitForTimeout(500);
r.buttonOn = await page.evaluate(() => {
  const b = document.querySelector('.pin-gear');
  return { there: !!b, fixed: b ? getComputedStyle(b).position : '' };
});
await page.evaluate(async () => {
  const { settings = {} } = await PIN.api.storage.sync.get('settings');
  await PIN.api.storage.sync.set({ settings: { ...settings, settingsButton: false, sidebarEntry: false } });
});
await page.waitForTimeout(500);
r.off = await page.evaluate(() => ({ gear: !document.querySelector('.pin-gear'), nav: !document.querySelector('.pin-nav-entry') }));

// pin ids survive the virtualised grid markup for later milestones
r.ids = await page.evaluate(() => [...document.querySelectorAll('[data-test-id="pin"]')].map(p => p.getAttribute('data-test-pin-id')));

const checks = {
  'userscript loads on Pinterest with settings and the sidebar entry': r.boot?.pin && r.boot.volume === 40 && r.boot.nav && r.boot.inNav && r.boot.navLabel === 'Better Browsing' && r.boot.navIcon && !r.boot.gear && r.boot.snap,
  'the fixture grid is there (4 pins with ids)': r.boot?.pins === 4 && r.ids?.length === 4 && r.ids[0] === '111111',
  'the sidebar entry opens the settings panel (shadow DOM, form fields)': r.panel?.open && r.panel.inputs >= 9 && /Pinterest Better Browsing/.test(r.panel.title || '') && r.panel.fixed === 'fixed',
  'a panel change is saved and applied live': r.saved?.stored === 12 && r.saved.live === 12 && r.saved.out === '12',
  'Esc closes and Alt+W reopens': r.escClosed && r.altW,
  'the floating button switch adds and removes it live': r.buttonOn?.there && r.buttonOn.fixed === 'fixed' && r.off?.gear,
  'the sidebar switch removes the entry live': r.off?.nav === true,
  'no page errors or dialogs': !logs.some(l => /pageerror|DIALOG/.test(l)),
};

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
if (failed) { console.log(JSON.stringify({ r, logs }, null, 2)); process.exit(1); }
await browser.close();

// Smoke test of the real MV3 extension (dist/better-browsing-ext/) loaded into Chromium: fixture pages only
// (every request is answered by a route, nothing reaches the live sites). Checks per site that the content
// script claims the page (<html data-bb-by="ext">), the settings panel opens through the toolbar popup's
// message, a settings key in the legacy localStorage layout is still read, and for X the DNR block toggle and
// the lazy hls.js injection for Reddit. Run: npm run test:ext
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

execFileSync(process.execPath, ['ext/build.js'], { stdio: 'inherit' });
const EXT = path.resolve('dist/better-browsing-ext');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ext-smoke-'));
const SITES = [
  { site: 'reddit', url: 'https://www.reddit.com/r/test/', tabs: 'https://*.reddit.com/*', panel: '.rbe-us-settings' },
  { site: 'instagram', url: 'https://www.instagram.com/', tabs: 'https://www.instagram.com/*', panel: '.igb-settings' },
  { site: 'x', url: 'https://x.com/explore', tabs: 'https://x.com/*', panel: '.xbb-settings' },
  { site: 'pinterest', url: 'https://www.pinterest.com/', tabs: 'https://*.pinterest.com/*', panel: '.pin-settings' },
];
const page = '<!doctype html><html><head><title>fixture</title></head><body><main style="height:2000px">fixture</main></body></html>';
const checks = {};
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.route(/^https?:/, r => r.request().resourceType() === 'document'
    ? r.fulfill({ status: 200, contentType: 'text/html', body: page })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  checks['extension loads, worker is up'] = !!id;

  for (const s of SITES) {
    const p = await ctx.newPage();
    await p.goto(s.url);
    await p.waitForTimeout(500);
    const by = await p.evaluate(() => document.documentElement.getAttribute('data-bb-by'));
    const mark = await p.evaluate(site => localStorage.getItem('bb-ext-' + site), s.site);
    checks[`${s.site}: content script claims the page for the extension`] = by === 'ext' && mark === '1';
    // the same message the toolbar popup sends to a covered tab
    const reply = await sw.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url });
      return chrome.tabs.sendMessage(tab.id, { type: 'bb-open-settings' });
    }, s.tabs);
    await p.waitForTimeout(300);
    const opened = await p.evaluate(sel => !!document.querySelector(sel)?.shadowRoot, s.panel);
    checks[`${s.site}: bb-open-settings opens the in-page settings panel`] = !!(reply && reply.ok) && opened;
    await p.close();
  }

  // the toolbar popup page itself: the hub lists the four sites (the active tab is not a covered site)
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  await pop.locator('#sites li').nth(3).waitFor({ timeout: 5000 }).catch(() => {});
  checks['popup: hub lists the four sites'] = (await pop.locator('#sites li').count()) === 4;
  await pop.close();

  // X: the block toggle (the message X's bridge sends) adds and removes the three DNR rules; Pinterest has two
  const ep = await ctx.newPage();
  await ep.goto(`chrome-extension://${id}/popup/popup.html`);
  const set = (site, block) => ep.evaluate(m => chrome.runtime.sendMessage(m), { type: 'bb-ext-set', site, block });
  const rules = () => sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules().then(r => r.filter(x => x.id < 3000).map(x => x.id).sort().join()));
  checks['reddit + instagram: verified telemetry/ad rules 3001..3005, 4001..4002 active'] =
    (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules().then(r => r.filter(x => x.id >= 3000).map(x => x.id).sort().join()))) === '3001,3002,3003,3004,3005,4001,4002';
  checks['x: bb-ext-set block=true installs rules 1001..1003'] = (await set('x', true)).blocking === true && (await rules()) === '1001,1002,1003';
  checks['x: bb-ext-get reports the state'] = (await ep.evaluate(() => chrome.runtime.sendMessage({ type: 'bb-ext-get', site: 'x' }))).blocking === true;
  checks['x: legacy xbb-ext-set alias still works (block=false removes the rules)'] =
    (await ep.evaluate(() => chrome.runtime.sendMessage({ type: 'xbb-ext-set', block: false }))).blocking === false && (await rules()) === '';
  checks['pinterest: bb-ext-set block=true installs rules 2001..2002 (s.pinimg.com/webapp/, pinterest initiators)'] = (await set('pinterest', true)).blocking === true && (await rules()) === '2001,2002'
    && (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules().then(r => r.filter(x => x.id >= 2000 && x.id < 3000).every(x => x.condition.urlFilter === '||s.pinimg.com/webapp/' && x.condition.initiatorDomains.includes('pinterest.com')))));
  checks['pinterest: the pin-ext-set alias removes them again'] =
    (await ep.evaluate(() => chrome.runtime.sendMessage({ type: 'pin-ext-set', block: false }))).blocking === false && (await rules()) === '';
  await ep.close();

  // Reddit: reddit/hls.js injected into the content script's world sets globalThis.Hls there (the worker's bb-load-hls)
  const pr = await ctx.newPage();
  await pr.goto('https://www.reddit.com/r/test/'); await pr.waitForTimeout(400);
  const hls = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://*.reddit.com/*' });
    const before = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!globalThis.Hls, world: 'ISOLATED' }))[0].result;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['reddit/hls.js'], world: 'ISOLATED' });
    const after = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => typeof globalThis.Hls === 'function', world: 'ISOLATED' }))[0].result;
    return { before, after };
  });
  checks['reddit: hls.js is not loaded until asked, then injects Hls into the content world'] = hls.before === false && hls.after === true;
  await pr.close();
} catch (e) {
  console.error(e);
  checks['no exception'] = false;
} finally {
  await ctx?.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
process.exit(failed ? 1 : 0);

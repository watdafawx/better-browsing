// Double install: the combined script and a per-site script on the same page must run the site once, and
// the per-site script takes over from the next load (userscript/claim.js). Fixture pages only, never the live
// sites. Run: npm run test:double  (BROWSER=firefox for Firefox)
import { chromium, firefox } from 'playwright';
import path from 'path';
import fs from 'fs';

const browserType = process.env.BROWSER === 'firefox' ? firefox : chromium;
const COMBINED = path.resolve('dist/better-browsing.user.js');
const SITES = [
  { site: 'reddit', url: 'https://www.reddit.com/r/test/', css: 'rbe-css' },
  { site: 'instagram', url: 'https://www.instagram.com/', css: 'igb-css' },
  { site: 'x', url: 'https://x.com/home', css: 'xbb-css' },
  { site: 'pinterest', url: 'https://www.pinterest.com/', css: 'pin-css' },
];
const page = '<!doctype html><html><head><title>fixture</title></head><body><main style="height:2000px">fixture</main></body></html>';
// The extension's content script, as far as claiming goes: userscript/claim.js's own bbClaim(site, 'ext'). The
// real extension (ext/build.js) calls the same line first thing in <site>/content.js.
const fakeExt = site => ({ content: `(() => {
${fs.readFileSync('userscript/claim.js', 'utf8')}
const go = () => bbClaim('${site}', 'ext');
if (document.documentElement) go(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); go(); } }).observe(document, { childList: true });
})();` });
const browser = await browserType.launch();
const checks = {};

// A context with these scripts in this order (managers run them in install order), answering every request
async function open(files, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  if (seed) await ctx.addInitScript(seed);
  for (const f of files) await ctx.addInitScript(typeof f === 'string' ? { path: f } : f);
  await ctx.route('**/*', r => r.request().resourceType() === 'document'
    ? r.fulfill({ status: 200, contentType: 'text/html', body: page })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  return { ctx, p: await ctx.newPage() };
}
const state = (p, s) => p.evaluate(({ css, site }) => ({
  styles: document.querySelectorAll('#' + css).length,
  by: document.documentElement.getAttribute('data-bb-by'),
  site: document.documentElement.getAttribute('data-bb-site'),
  mark: localStorage.getItem('bb-split-' + site),
  extMark: localStorage.getItem('bb-ext-' + site),
  notice: document.querySelector('.bb-split-notice')?.shadowRoot?.querySelector('.install')?.getAttribute('href') || '',
}), s);
const settle = p => p.waitForTimeout(400);

for (const s of SITES) {
  const own = path.resolve(`dist/better-browsing-${s.site}.user.js`);
  // combined installed first, then the per-site script
  {
    const { ctx, p } = await open([COMBINED, own]);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    await p.reload(); await settle(p);
    const b = await state(p, s);
    checks[`${s.site}: combined + per-site, first load: the site runs once (combined), the per-site script leaves its mark`] =
      a.styles === 1 && a.by === 'combined' && a.site === s.site && a.mark === '1';
    checks[`${s.site}: combined + per-site, next load: the per-site script runs, once`] = b.styles === 1 && b.by === s.site;
    await ctx.close();
  }
  // per-site script first, then the combined one
  {
    const { ctx, p } = await open([own, COMBINED]);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    checks[`${s.site}: per-site + combined: the per-site script runs, once, and no notice`] = a.styles === 1 && a.by === s.site && !a.notice;
    await ctx.close();
  }
  // the per-site script was removed again: the combined script must come back
  {
    const { ctx, p } = await open([COMBINED], `try { localStorage.getItem('bb-split-${s.site}-seeded') || (localStorage.setItem('bb-split-${s.site}', '1'), localStorage.setItem('bb-split-${s.site}-seeded', '1')); } catch {}`);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    await p.reload(); await settle(p);
    const b = await state(p, s);
    checks[`${s.site}: per-site script gone: the combined script drops the stale mark and runs again on the next load`] =
      a.styles === 0 && a.mark === null && b.styles === 1 && b.by === 'combined';
    await ctx.close();
  }
  // the extension, installed next to the userscripts: it wins in either order, and the userscripts run nothing
  {
    const { ctx, p } = await open([fakeExt(s.site), COMBINED, own]);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    checks[`${s.site}: extension first, then both userscripts: only the extension claims the page, no userscript runs, no notice`] =
      a.styles === 0 && a.by === 'ext' && a.site === s.site && a.extMark === '1' && !a.notice;
    await ctx.close();
  }
  {
    const { ctx, p } = await open([COMBINED, own, fakeExt(s.site)]);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    await p.reload(); await settle(p);
    const b = await state(p, s);
    checks[`${s.site}: userscripts first, then the extension: a userscript owns the first load, the extension leaves its mark`] =
      a.styles === 1 && a.by !== 'ext' && a.extMark === '1';
    checks[`${s.site}: userscripts first, then the extension: from the next load on the extension wins and the userscripts stand aside`] =
      b.styles === 0 && b.by === 'ext' && b.extMark === '1';
    await ctx.close();
  }
  // the extension was removed again: its stale mark must not keep the userscripts out for good
  for (const [what, scripts] of [['per-site', [own]], ['combined', [COMBINED]]]) {
    const { ctx, p } = await open(scripts, `try { localStorage.getItem('bb-ext-seeded') || (localStorage.setItem('bb-ext-${s.site}', '1'), localStorage.setItem('bb-ext-seeded', '1')); } catch {}`);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    await p.reload(); await settle(p);
    const b = await state(p, s);
    checks[`${s.site}: extension gone (${what} script): the stale mark is dropped and the script runs again on the next load`] =
      a.styles === 0 && a.extMark === null && b.styles === 1 && b.by === (what === 'combined' ? 'combined' : s.site);
    await ctx.close();
  }
  // the combined script alone: off Reddit it says once that the site has its own script
  {
    const { ctx, p } = await open([COMBINED]);
    await p.goto(s.url); await settle(p);
    const a = await state(p, s);
    await p.reload(); await settle(p);
    const b = await state(p, s);
    checks[`${s.site}: combined alone runs the site${s.site === 'reddit' ? ', no notice on Reddit' : ', shows the install notice once'}`] = a.styles === 1 && a.by === 'combined' &&
      (s.site === 'reddit' ? !a.notice && !b.notice : a.notice.endsWith(`/better-browsing-${s.site}.user.js`) && !b.notice);
    await ctx.close();
  }
}
await browser.close();

let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
process.exit(failed ? 1 : 0);

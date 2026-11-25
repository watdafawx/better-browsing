// Local dev server for the Better Browsing MV3 extension (npm run dev:ext):
//   - watches src/, instagram/src/, x/src/, pinterest/src/, userscript/, ext/ and the manifests; rebuilds
//     dist/better-browsing-ext/ in --dev mode (150 ms debounce)
//   - GET /version -> { id }: the extension's worker polls it, then reloads the active covered tabs and itself
//   - POST /log -> dist/bb-ext-dev.log (and stdout), one line each: HH:MM:SS.mmm [level] [site] args (url)
//   - GET /logs -> the tail of that log
// Stop it when you are done: it is a long-lived node process.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'dist', 'bb-ext-dev.log');
const PORT = Number(process.env.BB_DEV_PORT) || 47910;   // the extension talks to 47910; the override is for tests
// Optional extra mirror target (e.g. main project checkout when developing inside a worktree)
const MIRROR_OUT = process.env.BB_EXT_MIRROR || '';

let buildId = String(Date.now());
let rebuildTimer = 0;

function rebuild(reason) {
  const id = String(Date.now());
  const t0 = Date.now();
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'build.js'), '--dev', `--build-id=${id}`], { cwd: ROOT, stdio: 'inherit' });
    if (MIRROR_OUT) {
      execFileSync(process.execPath, [path.join(__dirname, 'build.js'), '--dev', `--build-id=${id}`, `--out=${MIRROR_OUT}`], { cwd: ROOT, stdio: 'inherit' });
    }
    buildId = id;   // only a build that worked gets announced: the extension must not reload into a broken one
    appendLog({ t: Date.now(), level: 'build', args: ['rebuilt', reason || 'manual', 'id=' + id, (Date.now() - t0) + 'ms'], meta: { site: 'dev' } });
  } catch (e) {
    appendLog({ t: Date.now(), level: 'error', args: ['build failed:', e.message], meta: { site: 'dev' } });
  }
}

function appendLog(entry) {
  const meta = entry.meta || {};
  const ts = new Date(entry.t || Date.now()).toISOString().slice(11, 23);
  const args = (entry.args || []).map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `${ts} [${entry.level || 'log'}] [${meta.site || 'ext'}] ${args}${meta.url ? ' (' + meta.url + ')' : ''}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
fs.writeFileSync(LOG_FILE, '');
rebuild('startup');

// [dir, recursive, file filter]. The manifests sit next to (not inside) their site's src/.
const WATCH = [
  ['src', true], ['instagram/src', true], ['x/src', true], ['pinterest/src', true], ['userscript', true], ['ext', true],
  ['.', false, /^(manifest\.base\.json|build-lib\.js)$/], ['instagram', false, /^manifest\.base\.json$/],
  ['x', false, /^manifest\.base\.json$/], ['pinterest', false, /^manifest\.base\.json$/],
];
const watchers = [];
for (const [dir, recursive, filter] of WATCH) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  watchers.push(fs.watch(full, { recursive }, (_ev, file) => {
    if (!file || (filter && !filter.test(String(file))) || /(^|[\\/])(README|PLAN)|\.md$/.test(String(file))) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => rebuild(`${dir}/${file}`), 150);
  }));
}

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/version') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ id: buildId }));
    return;
  }
  if (req.method === 'GET' && req.url === '/logs') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').slice(-32000) : '');
    return;
  }
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', c => { if (body.length < 65536) body += c; });
    req.on('end', () => {
      try { appendLog(JSON.parse(body)); } catch {}
      res.writeHead(204); res.end();
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-server] listening on http://127.0.0.1:${PORT} (log: dist/bb-ext-dev.log). Load dist/better-browsing-ext/ unpacked.`);
});
const stop = () => { watchers.forEach(w => w.close()); server.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

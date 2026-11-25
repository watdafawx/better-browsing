// Local dev server for X Fast UI MV3 extension:
//   - Watches x/src/, x/ext/, userscript/ -> rebuilds dist/x-fast-ext/ in ~20 ms
//   - GET /version -> { id } so extension background worker hot-reloads itself + x.com tab
//   - POST /log -> writes live extension/perf logs to dist/x-fast-dev.log and stdout
// Usage: npm run dev:x:ext
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG_FILE = path.join(ROOT, 'dist', 'x-fast-dev.log');
const PORT = 47910;

let buildId = String(Date.now());
let rebuildTimer = 0;

function rebuild(reason) {
  buildId = String(Date.now());
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'build-ext.js'), '--dev', `--build-id=${buildId}`], {
      cwd: ROOT, stdio: 'inherit'
    });
    appendLog({ t: Date.now(), level: 'build', args: ['rebuilt', reason || 'manual', 'id=' + buildId] });
  } catch (e) {
    console.error('[dev-server] build failed:', e.message);
  }
}

function appendLog(entry) {
  const ts = new Date(entry.t || Date.now()).toISOString().slice(11, 23);
  const line = `${ts} [${entry.level || 'log'}] ${(entry.args || []).map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}${entry.meta && entry.meta.url ? ' (' + entry.meta.url + ')' : ''}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

// Initial clean log + dev build
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
fs.writeFileSync(LOG_FILE, '');
rebuild('startup');

// Watch source dirs
for (const dir of ['x/src', 'x/ext', 'userscript']) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  fs.watch(full, { recursive: true }, (_ev, file) => {
    if (!file || /fast-ui-mock|README|PLAN/.test(file)) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => rebuild(`${dir}/${file}`), 150);
  });
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
  console.log(`[dev-server] listening on http://127.0.0.1:${PORT} (logs: dist/x-fast-dev.log)`);
});

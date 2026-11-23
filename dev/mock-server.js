/**
 * Paikallinen kehityspalvelin: tarjoilee index.html:n ja ajaa oikeaa Code.gs:ää jäljitellyllä Sheetsillä.
 *
 *   node dev/mock-server.js [--port 8787] [--seed 250]
 *
 * Avaa http://localhost:8787/ – index.html:n WEB_APP_URL korvataan lennossa paikallisella /exec-osoitteella.
 * Offline-jonon testaus: http://localhost:8787/__offline?on=1 (ja ?on=0 takaisin).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { luoYmparisto, siemen } = require('./gas-mock');

const arg = (nimi, oletus) => { const i = process.argv.indexOf(nimi); return i > 0 ? process.argv[i + 1] : oletus; };
const PORT = Number(arg('--port', 8787));
const JUURI = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(JUURI, 'index.html'), 'utf8');
const TOKEN = (indexHtml.match(/TOKEN:\s*"([^"]+)"/) || [])[1];
const env = luoYmparisto(TOKEN);
const SEED = Number(arg('--seed', 0));
if (SEED) siemen(env, SEED, TOKEN);
let offline = false;

const TYYPIT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__offline') {
    offline = url.searchParams.get('on') === '1';
    res.end('offline = ' + offline);
    return;
  }
  if (url.pathname === '/exec') {
    if (offline) { req.socket.destroy(); return; }
    const vastaa = obj => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => setTimeout(() => vastaa(env.post(body)), 300));
    } else {
      vastaa(env.get(Object.fromEntries(url.searchParams)));
    }
    return;
  }
  let tiedosto = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const polku = path.normalize(path.join(JUURI, tiedosto));
  if (!polku.startsWith(JUURI) || polku.includes(path.join(JUURI, 'dev'))) { res.writeHead(404); res.end(); return; }
  fs.readFile(polku, (err, sisalto) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    if (tiedosto === '/index.html') {
      sisalto = sisalto.toString('utf8').replace(/WEB_APP_URL:\s*"[^"]*"/, `WEB_APP_URL: "http://localhost:${PORT}/exec"`);
    }
    res.writeHead(200, { 'Content-Type': TYYPIT[path.extname(polku)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(sisalto);
  });
}).listen(PORT, () => console.log(`FD-keruu mock: http://localhost:${PORT}/  (rivejä ${env.data.length})`));

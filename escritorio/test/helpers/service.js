'use strict';
// Servicio web falso (mt.nonosky.com): recibe telemetría y verificación de licencias.
const http = require('http');

function startService() {
  const st = { posts: [], status: 200, verify: { valida: true }, statuses: [] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      let body = null; try { body = JSON.parse(b); } catch (_) { /* sin JSON */ }
      st.posts.push({ method: req.method, path: req.url, headers: req.headers, body, raw: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/api/licencias/verificar')) { res.writeHead(200); return res.end(JSON.stringify(st.verify)); }
      const code = st.statuses.length ? st.statuses.shift() : st.status;
      res.writeHead(code); res.end(code < 300 ? '{"ok":true}' : '{"ok":false}');
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(Object.assign(st, {
    url: `http://127.0.0.1:${srv.address().port}`,
    events: () => st.posts.filter(p => p.path.endsWith('/eventos')).flatMap(p => p.body.eventos),
    installs: () => st.posts.filter(p => p.path.endsWith('/instalacion')),
    close: () => new Promise(x => { srv.close(x); if (srv.closeAllConnections) srv.closeAllConnections(); }),
  }))));
}

module.exports = { startService };

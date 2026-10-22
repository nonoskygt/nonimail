'use strict';
// Cliente HTTP mínimo contra la API local de la app (JSON) para las pruebas.
const http = require('http');

function client(getPort) {
  return function req(method, p, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const r = http.request({ host: '127.0.0.1', port: getPort(), method, path: p, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* no es JSON */ } resolve({ status: res.statusCode, body: j, text: b, headers: res.headers }); });
      });
      r.on('error', reject); if (data) r.write(data); r.end();
    });
  };
}

module.exports = { client };

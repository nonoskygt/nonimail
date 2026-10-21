'use strict';
// Pares de claves Ed25519 de usar y tirar para las pruebas de licencias; nunca la clave de producción.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-key-'));
  const pubFile = path.join(dir, 'clave-publica.pem');
  fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
  // payload = { v:1, lid, cuenta, tipo, canal, iat, exp }
  function sign(p = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { v: 1, lid: crypto.randomUUID(), cuenta: 'yo@test.local', tipo: 'limpiar', canal: 'app', iat: now, exp: now + 30 * 86400, ...p };
    const head = `NMT1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return `${head}.${crypto.sign(null, Buffer.from(head), privateKey).toString('base64url')}`;
  }
  return { pubFile, sign, privateKey, publicKey, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { makeKeys };

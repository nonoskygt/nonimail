'use strict';
// Actualización automática: la decisión (tipo de instalación + estado -> acción) y la comparación con releases/latest.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { installKind, decide, compareVersions, checkLatestRelease, releasesApiUrl } = require('../lib/updates');

test('tipo de instalación: NSIS, AppImage, portable, deb y ejecución desde el código', () => {
  assert.equal(installKind({ platform: 'win32', env: {} }), 'nsis');
  assert.equal(installKind({ platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'C:\\x' } }), 'portable');
  assert.equal(installKind({ platform: 'linux', env: { APPIMAGE: '/x.AppImage' } }), 'appimage');
  assert.equal(installKind({ platform: 'linux', env: {} }), 'deb');
  assert.equal(installKind({ platform: 'linux', env: {}, packaged: false }), 'dev');
});

test('decisión: NSIS y AppImage se actualizan solos; portable y deb solo avisan', () => {
  for (const kind of ['nsis', 'appimage']) {
    assert.deepEqual(decide({ kind, auto: true, phase: 'idle' }), { check: 'updater', periodic: true, banner: null, canRestart: false });
    assert.equal(decide({ kind, auto: true, phase: 'downloaded' }).banner, 'ready');
  }
  for (const kind of ['portable', 'deb']) {
    const d = decide({ kind, auto: true, phase: 'available' });
    assert.equal(d.check, 'github'); assert.equal(d.banner, 'download'); assert.equal(d.canRestart, false);
  }
  assert.equal(decide({ kind: 'dev', auto: true }).check, 'none');
});

test('decisión: nunca se reinicia con una operación en curso, y apagado solo avisa', () => {
  assert.equal(decide({ kind: 'nsis', auto: true, phase: 'downloaded', busy: false }).canRestart, true);
  const wait = decide({ kind: 'nsis', auto: true, phase: 'downloaded', busy: true });
  assert.equal(wait.banner, 'ready'); assert.equal(wait.canRestart, false);
  assert.equal(decide({ kind: 'nsis', auto: true, phase: 'downloading' }).canRestart, false);
  const off = decide({ kind: 'nsis', auto: false, phase: 'available' });
  assert.deepEqual([off.check, off.periodic, off.banner], ['github', false, 'download']);
});

test('versiones: compara numéricamente y la prerelease es menor que la final', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.1.1', '1.2.0'), -1);
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), -1);
  assert.equal(compareVersions('basura', '1.2.0'), 0);
});

test('build.publish de package.json da la URL de releases/latest', () => {
  assert.equal(releasesApiUrl(require('../package.json')), 'https://api.github.com/repos/nonoskygt/nonimail/releases/latest');
  assert.equal(releasesApiUrl({}), '');
});

let srv, base, reply;
before(async () => {
  srv = http.createServer((req, res) => {
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply.body));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/releases/latest`;
});
after(() => srv.close());
const release = (tag, extra = {}) => ({
  status: 200,
  body: {
    tag_name: tag, html_url: `https://github.com/nonoskygt/nonimail-tools/releases/tag/${tag}`,
    assets: ['NoniMail-Tools-Setup.exe', `NoniMail-Tools-Portable-${tag.slice(1)}.exe`, 'NoniMail-Tools-Portable.exe', `nonimail-tools_${tag.slice(1)}_amd64.deb`, 'latest.yml']
      .map(name => ({ name, browser_download_url: `https://github.com/nonoskygt/nonimail-tools/releases/download/${tag}/${name}` })),
    ...extra,
  },
});

test('punto fijo de actualizaciones: URL del JSON y respaldo de GitHub tomados de la configuración', () => {
  const { feedJsonUrl, githubFeed } = require('../lib/updates');
  const pkg = require('../package.json');
  assert.equal(feedJsonUrl('https://mt.nonosky.com/actualizaciones/', 'latest.json'), 'https://mt.nonosky.com/actualizaciones/latest.json');
  assert.equal(feedJsonUrl('https://mt.nonosky.com/actualizaciones', 'latest.json'), 'https://mt.nonosky.com/actualizaciones/latest.json');
  assert.equal(feedJsonUrl('', 'latest.json'), '');
  assert.deepEqual(githubFeed(pkg), { provider: 'github', owner: 'nonoskygt', repo: 'nonimail', releaseType: 'release' });
  const pub = pkg.build.publish[0];
  assert.equal(pub.provider, 'generic', 'electron-updater lee primero el punto fijo (app-update.yml sale del primer publish)');
  assert.equal(pub.url, require('../config/defaults.json').updates.feedUrl);
});

test('si el punto fijo falla, se pregunta a GitHub; gana la primera fuente que responde', async () => {
  const pedidas = [];
  const fetchFn = async (u) => {
    pedidas.push(String(u));
    if (String(u).includes('actualizaciones')) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ tag_name: 'v9.0.0', html_url: 'https://github.com/x/y/releases/tag/v9.0.0', assets: [] }) };
  };
  const r = await checkLatestRelease({ apiUrls: ['https://mt.nonosky.com/actualizaciones/latest.json', 'https://api.github.com/repos/x/y/releases/latest'], current: '1.7.0', kind: 'deb', fetchFn });
  assert.equal(r.newer, true); assert.equal(r.version, '9.0.0');
  assert.equal(pedidas.length, 2);
  await assert.rejects(checkLatestRelease({ apiUrls: ['https://mt.nonosky.com/actualizaciones/latest.json'], current: '1.7.0', kind: 'deb', fetchFn }), /502/);
});

test('releases/latest (servidor simulado): versión nueva -> archivo que corresponde', async () => {
  reply = release('v1.3.0');
  const p = await checkLatestRelease({ apiUrl: base, current: '1.2.0', kind: 'portable' });
  assert.equal(p.newer, true); assert.equal(p.version, '1.3.0');
  assert.match(p.url, /NoniMail-Tools-Portable-1\.3\.0\.exe$/);
  const d = await checkLatestRelease({ apiUrl: base, current: '1.2.0', kind: 'deb' });
  assert.match(d.url, /nonimail-tools_1\.3\.0_amd64\.deb$/);
});

test('releases/latest: misma versión, borrador y errores', async () => {
  reply = release('v1.2.0');
  assert.deepEqual(await checkLatestRelease({ apiUrl: base, current: '1.2.0', kind: 'deb' }), { newer: false, version: '1.2.0', url: null });
  reply = release('v9.0.0', { draft: true });
  assert.equal((await checkLatestRelease({ apiUrl: base, current: '1.2.0', kind: 'deb' })).newer, false);
  reply = { status: 403, body: { message: 'rate limit' } };
  await assert.rejects(checkLatestRelease({ apiUrl: base, current: '1.2.0', kind: 'deb' }), /403/);
  reply = { status: 200, body: { tag_name: 'nightly' } };
  await assert.rejects(checkLatestRelease({ apiUrl: base, current: '1.2.0', kind: 'deb' }), /versión válida/);
});

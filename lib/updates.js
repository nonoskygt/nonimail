'use strict';
// Actualización automática. Este archivo reúne la parte sin Electron (se prueba sola):
//   installKind     qué tipo de instalación es: nsis | appimage | portable | deb | other | dev
//   decide          tipo + estado -> qué comprobar, qué aviso mostrar y si se puede reiniciar
//   compareVersions / checkLatestRelease / pickAsset   comprobación contra GitHub (releases/latest)
// El controlador que une todo con electron-updater está en lib/updater.js.

// Con electron-updater se actualizan el instalador NSIS y el AppImage; el portable y el .deb no pueden:
// a esos solo se les avisa y se les da el enlace de descarga.
function installKind({ platform = process.platform, env = process.env, packaged = true } = {}) {
  if (!packaged) return 'dev';
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'nsis';
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'deb';
  return 'other';
}

const SELF_UPDATING = ['nsis', 'appimage'];

// phase: idle | checking | uptodate | available | downloading | downloaded | error
// -> { check: 'updater'|'github'|'none', periodic, banner: null|'ready'|'download', canRestart }
// Con la actualización automática apagada nada se baja solo: solo se avisa (consulta a GitHub) y a mano.
// Nunca se reinicia con una operación en curso (sincronizar, limpiar o bajar un modelo): se espera.
function decide({ kind, auto, phase = 'idle', busy = false }) {
  if (kind === 'dev') return { check: 'none', periodic: false, banner: null, canRestart: false };
  const updater = SELF_UPDATING.includes(kind) && !!auto;
  const banner = phase === 'downloaded' && updater ? 'ready' : (phase === 'available' && !updater ? 'download' : null);
  return { check: updater ? 'updater' : 'github', periodic: !!auto, banner, canRestart: banner === 'ready' && !busy };
}

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null;
}
// 1 si a > b, -1 si a < b, 0 si iguales o no son versiones; una prerelease es menor que la final
function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  return !x.pre ? 1 : !y.pre ? -1 : (x.pre > y.pre ? 1 : -1);
}

const ASSET_PATTERNS = {
  portable: /portable.*\.exe$/i,
  deb: /\.deb$/i,
  nsis: /setup.*\.exe$/i,
  appimage: /\.AppImage$/i,
  other: /\.(exe|AppImage|deb)$/i,
};
// La descarga que corresponde a la instalación; se prefiere el archivo con versión en el nombre
function pickAsset(assets, kind, version) {
  const re = ASSET_PATTERNS[kind] || ASSET_PATTERNS.other;
  const list = (Array.isArray(assets) ? assets : []).filter(a => a && re.test(String(a.name)) && /^https:\/\//i.test(String(a.browser_download_url)));
  const exact = list.find(a => String(a.name).includes(version));
  return (exact || list[0] || {}).browser_download_url || null;
}

// GET releases/latest -> { newer, version, url } (url: el archivo que toca, o la página de la versión)
async function checkLatestRelease({ apiUrl, current, kind, fetchFn = (...a) => fetch(...a), timeoutMs = 15000 }) {
  const res = await fetchFn(apiUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `NoniMailTools/${current}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const rel = await res.json();
  const version = String((rel && rel.tag_name) || '').replace(/^v/, '');
  if (!parse(version)) throw new Error('la respuesta de GitHub no trae una versión válida');
  if (rel.draft || rel.prerelease) return { newer: false, version, url: null };
  const newer = compareVersions(version, current) > 0;
  const page = /^https:\/\//i.test(String(rel.html_url)) ? rel.html_url : null;
  return { newer, version, url: newer ? (pickAsset(rel.assets, kind, version) || page) : null };
}

// https://api.github.com/repos/<owner>/<repo>/releases/latest, tomado de la sección build.publish de package.json
function releasesApiUrl(pkg) {
  const pub = [].concat((pkg.build && pkg.build.publish) || []).find(p => p && p.provider === 'github');
  return pub ? `https://api.github.com/repos/${pub.owner}/${pub.repo}/releases/latest` : '';
}

module.exports = { installKind, decide, compareVersions, pickAsset, checkLatestRelease, releasesApiUrl, SELF_UPDATING };

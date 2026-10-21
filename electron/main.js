'use strict';
// NoniMail Tools de escritorio (Windows y Linux): arranca el mismo servidor local de lib/app.js en
// 127.0.0.1 con un puerto libre y lo muestra en una ventana. Una sola instancia a la vez.
const path = require('path');
const { app, BrowserWindow, Menu, shell, safeStorage, nativeTheme } = require('electron');

const ROOT = path.join(__dirname, '..');
const { resolveDataDir, PRODUCT } = require('../lib/paths');
const { createApp } = require('../lib/app');

app.setName(PRODUCT);
// La misma carpeta de datos que el modo sin ventana (npm start): así no hay dos configuraciones
app.setPath('userData', resolveDataDir(null));

// En un AppImage el sandbox de Chromium puede quedar bloqueado por el sistema (Ubuntu 24.04+); la ventana
// solo muestra la interfaz local, con CSP estricta, así que se prefiere abrir a fallar.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');

let win = null, server = null, quitting = false, bgTimer = null;

// Llavero del sistema para contraseñas y tokens (DPAPI en Windows; libsecret/kwallet en Linux).
// En Linux sin llavero Electron cae a "basic_text": eso no protege nada, se usa el archivo 0600 de lib/secrets.js.
const cipher = {
  available() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
      return true;
    } catch (_) { return false; }
  },
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

// Color de fondo de la ventana según el modo (evita el destello al abrir): claro 06:00–17:59 en «auto»
function windowBackground(ap) {
  const bg = ap.background || { light: '#f3f0e9', dark: '#1a1e25' };
  const h = new Date().getHours();
  const dark = ap.mode === 'oscuro' || (ap.mode !== 'claro' && (h < ap.dayStartHour || h >= ap.nightStartHour));
  return { color: dark ? bg.dark : bg.light, dark };
}
function applyBackground() {
  if (!server || !win || win.isDestroyed()) return;
  const { color, dark } = windowBackground(server.cfg().appearance);
  win.setBackgroundColor(color);
  nativeTheme.themeSource = dark ? 'dark' : 'light';
}

function createWindow() {
  const ap = server.cfg().appearance;
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 360, minHeight: 520,
    show: false, title: PRODUCT, icon: path.join(__dirname, 'icon.png'),
    backgroundColor: windowBackground(ap).color, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  // enlaces externos (comprar licencia, guía de Google, autorización de Google) en el navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(server.url)) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.webContents.on('render-process-gone', (_e, d) => server.reportError(new Error(`render-process-gone: ${d.reason}`), 'app'));
  win.on('closed', () => { win = null; });
  win.loadURL(server.url);
  applyBackground();
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  process.on('uncaughtException', (e) => { if (server) server.reportError(e, 'app'); else console.error(e); });
  process.on('unhandledRejection', (e) => { const err = e instanceof Error ? e : new Error(String(e)); if (server) server.reportError(err, 'app'); else console.error(err); });

  app.whenReady().then(async () => {
    server = await createApp({
      desktop: true, host: '127.0.0.1', cipher, locale: app.getLocale(),
      dataDir: app.getPath('userData'),
      openPath: (p) => shell.openPath(p),
      onAppearance: () => applyBackground(),
    });
    createWindow();
    bgTimer = setInterval(applyBackground, 60000); // el modo «auto» cambia con la hora
    app.on('activate', () => { if (!win) createWindow(); });
  }).catch((e) => {
    console.error(e);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
  // Al cerrar: último envío de telemetría y cierre ordenado del servidor
  app.on('before-quit', (e) => {
    if (quitting || !server) return;
    e.preventDefault(); quitting = true;
    clearInterval(bgTimer);
    server.close().catch(() => {}).finally(() => app.exit(0));
  });
}

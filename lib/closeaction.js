'use strict';
// Qué hace el botón de cerrar de la ventana (electron/main.js). Funciones puras, sin Electron.
const ACTIONS = ['ask', 'minimize', 'quit'];

// Valor guardado -> 'ask' | 'minimize' | 'quit' (cualquier otra cosa se trata como "preguntar")
function decideClose(setting) { return ACTIONS.includes(setting) ? setting : 'ask'; }

// ¿Sirve la bandeja del sistema? En Linux sin pantalla o con GNOME puro (sin extensión de iconos)
// el icono no se vería y la ventana oculta quedaría perdida.
function trayUsable(platform, env, created) {
  if (!created) return false;
  if (platform !== 'linux') return true;
  if (!(env.DISPLAY || env.WAYLAND_DISPLAY)) return false;
  const de = String(env.XDG_CURRENT_DESKTOP || '');
  return !(/(^|:)GNOME$/i.test(de) && !/ubuntu|unity|budgie|pop/i.test(de));
}

// Resultado final del botón: qué hacer con la ventana
// -> { act: 'ask'|'quit'|'hide'|'minimize', remember?: 'minimize'|'quit' }
// `answer` es lo que contestó el diálogo: { quit: bool, remember: bool }
function resolveClose(setting, tray, answer) {
  let d = decideClose(setting), remember;
  if (d === 'ask') {
    if (!answer) return { act: 'ask' };
    d = answer.quit ? 'quit' : 'minimize';
    if (answer.remember) remember = d;
  }
  if (d === 'quit') return { act: 'quit', remember };
  return { act: tray ? 'hide' : 'minimize', remember }; // sin bandeja: minimizar normal
}

module.exports = { ACTIONS, decideClose, trayUsable, resolveClose };

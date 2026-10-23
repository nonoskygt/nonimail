'use strict';
// Tema «Dulce»: se carga en el <head> sin diferir, así el modo y el acento quedan puestos ANTES de pintar.
// Modo auto = según la hora del equipo (claro de 06:00 a 17:59), y se vuelve a mirar cada minuto.
(function () {
  var ACCENTS = ['carmesi', 'verde-azulado', 'violeta', 'azul', 'ambar', 'verde'];
  var root = document.documentElement;
  var st = {
    mode: root.getAttribute('data-mode') || 'auto',
    accent: root.getAttribute('data-acento') || 'carmesi',
    day: parseInt(root.getAttribute('data-day'), 10), night: parseInt(root.getAttribute('data-night'), 10),
  };
  if (isNaN(st.day)) st.day = 6;
  if (isNaN(st.night)) st.night = 18;
  var BG = { light: '#f3f0e9', dark: '#1a1e25' };

  function isDark() {
    if (st.mode === 'oscuro') return true;
    if (st.mode === 'claro') return false;
    var h = new Date().getHours();
    return h < st.day || h >= st.night;
  }
  function apply() {
    var dark = isDark();
    root.setAttribute('data-theme', dark ? 'dulce-dark' : 'dulce');
    root.setAttribute('data-acento', ACCENTS.indexOf(st.accent) < 0 ? 'carmesi' : st.accent);
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.style.backgroundColor = dark ? BG.dark : BG.light;
  }
  window.NMTTheme = {
    set: function (mode, accent) { if (mode) st.mode = mode; if (accent) st.accent = accent; apply(); },
    isDark: isDark,
  };
  apply();
  setInterval(function () { if (st.mode === 'auto') apply(); }, 60000);
})();

'use strict';
// Servidores conocidos: viven en config/defaults.json (presets) y se pueden ampliar en la configuración.
// Outlook/Hotmail no está: Microsoft ya no acepta contraseña en IMAP/SMTP.
const { defaults } = require('../defaults');

const PRESETS = defaults().presets;

module.exports = { PRESETS };

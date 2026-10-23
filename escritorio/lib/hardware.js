'use strict';
// Equipo del usuario para recomendar el modelo de IA: RAM total, GPU y su VRAM (si se puede saber).
// Todo es "mejor esfuerzo": si algo falla, se sigue sin GPU y se recomienda por la RAM.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MIB = 1024 * 1024;

function run(cmd, args, timeoutMs, exec = execFile) {
  return new Promise((resolve) => {
    try {
      exec(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
    } catch (_) { resolve(null); }
  });
}

// "NVIDIA GeForce RTX 3060, 6144" (una línea por GPU, VRAM en MiB) -> la de más VRAM
function parseNvidia(out) {
  let best = null;
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(.*?),\s*(\d+)(?:\s*MiB)?$/);
    if (!m) continue;
    const g = { name: m[1].trim() || 'NVIDIA', vendor: 'NVIDIA', vramBytes: Number(m[2]) * MIB };
    if (!best || g.vramBytes > best.vramBytes) best = g;
  }
  return best;
}

// PowerShell: Get-CimInstance Win32_VideoController | Select Name,AdapterRAM | ConvertTo-Json
// OJO: AdapterRAM es un entero de 32 bits, así que nunca pasa de 4 GB aunque la tarjeta tenga más;
// por eso solo es el respaldo cuando no hay nvidia-smi.
function parseCim(out) {
  let j; try { j = JSON.parse(out); } catch (_) { return null; }
  let best = null;
  for (const g of [].concat(j || [])) {
    if (!g || !g.Name || /microsoft basic|remote|virtual|hyper-v/i.test(g.Name)) continue;
    const vramBytes = Number(g.AdapterRAM) || 0;
    const vendor = /nvidia/i.test(g.Name) ? 'NVIDIA' : /amd|radeon/i.test(g.Name) ? 'AMD' : /intel/i.test(g.Name) ? 'Intel' : '';
    if (!best || vramBytes > best.vramBytes) best = { name: g.Name, vendor, vramBytes };
  }
  return best;
}

// /sys/class/drm/card*/device/{mem_info_vram_total,vendor} (amdgpu expone la VRAM; los demás no)
function drmGpu(fsx = fs, root = '/sys/class/drm') {
  let best = null;
  try {
    for (const d of fsx.readdirSync(root)) {
      if (!/^card\d+$/.test(d)) continue;
      const dev = path.join(root, d, 'device');
      let vram = 0, vendor = '';
      try { vram = Number(String(fsx.readFileSync(path.join(dev, 'mem_info_vram_total'), 'utf8')).trim()) || 0; } catch (_) {}
      try { const v = String(fsx.readFileSync(path.join(dev, 'vendor'), 'utf8')).trim(); vendor = v === '0x10de' ? 'NVIDIA' : v === '0x1002' ? 'AMD' : v === '0x8086' ? 'Intel' : ''; } catch (_) {}
      if (vram && (!best || vram > best.vramBytes)) best = { name: vendor || 'GPU', vendor, vramBytes: vram };
    }
  } catch (_) {}
  return best;
}

// o: { platform, totalmem, exec, fs, timeoutMs }
async function detect(o = {}) {
  const platform = o.platform || process.platform, exec = o.exec || execFile, ms = o.timeoutMs || 4000;
  const ramBytes = o.totalmem != null ? o.totalmem : os.totalmem();
  let gpu = parseNvidia(await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], ms, exec));
  if (!gpu && platform === 'win32') {
    gpu = parseCim(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'], ms, exec));
  }
  if (!gpu && platform === 'linux') gpu = drmGpu(o.fs || fs);
  return { ramBytes, gpu };
}

// Regla: el tier más grande que cabe cómodo. VRAM >= lo que pide -> GPU; si no, solo CPU con
// RAM >= tier.ramGb (que en defaults.json es 2x el modelo + 4 GB de holgura). Si nada cabe: el básico y un aviso.
// -> { id, mode: 'gpu'|'cpu'|'low', warn: bool }
function recommend(tiers, hw) {
  const gb = (b) => b / 1024 ** 3;
  const ram = gb(hw.ramBytes || 0), vram = hw.gpu ? gb(hw.gpu.vramBytes || 0) : 0;
  const sorted = [...tiers].sort((a, b) => a.sizeBytes - b.sizeBytes);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (vram >= sorted[i].vramGb) return { id: sorted[i].id, mode: 'gpu', warn: false };
    if (ram >= sorted[i].ramGb) return { id: sorted[i].id, mode: 'cpu', warn: false };
  }
  return { id: sorted[0].id, mode: 'low', warn: true };
}

module.exports = { detect, recommend, parseNvidia, parseCim, drmGpu };

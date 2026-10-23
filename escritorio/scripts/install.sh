#!/usr/bin/env bash
# NoniMail Tools: instalador para Linux (sin root).
#   curl -fsSL https://raw.githubusercontent.com/nonoskygt/nonimail-tools/main/scripts/install.sh | bash
# Instala el AppImage en ~/.local/bin, crea la entrada del menú y, si usted quiere, instala Ollama (IA local).
#   NMT_OLLAMA=1  instala Ollama sin preguntar     NMT_OLLAMA=0  no pregunta ni instala
#   NMT_BASE_URL  carpeta de descarga (por defecto, la última versión de GitHub Releases)
set -euo pipefail

BASE="${NMT_BASE_URL:-https://github.com/nonoskygt/nonimail-tools/releases/latest/download}"
FILE="NoniMail-Tools.AppImage"
BIN_DIR="${NMT_BIN_DIR:-$HOME/.local/bin}"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
TARGET="$BIN_DIR/nonimail-tools.AppImage"
LANG_ES=0; case "${LC_ALL:-${LANG:-}}" in es*) LANG_ES=1;; esac
say() { if [ "$LANG_ES" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }

if [ "$(uname -s)" != "Linux" ]; then say "Este instalador es solo para Linux." "This installer is for Linux only."; exit 1; fi
case "$(uname -m)" in x86_64|amd64) ;; *) say "Solo hay compilación para x86_64." "Only x86_64 builds are available."; exit 1;; esac
if command -v curl >/dev/null 2>&1; then dl() { curl -fL --progress-bar -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then dl() { wget -O "$2" "$1"; }
else say "Se necesita curl o wget." "curl or wget is required."; exit 1; fi

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

say "Descargando NoniMail Tools…" "Downloading NoniMail Tools…"
dl "$BASE/$FILE" "$tmp/$FILE"
if dl "$BASE/SHA256SUMS.txt" "$tmp/SHA256SUMS.txt" 2>/dev/null && command -v sha256sum >/dev/null 2>&1; then
  want="$(grep " $FILE\$" "$tmp/SHA256SUMS.txt" | awk '{print $1}' | head -n1 || true)"
  if [ -n "$want" ]; then
    got="$(sha256sum "$tmp/$FILE" | awk '{print $1}')"
    [ "$want" = "$got" ] || { say "La suma SHA256 no coincide: se cancela." "SHA256 mismatch: aborting."; exit 1; }
    say "Suma SHA256 verificada." "SHA256 verified."
  fi
fi
install -m 0755 "$tmp/$FILE" "$TARGET"

# icono: se extrae del propio AppImage si se puede
if "$TARGET" --appimage-extract 'usr/share/icons/hicolor/256x256/apps/*.png' >/dev/null 2>&1; then
  ic="$(ls squashfs-root/usr/share/icons/hicolor/256x256/apps/*.png 2>/dev/null | head -n1 || true)"
  [ -n "$ic" ] && cp "$ic" "$ICON_DIR/nonimail-tools.png"
  rm -rf squashfs-root
fi

cat > "$APP_DIR/nonimail-tools.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=NoniMail Tools
Name[es]=NoniMail Tools
Comment=Clean your inbox and sync IMAP mailboxes
Comment[es]=Limpie su bandeja de entrada y sincronice buzones IMAP
Exec=$TARGET %U
Icon=nonimail-tools
Terminal=false
Categories=Office;Email;Utility;
StartupWMClass=NoniMail Tools
DESKTOP
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true

say "Instalado en $TARGET" "Installed at $TARGET"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "Agregue $BIN_DIR a su PATH para abrirlo desde la terminal." "Add $BIN_DIR to your PATH to run it from a terminal.";; esac

# Ollama (opcional): la propia app también lo instala desde el configurador
if ! command -v ollama >/dev/null 2>&1; then
  ans="${NMT_OLLAMA:-}"
  if [ -z "$ans" ] && [ -r /dev/tty ]; then
    if [ "$LANG_ES" = 1 ]; then printf 'Instalar Ollama (IA local) ahora? [s/N] '; else printf 'Install Ollama (local AI) now? [y/N] '; fi
    read -r reply < /dev/tty || reply=""
    case "$reply" in s|S|y|Y|si|sí|yes) ans=1;; *) ans=0;; esac
  fi
  if [ "$ans" = 1 ]; then
    say "Instalando Ollama (script oficial; pedirá su contraseña con sudo)…" "Installing Ollama (official script; sudo will ask for your password)…"
    dl "https://ollama.com/install.sh" "$tmp/ollama-install.sh"
    sudo sh "$tmp/ollama-install.sh"
  fi
fi
say "Listo. Ábralo desde el menú de aplicaciones o con: $TARGET" "Done. Open it from the applications menu or run: $TARGET"

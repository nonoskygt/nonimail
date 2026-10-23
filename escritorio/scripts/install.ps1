<#
NoniMail Tools: instalador para Windows (por usuario, sin administrador).
  irm https://raw.githubusercontent.com/nonoskygt/nonimail-tools/main/scripts/install.ps1 | iex
Descarga el instalador de la última versión, verifica la suma SHA256 y lo instala en silencio.
  $env:NMT_OLLAMA = '1'  instala también Ollama (IA local) sin preguntar;  '0'  no pregunta ni instala.
  $env:NMT_BASE_URL      carpeta de descarga (por defecto, GitHub Releases).
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Base = if ($env:NMT_BASE_URL) { $env:NMT_BASE_URL } else { 'https://github.com/nonoskygt/nonimail-tools/releases/latest/download' }
$File = 'NoniMail-Tools-Setup.exe'
$Es = (Get-Culture).TwoLetterISOLanguageName -eq 'es'
function Say($es, $en) { if ($Es) { Write-Host $es } else { Write-Host $en } }

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('nonimail-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Exe = Join-Path $Tmp $File
  Say 'Descargando NoniMail Tools...' 'Downloading NoniMail Tools...'
  Invoke-WebRequest -Uri "$Base/$File" -OutFile $Exe -UseBasicParsing

  try {
    $Sums = (Invoke-WebRequest -Uri "$Base/SHA256SUMS.txt" -UseBasicParsing).Content
    $Line = ($Sums -split "`n" | Where-Object { $_ -match [regex]::Escape($File) } | Select-Object -First 1)
    if ($Line) {
      $Want = ($Line -split '\s+')[0].ToLower()
      $Got = (Get-FileHash -Algorithm SHA256 -Path $Exe).Hash.ToLower()
      if ($Want -ne $Got) { throw 'sha256' }
      Say 'Suma SHA256 verificada.' 'SHA256 verified.'
    }
  } catch {
    if ($_.Exception.Message -eq 'sha256') { Say 'La suma SHA256 no coincide: se cancela.' 'SHA256 mismatch: aborting.'; exit 1 }
  }

  Say 'Instalando...' 'Installing...'
  $p = Start-Process -FilePath $Exe -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "El instalador terminó con el código $($p.ExitCode)" }
  Say 'NoniMail Tools instalado. Ábralo desde el menú Inicio.' 'NoniMail Tools installed. Open it from the Start menu.'

  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    $Ans = $env:NMT_OLLAMA
    if (-not $Ans) {
      $r = Read-Host $(if ($Es) { 'Instalar Ollama (IA local) ahora? [s/N]' } else { 'Install Ollama (local AI) now? [y/N]' })
      $Ans = if ($r -match '^(s|S|y|Y|si|sí|yes)$') { '1' } else { '0' }
    }
    if ($Ans -eq '1') {
      Say 'Instalando Ollama (instalador oficial)...' 'Installing Ollama (official installer)...'
      $Oll = Join-Path $Tmp 'OllamaSetup.exe'
      Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $Oll -UseBasicParsing
      Start-Process -FilePath $Oll -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -Wait
    }
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

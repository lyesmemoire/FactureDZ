# ============================================================
#  FacturationDZ — Génération de l'installateur Windows
#  FacturationDZ-Setup.exe  (Tauri + NSIS, mode MSVC)
# ============================================================
#  Usage (PowerShell, à la racine du projet) :
#      powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
#
#  Prérequis (à installer une seule fois sur le poste de build) :
#    1. Node.js 20 LTS ................ https://nodejs.org
#    2. Rust (toolchain MSVC) ......... https://rustup.rs   →  rustup default stable-msvc
#    3. Visual Studio Build Tools ..... charge de travail « Développement Desktop en C++ »
#    4. NSIS 3 ....................... https://nsis.sourceforge.io  (ou laissé à Tauri)
#
#  Ce script n'installe rien : il vérifie, teste, compile, et calcule le SHA-256.
# ============================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "== FacturationDZ : build installateur Windows ==" -ForegroundColor Cyan
Write-Host "Projet : $root"

# ---------- 1. Vérifications préalables ----------
function Require-Cmd($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Commande introuvable : '$name'. $hint"
  }
}
Require-Cmd node  "Installez Node.js 20 LTS (https://nodejs.org)."
Require-Cmd npm   "Installez Node.js 20 LTS (https://nodejs.org)."
Require-Cmd cargo "Installez Rust via https://rustup.rs puis 'rustup default stable-msvc'."

$nodeVersion = (node --version)
Write-Host "Node  : $nodeVersion"
Write-Host "Rust  : $(cargo --version)"
Write-Host "rustc : $(rustc --version)"

$hostTarget = (rustc -vV | Select-String '^host:').ToString().Split(':')[1].Trim()
if ($hostTarget -notlike '*windows-msvc') {
  Write-Warning "Toolchain hôte détecté : $hostTarget (attendu: *windows-msvc)."
  Write-Warning "Corrigez avec :  rustup default stable-msvc"
}

# ---------- 2. Dépendances et tests de non-régression ----------
Write-Host "`n[1/4] npm ci ..." -ForegroundColor Yellow
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci a échoué." }

Write-Host "`n[2/4] Tests frontend (§66) ..." -ForegroundColor Yellow
npm test
if ($LASTEXITCODE -ne 0) { throw "Les tests frontend ont échoué — build interrompu (aucun installateur non testé)." }

Write-Host "`n[3/4] Tests backend Rust (§64) ..." -ForegroundColor Yellow
Push-Location src-tauri
cargo test
$rcRust = $LASTEXITCODE
Pop-Location
if ($rcRust -ne 0) { throw "Les tests Rust ont échoué — build interrompu." }

# ---------- 3. Compilation + empaquetage NSIS ----------
Write-Host "`n[4/4] npx tauri build (NSIS, français) ..." -ForegroundColor Yellow
npx tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build a échoué." }

# ---------- 4. Livrable ----------
$nsis = Join-Path $root "src-tauri\target\release\bundle\nsis"
$exe  = Get-ChildItem $nsis -Filter *.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw "Aucun installateur trouvé dans $nsis" }

$out = Join-Path $root "artifacts"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$final = Join-Path $out "FacturationDZ-Setup.exe"
Copy-Item $exe.FullName $final -Force

$hash = (Get-FileHash $final -Algorithm SHA256).Hash
"$hash  FacturationDZ-Setup.exe" | Set-Content (Join-Path $out "SHA256SUMS.txt") -Encoding ASCII

Write-Host "`n=== TERMINÉ ===" -ForegroundColor Green
Write-Host "Installateur : $final"
Write-Host ("Taille       : {0:N1} Mo" -f ((Get-Item $final).Length / 1MB))
Write-Host "SHA-256      : $hash"
Write-Host "`nTest d'installation recommandé (§65) : installez sur une machine vierge,"
Write-Host "créez une facture, vérifiez C:\ProgramData\FacturationDZ, désinstallez,"
Write-Host "puis réinstallez : les données doivent être intactes."

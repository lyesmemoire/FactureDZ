#!/usr/bin/env bash
# ============================================================
#  FacturationDZ — assemblage des artefacts Windows (§53)
# ============================================================
#  À lancer après un build Tauri réussi :
#     bash scripts/make-artifacts.sh [dossier_release]
#  Par défaut : src-tauri/target/x86_64-pc-windows-gnu/release
#  Produit :
#     artifacts/FacturationDZ-Setup.exe      installateur NSIS
#     artifacts/SHA256SUMS.txt               empreinte SHA-256
#     artifacts/FacturationDZ-Portable/      version sans installation
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REL="${1:-$ROOT/src-tauri/target/x86_64-pc-windows-gnu/release}"
OUT="$ROOT/artifacts"

if [ ! -d "$REL" ]; then
  echo "ERREUR : dossier release introuvable : $REL" >&2
  exit 1
fi

SETUP="$(ls -1 "$REL"/bundle/nsis/*-setup.exe 2>/dev/null | head -1 || true)"
APP="$(cd "$REL" && ls -1 *.exe 2>/dev/null | grep -v '^FacturationDZ-Portable' | head -1 || true)"

if [ -z "$SETUP" ] || [ -z "$APP" ]; then
  echo "ERREUR : installateur NSIS ou binaire applicatif absent dans $REL" >&2
  echo "  setup trouvé : ${SETUP:-aucun}" >&2
  echo "  binaire      : ${APP:-aucun}" >&2
  exit 1
fi

mkdir -p "$OUT/FacturationDZ-Portable"
cp -f "$SETUP" "$OUT/FacturationDZ-Setup.exe"
cp -f "$REL/$APP" "$OUT/FacturationDZ-Portable/FacturationDZ.exe"
mkdir -p "$OUT/FacturationDZ-Portable/portable-data"
# Le moteur PDF charge les polices depuis <dossier de l'exe>/resources/fonts
# (src-tauri/src/lib.rs) : indispensables au bon fonctionnement du mode portable.
mkdir -p "$OUT/FacturationDZ-Portable/resources"
cp -rf "$ROOT/src-tauri/resources/." "$OUT/FacturationDZ-Portable/resources/"

cat > "$OUT/FacturationDZ-Portable/LISEZ-MOI.txt" <<'TXT'
FacturationDZ — version portable (§53)
======================================

Aucune installation requise : lancez FacturationDZ.exe.

Vos donnees sont enregistrees dans le sous-dossier « portable-data\ » cree a
cote du programme (rien n'est ecrit dans C:\ProgramData). Copiez tout le
dossier (exe + portable-data) sur une cle USB pour emporter vos donnees.

Fonctionne 100 % hors ligne. Aucune donnee ne quitte cet ordinateur.

Rappel : logiciel concu pour integrer la reglementation algerienne applicable ;
la validation finale des documents reste sous la responsabilite de l'entreprise
et de son conseil fiscal.
TXT

(
  cd "$OUT"
  sha256sum FacturationDZ-Setup.exe > SHA256SUMS.txt
  sha256sum FacturationDZ-Portable/FacturationDZ.exe >> SHA256SUMS.txt
)

echo "=== ARTEFACTS PRÊTS ==="
ls -lh "$OUT"
echo
cat "$OUT/SHA256SUMS.txt"

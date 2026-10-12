# Installation, mise à jour, désinstallation

## Installer (§53)

1. Double-cliquer sur **FacturationDZ-Setup.exe**.
2. Choisir « Installer pour moi uniquement » ou « Tous les utilisateurs ».
3. L'installateur NSIS (français, compression LZMA) :
   - copie le programme **et les polices PDF** (`resources/fonts`) dans le dossier choisi ;
   - crée les raccourcis Menu Démarrer et Bureau ;
   - propose le runtime WebView2 s'il est absent (Windows 10/11 à jour : déjà présent) ;
   - **ne touche jamais** au dossier de données (§52).
4. Premier lancement → l'application crée `C:\ProgramData\FacturationDZ\{Data,Backups,Documents,Exports,Logs}`
   (§3), puis lance l'**assistant de configuration** en 9 étapes (§54).

À la désinstallation, l'assistant **propose de conserver vos données** (choix par défaut),
exige une **seconde confirmation** avant toute suppression, et **conserve toujours** les
données en mode silencieux (`/S` — mises à jour, déploiements automatisés).
Détails et dépannage : `docs/GUIDE_INSTALLATEUR_WINDOWS.md`.

Version portable : copier le dossier **`artifacts/FacturationDZ-Portable/`** entier
(exécutable + `resources/fonts` + `portable-data/`) sur la clé USB. Le sous-dossier
`resources/fonts` est **indispensable** : le moteur PDF y charge ses polices, à côté de
l'exécutable.

## Générer l'installateur (développeur)

Trois voies, détaillées dans **`docs/GUIDE_INSTALLATEUR_WINDOWS.md`** :

1. **Artefact déjà produit** — `artifacts/FacturationDZ-Setup.exe` (+ `SHA256SUMS.txt`),
   généré par compilation croisée Linux→Windows de validation.
2. **CI GitHub Actions** (recommandé, chaîne MSVC officielle) —
   `.github/workflows/windows-build.yml` : exécute `npm test`, `cargo test` et le test
   de charge §50, puis publie `FacturationDZ-Setup.exe` (lancer via *Run workflow* ou
   en poussant un tag `v1.0.0`).
3. **Build local Windows** — Windows 10/11 x64, Rust stable (MSVC), Node.js 20,
   Visual Studio Build Tools (C++), WebView2 :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
# (équivalent manuel : npm ci && npm test && cargo test && npx tauri build --bundles nsis
#  → src-tauri\target\release\bundle\nsis\FacturationDZ_1.0.0_x64-setup.exe)
```

Aucun Node/Python/Rust n'est requis sur le PC cible (§2, §79).

### Ressources embarquées (déjà présentes dans le dépôt)

- **Icônes** (`src-tauri/icons/`) : `icon.ico` (16→256 px) et `icon.png`
  (512 px). Régénération depuis un logo : `npx tauri icon mon-logo-1024.png`.
- **Polices du PDF natif** (§23) : `src-tauri/resources/fonts/` contient
  **Liberation Sans** et **Liberation Mono** (polices libres, métriques
  compatibles Arial/Courier), embarquées automatiquement (`bundle.resources`).
  Sans elles, la génération PDF native échoue (l'impression système reste
  disponible en repli).

### Vérifications avant de produire l'installateur

```bash
npm test              # 90 tests frontend
npm run test:rust     # 14 tests backend (cargo)
npm run loadtest      # charge §50 — 100 000 documents
npx tauri build --bundles nsis   # produit src-tauri/target/release/bundle/nsis/*.exe
```

### Mode portable (§53)

Pour une exécution depuis une clé USB (données à côté du programme) :

1. copier le dossier **`artifacts/FacturationDZ-Portable/`** (exécutable,
   `resources/fonts`, `portable-data/`, `LISEZ-MOI.txt`) sur la clé — la structure
   est déjà prête ;
2. lancer `FacturationDZ.exe` : toutes les données (base, sauvegardes, PDF,
   pièces jointes, journaux) vont dans `portable-data/…` au lieu de
   `C:\ProgramData\FacturationDZ`.

La variable d'environnement `FACTURATIONDZ_DATA_DIR` permet aussi de forcer
l'emplacement (tests, postes partagés).

## Mettre à jour (§51)

1. L'installateur effectue **automatiquement une sauvegarde pré-migration**
   (`Backups/pre_migration_*.sqlite`).
2. Le programme est remplacé ; la base `Data/facturation.db` n'est **jamais**
   touchée par l'installateur (§3, §81).
3. Au démarrage, le moteur applique les migrations manquantes, puis lance une
   vérification d'intégrité (§49).

## Désinstaller (§52)

Le désinstallateur affiche : « Vos données seront conservées. »

- Option par défaut : **supprimer le programme uniquement** —
  `C:\ProgramData\FacturationDZ` est intégralement conservé.
- Option explicite (case à cocher + confirmation) : supprimer programme ET
  données. Jamais par défaut.

## Environnement d'exécution

- Windows 10 64 bits / Windows 11 64 bits (§2).
- Fonctionne **sans connexion Internet** (§4) : aucune vérification de
  licence en ligne, aucune mise à jour automatique silencieuse.

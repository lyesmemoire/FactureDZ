# Installateur Windows — FacturationDZ

> **Livrable :** `FacturationDZ-Setup.exe` — installateur NSIS, interface **française**, sans dépendance à Internet au fonctionnement.
> **Application :** React + TypeScript (interface) · Rust + SQLite (moteur métier) · Tauri 2 (coquille Windows).
> **Garanties tenues :** 100 % hors ligne · toutes les données restent sur le poste · mise à jour et désinstallation sans perte de données.

---

## 1. Le livrable

| Élément | Valeur |
|---|---|
| Fichier | `FacturationDZ-Setup.exe` |
| Format | Installateur NSIS 3 (auto-extractible, compression LZMA) |
| Langue | Français |
| Mode d'installation | `both` — pour l'utilisateur courant, ou pour tous les utilisateurs si lancé en administrateur |
| Taille | ≈ 5,7 Mo (5 953 150 octets, NSIS 3 Unicode + LZMA solide) |
| SHA-256 | `f5f30d0780374058fb3dafb8ff2229c02c3a24253853326d801fa8909b67d2a0` (voir `artifacts/SHA256SUMS.txt`) — build **incluant les correctifs F-17/F-18** |
| Base de données | créée au **premier lancement** dans `C:\ProgramData\FacturationDZ\` (jamais par l'installateur) |

L'installateur contient le binaire Windows **et** les polices PDF embarquées (`resources/fonts/*`).
Il **n'exige ni Node.js, ni Rust, ni Internet** sur le poste de l'utilisateur final.

Dossier `artifacts/` du projet :

```
artifacts/
├── FacturationDZ-Setup.exe     ← installateur (livrable principal)
├── SHA256SUMS.txt              ← empreintes SHA-256 des deux livrables
└── FacturationDZ-Portable/     ← version sans installation (§53)
    ├── FacturationDZ.exe
    ├── resources/fonts/        ← polices du PDF natif (indispensables)
    ├── portable-data/          ← créé au premier lancement (mode portable)
    └── LISEZ-MOI.txt
```

---

## 2. Voie A — Utiliser l'installateur déjà produit

1. Copiez `artifacts/FacturationDZ-Setup.exe` sur le poste Windows 10/11 (clé USB, partage local…).
2. Vérifiez l'empreinte (facultatif mais recommandé) :
   ```powershell
   Get-FileHash .\FacturationDZ-Setup.exe -Algorithm SHA256
   # à comparer avec artifacts/SHA256SUMS.txt
   ```
3. Double-cliquez, choisissez la destination, terminez. L'assistant affiche le rappel d'utilisation
   hors ligne puis se ferme.
4. Au premier lancement, l'application crée `C:\ProgramData\FacturationDZ\` puis l'assistant de
   premier démarrage (entreprise, utilisateur, taux de TVA).

> **Provenance de l'artefact fourni :** il a été produit par **compilation croisée** Linux → Windows
> (cible `x86_64-pc-windows-gnu` + NSIS), ce qui permet de vérifier la chaîne complète sans poste
> Windows. Pour un livrable diffusé à grande échelle, préférez la **voie B** (CI Windows, toolchain
> MSVC), qui reproduit le même installateur avec la chaîne officielle Tauri.

---

## 3. Voie B — Reconstruire l'installateur avec GitHub Actions (recommandé)

Le dépôt contient le workflow `.github/workflows/windows-build.yml` : il exécute **tous les tests**
avant de compiler, puis publie l'installateur.

```bash
git init && git add . && git commit -m "FacturationDZ 1.0.0"
git remote add origin https://github.com/<votre-compte>/facturation-dz.git
git push -u origin main
```

Puis, sur GitHub : **Actions → « Build installateur Windows » → Run workflow**.
À la fin (≈ 10–15 min), téléchargez l'artefact **FacturationDZ-Setup** (`FacturationDZ-Setup.exe` +
`SHA256SUMS.txt`).

Le workflow enchaîne : `npm ci` → `npm test` (90 tests) → `cargo test` (14 tests) →
`npm run loadtest` (100 000 documents) → `npx tauri build --bundles nsis`.
Aucun test en échec ⇒ aucun installateur publié.

---

## 4. Voie C — Reconstruire en local sous Windows

Prérequis à installer une seule fois :

1. **Node.js 20 LTS** — <https://nodejs.org>
2. **Rust (toolchain MSVC)** — <https://rustup.rs> puis `rustup default stable-msvc`
3. **Visual Studio Build Tools** — charge de travail « Développement Desktop en C++ »
4. NSIS est téléchargé automatiquement par Tauri si absent.

Puis, à la racine du projet :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

Le script vérifie les prérequis, lance les tests de non-régression, compile, copie l'installateur
dans `artifacts\` et calcule son SHA-256.

Commande équivalente « à la main » :

```powershell
npm ci
npm test
cd src-tauri ; cargo test ; cd ..
npx tauri build --bundles nsis
# → src-tauri\target\release\bundle\nsis\FacturationDZ_1.0.0_x64-setup.exe
```

> **Compilation croisée depuis Linux/macOS (avancé, non officiel) :**
> ```bash
> sudo apt install nsis gcc-mingw-w64-x86-64 binutils-mingw-w64   # Debian/Ubuntu
> rustup target add x86_64-pc-windows-gnu
> CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
>   npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
> ```
> Utile pour valider la chaîne d'empaquetage sans machine Windows ; la voie B reste la référence.

---

## 5. Variante « installation 100 % hors ligne » (runtime WebView2)

Par défaut, l'installateur utilise le *bootstrapper* WebView2 : si le poste n'a pas le runtime
WebView2 (cas rare sur Windows 11 et Windows 10 à jour, où il est préinstallé), il le télécharge.
Pour un déploiement où **aucun accès Internet n'est possible**, emballez le runtime complet :

```jsonc
// src-tauri/tauri.conf.json
"bundle": {
  "windows": {
    "webviewInstallMode": { "type": "offlineInstaller", "silent": true }
  }
}
```

L'installateur passe alors de ~10 Mo à ~140 Mo, mais s'installe sur n'importe quel Windows 10/11
sans réseau. Recompilez ensuite avec la voie B ou C.

---

## 6. Ce que fait exactement l'installateur

* Assistant NSIS **en français**, page de choix du dossier, raccourcis Menu Démarrer et bureau.
* Installe les binaires dans le dossier choisi (`%LOCALAPPDATA%\FacturationDZ` par défaut en
  installation utilisateur ; `C:\Program Files\FacturationDZ` en installation machine).
* **Ne touche jamais** au dossier de données `C:\ProgramData\FacturationDZ\`.
* **Hooks personnalisés** (`src-tauri/installer-hooks.nsh`) :
  * à la fin de l'installation : rappel « 100 % hors ligne » et avertissement légal (§79) ;
  * à la désinstallation : **propose de conserver les données** (choix par défaut), exige une
    **seconde confirmation** avant toute suppression, et **conserve toujours** en mode silencieux
    (`/S`, mises à jour, déploiement automatisé).

---

## 7. Données utilisateur et désinstallation — garanties §52

| Situation | Comportement |
|---|---|
| Mise à jour (réinstallation) | Les données sont **intactes** : l'installateur ne les ouvre même pas. |
| Désinstallation interactive | Question « conserver vos données ? » — **Oui par défaut**. |
| Désinstallation silencieuse (`/S`) | Données **conservées**, sans question, sans exception. |
| Suppression demandée et confirmée | Seul cas où `C:\ProgramData\FacturationDZ` est effacé (best-effort, irréversible, double confirmation). |
| Désinstallation avec droits insuffisants | Les données éventuellement non supprimées sont listées dans le message final ; suppression manuelle possible. |

Emplacement des données (jamais dans le dossier du programme) :

```
C:\ProgramData\FacturationDZ\
├── Data\        facturationdz.db (+ -wal, -shm)
├── Backups\     sauvegardes .zip automatiques et manuelles
├── Documents\   pièces jointes (logos, cachets, signatures, scans)
├── Exports\     PDF, CSV, XLSX générés
└── Logs\        journaux techniques + journal d'audit
```

**Mode portable (§53) :** sans installation, lancez `FacturationDZ-Portable\FacturationDZ.exe` ;
les données sont alors créées dans `portable-data\` à côté du binaire (aucune écriture dans
`ProgramData`).

---

## 8. Recette d'installation (§65) — à exécuter avant diffusion

| # | Étape | Résultat attendu |
|---|---|---|
| 1 | Copier l'installateur sur un PC Windows 10/11 neuf (si possible **sans Internet**). | — |
| 2 | Vérifier la somme SHA-256. | Identique à `SHA256SUMS.txt`. |
| 3 | Exécuter, installer « pour moi » puis refaire le test « pour tous les utilisateurs ». | Assistant en français, aucune erreur. |
| 4 | Lancer l'application : premier démarrage. | Création de `C:\ProgramData\FacturationDZ\` + assistant (entreprise / utilisateur / TVA). |
| 5 | Créer une facture de test (ex. 1 250 000,00 DA, TVA 19 %). | Numéro `FAC-<année>-000001`, montant en lettres correct, PDF généré. |
| 6 | Vérifier le PDF A4 (mentions vendeur/client, cachet, montant en lettres). | Conforme au modèle livré. |
| 7 | Fermer l'application, vérifier `Data\facturationdz.db`, `Backups\`, `Logs\`. | Fichiers présents, journal d'audit rempli. |
| 8 | **Désinstaller** puis répondre « conserver mes données ». | Programme retiré, `ProgramData` intact. |
| 9 | **Réinstaller** puis ouvrir l'application. | La facture de test est toujours là. |
| 10 | Refaire une désinstallation avec « supprimer » + confirmation. | Données effectivement supprimées ; sans confirmation, elles restent. |
| 11 | Couper le réseau et travailler 30 min (facture, PDF, sauvegarde, restauration). | Tout fonctionne **hors ligne**, aucune requête réseau (vérifiable dans les journaux). |

---

## 9. Signature de code (facultatif)

Sans signature, Windows SmartScreen affiche un avertissement (« Éditeur inconnu ») au premier
lancement. Pour le supprimer, signez l'installateur avec un certificat de signature de code :

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f certificat.pfx /p <motdepasse> artifacts\FacturationDZ-Setup.exe
```

La signature n'a **aucun effet** sur le fonctionnement hors ligne : elle s'applique au fichier
d'installation, pas à l'application à l'exécution.

---

## 10. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Windows a protégé votre PC » (SmartScreen) | Installateur non signé | §9 — « Informations complémentaires → Exécuter quand même » en attendant. |
| Message demandant WebView2 | Runtime absent et poste sans Internet | Utiliser la variante `offlineInstaller` (§5) ou installer le runtime Microsoft une fois. |
| L'installation « pour tous les utilisateurs » échoue | Exécution sans élévation | Clic droit → **Exécuter en tant qu'administrateur**, ou rester en installation utilisateur. |
| Antivirus signale le fichier | Binaire non signé peu répandu | Signer (§9) ou mettre en liste blanche ; l'application elle-même ne fait aucun accès réseau. |
| Après désinstallation/réinstallation | Comportement normal | Les données restent : c'est la garantie §52. Supprimer `C:\ProgramData\FacturationDZ` manuellement si voulu. |
| L'application ne retrouve pas ses données | Mode portable vs installation complète | Chercher `portable-data\` à côté du binaire, sinon `%ProgramData%\FacturationDZ`. |

---

## 11. Rappel légal (§79)

FacturationDZ **n'est pas certifié par un organisme d'État** et ne revendique aucune homologation
officielle (DGI ou autre). Le logiciel est **conçu pour intégrer la réglementation algérienne
applicable** (mentions obligatoires, TVA configurable, numérotation séquentielle, montants en
lettres). **La validation finale des documents émis reste sous la responsabilité de l'entreprise
et de son conseil fiscal.**

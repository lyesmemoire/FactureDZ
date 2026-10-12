# FacturationDZ

**Logiciel de facturation professionnel 100 % hors ligne pour les entreprises algériennes.**

- ✅ Windows 10/11 64 bits, installateur `FacturationDZ-Setup.exe` (double-clic)
- ✅ Aucun Internet requis : aucune API, aucun cloud, aucune télémétrie (§4, §62)
- ✅ SQLite local dans `C:\ProgramData\FacturationDZ\` — programme et données séparés (§3)
- ✅ Factures, avoirs, devis, proforma, bons de livraison (§56-59)
- ✅ Numérotation séquentielle inviolable, snapshots historiques (§12, §38)
- ✅ Moteur de taxes configurable — rien n'est codé en dur (§10, §73)
- ✅ Montants en lettres français calculés automatiquement (§16)
- ✅ PDF A4, impression, cachet/signature (§23, §24, §26)
- ✅ Sauvegarde/restauration automatiques et manuelles (§30-32), avec réhydratation de l'interface
- ✅ Journal d'audit, rôles et permissions (§34, §35) — mots de passe Argon2id
- ✅ Pièces jointes par document, stockées localement (§61)
- ✅ Base SQLite synchronisée en continu ; mode portable sur clé USB (§53)
- ✅ 90 tests frontend + 14 tests backend Rust, test de charge 100 000 documents (§50, §66)

> ⚖️ Application conçue pour intégrer les exigences réglementaires algériennes
> applicables à la facturation (notamment le décret exécutif n° 05-468 du
> 10 décembre 2005). La validation finale par l'entreprise et son conseiller
> fiscal/comptable reste nécessaire (§72). Ce logiciel n'affiche aucune mention
> d'agrément officiel.

---

## Démarrage rapide (développement)

```bash
npm install
npm test              # 90 tests métier, store, synchronisation et interface (§64-66)
npm run test:rust     # 14 tests backend (numérotation SQL, Argon2, synchronisation)
npm run loadtest      # charge §50 : 100 000 documents (recherche, intégrité)
npm run dev           # interface (mode démo : persistance locale du navigateur)
npm run build         # frontend de production
```

## Validation (état vérifié)

`docs/VALIDATION_APPLICATION_REELLE.md` — rapport de la session où l'application a été
**lancée et utilisée** : 101 tests frontend + 15 tests Rust (dont un parcours d'intégration
sur base SQLite réelle), application exécutée, actions vérifiées directement dans la base,
captures d'écran dans `docs/captures/`. Deux défauts critiques (F-17 reprise des données,
F-18 synchronisation interface → base) ont été découverts et corrigés lors de cette session.

## Livrables Windows (§53) — déjà produits

```
artifacts/
├── FacturationDZ-Setup.exe     ← installateur NSIS (français, 5,7 Mo)
├── SHA256SUMS.txt              ← empreintes des livrables
└── FacturationDZ-Portable/     ← version sans installation (clé USB, §53)
    ├── FacturationDZ.exe · resources/fonts/ · portable-data/ · LISEZ-MOI.txt
```

Trois façons de (re)construire l'installateur — guide complet :
**`docs/GUIDE_INSTALLATEUR_WINDOWS.md`**.

```powershell
# Voie recommandée — CI GitHub Actions (chaîne MSVC officielle, tests inclus) :
#   Actions → « Build installateur Windows » → Run workflow  (ou tag v1.0.0)

# Voie locale — PC Windows 10/11 + Rust (MSVC) + Node.js 20 + VS Build Tools :
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
# → artifacts\FacturationDZ-Setup.exe + SHA256SUMS.txt

# Voie avancée — compilation croisée depuis Linux (validation) :
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
bash scripts/make-artifacts.sh
```

## Arborescence (ÉTAPE 2)

```
facturation-dz/
├── package.json, vite.config.ts, tsconfig.json   # frontend React + TypeScript
├── index.html
├── src/
│   ├── core/          # MOTEURS MÉTIER purs (testés) : money, TVA, numérotation,
│   │                  # calcul, montant en lettres, validation  (§14, §70)
│   ├── store/         # Couche de données (contrat identique au backend SQLite)
│   ├── ui/            # Coquille app, A4, modales, styles
│   └── screens/       # Tableau de bord, factures, clients, rapports… (§44)
├── src-tauri/         # Backend Rust/Tauri : SQLite, transactions, PDF, backups
│   ├── src/{db, numbering, invoices, money_fr, backup, pdf, audit, commands}.rs
│   ├── tauri.conf.json            # bundle NSIS → FacturationDZ-Setup.exe
│   └── capabilities/default.json  # permissions minimales (§36)
├── db/migrations/     # Migrations SQL versionnées (§5)
├── docs/              # ARCHITECTURE, DATABASE, SECURITY, LEGAL_COMPLIANCE… (§71)
└── .github/workflows/ # Build automatique de l'installateur Windows
```

## Documentation

| Document | Contenu |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Vue d'ensemble, modules, flux de validation |
| [docs/DATABASE.md](docs/DATABASE.md) | Schéma SQLite complet et règles d'intégrité |
| [docs/SECURITY.md](docs/SECURITY.md) | Mots de passe, permissions, protection des données |
| [docs/LEGAL_COMPLIANCE.md](docs/LEGAL_COMPLIANCE.md) | Conformité réglementaire algérienne |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Installation, mise à jour, désinstallation |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Guide utilisateur |
| [docs/BACKUP.md](docs/BACKUP.md) | Sauvegarde et restauration |
| [docs/TESTS.md](docs/TESTS.md) | Stratégie de tests et non-régression |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md) | Migrations de schéma et mises à jour |

## Licence

Propriétaire — usage par l'entreprise acquéreuse. Les données de démonstration
(§77) sont fictives et isolées des données réelles.

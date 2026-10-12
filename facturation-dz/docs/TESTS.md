# Tests et non-régression (§64, §65, §66)

## Exécuter

```bash
npm test            # suite frontend (vitest) — 101 tests (dont 12 d'interface et 3 de contrat IPC)
npm run test:rust   # backend Rust (cargo test) — 16 tests (dont le parcours E2E complet)
npm run loadtest    # test de charge §50 — 100 000 documents (hors CI standard)
```

## Couverture actuelle — 101 tests frontend + 15 tests Rust ✅

## Contrat IPC frontend ↔ backend (`src/store/ipcContract.test.ts`) — garde-fou F-18

Tauri v2 expose les paramètres Rust `snake_case` en **camelCase** côté JavaScript. Ce test
compare statiquement les signatures `#[tauri::command] pub fn …` de `src-tauri/src/commands.rs`
avec les clés réellement envoyées par chaque `invokeDesktop("cmd", { … })` du frontend :
commande inconnue ou clé inconnue ⇒ échec. Il a détecté le défaut F-18 (deux appels
envoyant `local_id` au lieu de `localId`) **avant** sa correction.

## Parcours d'intégration complet — base réelle (`src-tauri/src/e2e.rs`)

Contrairement aux tests unitaires (base en mémoire), ce test exécute le **parcours
réel sur une base SQLite sur disque** ouverte par `Db::open` (WAL, clés étrangères,
migrations 0001 + 0002) et vérifie, dans l'ordre :

| Étape | Vérification |
|---|---|
| 1–4 | Entreprise (§6, NIF/NIS/RC/AI distincts), 3 taux de TVA (19 %, 9 %, exonéré), client, utilisateur — écrits par l'API de synchronisation réelle |
| 5 | Facture brouillon à 2 lignes (dont une remisée), multi-taux |
| 6 | Validation atomique (§69) : numéro `FAC-2026-000001`, totaux **recalculés par le serveur** (HT 12 000,00 / TVA 2 205,00 / TTC 14 205,00), montant en lettres **exact** : « QUATORZE MILLE DEUX CENT CINQ DINARS ALGÉRIENS ET ZÉRO CENTIME. » |
| 7 | Immutabilité (§20) : un `UPDATE` direct sur un document validé est **refusé par le trigger** |
| 8 | **PDF natif A4** généré avec les polices embarquées (`%PDF-`, 1,9 Mo) |
| 9 | Sauvegarde `VACUUM INTO` **rouverte comme base** : la facture validée s'y retrouve — sauvegarde réellement restaurable (§31, §32) ; export ZIP complet valide (§33) |
| 10 | Annulation (§21) : motif enregistré, **numéro jamais réutilisé** (facture suivante = `FAC-2026-000002`) |
| 11–13 | Paiement (59 500 centimes), journal d'audit alimenté, `PRAGMA integrity_check = ok` |

Jeu de données de démonstration reproductible (même API) :

```bash
FACTURATIONDZ_DATA_DIR=/tmp/demo cargo run --example seed_demo
# → entreprise, 3 clients, 3 produits, 4 documents (validé/annulé/brouillons), paiement, sauvegarde
```

### Couche de gestion (store) — 25 tests de non-régression (§64, §66)
- **Cycle de vie (§11, §20, §69)** : validation = transaction complète
  (numéro + statut + totaux recalculés + montant en lettres) ; document
  validé FIGÉ (modification/suppression interdites) ; échec de validation
  sans consommation du compteur ; totaux falsifiés détectés.
- **Annulation (§21)** : motif obligatoire, document et numéro conservés,
  numéro jamais réutilisé, double annulation refusée, brouillon non annulable.
- **Avoirs (§22)** : série `AV-` distincte, référence à l'origine, facture
  d'origine jamais modifiée, refus sur brouillon/non-facture.
- **Duplication (§46)** : brouillon sans numéro, jamais de copie du numéro.
- **Conversions (§57-59)** : devis → facture, nouveau numéro, devis intact.
- **Paiements (§19)** : statuts PARTIELLEMENT PAYÉE / PAYÉE dérivés
  automatiquement ; trop-perçu, brouillon et montant nul refusés.
- **Numérotation (§12, §55)** : séquentielle, compteurs séparés par année,
  aucune collision, gabarit modifiable pour les futurs numéros seulement.
- **Snapshots (§38)** : changement de NIF/adresse/raison sociale APRÈS
  validation → les anciennes factures restent intactes.
- **Moteur fiscal (§10, §74)** : changement de taux sans effet rétroactif,
  historique réglementaire complet (ancien/nouveau/date d'effet/motif).
- **Validations (§48, §8)** : quantité, adresse, taux inconnu bloquants ;
  NIF configurable OFF/WARN/BLOCK sans arbitraire.
- **Intégrité (§49)** : état sain → OK ; doublons de numéros et orphelins
  injectés → détectés.
- **Sauvegarde/restauration (§30-32)** : round-trip complet, sauvegarde de
  sécurité automatique avant restauration, fichiers invalides refusés.
- **Migrations (§51)** : payload ancien complété sans perte ; stockage
  corrompu → base neuve sans crash.
- **Audit (§34)** : création, validation, encaissement, annulation tracés.
- **Sécurité (§36)** : mots de passe jamais en clair (SHA-256), vérification
  fiable, doublons et mots de passe faibles refusés.
- **Démo (§77)** : données fictives marquées et isolées des données réelles.

### Money (§14)
- Conversion décimal → centimes sans dérive flottante (piège `0.1 + 0.2`).
- Arrondi half-up au centime, négatifs inclus.
- Format algérien FR : `1 250 000,00` (§43).
- Analyse de saisie française.

### Montant en lettres (§16)
- Cas de référence §65 : **119 000,00 DA → « CENT DIX-NEUF MILLE DINARS
  ALGÉRIENS ET ZÉRO CENTIME. »**
- Accords : quatre-vingts / quatre-vingt mille, deux cents / deux cent mille,
  deux cents millions ; mille invariable ; et un / et onze ; centimes.

### Calcul des factures (§13-15, §17)
- Test officiel §65 : 10 × 10 000 DA = 100 000 HT ; TVA 19 % = 19 000 ;
  TTC = 119 000 ; lettres exactes.
- TVA 9 %, exonération avec motif, **plusieurs taux dans une même facture**.
- Remise par ligne, remise globale % et montant (répartition au prorata,
  aucun centime perdu).
- Arrondi TVA au centime ; quantités décimales (kg).
- Le snapshot de taux est imperméable au référentiel (§10).

### Numérotation (§12, §55, §56)
- Séquence `FAC-2026-000001…000003`, gabarits alternatifs, séries séparées.
- Refus d'un numéro déjà attribué ; compteurs invalides rejetés.

### Moteur fiscal (§10, §73)
- Préconfiguration TVA 19/9/Exonéré ; fenêtres de validité par dates ;
  calculs de TVA ligne.

### Interface (O-04) — 12 tests composants (jsdom + React Testing Library)
- **Assistant (§54)** : affichage tant que non configuré ; parcours complet des
  9 étapes (entreprise → taxes → numérotation → sauvegardes → administrateur) ;
  mot de passe trop court refusé ; mot de passe jamais stocké en clair.
- **Coquille** : navigation, titre d'écran, bandeau de données de démonstration,
  mention hors ligne.
- **Clients (§7)** : création par modale puis recherche ; suppression bloquée
  lorsqu'un document est rattaché (§47).
- **Documents (§27)** : affichage du numéro validé ; recherche par montant
  (§27, F-08) ; absence de faux positifs.
- **Autres taxes (§10)** : la ligne « Autres taxes » apparaît dans le
  récapitulatif ; TVA et autres taxes restent séparées.
- **Pièces jointes (§61)** : panneau présent dans l'éditeur ; refus au-delà
  de la limite de démonstration.
- **Verrouillage (O-16)** : sans aucun compte, l'écran propose de relancer
  l'assistant.

### Écran Documents — non-régression (F-08)
La recherche couvre numéro, client, NIF/NIS/RC, statut, mode de paiement,
et **les montants HT/TVA/TTC/payé/reste** ainsi que les dates.

### Autres taxes (§10)
- Une ligne TVA alimente `vatDetail` ; une ligne « autre taxe » alimente
  `otherTaxDetail` (jamais les deux).
- TTC = HT + TVA + autres taxes ; montant en lettres sur le TTC complet.
- Arrondi half-up au centime identique pour les autres taxes.

### Backend Rust (cargo test) — 14 tests
- **Numérotation SQL (§12)** : séquence unique, jamais décrémentée.
- **Montant en lettres / money_fr** : parité avec le moteur frontend.
- **Authentification (§36)** : Argon2id, migration transparente des hash
  hérités (démo SHA-256), protection du dernier administrateur, sessions.
- **Synchronisation (§70)** : upsert client idempotent, cycle brouillon →
  validation (champs figés refusés par les triggers §20), paiement après
  document (idempotent), séquences monotones, réhydratation complète
  (`load_dataset`), suppression brouillon OK / validé interdite (§47).
- **Pièces jointes (§61)** : neutralisation du path-traversal, écriture,
  liste, suppression, anti-écrasement.

## Test de charge (§50) — résultats mesurés

`npm run loadtest` génère **100 000 documents** (calculs monétaires réels) et
mesure les opérations critiques :

| Opération | Temps |
|---|---|
| Génération de 100 000 documents | ≈ 2,2 s |
| Recherche plein texte (§27) | ≈ 62 ms |
| Pagination (25 lignes) | < 1 ms |
| Rapport agrégé sur tout l'historique | ≈ 25 ms |
| Contrôle d'intégrité (doublons) | ≈ 79 ms |
| Attribution d'un numéro (§12) | ≈ 29 ms |

Aucune dérive de performance constatée : l'application reste utilisable bien
au-delà du volume d'une PME.

## Non-régression (§66)

Toute modification du calcul TVA, de la numérotation, des arrondis ou des
lettres doit passer cette suite. Le workflow CI exécute `npm test`,
`cargo test` et le test de charge §50 avant de produire l'installateur Windows.

## Scénarios fonctionnels vérifiés manuellement (§64)

Création → validation → numéro unique ; annulation avec motif et marquage ;
avoir référencé ; paiement partiel puis complet ; duplication ;
sauvegarde/restauration ; intégrité ; conversion devis → facture.

## Révision de devis (ajoutée)

- `src/store/store.test.ts` — bloc « révision de devis (§20, §12) » : brouillon lié sans toucher l'original, nouveau numéro à la validation, une seule révision ouverte à la fois, refus (brouillon / facture / devis annulé).
- `src-tauri/src/sync.rs` — `revision_de_devis_persistee_et_figee_a_la_validation` : le lien `origin_doc_number` (migration 0003) traverse SQLite et survit à la validation.

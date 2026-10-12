# Architecture — FacturationDZ (ÉTAPE 1)

## 1. Choix techniques (§2)

| Couche | Technologie | Justification |
|---|---|---|
| Desktop | **Tauri 2** | Binaire natif léger (~10 Mo), sans Node chez l'utilisateur |
| Frontend | **React + TypeScript** (bundlé statiquement) | Productivité, typage strict |
| Backend | **Rust** (commandes IPC) | Stabilité, sécurité mémoire, performances |
| Base | **SQLite (WAL, FK, transactions)** | Local, robuste, zéro serveur (§5) |
| PDF | **printpdf** (Rust) | Génération locale sans dépendance externe (§23) |
| Installateur | **NSIS** via Tauri | `FacturationDZ-Setup.exe`, double-clic (§53) |

Aucun de ces composants n'exige Internet à l'exécution (§4).

## 2. Séparation programme / données (§3, §81)

```
C:\Program Files\FacturationDZ\        ← programme (remplaçable à chaque mise à jour)
C:\ProgramData\FacturationDZ\
    ├── Data\facturation.db            ← base SQLite (WAL + shm)
    ├── Backups\                       ← sauvegardes (§30)
    ├── Documents\                     ← pièces jointes, logo/cachet/signature (§61, §24)
    ├── Exports\                       ← exports CSV/ZIP (§33)
    └── Logs\facturationdz.log         ← journal technique (§67)
```

Une mise à jour ou une désinstallation ne touche **jamais** `ProgramData` (§51, §52).

## 3. Modules (§70)

```
UI (React) ──invoke──▶ Commandes IPC (commands.rs)
                            │
   ┌────────────┬───────────┼───────────────┬──────────────┐
Invoice Engine  Tax Engine  Numbering Engine  PDF Engine   Backup Engine
(invoices.rs)   (tax_rates) (numbering.rs)    (pdf.rs)     (backup.rs)
   │                │             │
   └────────────────┴──── Database Layer (db.rs : SQLite + migrations) ────┘
Audit Engine (audit.rs)   Authentication (users/sessions + Argon2)   Reports
```

**Règle §73** : toutes les règles fiscales vivent dans `tax_rates`,
`tax_rules`, `legal_configuration` — jamais dispersées dans le code. Un
changement de taux ou de mention obligatoire = une donnée, pas une réécriture.

## 4. Flux de validation d'une facture (§69)

```
BEGIN TRANSACTION
  ├─ contrôles §48 (client, adresse, lignes, quantités, prix, TVA)
  ├─ allocate_number() : UPDATE invoice_sequences SET counter=counter+1
  │     → contrainte UNIQUE sur invoices.number = anti-collision absolu (§12)
  ├─ INSERT lignes + calcul HT/TVA/TTC côté serveur (§14, arrondi half-up)
  ├─ snapshots vendeur/acheteur JSON (§38)
  ├─ montant en lettres recalculé (§16)
  └─ INSERT audit_logs (§34)
COMMIT  (ou ROLLBACK : aucune facture partielle ne peut exister)
```

Des triggers SQLite interdisent physiquement la suppression d'une facture
validée et la modification de ses champs figés (§20, §34, §47).

## 5. États d'un document

```
BROUILLON ──valider──▶ VALIDEE ──payer──▶ PARTIELLEMENT_PAYEE ──▶ PAYEE
    │                      │
    │ supprimer (§47)      ├─ annuler (§21) ──▶ ANNULEE (numéro conservé)
    ▼                      └─ avoir (§22) ──▶ nouveau doc AVOIR (nouveau numéro)
 (détruit, journalisé)
```

Devis : BROUILLON → ENVOYE → ACCEPTE / REFUSE / EXPIRE → conversion facture
(nouveau document, nouveau numéro — §58). Idem proforma (§57) et BL (§59).

## 6. Couche de données duale

Le frontend embarque un **adaptateur local** qui applique exactement le même
contrat métier que le backend Rust (numérotation, validation, snapshots,
audit). En mode démo/navigateur, la persistance est le stockage local ; sur
le poste Windows, ces données sont **mirorées** vers SQLite via la
synchronisation write-through (§9.1) et SQLite sert de base durable
(sauvegardes, PDF, pièces jointes, restauration).
Les moteurs de calcul (`src/core/*`) sont **partagés et testés** dans les
deux mondes : 90 tests frontend + 14 tests Rust (§66).

## 7. Performance (§50)

- Index sur `invoices(number) UNIQUE`, `(customer_id)`, `(date)`, `(status)`,
  `(doc_type, date)` ; `customers(nif, rc, denomination)`.
- Requêtes préparées partout (rusqlite), pagination des listes côté UI.
- WAL : lecteurs non bloqués par les écritures.
- Dimensionnement validé : 10 000 clients / 50 000 produits / 100 000 factures /
  1 000 000 lignes (les opérations critiques restent O(log n) via index).
- **Mesures réelles** (`npm run loadtest`, 100 000 documents) : recherche
  62 ms, pagination < 1 ms, rapport agrégé 25 ms, contrôle d'intégrité 79 ms,
  attribution de numéro 29 ms (voir docs/TESTS.md).

## 8. Préparation V2 (§75)

`company_id` présent dans toutes les tables (§76), rôles/permissions déjà
opérationnels (§35), séquences multi-séries : le passage en réseau local ou
multi-société n'exige aucune refonte du schéma.

## 9. Câblage IPC desktop (état : complet)

La passerelle `src/store/desktop.ts` détecte l'environnement Tauri ;
`src/ui/desktopActions.ts` construit les modèles attendus par le backend ;
`src/store/desktopSync.ts` porte la synchronisation write-through.

### 9.1 Synchronisation write-through (§70)

Le frontend reste la source de vérité de l'interface ; en mode desktop chaque
mutation est **mirorée** vers SQLite :

- `sync_upsert(entity, local_id, data)` — une entité par appel :
  `company`, `settings`, `user`, `tax_rate`, `tax_history`, `sequence`,
  `customer` (avec ses contacts), `product`, `document` (avec ses lignes),
  `payment`, `audit`, `backup_record` ;
- `sync_delete(entity, local_id)` — suppression (brouillons, clients et
  produits non référencés) ;
- `load_dataset()` — réhydratation complète de l'état frontend depuis SQLite.

La table **`desktop_ids`** (migration 0002) assure la correspondance stable
identifiant chaîne (frontend) ↔ clé INTEGER (SQLite). Les références croisées
(client d'un document, document d'un paiement, utilisateur d'un audit) sont
résolues par cette table : aucune logique métier n'est dupliquée.

### 9.2 Garde-fous appliqués côté base

- Le miroir d'un document **validé** ne peut modifier que statut, annulation
  et archivage : les triggers `prevent_validated_invoice_update/delete`
  (§20, §47) restent maîtres ;
- le compteur de séquence SQLite ne peut **jamais décroître** (§21) :
  `counter = MAX(existing, incoming)` ;
- un hash Argon2id n'est jamais écrasé par un hash miroir plus faible (§36).

### 9.3 Authentification desktop (§35, §36)

- `auth_login` vérifie le mot de passe **côté Rust** (Argon2id) ; un hash
  hérité du mode démo (SHA-256) est accepté une fois puis **migré** vers
  Argon2id de façon transparente ;
- une session locale (`sessions`) est ouverte, purgée automatiquement à
  l'expiration (verrouillage §37) ;
- `auth_create_user`, `auth_change_password`, `auth_set_active`,
  `auth_list_users` complètent la gestion des comptes ;
- le dernier compte administrateur ne peut pas être désactivé.

### 9.4 Autres commandes desktop

- `render_pdf_to_exports` : PDF natif (printpdf, A4, tableaux alignés) dans
  `Exports\` — repli automatique sur l'impression système ;
- `integrity_check` : `PRAGMA integrity_check` + compteurs d'orphelins ;
- `backup_now` / `restore_backup` / `export_zip` : sauvegardes SQLite avec
  sauvegarde de sécurité préalable (§32) et réhydratation frontend après
  restauration ;
- `save_attachment` / `list_attachments` / `delete_attachment` (§61) :
  fichiers stockés dans `Documents\`, la base ne garde que la référence.

Restauration et re-synchronisation sont accessibles depuis l'écran
**Sauvegardes** (boutons visibles uniquement sur le poste Windows).

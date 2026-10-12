# Base de données — SQLite (ÉTAPE 3-4)

Fichier : `C:\ProgramData\FacturationDZ\Data\facturation.db` (§3)

Pragmas (§5) : `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
`busy_timeout=5000`.

## Montants (§14)

**Tous les montants sont des entiers en centimes** (`INTEGER`). Jamais de
flottant pour l'argent. Politique d'arrondi : *half-up* au centime, appliquée
ligne à ligne, centralisée dans `money.ts` / `money_fr.rs`.

## Tables

| Table | Rôle | Règles clés |
|---|---|---|
| `companies` | Entreprise (§6), multi-société prêt (§76) | NIF/NIS/RC/AI = colonnes distinctes |
| `users` / `sessions` | Comptes locaux, rôles (§35, §36) | hash Argon2id, jamais en clair |
| `customers` | Clients entreprise/particulier (§7) | index NIF/RC/nom ; `demo` (§77) |
| `customer_contacts` | Contacts multiples (§7) | FK CASCADE |
| `products` | Catalogue produits **et** services (§9) | `kind`, vue `services`, PU ≥ 0 |
| `tax_rates` | Référentiel TVA (§10) | code UNIQUE, date début/fin, actif |
| `tax_rules` | Règles avancées paramétrables (§73) | JSON |
| `tax_rate_history` | Historique réglementaire (§74) | ancien/nouveau, date effet, motif |
| `invoice_sequences` | Compteurs par série × année (§12, §56) | PK (doc_type, year), jamais décrémenté |
| `invoices` | Tous documents : FAC/DEV/PRO/BL/AVOIR (§56) | `number` UNIQUE, snapshots JSON (§38) |
| `invoice_items` | Lignes (§13) | taux snapshoté, montants stockés |
| `payments` | Encaissements (§19) | montant > 0, statut dérivé |
| `credit_notes` | Lien avoir ↔ facture d'origine (§22) | référence croisée |
| `invoice_attachments` | Pièces jointes locales (§61) | chemin relatif à `Documents/` |
| `audit_logs` | Journal d'audit append-only (§34) | ancien/nouveau valeur |
| `settings` | Paramètres clé/valeur | validation §8, verrouillage §37 |
| `document_templates` | Modèles de documents | personnalisation future |
| `legal_configuration` (+history) | Paramètres réglementaires (§5, §74) | décret 05-468 en référence |
| `backup_history` | Historique sauvegardes (§30) | type AUTO/MANUELLE/SECURITE |
| `schema_migrations` | Migrations versionnées (§51) | appliquées en ordre, jamais destructives |

## Garanties physiques

1. **Trigger `prevent_validated_invoice_delete`** : tout `DELETE` sur une
   facture non-brouillon est rejeté par SQLite (§34, §47).
2. **Trigger `prevent_validated_invoice_update`** : les colonnes figées
   (numéro, date, client, totaux) ne peuvent pas être modifiées après
   validation (§20).
3. **Index UNIQUE `invoices.number`** : deux documents ne peuvent jamais
   porter le même numéro, quel que soit le chemin d'écriture (§12).
4. **Transactions** : la validation est atomique (§69) — COMMIT ou ROLLBACK.
5. **Snapshots JSON** vendeur/acheteur : l'historique est immunisé contre les
   modifications de fiches (§38).

## Contrôle d'intégrité (§49)

`PRAGMA integrity_check` + requêtes orphelins/doublons/totaux/paiements,
exposées via l'écran Diagnostic et la commande IPC `integrity_check`.

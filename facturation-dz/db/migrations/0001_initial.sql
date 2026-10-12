-- ============================================================
-- FacturationDZ — Migration 0001 (schéma initial)
-- SQLite : WAL, clés étrangères, transactions, contraintes (§5, §69)
-- Tous les montants sont des ENTIERS en centimes (§14).
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Entreprise(s) (§6, §76 : company_id partout pour le multi-société)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raison_sociale TEXT NOT NULL,
  nom_commercial TEXT,
  forme_juridique TEXT,
  activite TEXT,
  adresse TEXT,
  wilaya TEXT,
  commune TEXT,
  telephone TEXT,
  fax TEXT,
  email TEXT,
  site_web TEXT,
  -- Identifiants DISTINCTS (§6) : jamais de champ générique.
  rc TEXT,
  nif TEXT,
  nis TEXT,
  article_imposition TEXT,
  tin_libelle TEXT,               -- libellé international du NIF (§6)
  capital_social TEXT,
  banque TEXT,
  agence TEXT,
  rib TEXT,
  rip_ccp TEXT,
  logo_path TEXT,                 -- fichier local dans Documents/
  cachet_path TEXT,
  signature_path TEXT,
  afficher_cachet INTEGER NOT NULL DEFAULT 1,
  afficher_signature INTEGER NOT NULL DEFAULT 1,
  afficher_banque INTEGER NOT NULL DEFAULT 1,
  devise TEXT NOT NULL DEFAULT 'DZD',          -- §42
  conditions_paiement_defaut_jours INTEGER NOT NULL DEFAULT 30,
  mode_paiement_defaut TEXT NOT NULL DEFAULT 'Virement bancaire',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Utilisateurs, rôles, sessions locales (§35, §36)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,          -- Argon2id, JAMAIS en clair (§36)
  role TEXT NOT NULL CHECK (role IN ('ADMIN','GESTIONNAIRE','COMPTABLE','VENDEUR','LECTEUR')),
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  closed_at TEXT
);

-- ------------------------------------------------------------
-- Clients et contacts (§7)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL CHECK (type IN ('ENTREPRISE','PARTICULIER')),
  denomination TEXT,
  nom_commercial TEXT,
  forme_juridique TEXT,
  activite TEXT,
  nom TEXT,
  prenom TEXT,
  adresse TEXT,
  wilaya TEXT,
  commune TEXT,
  telephone TEXT,
  fax TEXT,
  email TEXT,
  contact_principal TEXT,
  rc TEXT,
  nif TEXT,
  nis TEXT,
  article_imposition TEXT,
  tin_international TEXT,
  conditions_paiement_jours INTEGER,
  plafond_credit_cents INTEGER,         -- §7, NULL si non défini
  observations TEXT,
  actif INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,      -- §77 : données démo isolées
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_nif ON customers(nif);
CREATE INDEX IF NOT EXISTS idx_customers_rc ON customers(rc);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(denomination, nom, prenom);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  fonction TEXT,
  telephone TEXT,
  email TEXT
);

-- ------------------------------------------------------------
-- Catalogue produits / services (§9)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL DEFAULT 'PRODUIT' CHECK (kind IN ('PRODUIT','SERVICE')),
  reference TEXT NOT NULL,
  designation TEXT NOT NULL,
  description TEXT,
  unite TEXT NOT NULL DEFAULT 'unité',
  pu_ht_cents INTEGER NOT NULL CHECK (pu_ht_cents >= 0),
  tax_code_defaut TEXT NOT NULL DEFAULT 'TVA19',
  categorie TEXT,
  actif INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_products_designation ON products(designation);

-- Vue §5 : table « services » exposée séparément.
CREATE VIEW IF NOT EXISTS services AS
  SELECT * FROM products WHERE kind = 'SERVICE';

-- ------------------------------------------------------------
-- Moteur fiscal (§10, §73, §74) — RIEN n'est codé en dur
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  libelle TEXT NOT NULL,
  rate_pct REAL NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
  date_debut TEXT NOT NULL,
  date_fin TEXT,
  actif INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  reference_reglementaire TEXT,
  commentaire TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  params_json TEXT NOT NULL DEFAULT '{}'   -- règles avancées (exonérations catégorielles…)
);

-- Historique des modifications réglementaires (§74) :
-- ancienne valeur / nouvelle valeur / date d'effet / motif / utilisateur.
CREATE TABLE IF NOT EXISTS tax_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_code TEXT NOT NULL,
  old_json TEXT NOT NULL,
  new_json TEXT NOT NULL,
  date_effet TEXT NOT NULL,
  motif TEXT,
  user_id INTEGER REFERENCES users(id),
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Séquences de numérotation (§12, §55, §56)
-- Attribuées par transaction + compteur UNIQUE : impossible à dupliquer.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_sequences (
  doc_type TEXT NOT NULL CHECK (doc_type IN ('FAC','DEV','PRO','BL','AVOIR')),
  year INTEGER NOT NULL CHECK (year >= 2000),
  template TEXT NOT NULL,                          -- ex : FAC-{YEAR}-{COUNTER}
  padding INTEGER NOT NULL DEFAULT 6,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),  -- jamais décrémenté (§21)
  PRIMARY KEY (doc_type, year)
);

-- ------------------------------------------------------------
-- Documents : factures, devis, proforma, BL, avoirs (§11, §57-59)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('FAC','DEV','PRO','BL','AVOIR')),
  number TEXT UNIQUE,                 -- NULL = brouillon ; UNIQUE = §12
  status TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (status IN (
    'BROUILLON','VALIDEE','ENVOYEE','PARTIELLEMENT_PAYEE','PAYEE','ANNULEE',
    'ENVOYE','ACCEPTE','REFUSE','EXPIRE')),
  date TEXT NOT NULL,
  date_echeance TEXT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  mode_paiement TEXT,
  conditions_paiement TEXT,
  ref_commande TEXT,
  ref_devis TEXT,
  ref_bon_livraison TEXT,
  observations TEXT,
  devise TEXT NOT NULL DEFAULT 'DZD',
  remise_globale_kind TEXT CHECK (remise_globale_kind IN ('PCT','AMT')),
  remise_globale_valeur_cents INTEGER,
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  total_tva_cents INTEGER NOT NULL DEFAULT 0,
  total_ttc_cents INTEGER NOT NULL DEFAULT 0,
  montant_lettres TEXT NOT NULL DEFAULT '',         -- §16 : généré, jamais saisi
  vat_detail_json TEXT NOT NULL DEFAULT '[]',
  -- SNAPSHOTS (§38) : figés à la validation, insensibles aux modifications
  -- ultérieures des fiches entreprise/client.
  seller_snapshot_json TEXT NOT NULL,
  buyer_snapshot_json TEXT NOT NULL,
  -- Champs optionnels import/export (§41)
  incoterm TEXT,
  pays_origine TEXT,
  taux_change TEXT,
  ref_douaniere TEXT,
  -- Annulation (§21)
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancel_motif TEXT,
  -- Avoir (§22) : référence facture d'origine
  origin_invoice_id INTEGER REFERENCES invoices(id),
  archived INTEGER NOT NULL DEFAULT 0,              -- §60
  demo INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_number ON invoices(number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_type_date ON invoices(doc_type, date);

-- §34/§47 : INTERDICTION physique de supprimer une facture validée en SQL.
CREATE TRIGGER IF NOT EXISTS prevent_validated_invoice_delete
BEFORE DELETE ON invoices
WHEN OLD.status <> 'BROUILLON'
BEGIN
  SELECT RAISE(ABORT, 'Suppression interdite : une facture validée ne peut jamais être supprimée (§47). Utilisez l''annulation.');
END;

-- Interdiction de modifier les champs figés après validation (§20).
CREATE TRIGGER IF NOT EXISTS prevent_validated_invoice_update
BEFORE UPDATE OF number, date, customer_id, total_ht_cents, total_tva_cents, total_ttc_cents
ON invoices
WHEN OLD.status NOT IN ('BROUILLON')
     AND NOT (NEW.status = 'ANNULEE' AND OLD.status <> 'ANNULEE')
BEGIN
  SELECT RAISE(ABORT, 'Modification interdite : un document validé est juridiquement figé (§20). Utilisez l''annulation ou un avoir.');
END;

-- ------------------------------------------------------------
-- Lignes (§13)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  nature TEXT NOT NULL DEFAULT 'VENTE' CHECK (nature IN ('VENTE','FRAIS','REMISE')),
  product_ref TEXT,
  designation TEXT NOT NULL,
  description TEXT,
  qty REAL NOT NULL CHECK (qty > 0),
  unite TEXT NOT NULL DEFAULT 'unité',
  pu_ht_cents INTEGER NOT NULL CHECK (pu_ht_cents >= 0),
  remise_pct REAL NOT NULL DEFAULT 0,
  tax_code TEXT NOT NULL,
  tax_rate_pct_snapshot REAL NOT NULL,        -- snapshot du taux (§10)
  tax_libelle_snapshot TEXT NOT NULL,
  motif_exoneration TEXT,
  ht_cents INTEGER NOT NULL,                  -- montants calculés, stockés
  tva_cents INTEGER NOT NULL,
  ttc_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);

-- ------------------------------------------------------------
-- Paiements (§19)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  mode TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference TEXT,
  banque TEXT,
  numero_cheque TEXT,
  commentaire TEXT,
  created_by INTEGER REFERENCES users(id),
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ------------------------------------------------------------
-- Avoirs (§22) — traçabilité supplémentaire de la référence croisée
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avoir_invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
  origin_invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  motif TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Pièces jointes (§61) — fichiers stockés dans Documents/, jamais en ligne
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,        -- chemin local relatif au dossier Documents/
  mime TEXT,
  size_bytes INTEGER,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Journal d'audit (§34) — append-only
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id),
  username TEXT,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  details TEXT,
  old_value TEXT,
  new_value TEXT,
  workstation TEXT               -- poste local si disponible (§34)
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);

-- ------------------------------------------------------------
-- Paramètres, modèles, configuration légale (§5, §74)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  name TEXT NOT NULL,
  content_json TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS legal_configuration (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  reference_text TEXT,          -- ex : décret exécutif n° 05-468 du 10/12/2005
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS legal_configuration_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  motif TEXT,
  user_id INTEGER REFERENCES users(id),
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Historique des sauvegardes (§30)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL CHECK (kind IN ('AUTO','MANUELLE','SECURITE','AVANT_MIGRATION')),
  label TEXT,
  file_path TEXT,
  size_bytes INTEGER,
  count_invoices INTEGER,
  count_customers INTEGER,
  count_products INTEGER,
  schema_version INTEGER NOT NULL
);

-- ------------------------------------------------------------
-- Données par défaut : référentiel TVA (§10) + configuration initiale
-- ------------------------------------------------------------
INSERT OR IGNORE INTO tax_rates (code, libelle, rate_pct, date_debut, actif, description, reference_reglementaire) VALUES
  ('TVA19', 'TVA 19 %', 19, '2000-01-01', 1, 'Taux normal de TVA.', 'Code des TCA — valeur configurable'),
  ('TVA9',  'TVA 9 %',   9, '2000-01-01', 1, 'Taux réduit de TVA.', 'Code des TCA — valeur configurable'),
  ('EXO',   'Exonéré',   0, '2000-01-01', 1, 'Opération exonérée (motif requis).', 'Dispositions légales applicables');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('schema_version', '1'),
  ('auto_backup_frequency', 'DAILY'),
  ('auto_backup_retention', '10'),
  ('lock_timeout_minutes', '15'),
  ('validation_nif', 'WARN'),
  ('validation_nis', 'WARN'),
  ('validation_rc', 'WARN'),
  ('validation_ai', 'WARN');

INSERT OR IGNORE INTO legal_configuration (key, value, effective_date, reference_text) VALUES
  ('facture_mentions', 'Mentions obligatoires vendeur/acheteur', '2005-12-10',
   'Décret exécutif n° 05-468 du 10 décembre 2005 fixant les conditions et modalités d''établissement de la facture, du bon de transfert, du bon de livraison et de la facture récapitulative.');

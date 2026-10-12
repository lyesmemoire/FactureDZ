-- Migration 0006 : achats — fournisseurs et bons de commande (BC).
-- Non destructive : tables nouvelles ; la série de numérotation accepte désormais « BC ».

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  denomination TEXT NOT NULL,
  nom_commercial TEXT,
  adresse TEXT,
  wilaya TEXT,
  commune TEXT,
  telephone TEXT,
  email TEXT,
  contact_principal TEXT,
  rc TEXT,
  nif TEXT,
  nis TEXT,
  article_imposition TEXT,
  conditions_paiement_jours INTEGER,
  observations TEXT,
  actif INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  number TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('BROUILLON', 'ENVOYE', 'RECU_PARTIEL', 'RECU', 'ANNULE')),
  date TEXT NOT NULL,
  date_livraison TEXT,
  devise TEXT NOT NULL DEFAULT 'DZD',
  mode_paiement TEXT,
  conditions_paiement TEXT,
  lieu_livraison TEXT,
  observations TEXT,
  supplier_snapshot_json TEXT NOT NULL DEFAULT '{}',
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  total_tva_cents INTEGER NOT NULL DEFAULT 0,
  total_ttc_cents INTEGER NOT NULL DEFAULT 0,
  montant_lettres TEXT,
  vat_detail_json TEXT NOT NULL DEFAULT '[]',
  sent_at TEXT,
  cancelled_at TEXT,
  cancel_motif TEXT,
  created_by INTEGER REFERENCES users(id),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_ref TEXT,
  designation TEXT NOT NULL,
  unite TEXT,
  qty REAL NOT NULL,
  qty_recue REAL NOT NULL DEFAULT 0 CHECK (qty_recue >= 0),
  pu_ht_cents INTEGER NOT NULL,
  remise_pct REAL NOT NULL DEFAULT 0,
  tax_code TEXT,
  tax_rate_pct_snapshot REAL NOT NULL DEFAULT 0,
  ht_cents INTEGER NOT NULL DEFAULT 0,
  tva_cents INTEGER NOT NULL DEFAULT 0,
  ttc_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (po_id, line_no)
);

-- Reconstruction de invoice_sequences pour accepter la série « BC ».
CREATE TABLE invoice_sequences_v6 (
  doc_type TEXT NOT NULL CHECK (doc_type IN ('FAC','DEV','PRO','BL','AVOIR','BC')),
  year INTEGER NOT NULL CHECK (year >= 2000),
  template TEXT NOT NULL,
  padding INTEGER NOT NULL DEFAULT 6,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  PRIMARY KEY (doc_type, year)
);
INSERT INTO invoice_sequences_v6 (doc_type, year, template, padding, counter)
  SELECT doc_type, year, template, padding, counter FROM invoice_sequences;
DROP TABLE invoice_sequences;
ALTER TABLE invoice_sequences_v6 RENAME TO invoice_sequences;

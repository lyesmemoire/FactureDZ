-- ============================================================
-- FacturationDZ — Migration 0002
-- Synchronisation frontend ↔ SQLite (desktop_ids), authentification
-- Argon2 (sessions), autres taxes (§10), pièces jointes.
-- Jamais destructive (§51).
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Correspondance identifiants frontend (chaînes) ↔ SQLite (INTEGER).
-- Le frontend reste source de vérité pour l'UI ; SQLite est la base
-- durable desktop. Chaque entité mirrorée possède un desktop_id stable.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS desktop_ids (
  entity TEXT NOT NULL,
  local_id TEXT NOT NULL,
  desktop_id INTEGER NOT NULL,
  PRIMARY KEY (entity, local_id)
);
CREATE INDEX IF NOT EXISTS idx_desktop_ids_desktop ON desktop_ids(entity, desktop_id);

-- ------------------------------------------------------------
-- Moteur fiscal étendu (§10) : TVA + autres taxes/droits/contributions.
-- kind = TVA (comportement historique) ou AUTRE (taxe additionnelle
-- calculée sur le HT ligne, agrégée séparément dans les totaux).
-- ------------------------------------------------------------
ALTER TABLE tax_rates ADD COLUMN kind TEXT NOT NULL DEFAULT 'TVA' CHECK (kind IN ('TVA','AUTRE'));
ALTER TABLE invoice_items ADD COLUMN tax_kind_snapshot TEXT NOT NULL DEFAULT 'TVA' CHECK (tax_kind_snapshot IN ('TVA','AUTRE'));
ALTER TABLE invoices ADD COLUMN total_other_taxes_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN other_tax_detail_json TEXT NOT NULL DEFAULT '[]';

-- Les avoirs et documents créés avant cette migration restent valides :
-- toutes les colonnes ajoutées ont une valeur par défaut sûre.

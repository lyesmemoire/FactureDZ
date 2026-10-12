-- Migration 0003 : révisions de devis et liens documentaires persistés.
-- Non destructive : ajoute une colonne nullable + index. Aucune donnée modifiée.
-- origin_doc_number = numéro du document d'origine (devis → révision,
-- devis → facture converti, facture → avoir). Stable, car un numéro validé
-- ne change jamais.
ALTER TABLE invoices ADD COLUMN origin_doc_number TEXT;
CREATE INDEX IF NOT EXISTS idx_invoices_origin_doc ON invoices(origin_doc_number);

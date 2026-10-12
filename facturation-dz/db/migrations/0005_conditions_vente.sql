-- Migration 0005 : conditions de vente facultatives des devis.
-- Non destructive : colonne ajoutée, NULL par défaut (aucun document existant modifié).
ALTER TABLE invoices ADD COLUMN conditions_vente TEXT;

-- Migration 0004 : taux de TVA par défaut de la société (paramètres).
-- Non destructive : colonne ajoutée avec valeur par défaut TVA19 (comportement inchangé
-- pour les installations existantes). Aucune donnée de document modifiée.
ALTER TABLE companies ADD COLUMN tax_code_defaut TEXT NOT NULL DEFAULT 'TVA19';

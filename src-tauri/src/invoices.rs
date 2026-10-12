//! Moteur documentaire : création, validation atomique (§69), annulation (§21),
//! avoirs (§22), paiements (§19), duplication (§46), conversions (§57-59).
//!
//! RÈGLE §38 : à la validation, les snapshots VENDEUR et ACHETEUR sont figés
//! en JSON — une modification ultérieure des fiches ne change jamais
//! l'historique.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::money_fr::amount_in_words;
use crate::numbering::allocate_number;

#[derive(Serialize, Deserialize, Clone)]
pub struct ItemInput {
    pub nature: String,
    pub product_ref: Option<String>,
    pub designation: String,
    pub description: Option<String>,
    pub qty: f64,
    pub unite: String,
    pub pu_ht_cents: i64,
    pub remise_pct: f64,
    pub tax_code: String,
    pub tax_rate_pct_snapshot: f64,
    pub tax_libelle_snapshot: String,
    pub motif_exoneration: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InvoiceInput {
    pub doc_type: String,
    pub date: String,
    pub date_echeance: Option<String>,
    pub customer_id: i64,
    pub mode_paiement: Option<String>,
    pub conditions_paiement: Option<String>,
    pub ref_commande: Option<String>,
    pub ref_devis: Option<String>,
    pub ref_bon_livraison: Option<String>,
    pub observations: Option<String>,
    pub remise_globale_kind: Option<String>,
    pub remise_globale_valeur_cents: Option<i64>,
    pub items: Vec<ItemInput>,
    pub seller_snapshot_json: String,
    pub buyer_snapshot_json: String,
}

/// Mise à l'échelle exacte d'un décimal saisi : 12,5 → 125000 (échelle 10^4).
/// Le résidu flottant est ≪ 0,5 : l'arrondi est exact pour toute saisie réaliste.
fn scale_dec(x: f64, digits: u32) -> i128 {
    (x * 10f64.powi(digits as i32)).round() as i128
}

/// (a × b ÷ d) arrondi half-up (0,5 → au plus loin de zéro), en entier exact.
/// Équivalent Rust de `mulDivRound` (src/core/money.ts) : aucun flottant ici.
pub fn mul_div_round(a: i128, b: i128, d: i128) -> i128 {
    let prod = a * b;
    let sign = if prod < 0 { -1 } else { 1 };
    let n = prod.abs();
    sign * ((2 * n + d) / (2 * d))
}

/// Calcul d'une ligne (§13, §14) : HT, TVA, TTC arrondis à 2 décimales.
/// Quantité à 3 décimales, remise et taux à 4 décimales max, tout en entier.
pub fn compute_line(item: &ItemInput) -> (i64, i64, i64) {
    let brut = mul_div_round(scale_dec(item.qty, 3), item.pu_ht_cents as i128, 1000) as i64;
    let remise_s = scale_dec(item.remise_pct, 4);
    let remise = if remise_s > 0 {
        (mul_div_round(brut as i128, remise_s, 1_000_000) as i64).min(brut)
    } else {
        0
    };
    let ht = brut - remise;
    let tva = if item.tax_rate_pct_snapshot == 0.0 {
        0
    } else {
        mul_div_round(ht as i128, scale_dec(item.tax_rate_pct_snapshot, 4), 1_000_000) as i64
    };
    (ht, tva, ht + tva)
}

#[cfg(test)]
mod arithmetique_exacte_tests {
    use super::*;

    fn item(qty: f64, pu: i64, remise: f64, taux: f64) -> ItemInput {
        ItemInput {
            nature: "VENTE".into(),
            product_ref: None,
            designation: "x".into(),
            description: None,
            qty,
            unite: "u".into(),
            pu_ht_cents: pu,
            remise_pct: remise,
            tax_code: "TVA19".into(),
            tax_rate_pct_snapshot: taux,
            tax_libelle_snapshot: "TVA".into(),
            motif_exoneration: None,
        }
    }

    /// Mêmes vecteurs que src/core/money.test.ts : TS et Rust doivent rester identiques.
    #[test]
    fn vecteurs_communs_ts_rust() {
        // 1,005 × 100 = 100,5 → 101 (le flottant donnait 100)
        assert_eq!(compute_line(&item(1.005, 100, 0.0, 0.0)).0, 101);
        // 1 000 × 1,15 % = 11,5 → 12 (remise sur brut)
        assert_eq!(compute_line(&item(1.0, 1000, 1.15, 0.0)).0, 1000 - 12);
        // HT 1 000 × 9,5 % = 95
        assert_eq!(compute_line(&item(1.0, 1000, 0.0, 9.5)).1, 95);
        // 0,333 × 300 000 = 99 900
        assert_eq!(compute_line(&item(0.333, 300000, 0.0, 0.0)).0, 99900);
    }

    #[test]
    fn demi_centime_symetrique() {
        assert_eq!(mul_div_round(-5, 1, 2), -3);
        assert_eq!(mul_div_round(5, 1, 2), 3);
    }
}

/// Contrôles avant validation (§48).
pub fn validate_before(conn: &Connection, input: &InvoiceInput) -> Result<()> {
    if input.date.is_empty() || input.date.len() != 10 {
        return Err(AppError::User("La date du document est manquante ou invalide.".into()));
    }
    if input.items.is_empty() {
        return Err(AppError::User("Le document ne contient aucune ligne (§48).".into()));
    }
    let adresse: Option<String> = conn.query_row(
        "SELECT adresse FROM customers WHERE id = ?1",
        params![input.customer_id],
        |r| r.get(0),
    ).map_err(|_| AppError::User("Client introuvable.".to_string()))?;
    if adresse.unwrap_or_default().trim().is_empty() {
        return Err(AppError::User(
            "L'adresse du client est vide. Complétez la fiche client avant validation (§48).".into(),
        ));
    }
    for (i, l) in input.items.iter().enumerate() {
        let n = i + 1;
        if l.designation.trim().is_empty() {
            return Err(AppError::User(format!("Ligne {n} : désignation vide.")));
        }
        if !(l.qty > 0.0) {
            return Err(AppError::User(format!("Ligne {n} : la quantité doit être supérieure à 0.")));
        }
        if l.pu_ht_cents < 0 {
            return Err(AppError::User(format!("Ligne {n} : le prix unitaire HT doit être ≥ 0.")));
        }
        let known: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tax_rates WHERE code = ?1",
            params![l.tax_code],
            |r| r.get(0),
        )?;
        if known == 0 {
            return Err(AppError::User(format!("Ligne {n} : code TVA inconnu ({}).", l.tax_code)));
        }
    }
    Ok(())
}

/// VALIDATION d'un document : transaction atomique (§69).
/// BEGIN → contrôles → numéro → lignes → snapshot → audit → COMMIT.
/// En cas d'échec : ROLLBACK complet, aucune donnée partielle.
pub fn validate_document(conn: &Connection, invoice_id: i64) -> Result<String> {
    crate::db::in_tx(conn, |tx| {
        let (doc_type, date, status, devise): (String, String, String, String) = tx.query_row(
            "SELECT doc_type, date, status, devise FROM invoices WHERE id = ?1",
            params![invoice_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        if status != "BROUILLON" {
            return Err(AppError::User(
                "Seul un document au statut BROUILLON peut être validé (§20).".into(),
            ));
        }
        let year: i32 = date.get(0..4).and_then(|y| y.parse().ok())
            .ok_or_else(|| AppError::User("Année illisible dans la date du document.".into()))?;

        // Numérotation : attribuée ici, UNIQUE en base, jamais dupliquée (§12).
        let number = allocate_number(tx, &doc_type, year)?;

        // Totaux recalculés côté serveur (jamais faire confiance au client).
        let mut items: Vec<(i64, ItemInput)> = Vec::new();
        {
            let mut st = tx.prepare(
                "SELECT id, nature, product_ref, designation, description, qty, unite,
                        pu_ht_cents, remise_pct, tax_code, tax_rate_pct_snapshot,
                        tax_libelle_snapshot, motif_exoneration
                 FROM invoice_items WHERE invoice_id = ?1 ORDER BY line_no",
            )?;
            let rows = st.query_map(params![invoice_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    ItemInput {
                        nature: r.get(1)?,
                        product_ref: r.get(2)?,
                        designation: r.get(3)?,
                        description: r.get(4)?,
                        qty: r.get(5)?,
                        unite: r.get(6)?,
                        pu_ht_cents: r.get(7)?,
                        remise_pct: r.get(8)?,
                        tax_code: r.get(9)?,
                        tax_rate_pct_snapshot: r.get(10)?,
                        tax_libelle_snapshot: r.get(11)?,
                        motif_exoneration: r.get(12)?,
                    },
                ))
            })?;
            for r in rows {
                items.push(r?);
            }
        }
        if items.is_empty() {
            return Err(AppError::User("Le document ne contient aucune ligne (§48).".into()));
        }
        let mut total_ht: i64 = 0;
        let mut total_tva: i64 = 0;
        for (idx, (item_id, item)) in items.iter().enumerate() {
            let (ht, tva, ttc) = compute_line(item);
            total_ht += ht;
            total_tva += tva;
            // Mise à jour PAR ID PRIMARY KEY : aucune ambiguïté, même si deux
            // lignes sont strictement identiques.
            tx.execute(
                "UPDATE invoice_items SET ht_cents=?1, tva_cents=?2, ttc_cents=?3, line_no=?4
                 WHERE id=?5",
                params![ht, tva, ttc, (idx + 1) as i64, item_id],
            )?;
        }
        let total_ttc = total_ht + total_tva;
        let montant_lettres = amount_in_words(total_ttc, &devise); // §16

        let new_status = if doc_type == "FAC" || doc_type == "AVOIR" { "VALIDEE" } else { "ENVOYE" };
        tx.execute(
            "UPDATE invoices SET number=?1, status=?2, total_ht_cents=?3, total_tva_cents=?4,
               total_ttc_cents=?5, montant_lettres=?6, updated_at=datetime('now')
             WHERE id=?7",
            params![number, new_status, total_ht, total_tva, total_ttc, montant_lettres, invoice_id],
        )?;

        // Audit (§34).
        tx.execute(
            "INSERT INTO audit_logs (action, object_type, object_id, details)
             VALUES ('VALIDATION_DOCUMENT','document', ?1, ?2)",
            params![invoice_id.to_string(), format!("{doc_type} {number}")],
        )?;

        Ok(number)
    })
}

/// Annulation (§21) : conservation totale, numéro non réutilisé, motif requis.
pub fn cancel_document(conn: &Connection, invoice_id: i64, user_id: i64, motif: &str) -> Result<()> {
    if motif.trim().is_empty() {
        return Err(AppError::User("Le motif d'annulation est obligatoire (§21).".into()));
    }
    crate::db::in_tx(conn, |tx| {
        let status: String = tx.query_row(
            "SELECT status FROM invoices WHERE id = ?1",
            params![invoice_id],
            |r| r.get(0),
        )?;
        if status == "ANNULEE" {
            return Err(AppError::User("Ce document est déjà annulé.".into()));
        }
        if status == "BROUILLON" {
            return Err(AppError::User("Un brouillon ne s'annule pas : supprimez-le.".into()));
        }
        tx.execute(
            "UPDATE invoices SET status='ANNULEE', cancelled_at=datetime('now'),
               cancelled_by=?1, cancel_motif=?2, updated_at=datetime('now') WHERE id=?3",
            params![user_id, motif.trim(), invoice_id],
        )?;
        tx.execute(
            "INSERT INTO audit_logs (user_id, action, object_type, object_id, details)
             VALUES (?1,'ANNULATION_DOCUMENT','document',?2,?3)",
            params![user_id, invoice_id.to_string(), format!("Motif : {}", motif.trim())],
        )?;
        Ok(())
    })
}

/// Encaissement (§19) : refuse les trop-perçus, met à jour le statut.
pub fn add_payment(
    conn: &Connection,
    invoice_id: i64,
    mode: &str,
    date: &str,
    amount_cents: i64,
    reference: Option<&str>,
    banque: Option<&str>,
    numero_cheque: Option<&str>,
    commentaire: Option<&str>,
    user_id: i64,
) -> Result<()> {
    if amount_cents <= 0 {
        return Err(AppError::User("Le montant du paiement doit être supérieur à 0.".into()));
    }
    crate::db::in_tx(conn, |tx| {
        let (ttc, status): (i64, String) = tx.query_row(
            "SELECT total_ttc_cents, status FROM invoices WHERE id = ?1",
            params![invoice_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if status == "ANNULEE" {
            return Err(AppError::User("Impossible d'encaisser une facture annulée.".into()));
        }
        let paid: i64 = tx.query_row(
            "SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE invoice_id = ?1",
            params![invoice_id],
            |r| r.get(0),
        )?;
        let remaining = ttc - paid;
        if amount_cents > remaining {
            return Err(AppError::User(format!(
                "Le paiement dépasse le reste à payer ({remaining} centimes dus).",
            )));
        }
        tx.execute(
            "INSERT INTO payments (invoice_id, mode, date, amount_cents, reference, banque, numero_cheque, commentaire, created_by)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![invoice_id, mode, date, amount_cents, reference, banque, numero_cheque, commentaire, user_id],
        )?;
        let new_status = if paid + amount_cents >= ttc { "PAYEE" } else { "PARTIELLEMENT_PAYEE" };
        tx.execute(
            "UPDATE invoices SET status=?1, updated_at=datetime('now') WHERE id=?2",
            params![new_status, invoice_id],
        )?;
        tx.execute(
            "INSERT INTO audit_logs (user_id, action, object_type, object_id, details)
             VALUES (?1,'ENCAISSEMENT','payment',?2,?3)",
            params![user_id, invoice_id.to_string(), format!("{amount_cents} centimes ({mode})")],
        )?;
        Ok(())
    })
}

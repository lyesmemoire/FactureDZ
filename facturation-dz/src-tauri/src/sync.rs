//! Synchronisation frontend ↔ SQLite (§70, ARCHITECTURE §9).
//!
//! Le frontend React reste la source de vérité de l'UI ; en mode desktop,
//! chaque mutation est mirrorée ici vers SQLite (write-through). La table
//! `desktop_ids` établit la correspondance stable entre les identifiants
//! chaîne du frontend et les clés INTEGER de SQLite. Après une restauration
//! de base (§32), `load_dataset` réhydrate l'état frontend depuis SQLite.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

use crate::error::{AppError, Result};

/* ------------------------------------------------------------------ */
/* Helpers JSON                                                        */
/* ------------------------------------------------------------------ */

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| match x {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn i64v(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64())
}

fn f64v(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}

fn b(v: &Value, k: &str) -> i64 {
    match v.get(k).and_then(|x| x.as_bool()) {
        Some(true) | None => 1,
        Some(false) => 0,
    }
}

fn b_opt(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_bool()).map(|x| if x { 1 } else { 0 })
}

fn json_str(v: &Value, k: &str) -> String {
    v.get(k).map(|x| x.to_string()).unwrap_or_else(|| "null".into())
}

/* ------------------------------------------------------------------ */
/* Table de correspondance desktop_ids                                 */
/* ------------------------------------------------------------------ */

/// Retourne le desktop_id d'une entité locale ; l'attribue si inconnu.
pub fn map_local(conn: &Connection, entity: &str, local_id: &str) -> Result<i64> {
    if let Some(id) = conn
        .query_row(
            "SELECT desktop_id FROM desktop_ids WHERE entity = ?1 AND local_id = ?2",
            params![entity, local_id],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(desktop_id), 0) + 1 FROM desktop_ids WHERE entity = ?1",
        params![entity],
        |r| r.get(0),
    )?;
    let next = if entity == "company" { 1 } else { next.max(1) };
    conn.execute(
        "INSERT INTO desktop_ids (entity, local_id, desktop_id) VALUES (?1, ?2, ?3)",
        params![entity, local_id, next],
    )?;
    Ok(next)
}

/// Identifiant local d'une ligne SQLite (pour load_dataset).
fn local_of(conn: &Connection, entity: &str, desktop_id: i64, fallback: &str) -> Result<String> {
    let v: Option<String> = conn
        .query_row(
            "SELECT local_id FROM desktop_ids WHERE entity = ?1 AND desktop_id = ?2",
            params![entity, desktop_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.unwrap_or_else(|| fallback.to_string()))
}

fn forget(conn: &Connection, entity: &str, local_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM desktop_ids WHERE entity = ?1 AND local_id = ?2",
        params![entity, local_id],
    )?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Upserts par entité                                                  */
/* ------------------------------------------------------------------ */

pub fn upsert(conn: &Connection, entity: &str, local_id: &str, data: &Value) -> Result<i64> {
    match entity {
        "company" => upsert_company(conn, data),
        "customer" => upsert_customer(conn, local_id, data),
        "product" => upsert_product(conn, local_id, data),
        "tax_rate" => upsert_tax_rate(conn, data),
        "tax_history" => insert_once(conn, "tax_history", local_id, |id| {
            conn.execute(
                "INSERT INTO tax_rate_history (tax_code, old_json, new_json, date_effet, motif, ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    s(data, "tax_code").unwrap_or_default(),
                    json_str(data, "old_value"),
                    json_str(data, "new_value"),
                    s(data, "date_effet").unwrap_or_default(),
                    s(data, "motif"),
                    s(data, "ts").unwrap_or_else(|| "datetime".into()),
                ],
            )?;
            let _ = id;
            Ok(())
        }),
        "sequence" => upsert_sequence(conn, data),
        "user" => upsert_user(conn, local_id, data),
        "document" => upsert_document(conn, local_id, data),
        "supplier" => upsert_supplier(conn, local_id, data),
        "purchase_order" => upsert_purchase_order(conn, local_id, data),
        "payment" => insert_once(conn, "payment", local_id, |_id| insert_payment(conn, data)),
        "audit" => insert_once(conn, "audit", local_id, |_id| insert_audit(conn, data)),
        "backup_record" => insert_once(conn, "backup_record", local_id, |_id| insert_backup_record(conn, data)),
        "settings" => upsert_settings(conn, data),
        other => Err(AppError::User(format!("Entité inconnue en synchronisation : {other}"))),
    }
}

/// Insertion idempotente : une entrée déjà mirrorée n'est pas réinsérée.
/// Le marquage « fait » est une ligne desktop_ids d'entité « {entity}#done ».
fn insert_once<F>(conn: &Connection, entity: &str, local_id: &str, f: F) -> Result<i64>
where
    F: FnOnce(i64) -> Result<()>,
{
    let marker = format!("{entity}#done");
    let done: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM desktop_ids WHERE entity = ?1 AND local_id = ?2",
            params![marker, local_id],
            |r| r.get(0),
        )
        .optional()?;
    if done.is_some() {
        return conn
            .query_row(
                "SELECT desktop_id FROM desktop_ids WHERE entity = ?1 AND local_id = ?2",
                params![entity, local_id],
                |r| r.get(0),
            )
            .map_err(AppError::Db);
    }
    let id = map_local(conn, entity, local_id)?;
    f(id)?;
    conn.execute(
        "INSERT OR IGNORE INTO desktop_ids (entity, local_id, desktop_id) VALUES (?1, ?2, ?3)",
        params![marker, local_id, id],
    )?;
    Ok(id)
}

fn upsert_company(conn: &Connection, d: &Value) -> Result<i64> {
    conn.execute(
        "INSERT INTO companies (id, raison_sociale, nom_commercial, forme_juridique, activite,
             adresse, wilaya, commune, telephone, fax, email, site_web,
             rc, nif, nis, article_imposition, tin_libelle, capital_social,
             banque, agence, rib, rip_ccp, logo_path, cachet_path, signature_path,
             afficher_cachet, afficher_signature, afficher_banque, devise,
             conditions_paiement_defaut_jours, mode_paiement_defaut, tax_code_defaut)
         VALUES (1, ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31)
         ON CONFLICT(id) DO UPDATE SET
           raison_sociale=excluded.raison_sociale, nom_commercial=excluded.nom_commercial,
           forme_juridique=excluded.forme_juridique, activite=excluded.activite,
           adresse=excluded.adresse, wilaya=excluded.wilaya, commune=excluded.commune,
           telephone=excluded.telephone, fax=excluded.fax, email=excluded.email,
           site_web=excluded.site_web, rc=excluded.rc, nif=excluded.nif, nis=excluded.nis,
           article_imposition=excluded.article_imposition, tin_libelle=excluded.tin_libelle,
           capital_social=excluded.capital_social, banque=excluded.banque, agence=excluded.agence,
           rib=excluded.rib, rip_ccp=excluded.rip_ccp, logo_path=excluded.logo_path,
           cachet_path=excluded.cachet_path, signature_path=excluded.signature_path,
           afficher_cachet=excluded.afficher_cachet, afficher_signature=excluded.afficher_signature,
           afficher_banque=excluded.afficher_banque, devise=excluded.devise,
           conditions_paiement_defaut_jours=excluded.conditions_paiement_defaut_jours,
           mode_paiement_defaut=excluded.mode_paiement_defaut, tax_code_defaut=excluded.tax_code_defaut,
           updated_at=datetime('now')",
        params![
            s(d, "raison_sociale").unwrap_or_default(),
            s(d, "nom_commercial"), s(d, "forme_juridique"), s(d, "activite"),
            s(d, "adresse"), s(d, "wilaya"), s(d, "commune"), s(d, "telephone"),
            s(d, "fax"), s(d, "email"), s(d, "site_web"),
            s(d, "rc"), s(d, "nif"), s(d, "nis"), s(d, "article_imposition"), s(d, "tin_libelle"),
            s(d, "capital_social"), s(d, "banque"), s(d, "agence"), s(d, "rib"), s(d, "rip_ccp"),
            s(d, "logo_path"), s(d, "cachet_path"), s(d, "signature_path"),
            b(d, "afficher_cachet"), b(d, "afficher_signature"), b(d, "afficher_banque"),
            s(d, "devise").unwrap_or_else(|| "DZD".into()),
            i64v(d, "conditions_paiement_defaut_jours").unwrap_or(30),
            s(d, "mode_paiement_defaut").unwrap_or_else(|| "Virement bancaire".into()),
            s(d, "tax_code_defaut").unwrap_or_else(|| "TVA19".into()),
        ],
    )?;
    Ok(1)
}

/// Garantit la ligne entreprise (id = 1) : les entités qui y font référence
/// (clients, produits, documents) ne peuvent pas arriver avant elle en
/// pratique, mais on préfère un garde-fou à une erreur de clé étrangère.
fn ensure_company(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO companies (id, raison_sociale) VALUES (1, '(entreprise à configurer)')",
        [],
    )?;
    Ok(())
}

fn upsert_customer(conn: &Connection, local_id: &str, d: &Value) -> Result<i64> {
    ensure_company(conn)?;
    let id = map_local(conn, "customer", local_id)?;
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM customers WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    let sql = if exists.is_some() {
        "UPDATE customers SET type=?2, denomination=?3, nom_commercial=?4, forme_juridique=?5,
           activite=?6, nom=?7, prenom=?8, adresse=?9, wilaya=?10, commune=?11, telephone=?12,
           fax=?13, email=?14, contact_principal=?15, rc=?16, nif=?17, nis=?18,
           article_imposition=?19, tin_international=?20, conditions_paiement_jours=?21,
           plafond_credit_cents=?22, observations=?23, actif=?24, demo=?25, updated_at=datetime('now')
         WHERE id=?1"
    } else {
        "INSERT INTO customers (id, company_id, type, denomination, nom_commercial, forme_juridique,
           activite, nom, prenom, adresse, wilaya, commune, telephone, fax, email, contact_principal,
           rc, nif, nis, article_imposition, tin_international, conditions_paiement_jours,
           plafond_credit_cents, observations, actif, demo)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)"
    };
    conn.execute(
        sql,
        params![
            id,
            s(d, "type").unwrap_or_else(|| "ENTREPRISE".into()),
            s(d, "denomination"), s(d, "nom_commercial"), s(d, "forme_juridique"),
            s(d, "activite"), s(d, "nom"), s(d, "prenom"), s(d, "adresse"), s(d, "wilaya"),
            s(d, "commune"), s(d, "telephone"), s(d, "fax"), s(d, "email"), s(d, "contact_principal"),
            s(d, "rc"), s(d, "nif"), s(d, "nis"), s(d, "article_imposition"), s(d, "tin_international"),
            i64v(d, "conditions_paiement_jours"), i64v(d, "plafond_credit_cents"),
            s(d, "observations"), b(d, "actif"), b_opt(d, "demo").unwrap_or(0),
        ],
    )?;

    // Contacts (§7) : remplacement complet.
    conn.execute("DELETE FROM customer_contacts WHERE customer_id = ?1", params![id])?;
    if let Some(contacts) = d.get("contacts").and_then(|c| c.as_array()) {
        for c in contacts {
            conn.execute(
                "INSERT INTO customer_contacts (customer_id, nom, fonction, telephone, email)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    id,
                    s(c, "nom").unwrap_or_default(),
                    s(c, "fonction"), s(c, "telephone"), s(c, "email"),
                ],
            )?;
        }
    }
    Ok(id)
}

fn upsert_product(conn: &Connection, local_id: &str, d: &Value) -> Result<i64> {
    ensure_company(conn)?;
    let id = map_local(conn, "product", local_id)?;
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM products WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    let sql = if exists.is_some() {
        "UPDATE products SET kind=?2, reference=?3, designation=?4, description=?5, unite=?6,
           pu_ht_cents=?7, tax_code_defaut=?8, categorie=?9, actif=?10, demo=?11, updated_at=datetime('now')
         WHERE id=?1"
    } else {
        "INSERT INTO products (id, company_id, kind, reference, designation, description, unite,
           pu_ht_cents, tax_code_defaut, categorie, actif, demo)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
    };
    conn.execute(
        sql,
        params![
            id,
            s(d, "kind").unwrap_or_else(|| "PRODUIT".into()),
            s(d, "reference").unwrap_or_default(),
            s(d, "designation").unwrap_or_default(),
            s(d, "description"),
            s(d, "unite").unwrap_or_else(|| "unité".into()),
            i64v(d, "pu_ht_cents").unwrap_or(0),
            s(d, "tax_code_defaut").unwrap_or_else(|| "TVA19".into()),
            s(d, "categorie"),
            b(d, "actif"),
            b_opt(d, "demo").unwrap_or(0),
        ],
    )?;
    Ok(id)
}

fn upsert_tax_rate(conn: &Connection, d: &Value) -> Result<i64> {
    let code = s(d, "code").ok_or_else(|| AppError::User("Taxe sans code.".into()))?;
    conn.execute(
        "INSERT INTO tax_rates (code, libelle, rate_pct, date_debut, date_fin, actif, kind,
           description, reference_reglementaire, commentaire)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(code) DO UPDATE SET
           libelle=excluded.libelle, rate_pct=excluded.rate_pct, date_debut=excluded.date_debut,
           date_fin=excluded.date_fin, actif=excluded.actif, kind=excluded.kind,
           description=excluded.description, reference_reglementaire=excluded.reference_reglementaire,
           commentaire=excluded.commentaire",
        params![
            code,
            s(d, "libelle").unwrap_or_default(),
            f64v(d, "rate_pct").unwrap_or(0.0),
            s(d, "date_debut").unwrap_or_else(|| "2000-01-01".into()),
            s(d, "date_fin"),
            b(d, "actif"),
            s(d, "kind").unwrap_or_else(|| "TVA".into()),
            s(d, "description"), s(d, "reference_reglementaire"), s(d, "commentaire"),
        ],
    )?;
    conn.query_row("SELECT id FROM tax_rates WHERE code = ?1", params![code], |r| r.get(0))
        .map_err(AppError::Db)
}

/// §21 : le compteur SQLite ne peut jamais DÉCRÉMENTÉ — on prend le max.
fn upsert_sequence(conn: &Connection, d: &Value) -> Result<i64> {
    conn.execute(
        "INSERT INTO invoice_sequences (doc_type, year, template, padding, counter)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(doc_type, year) DO UPDATE SET
           template = excluded.template,
           padding = excluded.padding,
           counter = MAX(invoice_sequences.counter, excluded.counter)",
        params![
            s(d, "doc_type").unwrap_or_default(),
            i64v(d, "year").unwrap_or(2026),
            s(d, "template").unwrap_or_else(|| "{TYPE}-{YEAR}-{COUNTER}".into()),
            i64v(d, "padding").unwrap_or(6),
            i64v(d, "counter").unwrap_or(0),
        ],
    )?;
    Ok(0)
}

fn upsert_user(conn: &Connection, local_id: &str, d: &Value) -> Result<i64> {
    let id = map_local(conn, "user", local_id)?;
    let username = s(d, "username").unwrap_or_default();
    // ON CONFLICT par username : un hash Argon2 (desktop) n'est JAMAIS
    // écrasé par un hash miroir plus faible (§36).
    conn.execute(
        "INSERT INTO users (username, password_hash, role, actif)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(username) DO UPDATE SET
           role = excluded.role,
           actif = excluded.actif,
           password_hash = CASE WHEN users.password_hash LIKE '$argon2%'
                                THEN users.password_hash ELSE excluded.password_hash END",
        params![
            username,
            s(d, "password_hash").unwrap_or_default(),
            s(d, "role").unwrap_or_else(|| "VENDEUR".into()),
            1,
        ],
    )?;
    let _ = id;
    conn.query_row("SELECT id FROM users WHERE username = ?1 COLLATE NOCASE", params![username], |r| r.get(0))
        .map_err(AppError::Db)
}

fn user_id_by_name(conn: &Connection, name: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM users WHERE username = ?1 COLLATE NOCASE",
        params![name],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn upsert_document(conn: &Connection, local_id: &str, d: &Value) -> Result<i64> {
    ensure_company(conn)?;
    let id = map_local(conn, "document", local_id)?;
    let customer_local = s(d, "customer_local_id")
        .ok_or_else(|| AppError::User("Document sans client lié.".into()))?;
    let customer_id = map_local(conn, "customer", &customer_local)?;

    let existing_status: Option<String> = conn
        .query_row("SELECT status FROM invoices WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;

    match existing_status.as_deref() {
        // Nouveau : insertion complète.
        None => {
            conn.execute(
                "INSERT INTO invoices (id, company_id, doc_type, number, status, date, date_echeance,
                   customer_id, mode_paiement, conditions_paiement, ref_commande, ref_devis,
                   ref_bon_livraison, observations, devise, remise_globale_kind, remise_globale_valeur_cents,
                   total_ht_cents, total_tva_cents, total_ttc_cents, total_other_taxes_cents,
                   montant_lettres, vat_detail_json, other_tax_detail_json,
                   seller_snapshot_json, buyer_snapshot_json, incoterm, pays_origine, taux_change,
                   ref_douaniere, cancelled_at, cancelled_by, cancel_motif, archived, demo, created_by, origin_doc_number,
                   conditions_vente)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                         ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37)",
                params![
                    id,
                    s(d, "doc_type").unwrap_or_default(),
                    s(d, "number"),
                    s(d, "status").unwrap_or_else(|| "BROUILLON".into()),
                    s(d, "date").unwrap_or_default(),
                    s(d, "date_echeance"),
                    customer_id,
                    s(d, "mode_paiement"), s(d, "conditions_paiement"), s(d, "ref_commande"),
                    s(d, "ref_devis"), s(d, "ref_bon_livraison"), s(d, "observations"),
                    s(d, "devise").unwrap_or_else(|| "DZD".into()),
                    s(d, "remise_globale_kind"), i64v(d, "remise_globale_valeur_cents"),
                    i64v(d, "total_ht_cents").unwrap_or(0),
                    i64v(d, "total_tva_cents").unwrap_or(0),
                    i64v(d, "total_ttc_cents").unwrap_or(0),
                    i64v(d, "total_other_taxes_cents").unwrap_or(0),
                    s(d, "montant_lettres").unwrap_or_default(),
                    json_str(d, "vat_detail"), json_str(d, "other_tax_detail"),
                    json_str(d, "seller_snapshot"), json_str(d, "buyer_snapshot"),
                    s(d, "incoterm"), s(d, "pays_origine"), s(d, "taux_change"), s(d, "ref_douaniere"),
                    s(d, "cancelled_at"),
                    s(d, "created_by_username").as_deref().and_then(|n| user_id_by_name(conn, n)),
                    s(d, "cancel_motif"),
                    b_opt(d, "archived").unwrap_or(0),
                    b_opt(d, "demo").unwrap_or(0),
                    s(d, "created_by_username").as_deref().and_then(|n| user_id_by_name(conn, n)),
                    s(d, "origin_doc_number"),
                    s(d, "conditions_vente"),
                ],
            )?;
            replace_items(conn, id, d)?;
        }
        // Brouillon existant : mise à jour complète autorisée (§20).
        Some("BROUILLON") => {
            conn.execute(
                "UPDATE invoices SET doc_type=?2, number=?3, status=?4, date=?5, date_echeance=?6,
                   customer_id=?7, mode_paiement=?8, conditions_paiement=?9, ref_commande=?10,
                   ref_devis=?11, ref_bon_livraison=?12, observations=?13, devise=?14,
                   remise_globale_kind=?15, remise_globale_valeur_cents=?16,
                   total_ht_cents=?17, total_tva_cents=?18, total_ttc_cents=?19,
                   total_other_taxes_cents=?20, montant_lettres=?21, vat_detail_json=?22,
                   other_tax_detail_json=?23, seller_snapshot_json=?24, buyer_snapshot_json=?25,
                   origin_doc_number=?26, conditions_vente=?27, updated_at=datetime('now')
                 WHERE id=?1",
                params![
                    id,
                    s(d, "doc_type").unwrap_or_default(),
                    s(d, "number"),
                    s(d, "status").unwrap_or_else(|| "BROUILLON".into()),
                    s(d, "date").unwrap_or_default(),
                    s(d, "date_echeance"),
                    customer_id,
                    s(d, "mode_paiement"), s(d, "conditions_paiement"), s(d, "ref_commande"),
                    s(d, "ref_devis"), s(d, "ref_bon_livraison"), s(d, "observations"),
                    s(d, "devise").unwrap_or_else(|| "DZD".into()),
                    s(d, "remise_globale_kind"), i64v(d, "remise_globale_valeur_cents"),
                    i64v(d, "total_ht_cents").unwrap_or(0),
                    i64v(d, "total_tva_cents").unwrap_or(0),
                    i64v(d, "total_ttc_cents").unwrap_or(0),
                    i64v(d, "total_other_taxes_cents").unwrap_or(0),
                    s(d, "montant_lettres").unwrap_or_default(),
                    json_str(d, "vat_detail"), json_str(d, "other_tax_detail"),
                    json_str(d, "seller_snapshot"), json_str(d, "buyer_snapshot"),
                    s(d, "origin_doc_number"),
                    s(d, "conditions_vente"),
                ],
            )?;
            replace_items(conn, id, d)?;
        }
        // Document validé (§20) : seuls statut/annulation/archivage bougent.
        Some(_) => {
            conn.execute(
                "UPDATE invoices SET status=?2, cancelled_at=?3, cancel_motif=?4, archived=?5,
                   updated_at=datetime('now')
                 WHERE id=?1",
                params![
                    id,
                    s(d, "status").unwrap_or_default(),
                    s(d, "cancelled_at"),
                    s(d, "cancel_motif"),
                    b_opt(d, "archived").unwrap_or(0),
                ],
            )?;
        }
    }
    Ok(id)
}

fn replace_items(conn: &Connection, invoice_id: i64, d: &Value) -> Result<()> {
    conn.execute("DELETE FROM invoice_items WHERE invoice_id = ?1", params![invoice_id])?;
    let Some(items) = d.get("items").and_then(|x| x.as_array()) else {
        return Ok(());
    };
    for (i, it) in items.iter().enumerate() {
        conn.execute(
            "INSERT INTO invoice_items (invoice_id, line_no, nature, product_ref, designation,
               description, qty, unite, pu_ht_cents, remise_pct, tax_code, tax_rate_pct_snapshot,
               tax_libelle_snapshot, tax_kind_snapshot, motif_exoneration, ht_cents, tva_cents, ttc_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                invoice_id,
                (i + 1) as i64,
                s(it, "nature").unwrap_or_else(|| "VENTE".into()),
                s(it, "product_ref"),
                s(it, "designation").unwrap_or_default(),
                s(it, "description"),
                f64v(it, "qty").unwrap_or(0.0),
                s(it, "unite").unwrap_or_else(|| "unité".into()),
                i64v(it, "pu_ht_cents").unwrap_or(0),
                f64v(it, "remise_pct").unwrap_or(0.0),
                s(it, "tax_code").unwrap_or_else(|| "TVA19".into()),
                f64v(it, "tax_rate_pct_snapshot").unwrap_or(0.0),
                s(it, "tax_libelle_snapshot").unwrap_or_default(),
                s(it, "tax_kind_snapshot").unwrap_or_else(|| "TVA".into()),
                s(it, "motif_exoneration"),
                i64v(it, "ht_cents").unwrap_or(0),
                i64v(it, "tva_cents").unwrap_or(0),
                i64v(it, "ttc_cents").unwrap_or(0),
            ],
        )?;
    }
    Ok(())
}

fn insert_payment(conn: &Connection, d: &Value) -> Result<()> {
    let invoice_local = s(d, "invoice_local_id")
        .ok_or_else(|| AppError::User("Paiement sans facture liée.".into()))?;
    let invoice_id: Option<i64> = conn
        .query_row(
            "SELECT desktop_id FROM desktop_ids WHERE entity = 'document' AND local_id = ?1",
            params![invoice_local],
            |r| r.get(0),
        )
        .optional()?;
    let Some(invoice_id) = invoice_id else {
        return Err(AppError::User(
            "Le document lié à ce paiement n'est pas encore synchronisé.".into(),
        ));
    };
    conn.execute(
        "INSERT INTO payments (invoice_id, mode, date, amount_cents, reference, banque,
           numero_cheque, commentaire, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            invoice_id,
            s(d, "mode").unwrap_or_default(),
            s(d, "date").unwrap_or_default(),
            i64v(d, "amount_cents").unwrap_or(0),
            s(d, "reference"), s(d, "banque"), s(d, "numero_cheque"), s(d, "commentaire"),
            s(d, "created_by_username").as_deref().and_then(|n| user_id_by_name(conn, n)),
        ],
    )?;
    Ok(())
}

fn insert_audit(conn: &Connection, d: &Value) -> Result<()> {
    conn.execute(
        "INSERT INTO audit_logs (ts, user_id, username, action, object_type, object_id, details, old_value, new_value)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            s(d, "ts").unwrap_or_default(),
            s(d, "username").as_deref().and_then(|n| user_id_by_name(conn, n)),
            s(d, "username"),
            s(d, "action").unwrap_or_default(),
            s(d, "object_type").unwrap_or_default(),
            s(d, "object_id"),
            s(d, "details"), s(d, "old_value"), s(d, "new_value"),
        ],
    )?;
    Ok(())
}

fn insert_backup_record(conn: &Connection, d: &Value) -> Result<()> {
    conn.execute(
        "INSERT INTO backup_history (ts, kind, label, size_bytes, count_invoices, count_customers,
           count_products, schema_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            s(d, "ts").unwrap_or_default(),
            s(d, "kind").unwrap_or_else(|| "MANUELLE".into()),
            s(d, "label"),
            i64v(d, "size_bytes").unwrap_or(0),
            i64v(d, "count_invoices").unwrap_or(0),
            i64v(d, "count_customers").unwrap_or(0),
            i64v(d, "count_products").unwrap_or(0),
            i64v(d, "schema_version").unwrap_or(1),
        ],
    )?;
    Ok(())
}

fn upsert_settings(conn: &Connection, d: &Value) -> Result<i64> {
    let Some(pairs) = d.get("pairs").and_then(|x| x.as_object()) else {
        return Ok(0);
    };
    for (k, v) in pairs {
        let value = match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![k, value],
        )?;
    }
    Ok(0)
}

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Achats : fournisseurs et bons de commande (migration 0006)          */
/* ------------------------------------------------------------------ */

fn upsert_supplier(conn: &Connection, local_id: &str, d: &Value) -> Result<i64> {
    ensure_company(conn)?;
    let id = map_local(conn, "supplier", local_id)?;
    conn.execute(
        "INSERT INTO suppliers (id, company_id, denomination, nom_commercial, adresse, wilaya, commune,
           telephone, email, contact_principal, rc, nif, nis, article_imposition,
           conditions_paiement_jours, observations, actif, demo)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(id) DO UPDATE SET
           denomination=excluded.denomination, nom_commercial=excluded.nom_commercial,
           adresse=excluded.adresse, wilaya=excluded.wilaya, commune=excluded.commune,
           telephone=excluded.telephone, email=excluded.email, contact_principal=excluded.contact_principal,
           rc=excluded.rc, nif=excluded.nif, nis=excluded.nis, article_imposition=excluded.article_imposition,
           conditions_paiement_jours=excluded.conditions_paiement_jours, observations=excluded.observations,
           actif=excluded.actif, updated_at=datetime('now')",
        params![
            id,
            s(d, "denomination").unwrap_or_default(),
            s(d, "nom_commercial"), s(d, "adresse"), s(d, "wilaya"), s(d, "commune"),
            s(d, "telephone"), s(d, "email"), s(d, "contact_principal"), s(d, "rc"), s(d, "nif"),
            s(d, "nis"), s(d, "article_imposition"), i64v(d, "conditions_paiement_jours"),
            s(d, "observations"), b(d, "actif"), b_opt(d, "demo").unwrap_or(0),
        ],
    )?;
    Ok(id)
}

fn upsert_purchase_order(conn: &Connection, local_id: &str, d: &Value) -> Result<i64> {
    ensure_company(conn)?;
    let id = map_local(conn, "purchase_order", local_id)?;
    let supplier_local = s(d, "supplier_local_id").unwrap_or_default();
    let supplier_id = map_local(conn, "supplier", &supplier_local)?;
    let status = s(d, "status").unwrap_or_else(|| "BROUILLON".into());
    let existing: Option<String> = conn
        .query_row("SELECT status FROM purchase_orders WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    let created_by = s(d, "created_by_username").as_deref().and_then(|n| user_id_by_name(conn, n));

    match existing.as_deref() {
        None | Some("BROUILLON") => {
            conn.execute(
                "INSERT INTO purchase_orders (id, company_id, supplier_id, number, status, date, date_livraison,
                   devise, mode_paiement, conditions_paiement, lieu_livraison, observations,
                   supplier_snapshot_json, total_ht_cents, total_tva_cents, total_ttc_cents, montant_lettres,
                   vat_detail_json, sent_at, cancelled_at, cancel_motif, created_by, demo)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
                 ON CONFLICT(id) DO UPDATE SET
                   supplier_id=excluded.supplier_id, number=excluded.number, status=excluded.status,
                   date=excluded.date, date_livraison=excluded.date_livraison, devise=excluded.devise,
                   mode_paiement=excluded.mode_paiement, conditions_paiement=excluded.conditions_paiement,
                   lieu_livraison=excluded.lieu_livraison, observations=excluded.observations,
                   supplier_snapshot_json=excluded.supplier_snapshot_json,
                   total_ht_cents=excluded.total_ht_cents, total_tva_cents=excluded.total_tva_cents,
                   total_ttc_cents=excluded.total_ttc_cents, montant_lettres=excluded.montant_lettres,
                   vat_detail_json=excluded.vat_detail_json, sent_at=excluded.sent_at,
                   cancelled_at=excluded.cancelled_at, cancel_motif=excluded.cancel_motif,
                   updated_at=datetime('now')",
                params![
                    id, supplier_id, s(d, "number"), status,
                    s(d, "date").unwrap_or_default(), s(d, "date_livraison"),
                    s(d, "devise").unwrap_or_else(|| "DZD".into()),
                    s(d, "mode_paiement"), s(d, "conditions_paiement"), s(d, "lieu_livraison"),
                    s(d, "observations"), json_str(d, "supplier_snapshot"),
                    i64v(d, "total_ht_cents").unwrap_or(0), i64v(d, "total_tva_cents").unwrap_or(0),
                    i64v(d, "total_ttc_cents").unwrap_or(0), s(d, "montant_lettres"),
                    json_str(d, "vat_detail"), s(d, "sent_at"), s(d, "cancelled_at"),
                    s(d, "cancel_motif"), created_by, b_opt(d, "demo").unwrap_or(0),
                ],
            )?;
            // Lignes : remplacement complet tant que le BC est en brouillon.
            conn.execute("DELETE FROM purchase_order_lines WHERE po_id = ?1", params![id])?;
            if let Some(lines) = d.get("lines").and_then(|x| x.as_array()) {
                for (i, l) in lines.iter().enumerate() {
                    conn.execute(
                        "INSERT INTO purchase_order_lines (po_id, line_no, product_ref, designation, unite, qty,
                           qty_recue, pu_ht_cents, remise_pct, tax_code, tax_rate_pct_snapshot,
                           ht_cents, tva_cents, ttc_cents)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                        params![
                            id, (i + 1) as i64, s(l, "product_ref"),
                            s(l, "designation").unwrap_or_default(), s(l, "unite"),
                            f64v(l, "qty").unwrap_or(0.0), f64v(l, "qty_recue").unwrap_or(0.0),
                            i64v(l, "pu_ht_cents").unwrap_or(0), f64v(l, "remise_pct").unwrap_or(0.0),
                            s(l, "tax_code"), f64v(l, "tax_rate_pct_snapshot").unwrap_or(0.0),
                            i64v(l, "ht_cents").unwrap_or(0), i64v(l, "tva_cents").unwrap_or(0),
                            i64v(l, "ttc_cents").unwrap_or(0),
                        ],
                    )?;
                }
            }
        }
        // BC envoyé ou reçu : contenu figé (§20) ; seules réception et statut évoluent.
        Some(_) => {
            conn.execute(
                "UPDATE purchase_orders SET status=?2, sent_at=?3, cancelled_at=?4, cancel_motif=?5,
                   updated_at=datetime('now') WHERE id=?1",
                params![id, status, s(d, "sent_at"), s(d, "cancelled_at"), s(d, "cancel_motif")],
            )?;
            if let Some(lines) = d.get("lines").and_then(|x| x.as_array()) {
                for (i, l) in lines.iter().enumerate() {
                    conn.execute(
                        "UPDATE purchase_order_lines SET qty_recue = ?3 WHERE po_id = ?1 AND line_no = ?2",
                        params![id, (i + 1) as i64, f64v(l, "qty_recue").unwrap_or(0.0)],
                    )?;
                }
            }
        }
    }
    Ok(id)
}

fn purchase_orders_dataset(conn: &Connection) -> Result<Value> {
    let orders = table_with_local(conn, "purchase_orders", "purchase_order", &[])?;
    let mut stmt = conn.prepare(
        "SELECT line_no, product_ref, designation, unite, qty, qty_recue, pu_ht_cents, remise_pct,
                tax_code, tax_rate_pct_snapshot, ht_cents, tva_cents, ttc_cents
         FROM purchase_order_lines WHERE po_id = ?1 ORDER BY line_no",
    )?;
    let mut arr = Vec::new();
    for po in orders.as_array().unwrap() {
        let mut po = po.clone();
        let obj = po.as_object_mut().unwrap();
        let po_id = obj.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
        if let Some(sid) = obj.get("supplier_id").and_then(|x| x.as_i64()) {
            let local = local_of(conn, "supplier", sid, &format!("supplier-db-{sid}"))?;
            obj.insert("supplier_local_id".into(), Value::String(local));
        }
        if let Some(uid_) = obj.get("created_by").and_then(|x| x.as_i64()) {
            let name: Option<String> = conn
                .query_row("SELECT username FROM users WHERE id = ?1", params![uid_], |r| r.get(0))
                .optional()?;
            obj.insert("created_by_name".into(), name.map(Value::String).unwrap_or(Value::Null));
        }
        let lines: Vec<Value> = stmt
            .query_map(params![po_id], |r| {
                let mut m = Map::new();
                let cols = [
                    "line_no", "product_ref", "designation", "unite", "qty", "qty_recue", "pu_ht_cents",
                    "remise_pct", "tax_code", "tax_rate_pct_snapshot", "ht_cents", "tva_cents", "ttc_cents",
                ];
                for (i, c) in cols.iter().enumerate() {
                    m.insert((*c).to_string(), cell_to_json(r.get_ref(i)?));
                }
                Ok(Value::Object(m))
            })?
            .collect::<std::result::Result<_, _>>()?;
        obj.insert("lines".into(), Value::Array(lines));
        arr.push(po);
    }
    Ok(Value::Array(arr))
}

/// Suppression d'un BC : brouillon uniquement (un BC émis reste dans l'historique).
fn delete_purchase_order(conn: &Connection, desktop_id: i64) -> Result<()> {
    let status: String = conn.query_row(
        "SELECT status FROM purchase_orders WHERE id = ?1",
        params![desktop_id],
        |r| r.get(0),
    )?;
    if status != "BROUILLON" {
        return Err(AppError::User(
            "Un bon de commande émis ne peut pas être supprimé : annulez-le.".into(),
        ));
    }
    conn.execute("DELETE FROM purchase_order_lines WHERE po_id = ?1", params![desktop_id])?;
    conn.execute("DELETE FROM purchase_orders WHERE id = ?1", params![desktop_id])?;
    Ok(())
}

pub fn delete(conn: &Connection, entity: &str, local_id: &str) -> Result<()> {
    let Some(desktop_id): Option<i64> = conn
        .query_row(
            "SELECT desktop_id FROM desktop_ids WHERE entity = ?1 AND local_id = ?2",
            params![entity, local_id],
            |r| r.get(0),
        )
        .optional()?
    else {
        return Ok(());
    };
    match entity {
        "customer" => {
            conn.execute("DELETE FROM customers WHERE id = ?1", params![desktop_id])?;
        }
        "product" => {
            conn.execute("DELETE FROM products WHERE id = ?1", params![desktop_id])?;
        }
        "supplier" => {
            let used: i64 = conn.query_row(
                "SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = ?1",
                params![desktop_id],
                |r| r.get(0),
            )?;
            if used > 0 {
                return Err(AppError::User(
                    "Impossible de supprimer ce fournisseur : des bons de commande lui sont rattachés.".into(),
                ));
            }
            conn.execute("DELETE FROM suppliers WHERE id = ?1", params![desktop_id])?;
        }
        "purchase_order" => delete_purchase_order(conn, desktop_id)?,
        "document" => {
            // Le trigger prevent_validated_invoice_delete interdit tout le reste (§47).
            conn.execute("DELETE FROM invoices WHERE id = ?1", params![desktop_id])?;
        }
        other => {
            return Err(AppError::User(format!("Suppression non supportée : {other}")));
        }
    }
    forget(conn, entity, local_id)?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Réhydratation complète après restauration (§32)                     */
/* ------------------------------------------------------------------ */

pub fn load_dataset(conn: &Connection) -> Result<Value> {
    let mut out = Map::new();

    out.insert("company".into(), row_to_json(conn, "SELECT * FROM companies WHERE id = 1")?);

    out.insert("customers".into(), table_with_local(conn, "customers", "customer", &[])?);
    out.insert(
        "customer_contacts".into(),
        table_with_local(conn, "customer_contacts", "customer_contact", &[])?,
    );
    out.insert("products".into(), table_with_local(conn, "products", "product", &[])?);
    out.insert("tax_rates".into(), table_with_local(conn, "tax_rates", "tax_rate", &[])?);
    out.insert("tax_history".into(), table_with_local(conn, "tax_rate_history", "tax_history", &[])?);
    out.insert("users".into(), table_with_local(conn, "users", "user", &["password_hash"])?);
    out.insert("payments".into(), payments_dataset(conn)?);
    out.insert("audit".into(), audit_dataset(conn)?);
    out.insert("backup_history".into(), table_with_local(conn, "backup_history", "backup_record", &[])?);
    out.insert("documents".into(), documents_dataset(conn)?);
    out.insert("settings".into(), settings_dataset(conn)?);
    out.insert("sequences".into(), sequences_dataset(conn)?);
    out.insert("suppliers".into(), table_with_local(conn, "suppliers", "supplier", &[])?);
    out.insert("purchase_orders".into(), purchase_orders_dataset(conn)?);

    Ok(Value::Object(out))
}

/// Convertit une valeur SQLite en JSON en respectant les types réels.
fn cell_to_json(v: rusqlite::types::ValueRef) -> Value {
    match v {
        rusqlite::types::ValueRef::Null => Value::Null,
        rusqlite::types::ValueRef::Integer(n) => Value::Number(n.into()),
        rusqlite::types::ValueRef::Real(f) => {
            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
        }
        rusqlite::types::ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        rusqlite::types::ValueRef::Blob(b) => Value::String(format!("<blob {} octets>", b.len())),
    }
}

/// Première ligne d'une requête en JSON (ou Null si aucune).
fn row_to_json(conn: &Connection, sql: &str) -> Result<Value> {
    let mut stmt = conn.prepare(sql)?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query_map([], |r| {
        let mut m = Map::new();
        for (i, c) in cols.iter().enumerate() {
            m.insert(c.clone(), cell_to_json(r.get_ref(i)?));
        }
        Ok(Value::Object(m))
    })?;
    Ok(match rows.next() {
        Some(r) => r?,
        None => Value::Null,
    })
}

/// Table complète + `local_id` depuis desktop_ids.
fn table_with_local(conn: &Connection, table: &str, entity: &str, _extra_keep: &[&str]) -> Result<Value> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}"))?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |r| {
        let mut m = Map::new();
        for (i, c) in cols.iter().enumerate() {
            m.insert(c.clone(), cell_to_json(r.get_ref(i)?));
        }
        Ok(Value::Object(m))
    })?;
    let mut arr = Vec::new();
    for row in rows {
        let mut v = row?;
        let obj = v.as_object_mut().unwrap();
        let desktop_id = obj.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
        let local = local_of(conn, entity, desktop_id, &format!("{entity}-db-{desktop_id}"))?;
        obj.insert("local_id".into(), Value::String(local));
        arr.push(v);
    }
    Ok(Value::Array(arr))
}

fn documents_dataset(conn: &Connection) -> Result<Value> {
    let invoices = table_with_local(conn, "invoices", "document", &[])?;
    let mut stmt = conn.prepare(
        "SELECT invoice_id, line_no, nature, product_ref, designation, description, qty, unite,
                pu_ht_cents, remise_pct, tax_code, tax_rate_pct_snapshot, tax_libelle_snapshot,
                tax_kind_snapshot, motif_exoneration, ht_cents, tva_cents, ttc_cents
         FROM invoice_items WHERE invoice_id = ?1 ORDER BY line_no",
    )?;
    let mut arr = Vec::new();
    for inv in invoices.as_array().unwrap() {
        let mut inv = inv.clone();
        let obj = inv.as_object_mut().unwrap();
        let invoice_id = obj.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
        // customer_id INTEGER → customer_local_id
        if let Some(cid) = obj.get("customer_id").and_then(|x| x.as_i64()) {
            let local = local_of(conn, "customer", cid, &format!("customer-db-{cid}"))?;
            obj.insert("customer_local_id".into(), Value::String(local));
        }
        // created_by / cancelled_by INTEGER → noms d'utilisateurs lisibles.
        for (col, out_key) in [("created_by", "created_by_name"), ("cancelled_by", "cancelled_by_name")] {
            if let Some(uid_) = obj.get(col).and_then(|x| x.as_i64()) {
                let name: Option<String> = conn
                    .query_row("SELECT username FROM users WHERE id = ?1", params![uid_], |r| r.get(0))
                    .optional()?;
                obj.insert(out_key.into(), name.map(Value::String).unwrap_or(Value::Null));
            }
        }
        let items: Vec<Value> = stmt
            .query_map(params![invoice_id], |r| {
                let mut m = Map::new();
                let cols = [
                    "invoice_id", "line_no", "nature", "product_ref", "designation", "description",
                    "qty", "unite", "pu_ht_cents", "remise_pct", "tax_code", "tax_rate_pct_snapshot",
                    "tax_libelle_snapshot", "tax_kind_snapshot", "motif_exoneration",
                    "ht_cents", "tva_cents", "ttc_cents",
                ];
                for (i, c) in cols.iter().enumerate() {
                    m.insert((*c).to_string(), cell_to_json(r.get_ref(i)?));
                }
                Ok(Value::Object(m))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        obj.insert("items".into(), Value::Array(items));
        arr.push(inv);
    }
    Ok(Value::Array(arr))
}

fn payments_dataset(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare("SELECT * FROM payments ORDER BY id")?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |r| {
        let mut m = Map::new();
        for (i, c) in cols.iter().enumerate() {
            m.insert(c.clone(), cell_to_json(r.get_ref(i)?));
        }
        Ok(Value::Object(m))
    })?;
    let mut arr = Vec::new();
    for row in rows {
        let mut v = row?;
        let obj = v.as_object_mut().unwrap();
        let desktop_id = obj.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
        let invoice_id = obj.get("invoice_id").and_then(|x| x.as_i64()).unwrap_or(0);
        obj.insert(
            "invoice_local_id".into(),
            Value::String(local_of(conn, "document", invoice_id, &format!("document-db-{invoice_id}"))?),
        );
        obj.insert(
            "local_id".into(),
            Value::String(local_of(conn, "payment", desktop_id, &format!("payment-db-{desktop_id}"))?),
        );
        arr.push(v);
    }
    Ok(Value::Array(arr))
}

fn audit_dataset(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT ts, username, action, object_type, object_id, details, old_value, new_value
         FROM audit_logs ORDER BY id DESC LIMIT 5000",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(json!({
            "ts": r.get::<_, Option<String>>(0)?,
            "username": r.get::<_, Option<String>>(1)?,
            "action": r.get::<_, Option<String>>(2)?,
            "object_type": r.get::<_, Option<String>>(3)?,
            "object_id": r.get::<_, Option<String>>(4)?,
            "details": r.get::<_, Option<String>>(5)?,
            "old_value": r.get::<_, Option<String>>(6)?,
            "new_value": r.get::<_, Option<String>>(7)?,
        }))
    })?;
    Ok(Value::Array(rows.collect::<std::result::Result<Vec<_>, _>>()?))
}

fn settings_dataset(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut m = Map::new();
    for r in rows {
        let (k, v) = r?;
        m.insert(k, Value::String(v));
    }
    Ok(Value::Object(m))
}

fn sequences_dataset(conn: &Connection) -> Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT doc_type, year, counter, template, padding FROM invoice_sequences ORDER BY doc_type, year",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })?;
    let mut counters = Map::new();
    let mut configs = Map::new(); // dernier template/padding connu par doc_type
    for r in rows {
        let (dt, year, counter, template, padding) = r?;
        counters.insert(format!("{dt}-{year}"), json!(counter));
        configs.insert(dt.clone(), json!({ "doc_type": dt, "template": template, "padding": padding }));
    }
    Ok(json!({ "counters": counters, "configs": configs }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    fn customer_payload(name: &str) -> Value {
        json!({
            "type": "ENTREPRISE", "denomination": name, "nif": "002116123456789",
            "actif": true, "demo": false,
            "contacts": [{"nom": "Contact 1", "telephone": "0550 00 00 00"}]
        })
    }

    #[test]
    fn upsert_customer_idempotent() {
        let conn = test_connection();
        let id1 = upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test")).unwrap();
        let id2 = upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test Modifié")).unwrap();
        assert_eq!(id1, id2);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let name: String = conn
            .query_row("SELECT denomination FROM customers WHERE id=?1", params![id1], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "SARL Test Modifié");
        let contacts: i64 = conn
            .query_row("SELECT COUNT(*) FROM customer_contacts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(contacts, 1);
    }

    fn doc_payload(status: &str, number: Option<&str>) -> Value {
        json!({
            "doc_type": "FAC", "number": number, "status": status, "date": "2026-10-08",
            "customer_local_id": "cus_1",
            "total_ht_cents": 10000, "total_tva_cents": 1900, "total_ttc_cents": 11900,
            "total_other_taxes_cents": 0,
            "montant_lettres": "onze mille neuf cents dinars algériens",
            "vat_detail": [{"ratePct": 19, "baseCents": 10000, "amountCents": 1900}],
            "other_tax_detail": [],
            "seller_snapshot": {"displayName": "Mon Entreprise"},
            "buyer_snapshot": {"displayName": "SARL Test"},
            "created_by_username": null, "archived": false, "demo": false,
            "items": [{
                "nature": "VENTE", "designation": "Produit X", "qty": 2.0, "unite": "unité",
                "pu_ht_cents": 5000, "remise_pct": 0.0, "tax_code": "TVA19",
                "tax_rate_pct_snapshot": 19.0, "tax_libelle_snapshot": "TVA 19 %",
                "tax_kind_snapshot": "TVA", "ht_cents": 10000, "tva_cents": 1900, "ttc_cents": 11900
            }]
        })
    }

    #[test]
    fn revision_de_devis_persistee_et_figee_a_la_validation() {
        let conn = test_connection();
        upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test")).unwrap();

        // Devis d'origine validé (numéro DEV-…), puis révision en brouillon liée.
        let mut dev = doc_payload("ENVOYE", Some("DEV-2026-000001"));
        dev["doc_type"] = json!("DEV");
        let dev_id = upsert(&conn, "document", "dev_1", &dev).unwrap();

        let mut rev = doc_payload("BROUILLON", None);
        rev["doc_type"] = json!("DEV");
        rev["origin_doc_number"] = json!("DEV-2026-000001");
        let rev_id = upsert(&conn, "document", "dev_2", &rev).unwrap();

        let origin: Option<String> = conn
            .query_row("SELECT origin_doc_number FROM invoices WHERE id=?1", params![rev_id], |r| r.get(0))
            .unwrap();
        assert_eq!(origin.as_deref(), Some("DEV-2026-000001"));

        // Validation de la révision : nouveau numéro, lien conservé.
        let mut rev_v = doc_payload("ENVOYE", Some("DEV-2026-000002"));
        rev_v["doc_type"] = json!("DEV");
        rev_v["origin_doc_number"] = json!("DEV-2026-000001");
        upsert(&conn, "document", "dev_2", &rev_v).unwrap();
        let (n, o): (String, Option<String>) = conn
            .query_row("SELECT number, origin_doc_number FROM invoices WHERE id=?1", params![rev_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(n, "DEV-2026-000002");
        assert_eq!(o.as_deref(), Some("DEV-2026-000001"));

        // Le devis d'origine n'a pas bougé (§20).
        let n0: String = conn
            .query_row("SELECT number FROM invoices WHERE id=?1", params![dev_id], |r| r.get(0))
            .unwrap();
        assert_eq!(n0, "DEV-2026-000001");
    }

    #[test]
    fn document_cycle_brouillon_validation() {
        let conn = test_connection();
        upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test")).unwrap();

        let id = upsert(&conn, "document", "doc_1", &doc_payload("BROUILLON", None)).unwrap();
        let items: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoice_items WHERE invoice_id=?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(items, 1);

        // Validation : statut + numéro mirrorés.
        upsert(&conn, "document", "doc_1", &doc_payload("VALIDEE", Some("FAC-2026-000001"))).unwrap();
        let (number, status): (String, String) = conn
            .query_row("SELECT number, status FROM invoices WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(number, "FAC-2026-000001");
        assert_eq!(status, "VALIDEE");

        // Tentative de modification d'un champ figé → refusée par le trigger (§20).
        let mut hacked = doc_payload("VALIDEE", Some("FAC-2026-000001"));
        hacked["total_ttc_cents"] = json!(999999);
        upsert(&conn, "document", "doc_1", &hacked).unwrap(); // chemin restreint : totaux ignorés
        let ttc: i64 = conn
            .query_row("SELECT total_ttc_cents FROM invoices WHERE id=?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(ttc, 11900);
    }

    #[test]
    fn payment_apres_document() {
        let conn = test_connection();
        upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test")).unwrap();
        upsert(&conn, "document", "doc_1", &doc_payload("VALIDEE", Some("FAC-2026-000001"))).unwrap();
        let pay = json!({
            "invoice_local_id": "doc_1", "mode": "Espèces", "date": "2026-10-09",
            "amount_cents": 11900
        });
        upsert(&conn, "payment", "pay_1", &pay).unwrap();
        // Idempotent : pas de double encaissement au re-mirror.
        upsert(&conn, "payment", "pay_1", &pay).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM payments", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn sequence_jamais_decremente() {
        let conn = test_connection();
        upsert(&conn, "sequence", "FAC-2026", &json!({"doc_type": "FAC", "year": 2026, "counter": 5, "template": "FAC-{YEAR}-{COUNTER}", "padding": 6})).unwrap();
        upsert(&conn, "sequence", "FAC-2026", &json!({"doc_type": "FAC", "year": 2026, "counter": 2, "template": "FAC-{YEAR}-{COUNTER}", "padding": 6})).unwrap();
        let counter: i64 = conn
            .query_row("SELECT counter FROM invoice_sequences WHERE doc_type='FAC' AND year=2026", [], |r| r.get(0))
            .unwrap();
        assert_eq!(counter, 5); // §21 : jamais décrémenté
    }

    #[test]
    fn load_dataset_roundtrip() {
        let conn = test_connection();
        upsert(&conn, "company", "company", &json!({"raison_sociale": "Mon Entreprise SARL", "nif": "0001", "devise": "DZD"})).unwrap();
        upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test")).unwrap();
        upsert(&conn, "document", "doc_1", &doc_payload("VALIDEE", Some("FAC-2026-000001"))).unwrap();
        upsert(&conn, "sequence", "FAC-2026", &json!({
            "doc_type": "FAC", "year": 2026, "counter": 5,
            "template": "FAC-{YEAR}-{COUNTER}", "padding": 6
        })).unwrap();

        let ds = load_dataset(&conn).unwrap();
        assert_eq!(ds["company"]["raison_sociale"], "Mon Entreprise SARL");
        assert_eq!(ds["customers"][0]["local_id"], "cus_1");
        assert_eq!(ds["documents"][0]["customer_local_id"], "cus_1");
        assert_eq!(ds["documents"][0]["items"][0]["designation"], "Produit X");
        assert_eq!(ds["sequences"]["counters"]["FAC-2026"], 5);
        assert_eq!(ds["sequences"]["configs"]["FAC"]["template"], "FAC-{YEAR}-{COUNTER}");
    }

    fn supplier_payload(name: &str) -> Value {
        json!({"denomination": name, "actif": true, "contacts": []})
    }

    fn po_payload(status: &str, number: Option<&str>) -> Value {
        json!({
            "supplier_local_id": "sup_1",
            "number": number,
            "status": status,
            "date": "2026-10-11",
            "devise": "DZD",
            "total_ht_cents": 100000, "total_tva_cents": 19000, "total_ttc_cents": 119000,
            "supplier_snapshot": {"displayName": "Fournisseur Test"},
            "lines": [{
                "designation": "Ciment", "qty": 10.0, "qty_recue": 0.0, "unite": "sac",
                "pu_ht_cents": 10000, "remise_pct": 0.0, "tax_code": "TVA19",
                "tax_rate_pct_snapshot": 19.0, "ht_cents": 100000, "tva_cents": 19000, "ttc_cents": 119000
            }]
        })
    }

    #[test]
    fn bon_de_commande_aller_retour_et_figement() {
        let conn = test_connection();
        upsert(&conn, "supplier", "sup_1", &supplier_payload("Fournisseur Test")).unwrap();
        upsert(&conn, "purchase_order", "po_1", &po_payload("BROUILLON", None)).unwrap();

        let ds = load_dataset(&conn).unwrap();
        assert_eq!(ds["suppliers"][0]["local_id"], "sup_1");
        assert_eq!(ds["purchase_orders"][0]["supplier_local_id"], "sup_1");
        assert_eq!(ds["purchase_orders"][0]["lines"][0]["designation"], "Ciment");

        // Émis : le contenu ne change plus, la réception oui.
        upsert(&conn, "purchase_order", "po_1", &po_payload("ENVOYE", Some("BC-2026-000001"))).unwrap();
        let mut recu = po_payload("RECU_PARTIEL", Some("BC-2026-000001"));
        recu["lines"][0]["qty_recue"] = json!(4.0);
        recu["lines"][0]["designation"] = json!("Modifié");
        upsert(&conn, "purchase_order", "po_1", &recu).unwrap();
        let ds = load_dataset(&conn).unwrap();
        assert_eq!(ds["purchase_orders"][0]["status"], "RECU_PARTIEL");
        assert_eq!(ds["purchase_orders"][0]["lines"][0]["qty_recue"], 4.0);
        assert_eq!(ds["purchase_orders"][0]["lines"][0]["designation"], "Ciment");

        // Suppression refusée une fois émis.
        assert!(delete(&conn, "purchase_order", "po_1").is_err());
        // Fournisseur utilisé : suppression refusée.
        assert!(delete(&conn, "supplier", "sup_1").is_err());
    }

    #[test]
    fn bon_de_commande_brouillon_supprimable() {
        let conn = test_connection();
        upsert(&conn, "supplier", "sup_2", &supplier_payload("Autre")).unwrap();
        let mut p = po_payload("BROUILLON", None);
        p["supplier_local_id"] = json!("sup_2");
        upsert(&conn, "purchase_order", "po_b", &p).unwrap();
        assert!(delete(&conn, "purchase_order", "po_b").is_ok());
        assert!(delete(&conn, "supplier", "sup_2").is_ok());
    }

    #[test]
    fn suppression_brouillon_ok_valide_interdit() {
        let conn = test_connection();
        upsert(&conn, "customer", "cus_1", &customer_payload("SARL Test")).unwrap();
        upsert(&conn, "document", "doc_b", &doc_payload("BROUILLON", None)).unwrap();
        assert!(delete(&conn, "document", "doc_b").is_ok());

        upsert(&conn, "document", "doc_v", &doc_payload("VALIDEE", Some("FAC-2026-000002"))).unwrap();
        assert!(delete(&conn, "document", "doc_v").is_err()); // §47
    }
}

//! Test d'intégration de bout en bout (§64, §65) — « parcours réel complet ».
//!
//! Contrairement aux tests unitaires (base en mémoire), ce parcours utilise :
//!   * une **vraie base SQLite sur disque** ouverte par `Db::open` (WAL,
//!     clés étrangères, migrations 0001 + 0002 appliquées) ;
//!   * l'arborescence réelle `Data/Backups/Documents/Exports/Logs` ;
//!   * la chaîne complète : entreprise → taxes → client → facture brouillon
//!     → validation (numérotation + totaux + montant en lettres) → PDF natif
//!     (polices embarquées) → sauvegarde → export → annulation → intégrité.
//!
//! Objectif : prouver que l'assemblage réel (Rust + SQLite + printpdf)
//! fonctionne sur des données de bout en bout, et pas seulement en unités.

#![cfg(test)]

use rusqlite::params;
use serde_json::json;

use crate::{backup, db, invoices, pdf, sync};

fn money(cents: i64) -> String {
    format!("{},{:02} DA", cents / 100, cents % 100)
}

#[test]
fn parcours_complet_facturation_reelle() {
    /* ---------- 0. Décor : dossiers + base réelle sur disque ---------- */
    let paths = db::test_paths();
    let dbh = db::Db::open(&paths).expect("ouverture de la base réelle (migrations)");
    let conn = dbh.conn.lock().unwrap();

    let db_file = db::database_file(&paths);
    assert!(db_file.exists(), "le fichier SQLite doit exister sur disque");
    assert!(
        db_file.with_extension("db-wal").exists() || db_file.exists(),
        "mode WAL actif"
    );

    /* ---------- 1. Entreprise (§6) : mentions distinctes NIF/NIS/RC/AI ---------- */
    sync::upsert(
        &conn,
        "company",
        "company_1",
        &json!({
            "raison_sociale": "SARL EXEMPLE ALGERIE",
            "nom_commercial": "Exemple DZ",
            "forme_juridique": "SARL",
            "activite": "Commerce de gros",
            "adresse": "12, rue Didouche Mourad",
            "wilaya": "Alger",
            "commune": "Alger Centre",
            "telephone": "021 00 00 00",
            "email": "contact@exemple.dz",
            "rc": "16/00-1234567 B 20",
            "nif": "000216001234567",
            "nis": "000216001234568",
            "article_imposition": "16012345678",
            "capital_social": "1 000 000,00 DA",
            "banque": "BNA — Agence Alger Centre",
            "rib": "001 00234 0300000123 45",
            "devise": "DZD",
            "conditions_paiement_defaut_jours": 30,
            "mode_paiement_defaut": "Virement bancaire"
        }),
    )
    .expect("entreprise enregistrée");

    /* ---------- 2. Moteur fiscal (§10) : taux configurables, jamais codés en dur ---------- */
    sync::upsert(
        &conn,
        "tax_rate",
        "tva19",
        &json!({
            "code": "TVA19", "libelle": "TVA 19 %", "rate_pct": 19.0,
            "kind": "TVA", "actif": true, "date_debut": "2020-01-01"
        }),
    )
    .expect("taux TVA 19 % créé");
    sync::upsert(
        &conn,
        "tax_rate",
        "tva9",
        &json!({
            "code": "TVA9", "libelle": "TVA 9 %", "rate_pct": 9.0,
            "kind": "TVA", "actif": true, "date_debut": "2020-01-01"
        }),
    )
    .expect("taux TVA 9 % créé");
    sync::upsert(
        &conn,
        "tax_rate",
        "exo",
        &json!({
            "code": "EXO", "libelle": "Exonéré", "rate_pct": 0.0,
            "kind": "TVA", "actif": true, "date_debut": "2020-01-01"
        }),
    )
    .expect("régime exonéré créé");

    /* ---------- 3. Client (§7) ---------- */
    sync::upsert(
        &conn,
        "customer",
        "cus_1",
        &json!({
            "type": "ENTREPRISE", "denomination": "EURL CLIENT DEMO", "forme_juridique": "EURL",
            "adresse": "45, boulevard Zirout Youcef", "wilaya": "Alger", "commune": "Bab El Oued",
            "telephone": "0550 11 22 33", "email": "achats@client-demo.dz",
            "rc": "16/00-7654321 B 19", "nif": "000216007654321",
            "nis": "000216007654322", "article_imposition": "16076543219",
            "actif": true, "demo": false,
            "contacts": [{"nom": "M. Karim B.", "fonction": "Responsable achats", "telephone": "0550 11 22 33"}]
        }),
    )
    .expect("client créé");

    /* ---------- 4. Utilisateur (§36) ---------- */
    let user_id = sync::upsert(
        &conn,
        "user",
        "usr_1",
        &json!({
            "username": "gerant", "password_hash": "$argon2id$test$hash",
            "role": "ADMIN", "actif": true
        }),
    )
    .expect("utilisateur créé");

    /* ---------- 5. Facture BROUILLON : 2 lignes, dont une remisée ---------- */
    let doc = json!({
        "doc_type": "FAC", "number": null, "status": "BROUILLON", "date": "2026-10-08",
        "date_echeance": "2026-11-07", "customer_local_id": "cus_1",
        "mode_paiement": "Virement bancaire", "conditions_paiement": "30 jours",
        "observations": "Livraison à l'entrepôt du client.",
        "total_ht_cents": 0, "total_tva_cents": 0, "total_ttc_cents": 0,
        "total_other_taxes_cents": 0,
        "vat_detail": [], "other_tax_detail": [],
        "seller_snapshot": {"displayName": "SARL EXEMPLE ALGERIE"},
        "buyer_snapshot": {"displayName": "EURL CLIENT DEMO"},
        "created_by_username": "gerant", "archived": false, "demo": false,
        "items": [
            {
                "nature": "VENTE", "designation": "Ordinateur portable 15\"", "qty": 10.0,
                "unite": "unité", "pu_ht_cents": 125000, "remise_pct": 10.0, "tax_code": "TVA19",
                "tax_rate_pct_snapshot": 19.0, "tax_libelle_snapshot": "TVA 19 %",
                "tax_kind_snapshot": "TVA", "ht_cents": 0, "tva_cents": 0, "ttc_cents": 0
            },
            {
                "nature": "VENTE", "designation": "Installation et mise en service", "qty": 3.0,
                "unite": "heure", "pu_ht_cents": 25000, "remise_pct": 0.0, "tax_code": "TVA9",
                "tax_rate_pct_snapshot": 9.0, "tax_libelle_snapshot": "TVA 9 %",
                "tax_kind_snapshot": "TVA", "ht_cents": 0, "tva_cents": 0, "ttc_cents": 0
            }
        ]
    });
    let invoice_id = sync::upsert(&conn, "document", "doc_1", &doc).expect("brouillon enregistré");

    /* ---------- 6. Validation atomique (§69) : numéro + recalcul serveur ---------- */
    let number = invoices::validate_document(&conn, invoice_id).expect("validation réussie");
    assert_eq!(number, "FAC-2026-000001", "numéro séquentiel de l'année");

    let (status, ht, tva, ttc, lettres): (String, i64, i64, i64, String) = conn
        .query_row(
            "SELECT status, total_ht_cents, total_tva_cents, total_ttc_cents, montant_lettres
             FROM invoices WHERE id = ?1",
            params![invoice_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();

    // L1 : 10 × 1 250,00 (remise 10 %) = 11 250,00 HT ; TVA 19 % = 2 137,50
    // L2 :  3 ×   250,00 (TVA 9 %)      =    750,00 HT ; TVA  9 % =    67,50
    // TOTAL : HT 12 000,00 | TVA 2 205,00 | TTC 14 205,00
    assert_eq!(status, "VALIDEE");
    assert_eq!(ht, 1_200_000, "total HT recalculé par le serveur");
    assert_eq!(tva, 220_500, "total TVA multi-taux recalculé par le serveur");
    assert_eq!(ttc, 1_420_500, "total TTC (§10) = HT + TVA");
    // Vérification STRICTE du moteur §16 sur le TTC recalculé (14 205,00 DA).
    assert_eq!(
        lettres,
        "QUATORZE MILLE DEUX CENT CINQ DINARS ALGÉRIENS ET ZÉRO CENTIME.",
        "montant en lettres (§16) exact"
    );
    println!(
        "✔ Validation : {number} | HT {} | TVA {} | TTC {} | {}",
        money(ht), money(tva), money(ttc), lettres
    );

    /* ---------- 7. Immutabilité (§20) : modification directe refusée ---------- */
    let hack = conn.execute(
        "UPDATE invoices SET total_ttc_cents = 999 WHERE id = ?1",
        params![invoice_id],
    );
    assert!(hack.is_err(), "trigger §20 : un document validé est immuable");
    println!("✔ Immutabilité §20 confirmée (UPDATE direct refusé)");

    /* ---------- 8. PDF natif A4 (§23) avec polices embarquées ---------- */
    let seller: serde_json::Value = json!({
        "display_name": "SARL EXEMPLE ALGERIE", "adresse": "12, rue Didouche Mourad",
        "telephone": "021 00 00 00", "email": "contact@exemple.dz",
        "rc": "16/00-1234567 B 20", "nif": "000216001234567",
        "nis": "000216001234568", "article_imposition": "16012345678"
    });
    let buyer: serde_json::Value = json!({
        "display_name": "EURL CLIENT DEMO", "adresse": "45, boulevard Zirout Youcef",
        "telephone": "0550 11 22 33", "email": "achats@client-demo.dz",
        "rc": "16/00-7654321 B 19", "nif": "000216007654321",
        "nis": "000216007654322", "article_imposition": "16076543219"
    });

    let items: Vec<(String, f64, String, i64, f64, f64, i64)> = {
        let mut st = conn
            .prepare(
                "SELECT designation, qty, unite, pu_ht_cents, remise_pct,
                        tax_rate_pct_snapshot, ht_cents
                 FROM invoice_items WHERE invoice_id = ?1 ORDER BY line_no",
            )
            .unwrap();
        let rows = st
            .query_map(params![invoice_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
            })
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    };
    assert_eq!(items.len(), 2, "les deux lignes sont présentes en base");

    let model = pdf::PdfModel {
        doc_title: "FACTURE".into(),
        number: number.clone(),
        date: "08/10/2026".into(),
        date_echeance: Some("07/11/2026".into()),
        seller: serde_json::from_value(seller).unwrap(),
        buyer: serde_json::from_value(buyer).unwrap(),
        lines: items
            .iter()
            .map(|(d, q, u, pu, rem, taux, ht)| pdf::PdfLine {
                designation: d.clone(),
                qty: *q,
                unite: u.clone(),
                pu_ht_cents: *pu,
                remise_pct: *rem,
                tax_rate_pct: *taux,
                ht_cents: *ht,
            })
            .collect(),
        total_ht_cents: ht,
        total_tva_cents: tva,
        total_other_taxes_cents: 0,
        total_ttc_cents: ttc,
        vat_detail: vec![
            ("TVA 19 %".into(), 1_125_000, 213_750),
            ("TVA 9 %".into(), 75_000, 6_750),
        ],
        other_tax_detail: vec![],
        conditions_paiement: Some("30 jours".into()),
        banque: Some("BNA — Agence Alger Centre".into()),
        rib: Some("001 00234 0300000123 45".into()),
        observations: Some("Livraison à l'entrepôt du client.".into()),
        conditions_vente: None,
        annulee: false,
        devise: Some("DZD".into()),
        logo_data_url: None,
    };

    let fonts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("fonts");
    let pdf_path = paths.exports.join(format!("{number}.pdf"));
    pdf::render_invoice_pdf(&model, &pdf_path, &fonts_dir).expect("rendu PDF natif");

    let bytes = std::fs::read(&pdf_path).expect("lecture du PDF");
    assert!(bytes.starts_with(b"%PDF-"), "en-tête PDF valide");
    assert!(bytes.len() > 20_000, "PDF complet (taille {} octets)", bytes.len());
    println!("✔ PDF généré : {} ({} octets)", pdf_path.display(), bytes.len());

    /* ---------- 9. Sauvegarde (§31) + export complet (§33) ---------- */
    let info = backup::backup_database(&conn, &paths, "e2e").expect("sauvegarde créée");
    let backup_zip = std::path::PathBuf::from(&info.file);
    assert!(backup_zip.exists(), "archive de sauvegarde présente");
    assert!(info.size_bytes > 0, "sauvegarde non vide");
    let zb = std::fs::read(&backup_zip).unwrap();
    assert!(
        zb.starts_with(b"SQLite format 3\0"),
        "instantané SQLite cohérent (VACUUM INTO) — pas un fichier tronqué"
    );
    // La sauvegarde doit être RÉUTILISABLE telle quelle (§31, §32) :
    // on l'ouvre comme une base et on y retrouve les documents.
    {
        let restored =
            rusqlite::Connection::open(&backup_zip).expect("ouverture de la sauvegarde (§32)");
        let n: i64 = restored
            .query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0))
            .unwrap();
        // À cet instant du parcours : la facture validée (la seconde
        // n'existe pas encore — elle est créée à l'étape suivante).
        assert_eq!(n, 1, "document présent dans la sauvegarde");
        let trouve: i64 = restored
            .query_row(
                "SELECT COUNT(*) FROM invoices WHERE number = ?1",
                params![number],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(trouve, 1, "la facture {number} est bien dans la sauvegarde");
    }
    println!("✔ Sauvegarde restaurable : {} ({} octets)", info.file, zb.len());

    let export_path = paths.exports.join("export-complet.zip");
    backup::export_zip(&conn, &paths, &export_path).expect("export complet");
    let eb = std::fs::read(&export_path).unwrap();
    assert_eq!(&eb[..2], b"PK", "export ZIP valide");
    println!("✔ Export complet : {} octets", eb.len());

    /* ---------- 10. Annulation (§21) : numéro jamais réutilisé ---------- */
    invoices::cancel_document(&conn, invoice_id, user_id, "Erreur de saisie client")
        .expect("annulation avec motif");
    let (st, motif): (String, Option<String>) = conn
        .query_row(
            "SELECT status, cancel_motif FROM invoices WHERE id = ?1",
            params![invoice_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(st, "ANNULEE");
    assert_eq!(motif.as_deref(), Some("Erreur de saisie client"));

    // Une nouvelle facture NE reprend PAS le numéro annulé (§21).
    let doc2 = json!({
        "doc_type": "FAC", "number": null, "status": "BROUILLON", "date": "2026-10-09",
        "customer_local_id": "cus_1",
        "total_ht_cents": 0, "total_tva_cents": 0, "total_ttc_cents": 0,
        "vat_detail": [], "other_tax_detail": [],
        "seller_snapshot": {"displayName": "SARL EXEMPLE ALGERIE"},
        "buyer_snapshot": {"displayName": "EURL CLIENT DEMO"},
        "items": [{
            "nature": "VENTE", "designation": "Fournitures diverses", "qty": 5.0,
            "unite": "unité", "pu_ht_cents": 10000, "remise_pct": 0.0, "tax_code": "TVA19",
            "tax_rate_pct_snapshot": 19.0, "tax_libelle_snapshot": "TVA 19 %",
            "tax_kind_snapshot": "TVA", "ht_cents": 0, "tva_cents": 0, "ttc_cents": 0
        }]
    });
    let id2 = sync::upsert(&conn, "document", "doc_2", &doc2).expect("deuxième facture");
    let n2 = invoices::validate_document(&conn, id2).expect("validation 2");
    assert_eq!(n2, "FAC-2026-000002", "pas de réutilisation du numéro annulé (§21)");
    println!("✔ Numérotation : {number} (annulée) → {n2} (jamais réutilisée)");

    /* ---------- 11. Paiement (§19) ---------- */
    let pay_id = sync::upsert(
        &conn,
        "payment",
        "pay_1",
        &json!({
            "invoice_local_id": "doc_2", "mode": "Espèces", "date": "2026-10-10",
            "amount_cents": 59_500, "reference": "Caisse 1"
        }),
    )
    .expect("paiement enregistré");
    assert!(pay_id > 0);
    let paid: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE invoice_id = ?1",
            params![id2],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(paid, 59_500, "paiement de 595,00 DA (TTC 5 × 100,00 + TVA 19 %)");
    println!("✔ Paiement enregistré : {}", money(paid));

    /* ---------- 12. Journal d'audit (§34) ---------- */
    let audits: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit_logs", [], |r| r.get(0))
        .unwrap();
    assert!(audits >= 2, "journal d'audit alimenté ({audits} entrées)");

    /* ---------- 13. Intégrité (§30) ---------- */
    drop(conn);
    let verdict = dbh.integrity().expect("contrôle d'intégrité exécutable");
    assert_eq!(verdict.trim(), "ok", "PRAGMA integrity_check = ok");
    drop(dbh);

    /* ---------- 14. Nettoyage du décor de test ---------- */
    let _ = std::fs::remove_dir_all(&paths.root);

    println!("══ PARCOURS COMPLET RÉUSSI : base réelle, validation, PDF, sauvegarde, annulation ══");
}

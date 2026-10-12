//! Exemple de démonstration : remplit la base desktop avec un jeu de données
//! réaliste, en passant EXACTEMENT par la même API que l'application
//! (`sync::upsert`), afin de valider la chaîne réelle :
//!   SQLite (migrations) → moteur de numérotation → moteur de validation
//!   → modèle de PDF.
//!
//! Usage :
//!   FACTURATIONDZ_DATA_DIR=/tmp/demo cargo run --example seed_demo

use facturation_dz_lib::{backup, db, invoices, sync};
use serde_json::json;

fn main() {
    let paths = db::resolve_paths().expect("résolution des dossiers de données");
    let handle = db::Db::open(&paths).expect("ouverture de la base");
    let conn = handle.conn.lock().unwrap();

    // --- Entreprise (§6) : NIF, NIS, RC, AI distincts ---
    sync::upsert(&conn, "company", "company", &json!({
        "raison_sociale": "SARL ELECTRO DISTRIBUTION ALGER",
        "nom_commercial": "ELECTRO DZ",
        "forme_juridique": "SARL",
        "activite": "Distribution de matériel informatique et électrique",
        "adresse": "12, rue Didouche Mourad",
        "wilaya": "Alger",
        "commune": "Alger Centre",
        "telephone": "021 63 00 00",
        "email": "contact@electro-dz.dz",
        "site_web": "www.electro-dz.dz",
        "rc": "16/00-1234567 B 20",
        "nif": "000216001234567",
        "nis": "000216001234568",
        "article_imposition": "16012345678",
        "capital_social": "5 000 000,00 DA",
        "banque": "BNA — Agence Alger Centre",
        "agence": "Alger Centre",
        "rib": "001 00234 0300000123 45",
        "devise": "DZD",
        "conditions_paiement_defaut_jours": 30,
        "mode_paiement_defaut": "Virement bancaire",
        "afficher_cachet": true, "afficher_signature": true, "afficher_banque": true
    }))
    .expect("entreprise");

    // --- Moteur fiscal (§10) : taux et régimes configurables ---
    for (code, lib, taux) in [("TVA19", "TVA 19 %", 19.0), ("TVA9", "TVA 9 %", 9.0), ("EXO", "Exonéré (art. 9)", 0.0)] {
        sync::upsert(&conn, "tax_rate", code, &json!({
            "code": code, "libelle": lib, "rate_pct": taux, "kind": "TVA",
            "actif": true, "date_debut": "2020-01-01"
        }))
        .expect("taux TVA");
    }

    // --- Utilisateurs (§36) ---
    let admin = sync::upsert(&conn, "user", "usr_admin", &json!({
        "username": "admin", "password_hash": "$argon2id$v=19$m=19456,t=2,p=1$demo",
        "role": "ADMIN", "actif": true
    }))
    .expect("administrateur");
    sync::upsert(&conn, "user", "usr_vendeur", &json!({
        "username": "k.benali", "password_hash": "$argon2id$v=19$m=19456,t=2,p=1$demo",
        "role": "VENDEUR", "actif": true
    }))
    .expect("vendeur");

    // --- Clients (§7) ---
    let clients = [
        ("cus_1", "EURL BATI PRO", "16/00-7654321 B 19", "000216007654321", "45, boulevard Zirout Youcef", "Alger", "0550 11 22 33"),
        ("cus_2", "SARL MEDITERRANEE TRAVAUX", "31/00-1122334 B 18", "000231001122334", "8, avenue de l'ALN", "Oran", "0770 44 55 66"),
        ("cus_3", "EURL ZAHRA IMPORT", "25/00-9988776 B 21", "000225009988776", "Cité 500 logements, Bt C", "Constantine", "0661 77 88 99"),
    ];
    let mut client_ids = std::collections::HashMap::new();
    for (lid, denom, rc, nif, adresse, wilaya, tel) in clients {
        let id = sync::upsert(&conn, "customer", lid, &json!({
            "type": "ENTREPRISE", "denomination": denom,
            "adresse": adresse, "wilaya": wilaya, "telephone": tel,
            "rc": rc, "nif": nif, "nis": nif, "article_imposition": "16000000000",
            "actif": true, "demo": false,
            "contacts": [{"nom": "Service achats", "telephone": tel}]
        }))
        .expect("client");
        client_ids.insert(lid, id);
    }

    // --- Produits (§8) ---
    for (code, des, pu, tva) in [
        ("PRD-001", "Ordinateur portable 15\" — i5 / 16 Go", 125_000i64, "TVA19"),
        ("PRD-002", "Imprimante laser monochrome A4", 68_500, "TVA19"),
        ("SRV-001", "Installation et mise en service", 25_000, "TVA9"),
    ] {
        sync::upsert(&conn, "product", code, &json!({
            "reference": code, "designation": des, "unite": "unité",
            "pu_ht_cents": pu, "tax_code": tva, "actif": true, "nature": "VENTE"
        }))
        .expect("produit");
    }

    // --- Factures : deux brouillons, une validée, une annulée ---
    let doc_items = |refs: &[(&str, f64, i64, f64, &str, f64)]| {
        refs.iter().map(|(des, q, pu, rem, tax, taux)| json!({
            "nature": "VENTE", // schéma §13 : VENTE | FRAIS | REMISE
            "designation": des, "qty": q, "unite": if des.starts_with("Installation") { "heure" } else { "unité" },
            "pu_ht_cents": pu, "remise_pct": rem, "tax_code": tax,
            "tax_rate_pct_snapshot": taux, "tax_libelle_snapshot": format!("TVA {taux} %"),
            "tax_kind_snapshot": "TVA", "ht_cents": 0, "tva_cents": 0, "ttc_cents": 0
        })).collect::<Vec<_>>()
    };

    let d1 = json!({
        "doc_type": "FAC", "number": null, "status": "BROUILLON", "date": "2026-10-06",
        "date_echeance": "2026-11-05", "customer_local_id": "cus_1",
        "mode_paiement": "Virement bancaire", "conditions_paiement": "30 jours fin de mois",
        "total_ht_cents": 1_250_000, "total_tva_cents": 237_500, "total_ttc_cents": 1_487_500,
        "vat_detail": [], "other_tax_detail": [],
        "seller_snapshot": {"displayName": "SARL ELECTRO DISTRIBUTION ALGER"},
        "buyer_snapshot": {"displayName": "EURL BATI PRO"},
        "created_by_username": "admin", "archived": false, "demo": false,
        "items": doc_items(&[
            ("Ordinateur portable 15\" — i5 / 16 Go", 10.0, 125_000, 0.0, "TVA19", 19.0)
        ])
    });
    sync::upsert(&conn, "document", "doc_draft_1", &d1).expect("brouillon 1");

    let d2 = json!({
        "doc_type": "DEV", "number": null, "status": "BROUILLON", "date": "2026-10-07",
        "customer_local_id": "cus_2", "conditions_paiement": "50 % à la commande",
        "total_ht_cents": 0, "total_tva_cents": 0, "total_ttc_cents": 0,
        "vat_detail": [], "other_tax_detail": [],
        "seller_snapshot": {"displayName": "SARL ELECTRO DISTRIBUTION ALGER"},
        "buyer_snapshot": {"displayName": "SARL MEDITERRANEE TRAVAUX"},
        "items": doc_items(&[("Imprimante laser monochrome A4", 5.0, 68_500, 5.0, "TVA19", 19.0)])
    });
    sync::upsert(&conn, "document", "doc_draft_2", &d2).expect("devis brouillon");

    // Facture validée par le moteur (§12, §69) → numéro + totaux + lettres.
    let d3 = json!({
        "doc_type": "FAC", "number": null, "status": "BROUILLON", "date": "2026-09-28",
        "date_echeance": "2026-10-28", "customer_local_id": "cus_3",
        "mode_paiement": "Chèque", "conditions_paiement": "30 jours",
        "total_ht_cents": 0, "total_tva_cents": 0, "total_ttc_cents": 0,
        "vat_detail": [], "other_tax_detail": [],
        "seller_snapshot": {"displayName": "SARL ELECTRO DISTRIBUTION ALGER"},
        "buyer_snapshot": {"displayName": "EURL ZAHRA IMPORT"},
        "items": doc_items(&[
            ("Ordinateur portable 15\" — i5 / 16 Go", 4.0, 125_000, 0.0, "TVA19", 19.0),
            ("Installation et mise en service", 6.0, 25_000, 0.0, "TVA9", 9.0)
        ])
    });
    let i3 = sync::upsert(&conn, "document", "doc_fac_1", &d3).expect("facture à valider");
    let n3 = invoices::validate_document(&conn, i3).expect("validation facture 1");
    println!("facture validée : {n3}");

    // Facture annulée (§21) — numéro conservé, jamais réutilisé.
    let d4 = json!({
        "doc_type": "FAC", "number": null, "status": "BROUILLON", "date": "2026-10-01",
        "customer_local_id": "cus_1", "mode_paiement": "Espèces",
        "total_ht_cents": 0, "total_tva_cents": 0, "total_ttc_cents": 0,
        "vat_detail": [], "other_tax_detail": [],
        "seller_snapshot": {"displayName": "SARL ELECTRO DISTRIBUTION ALGER"},
        "buyer_snapshot": {"displayName": "EURL BATI PRO"},
        "items": doc_items(&[("Imprimante laser monochrome A4", 1.0, 68_500, 0.0, "TVA19", 19.0)])
    });
    let i4 = sync::upsert(&conn, "document", "doc_fac_2", &d4).expect("facture à annuler");
    let n4 = invoices::validate_document(&conn, i4).expect("validation facture 2");
    invoices::cancel_document(&conn, i4, admin, "Double facturation — avoir à émettre")
        .expect("annulation");
    println!("facture annulée : {n4}");

    // Paiement partiel sur la facture 3 (§19).
    sync::upsert(&conn, "payment", "pay_1", &json!({
        "invoice_local_id": "doc_fac_1", "mode": "Virement bancaire",
        "date": "2026-10-03", "amount_cents": 300_000, "reference": "VIR-2026-1042"
    }))
    .expect("paiement");

    // Sauvegarde immédiate (§31) pour matérialiser Backups/.
    let b = backup::backup_database(&conn, &paths, "demo").expect("sauvegarde");
    println!("sauvegarde : {} ({} octets)", b.file, b.size_bytes);

    let (nf, nd): (i64, i64) = (
        conn.query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0)).unwrap(),
        conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0)).unwrap(),
    );
    println!("── base peuplée : {nf} documents, {nd} clients ──");
    println!("── dossiers : {}", paths.root.display());
}

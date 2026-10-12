//! Moteur de numérotation (§12, §55, §56).
//! Séquentiel, UNIQUE, attribué en transaction : deux utilisateurs ne
//! peuvent JAMAIS obtenir le même numéro (§12). Un numéro attribué n'est
//! jamais réutilisé, même après annulation (§21).

use rusqlite::{params, Connection};

use crate::error::{AppError, Result};

pub fn render_number(template: &str, year: i32, counter: i64, padding: usize) -> String {
    template
        .replace("{YEAR}", &year.to_string())
        .replace("{COUNTER}", &format!("{counter:0width$}", width = padding))
}

/// Attribue le prochain numéro pour (doc_type, année).
/// Doit être appelé DANS une transaction (verrou SQLite = anti-collision).
pub fn allocate_number(
    conn: &Connection,
    doc_type: &str,
    year: i32,
) -> Result<String> {
    // Crée la ligne de séquence si nécessaire.
    conn.execute(
        "INSERT OR IGNORE INTO invoice_sequences (doc_type, year, template, padding, counter)
         VALUES (?1, ?2,
                 CASE ?1 WHEN 'FAC' THEN 'FAC-{YEAR}-{COUNTER}'
                         WHEN 'DEV' THEN 'DEV-{YEAR}-{COUNTER}'
                         WHEN 'PRO' THEN 'PRO-{YEAR}-{COUNTER}'
                         WHEN 'BL'  THEN 'BL-{YEAR}-{COUNTER}'
                         ELSE 'AV-{YEAR}-{COUNTER}' END,
                 6, 0)",
        params![doc_type, year],
    )?;

    // Incrémentation atomique + lecture dans la même transaction.
    conn.execute(
        "UPDATE invoice_sequences SET counter = counter + 1 WHERE doc_type = ?1 AND year = ?2",
        params![doc_type, year],
    )?;
    let (counter, template, padding): (i64, String, usize) = conn.query_row(
        "SELECT counter, template, padding FROM invoice_sequences WHERE doc_type = ?1 AND year = ?2",
        params![doc_type, year],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    if counter < 1 {
        return Err(AppError::User(
            "Compteur de numérotation invalide (§12).".into(),
        ));
    }
    Ok(render_number(&template, year, counter, padding))
}

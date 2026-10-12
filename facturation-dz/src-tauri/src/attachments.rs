//! Pièces jointes (§61) : fichiers stockés dans Documents/, JAMAIS en base.
//! La base SQLite ne garde que la référence (nom, chemin relatif, taille).

use std::path::PathBuf;

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::AppPaths;
use crate::error::{AppError, Result};

#[derive(Serialize)]
pub struct AttachmentInfo {
    pub file_name: String,
    pub file_path: String, // relatif au dossier Documents/
    pub mime: Option<String>,
    pub size_bytes: i64,
}

/// Caractères autorisés dans un nom de fichier (anti path-traversal).
fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' })
        .collect();
    // Retire aussi les points/têtes vides pour neutraliser « .. » et « . ».
    let cleaned = cleaned.trim().trim_start_matches(['.', ' ']).to_string();
    if cleaned.is_empty() {
        "fichier".to_string()
    } else {
        cleaned
    }
}

fn invoice_folder(conn: &Connection, invoice_id: i64) -> Result<String> {
    let number: Option<String> = conn
        .query_row("SELECT number FROM invoices WHERE id = ?1", params![invoice_id], |r| r.get(0))
        .optional()?
        .flatten();
    Ok(number.map(|n| sanitize_segment(&n)).unwrap_or_else(|| format!("document-{invoice_id}")))
}

/// Enregistre une pièce jointe (contenu base64) dans Documents/<dossier>/<nom>.
pub fn save_attachment(
    paths: &AppPaths,
    conn: &Connection,
    invoice_local_id: &str,
    name: &str,
    data_b64: &str,
    mime: Option<&str>,
) -> Result<AttachmentInfo> {
    let invoice_id: i64 = conn
        .query_row(
            "SELECT desktop_id FROM desktop_ids WHERE entity = 'document' AND local_id = ?1",
            params![invoice_local_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::User("Le document lié n'est pas encore synchronisé.".into()))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|_| AppError::User("Contenu de la pièce jointe illisible (base64 invalide).".into()))?;
    const MAX_SIZE: usize = 20 * 1024 * 1024;
    if bytes.len() > MAX_SIZE {
        return Err(AppError::User("Pièce jointe trop volumineuse (maximum : 20 Mo).".into()));
    }

    let folder = invoice_folder(conn, invoice_id)?;
    let dir = paths.documents.join(&folder);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::User(format!("Création du dossier des pièces impossible : {e}")))?;

    // Évite l'écrasement : nom-1.ext, nom-2.ext…
    let base = sanitize_segment(name);
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (base.clone(), String::new()),
    };
    let mut file_name = base.clone();
    let mut n = 1;
    while dir.join(&file_name).exists() {
        file_name = format!("{stem}-{n}{ext}");
        n += 1;
    }

    let target = dir.join(&file_name);
    std::fs::write(&target, &bytes)
        .map_err(|e| AppError::User(format!("Écriture de la pièce jointe impossible : {e}")))?;

    let rel_path = format!("{folder}/{file_name}");
    conn.execute(
        "INSERT INTO invoice_attachments (invoice_id, file_name, file_path, mime, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![invoice_id, file_name, rel_path, mime, bytes.len() as i64],
    )?;
    log::info!("Pièce jointe enregistrée : {rel_path}");
    Ok(AttachmentInfo {
        file_name,
        file_path: rel_path,
        mime: mime.map(|s| s.to_string()),
        size_bytes: bytes.len() as i64,
    })
}

/// Liste les pièces jointes d'un document.
pub fn list_attachments(conn: &Connection, invoice_local_id: &str) -> Result<Vec<AttachmentInfo>> {
    let Some(invoice_id): Option<i64> = conn
        .query_row(
            "SELECT desktop_id FROM desktop_ids WHERE entity = 'document' AND local_id = ?1",
            params![invoice_local_id],
            |r| r.get(0),
        )
        .optional()?
    else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT file_name, file_path, mime, size_bytes FROM invoice_attachments
         WHERE invoice_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(params![invoice_id], |r| {
        Ok(AttachmentInfo {
            file_name: r.get(0)?,
            file_path: r.get(1)?,
            mime: r.get(2)?,
            size_bytes: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

/// Supprime une pièce jointe (fichier + ligne).
pub fn delete_attachment(conn: &Connection, paths: &AppPaths, invoice_local_id: &str, file_name: &str) -> Result<()> {
    let Some(invoice_id): Option<i64> = conn
        .query_row(
            "SELECT desktop_id FROM desktop_ids WHERE entity = 'document' AND local_id = ?1",
            params![invoice_local_id],
            |r| r.get(0),
        )
        .optional()?
    else {
        return Ok(());
    };
    let path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM invoice_attachments WHERE invoice_id = ?1 AND file_name = ?2",
            params![invoice_id, file_name],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(rel) = path {
        // Sécurité : le chemin relatif ne doit jamais sortir de Documents/.
        let full: PathBuf = paths.documents.join(&rel);
        if full.starts_with(&paths.documents) {
            let _ = std::fs::remove_file(&full);
        }
        conn.execute(
            "DELETE FROM invoice_attachments WHERE invoice_id = ?1 AND file_name = ?2",
            params![invoice_id, file_name],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_paths;
    use crate::sync;

    #[test]
    fn sanitize_bloque_path_traversal() {
        assert_eq!(sanitize_segment("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize_segment(".."), "fichier");
        assert_eq!(sanitize_segment(""), "fichier");
    }

    #[test]
    fn save_list_delete_attachment() {
        let conn = crate::db::test_connection();
        let paths = test_paths();
        // Un document mirroré d'abord.
        sync::upsert(&conn, "customer", "cus_1", &serde_json::json!({"type":"ENTREPRISE","denomination":"X"})).unwrap();
        sync::upsert(&conn, "document", "doc_1", &serde_json::json!({
            "doc_type":"FAC","status":"VALIDEE","number":"FAC-2026-000001","date":"2026-10-08",
            "customer_local_id":"cus_1","items":[]
        })).unwrap();

        let b64 = base64::engine::general_purpose::STANDARD.encode(b"bonjour");
        let info = save_attachment(&paths, &conn, "doc_1", "bon de commande.pdf", &b64, Some("application/pdf")).unwrap();
        assert!(info.file_path.starts_with("FAC-2026-000001/"));
        assert!(paths.documents.join(&info.file_path).exists());

        // Doublon : pas d'écrasement.
        let info2 = save_attachment(&paths, &conn, "doc_1", "bon de commande.pdf", &b64, None).unwrap();
        assert_ne!(info2.file_name, info.file_name);

        let list = list_attachments(&conn, "doc_1").unwrap();
        assert_eq!(list.len(), 2);

        delete_attachment(&conn, &paths, "doc_1", &info.file_name).unwrap();
        assert!(!paths.documents.join(&info.file_path).exists());
        assert_eq!(list_attachments(&conn, "doc_1").unwrap().len(), 1);
    }
}

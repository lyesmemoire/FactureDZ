//! Moteur de sauvegarde (§30, §31, §32, §33).
//! Règle absolue §81 : les données utilisateur ne sont JAMAIS sacrifiées.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::db::AppPaths;
use crate::error::{AppError, Result};

#[derive(Serialize)]
pub struct BackupInfo {
    pub file: String,
    pub size_bytes: u64,
}

/// Échappe un chemin pour VACUUM INTO (pas de paramètre lié possible).
fn sql_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn backup_filename(label: &str) -> String {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let safe_label: String = label
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("facturation_{stamp}_{safe_label}.backup.sqlite")
}

/// Sauvegarde SQLite cohérente via VACUUM INTO (§30, §31).
pub fn backup_database(conn: &Connection, paths: &AppPaths, label: &str) -> Result<BackupInfo> {
    let file = paths.backups.join(backup_filename(label));
    conn.execute(&format!("VACUUM INTO {}", sql_literal(&file.to_string_lossy())), [])?;
    let size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    log::info!("Sauvegarde créée : {file:?} ({size} octets)");
    Ok(BackupInfo {
        file: file.to_string_lossy().into_owned(),
        size_bytes: size,
    })
}

/// Sauvegarde de sécurité, utilisée AVANT une restauration (§32).
pub fn create_safety_backup(conn: &Connection, paths: &AppPaths) -> Result<PathBuf> {
    let file = paths.backups.join(backup_filename("securite_avant_restauration"));
    conn.execute(&format!("VACUUM INTO {}", sql_literal(&file.to_string_lossy())), [])?;
    log::info!("Sauvegarde de sécurité : {file:?}");
    Ok(file)
}

/// Rétention (§30) : ne conserver que les N dernières sauvegardes automatiques.
pub fn apply_retention(paths: &AppPaths, keep: usize) {
    let mut files: Vec<PathBuf> = fs::read_dir(&paths.backups)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    files.sort();
    if files.len() > keep {
        for f in files.iter().take(files.len() - keep) {
            let _ = fs::remove_file(f);
        }
    }
}

/// Export complet (§33) : archive .zip locale (base + métadonnées).
pub fn export_zip(conn: &Connection, paths: &AppPaths, dest: &Path) -> Result<()> {
    let io_err = |e: std::io::Error, ctx: &str| {
        AppError::User(format!("{ctx} : {e}"))
    };

    // Base extraite de façon cohérente (VACUUM INTO temporaire).
    let tmp = paths.exports.join("export_database.sqlite");
    conn.execute(
        &format!("VACUUM INTO {}", sql_literal(&tmp.to_string_lossy())),
        [],
    )?;

    let file = fs::File::create(dest).map_err(|e| io_err(e, "Création de l'archive impossible"))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default();
    let zip_err = |e: zip::result::ZipError| AppError::User(format!("Écriture de l'archive ZIP : {e}"));

    let mut db_bytes = Vec::new();
    fs::File::open(&tmp)
        .map_err(|e| io_err(e, "Lecture de la base temporaire impossible"))?
        .read_to_end(&mut db_bytes)
        .map_err(|e| io_err(e, "Lecture de la base temporaire impossible"))?;
    zip.start_file("database.sqlite", opts).map_err(zip_err)?;
    zip.write_all(&db_bytes).map_err(|e| io_err(e, "Écriture de la base dans l'archive"))?;

    let meta = serde_json::json!({
        "app": "FacturationDZ",
        "exported_at": chrono::Local::now().to_rfc3339(),
        "schema_version": 1,
        "note": "Export complet : base SQLite + métadonnées (§33)."
    });
    let meta_str = serde_json::to_string_pretty(&meta)
        .map_err(|e| AppError::User(format!("Métadonnées invalides : {e}")))?;
    zip.start_file("metadata.json", opts).map_err(zip_err)?;
    zip.write_all(meta_str.as_bytes()).map_err(|e| io_err(e, "Écriture des métadonnées dans l'archive"))?;
    zip.finish().map_err(zip_err)?;

    let _ = fs::remove_file(&tmp);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{test_paths, Db};

    fn raison(db: &Db) -> String {
        let conn = db.conn.lock().unwrap();
        conn.query_row("SELECT raison_sociale FROM companies WHERE id = 1", [], |r| r.get(0))
            .unwrap()
    }

    /// Sauvegarde → modification → restauration : la base redevient celle
    /// de la sauvegarde (§30, §32).
    #[test]
    fn aller_retour_sauvegarde_restauration() {
        let paths = test_paths();
        let db = Db::open(&paths).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO companies (id, raison_sociale) VALUES (1, 'Avant sauvegarde')
                 ON CONFLICT(id) DO UPDATE SET raison_sociale = excluded.raison_sociale",
                [],
            )
            .unwrap();
            let info = backup_database(&conn, &paths, "test").unwrap();
            assert!(info.size_bytes > 0);
            conn.execute("UPDATE companies SET raison_sociale = 'Après sauvegarde' WHERE id = 1", []).unwrap();
        }
        assert_eq!(raison(&db), "Après sauvegarde");

        let fichier = std::fs::read_dir(&paths.backups)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| p.to_string_lossy().contains("facturation_"))
            .expect("fichier de sauvegarde");
        db.restore_from(&paths, &fichier).unwrap();
        assert_eq!(raison(&db), "Avant sauvegarde");
    }
}

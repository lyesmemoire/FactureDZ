//! Couche base de données (§5) : SQLite local, WAL, clés étrangères,
//! migrations versionnées. Le programme et les données sont SÉPARÉS (§3) :
//! la base vit dans C:\ProgramData\FacturationDZ\Data (jamais dans le
//! dossier d'installation) — une mise à jour ne peut pas l'écraser (§51, §81).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::{AppError, Result};

/// Répertoires de données (§3).
pub struct AppPaths {
    pub root: PathBuf,
    pub data: PathBuf,
    pub backups: PathBuf,
    pub documents: PathBuf,
    pub exports: PathBuf,
    pub logs: PathBuf,
}

pub fn resolve_paths() -> std::result::Result<AppPaths, String> {
    // Mode portable (§53) :
    //  1. variable d'environnement FACTURATIONDZ_DATA_DIR (priorité absolue) ;
    //  2. dossier « portable-data » à côté de l'exécutable (clé USB…) ;
    //  3. sinon emplacement standard : C:\ProgramData\FacturationDZ.
    let root = if let Ok(dir) = std::env::var("FACTURATIONDZ_DATA_DIR") {
        PathBuf::from(dir)
    } else if let Some(exe) = std::env::current_exe().ok() {
        let portable = exe.parent().map(|p| p.join("portable-data"));
        if portable.as_ref().map(|p| p.is_dir()).unwrap_or(false) {
            portable.unwrap()
        } else {
            default_root()?
        }
    } else {
        default_root()?
    };

    let paths = AppPaths {
        data: root.join("Data"),
        backups: root.join("Backups"),
        documents: root.join("Documents"),
        exports: root.join("Exports"),
        logs: root.join("Logs"),
        root,
    };
    for p in [&paths.data, &paths.backups, &paths.documents, &paths.exports, &paths.logs] {
        std::fs::create_dir_all(p).map_err(|e| format!("Création du dossier {:?} impossible : {e}", p))?;
    }
    Ok(paths)
}

fn default_root() -> std::result::Result<PathBuf, String> {
    // Windows : C:\ProgramData\FacturationDZ ; sinon dossier de données standard.
    let base = std::env::var("ProgramData")
        .map(PathBuf::from)
        .ok()
        .or_else(dirs::data_dir)
        .ok_or("Impossible de déterminer le dossier de données système.")?;
    Ok(base.join("FacturationDZ"))
}

pub fn database_file(paths: &AppPaths) -> PathBuf {
    paths.data.join("facturation.db")
}

/// Échappe une chaîne pour un littéral SQL simple (VACUUM INTO n'accepte
/// pas de paramètre lié) — neutralise les apostrophes des chemins.
fn sql_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Migrations versionnées (§5, §51) : appliquées dans l'ordre, jamais
/// destructives. AVANT toute migration : sauvegarde automatique (§51).
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../db/migrations/0001_initial.sql")),
    (2, include_str!("../../db/migrations/0002_sync.sql")),
    (3, include_str!("../../db/migrations/0003_revisions.sql")),
    (4, include_str!("../../db/migrations/0004_tax_default.sql")),
    (5, include_str!("../../db/migrations/0005_conditions_vente.sql")),
    (6, include_str!("../../db/migrations/0006_achats.sql")),
];

pub struct Db {
    pub conn: Mutex<Connection>,
}

fn open_with_pragmas(file: &Path) -> Result<Connection> {
    let conn = Connection::open(file)?;
    // Pragmas de fiabilité (§5).
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    Ok(conn)
}

impl Db {
    pub fn open(paths: &AppPaths) -> Result<Self> {
        let file = database_file(paths);
        let existed = file.exists();
        let conn = open_with_pragmas(&file)?;

        // Version de schéma.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               applied_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        )?;
        let current: i64 = conn
            .prepare("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")?
            .query_row([], |r| r.get(0))?;

        for (version, sql) in MIGRATIONS {
            if *version > current {
                if existed && current > 0 {
                    // §51 : backup automatique AVANT migration.
                    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
                    let backup_file = paths.backups.join(format!("pre_migration_v{version}_{stamp}.sqlite"));
                    conn.execute(
                        &format!("VACUUM INTO {}", sql_literal(&backup_file.to_string_lossy())),
                        [],
                    )?;
                    log::info!("Sauvegarde pré-migration : {backup_file:?}");
                }
                log::info!("Application de la migration {version}…");
                let tx = conn.unchecked_transaction()?;
                tx.execute_batch(sql)?;
                tx.execute("INSERT INTO schema_migrations (version) VALUES (?1)", [version])?;
                tx.commit()?;
            }
        }

        Ok(Db { conn: Mutex::new(conn) })
    }

    /// Contrôle d'intégrité SQLite (§49) : PRAGMA integrity_check.
    pub fn integrity(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let ok: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        Ok(ok)
    }

    /// Restauration (§32) : remplace le fichier de base par `source`.
    ///
    /// Séquence sûre sous Windows :
    ///   1. checkpoint WAL puis libération du handle SQLite (mémoire) ;
    ///   2. suppression du fichier et de ses side-files -wal/-shm ;
    ///   3. copie de la sauvegarde ;
    ///   4. réouverture avec pragmas — la connexion suivante voit la base
    ///      restaurée, jamais l'ancienne.
    pub fn restore_from(&self, paths: &AppPaths, source: &Path) -> Result<()> {
        if !source.exists() {
            return Err(AppError::User("Fichier de sauvegarde introuvable.".into()));
        }
        let file = database_file(paths);

        // 1. Libérer le handle fichier.
        {
            let mut guard = self.conn.lock().unwrap();
            let _ = guard.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
            *guard = Connection::open_in_memory()?;
        }
        // 2. Retirer l'ancienne base et ses side-files.
        for suffix in ["", "-wal", "-shm"] {
            let p = PathBuf::from(format!("{}{suffix}", file.to_string_lossy()));
            if p.exists() {
                std::fs::remove_file(&p).map_err(|e| {
                    AppError::User(format!("Impossible de retirer l'ancienne base ({p:?}) : {e}"))
                })?;
            }
        }
        // 3. Copier la sauvegarde.
        std::fs::copy(source, &file).map_err(|e| {
            AppError::User(format!(
                "Restauration impossible (copie de {:?} vers {:?}) : {e}",
                source, file
            ))
        })?;
        // 4. Réouvrir proprement.
        let mut guard = self.conn.lock().unwrap();
        *guard = open_with_pragmas(&file)?;
        log::info!("Base restaurée depuis {source:?}");
        Ok(())
    }
}

/// Utilitaire : exécuter une fonction dans une transaction atomique (§69).
pub fn in_tx<T>(conn: &Connection, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    // NB : le pattern `unchecked_transaction` permet l'imbrication avec un
    // Mutex déjà verrouillé ; COMMIT/ROLLBACK garantit l'atomicité (§69).
    let tx = conn.unchecked_transaction().map_err(AppError::Db)?;
    match f(&tx) {
        Ok(v) => {
            tx.commit().map_err(AppError::Db)?;
            Ok(v)
        }
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

/* ---------------- Tests (§64, §66) ---------------- */

#[cfg(test)]
pub fn test_connection() -> Connection {
    let conn = Connection::open_in_memory().expect("ouverture base en mémoire");
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for (version, sql) in MIGRATIONS {
        conn.execute_batch(sql).unwrap_or_else(|e| panic!("migration {version} : {e}"));
    }
    conn
}

#[cfg(test)]
pub fn test_paths() -> AppPaths {
    let root = std::env::temp_dir().join(format!(
        "facturationdz-test-{}-{}",
        std::process::id(),
        chrono::Local::now().format("%H%M%S%f")
    ));
    let paths = AppPaths {
        data: root.join("Data"),
        backups: root.join("Backups"),
        documents: root.join("Documents"),
        exports: root.join("Exports"),
        logs: root.join("Logs"),
        root,
    };
    for p in [&paths.data, &paths.backups, &paths.documents, &paths.exports, &paths.logs] {
        std::fs::create_dir_all(p).unwrap();
    }
    paths
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    /// Une installation existante (migrations 1 à 3 seulement) reçoit la v4
    /// sans perte : données conservées, valeur par défaut TVA19, sauvegarde
    /// pré-migration créée (§51).
    #[test]
    fn mise_a_niveau_v3_vers_v4_conserve_les_donnees() {
        let paths = test_paths();
        {
            let conn = open_with_pragmas(&database_file(&paths)).unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
            )
            .unwrap();
            for (version, sql) in &MIGRATIONS[..3] {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO schema_migrations (version) VALUES (?1)", [version]).unwrap();
            }
            conn.execute(
                "INSERT INTO companies (raison_sociale, devise) VALUES ('Société antérieure', 'EUR')",
                [],
            )
            .unwrap();
        }

        let db = Db::open(&paths).expect("mise à niveau");
        let conn = db.conn.lock().unwrap();
        let (raison, devise, taxe): (String, String, String) = conn
            .query_row(
                "SELECT raison_sociale, devise, tax_code_defaut FROM companies WHERE raison_sociale = 'Société antérieure'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("la société existante doit subsister");
        assert_eq!(raison, "Société antérieure");
        assert_eq!(devise, "EUR", "la monnaie existante ne doit pas changer");
        assert_eq!(taxe, "TVA19", "défaut appliqué à la colonne ajoutée");
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 6);
        drop(conn);

        let sauvegardes: Vec<_> = std::fs::read_dir(&paths.backups)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("pre_migration_"))
            .collect();
        assert!(!sauvegardes.is_empty(), "sauvegarde pré-migration attendue (§51)");
    }
}

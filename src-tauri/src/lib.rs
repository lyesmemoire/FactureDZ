//! FacturationDZ — backend desktop (§2) : Tauri + Rust + SQLite.
//! 100 % hors ligne (§4) — aucune API, aucune télémétrie (§62).

pub mod attachments;
pub mod audit;
pub mod auth;
pub mod backup;
pub mod commands;
pub mod db;
pub mod error;
pub mod import;
pub mod invoices;
pub mod money_fr;
pub mod permissions;
pub mod numbering;
pub mod pdf;
pub mod sync;

/// Parcours d'intégration de bout en bout (§64, §65) — base réelle, PDF, sauvegarde.
#[cfg(test)]
mod e2e;

use std::sync::Mutex;

use commands::AppState;

/// Logger technique fichier (§67) — séparé du journal d'audit (§34).
/// Ne journalise JAMAIS de mots de passe (les commandes n'en transportent pas
/// vers le log ; règle rappelée dans SECURITY.md).
struct FileLogger(std::path::PathBuf);

impl log::Log for FileLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.0)
        {
            let _ = writeln!(
                f,
                "{} [{:>8}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level().to_string(),
                record.args()
            );
        }
    }
    fn flush(&self) {}
}

fn init_logger(logs_dir: &std::path::Path) {
    let path = logs_dir.join("facturationdz.log");
    if log::set_boxed_logger(Box::new(FileLogger(path))).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = db::resolve_paths().expect("Impossible d'initialiser les dossiers de données (§3).");
    init_logger(&paths.logs);

    let database = db::Db::open(&paths).expect("Ouverture de la base SQLite impossible (§5).");
    let fonts_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("resources").join("fonts")))
        .unwrap_or_else(|| std::path::PathBuf::from("resources/fonts"));

    let state = AppState {
        db: database,
        fonts_dir,
        paths,
        current_user: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::integrity_check,
            commands::validate_document,
            commands::cancel_document,
            commands::add_payment,
            commands::backup_now,
            commands::restore_backup,
            commands::export_zip,
            commands::render_pdf,
            commands::render_pdf_to_exports,
            commands::auth_login,
            commands::auth_logout,
            commands::auth_create_user,
            commands::auth_change_password,
            commands::auth_set_active,
            commands::auth_list_users,
            commands::sync_upsert,
            commands::sync_delete,
            commands::load_dataset,
            commands::save_attachment,
            commands::read_import_table,
            commands::list_attachments,
            commands::delete_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("Démarrage de l'application FacturationDZ impossible");
}

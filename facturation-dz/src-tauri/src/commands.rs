//! Commandes IPC exposées au frontend React.
//! Chaque commande retourne soit le résultat, soit un message d'erreur
//! en langage clair (§68) — jamais d'erreur technique brute.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{AppPaths, Db};
use crate::error::{AppError, ErrorPayload};
use crate::{attachments, auth, backup, invoices, sync};

pub struct AppState {
    pub db: Db,
    pub paths: AppPaths,
    pub fonts_dir: PathBuf,
    pub current_user: Mutex<Option<i64>>,
}

type CmdResult<T> = std::result::Result<T, ErrorPayload>;

fn current_user(state: &AppState) -> i64 {
    state.current_user.lock().unwrap().unwrap_or(0)
}

/* ---------------- Authentification (§35, §36) ---------------- */

#[tauri::command]
pub fn auth_login(state: State<AppState>, username: String, password: String) -> CmdResult<Option<auth::AuthUser>> {
    let conn = state.db.conn.lock().unwrap();
    let user = auth::verify_and_upgrade(&conn, &username, &password).map_err(ErrorPayload::from)?;
    if let Some(u) = &user {
        *state.current_user.lock().unwrap() = Some(u.id);
        let ttl: i64 = conn
            .query_row("SELECT value FROM settings WHERE key='lock_timeout_minutes'", [], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15);
        let _ = auth::open_session(&conn, u.id, ttl).map_err(ErrorPayload::from)?;
        crate::audit::log_audit(&conn, Some(u.id), "CONNEXION", "user", None,
            Some(&format!("Session ouverte : {}", u.username)), None, None)
            .map_err(ErrorPayload::from)?;
    }
    Ok(user)
}

#[tauri::command]
pub fn auth_logout(state: State<AppState>) -> CmdResult<()> {
    let user_id = state.current_user.lock().unwrap().take();
    let conn = state.db.conn.lock().unwrap();
    crate::audit::log_audit(&conn, user_id, "DECONNEXION", "user", None, None, None, None)
        .map_err(ErrorPayload::from)
}

/// Contrôle d'accès (§35, §36) : vérifie le droit `action` pour l'utilisateur
/// de la session courante. La règle est dans `permissions::require_action`.
fn authorize(state: &AppState, action: &str) -> CmdResult<()> {
    let user = *state.current_user.lock().unwrap();
    let conn = state.db.conn.lock().unwrap();
    crate::permissions::require_action(&conn, user, action).map_err(ErrorPayload::from)
}

/// Droit requis pour un `sync_upsert` : dépend du type d'entité et, pour un
/// document, de son changement de statut (validation, annulation, encaissement).
fn authorize_upsert(state: &AppState, entity: &str, local_id: &str, data: &serde_json::Value) -> CmdResult<()> {
    let new_status = data.get("status").and_then(|v| v.as_str()).map(str::to_owned);
    let existing: Option<String> = if entity == "document" {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT i.status FROM desktop_ids d JOIN invoices i ON i.id = d.desktop_id
             WHERE d.entity = 'document' AND d.local_id = ?1",
            rusqlite::params![local_id],
            |r| r.get(0),
        )
        .ok()
    } else {
        None
    };
    let action = crate::permissions::sync_action(entity, new_status.as_deref(), existing.as_deref());
    authorize(state, action)
}

#[tauri::command]
pub fn auth_create_user(state: State<AppState>, username: String, password: String, role: String) -> CmdResult<i64> {
    authorize(&state, "users.manage")?;
    let conn = state.db.conn.lock().unwrap();
    let id = auth::create_user(&conn, &username, &password, &role).map_err(ErrorPayload::from)?;
    let by = *state.current_user.lock().unwrap();
    crate::audit::log_audit(&conn, by, "CREATION_UTILISATEUR",
        "user", Some(&id.to_string()), Some(&format!("{username} ({role})")), None, None)
        .map_err(ErrorPayload::from)?;
    Ok(id)
}

#[tauri::command]
pub fn auth_change_password(state: State<AppState>, user_id: i64, current: String, new: String) -> CmdResult<()> {
    let conn = state.db.conn.lock().unwrap();
    auth::change_password(&conn, user_id, &current, &new).map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn auth_set_active(state: State<AppState>, user_id: i64, actif: bool) -> CmdResult<()> {
    authorize(&state, "users.manage")?;
    let conn = state.db.conn.lock().unwrap();
    auth::set_user_active(&conn, user_id, actif).map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn auth_list_users(state: State<AppState>) -> CmdResult<Vec<auth::AuthUser>> {
    let conn = state.db.conn.lock().unwrap();
    auth::list_users(&conn).map_err(ErrorPayload::from)
}

/* ---------------- Synchronisation frontend ↔ SQLite (§70) ---------------- */

#[tauri::command]
pub fn sync_upsert(state: State<AppState>, entity: String, local_id: String, data: serde_json::Value) -> CmdResult<i64> {
    authorize_upsert(&state, &entity, &local_id, &data)?;
    let conn = state.db.conn.lock().unwrap();
    crate::db::in_tx(&conn, |tx| sync::upsert(tx, &entity, &local_id, &data))
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn sync_delete(state: State<AppState>, entity: String, local_id: String) -> CmdResult<()> {
    authorize(&state, crate::permissions::sync_delete_action(&entity))?;
    let conn = state.db.conn.lock().unwrap();
    crate::db::in_tx(&conn, |tx| sync::delete(tx, &entity, &local_id))
        .map_err(ErrorPayload::from)
}

/// Réhydratation complète de l'état frontend depuis SQLite (§32).
#[tauri::command]
pub fn load_dataset(state: State<AppState>) -> CmdResult<serde_json::Value> {
    let conn = state.db.conn.lock().unwrap();
    sync::load_dataset(&conn).map_err(ErrorPayload::from)
}

/* ---------------- Import Excel / CSV ---------------- */

/// Lit la première feuille (xlsx/xls/ods) ou le CSV envoyé en base64.
/// Ne modifie rien : le mapping et l'enregistrement se font dans l'interface.
#[tauri::command]
pub fn read_import_table(
    state: State<AppState>,
    file_name: String,
    data_b64: String,
) -> CmdResult<Vec<Vec<String>>> {
    // Lecture seule : toute session ouverte peut lire un fichier ; l'écriture est contrôlée
    // par document.write / catalog.write au moment de l'enregistrement.
    if state.current_user.lock().unwrap().is_none() {
        return Err(ErrorPayload::from(AppError::User("Connexion requise pour importer un fichier.".into())));
    }
    crate::import::read_table_b64(&file_name, &data_b64).map_err(ErrorPayload::from)
}

/* ---------------- Pièces jointes (§61) ---------------- */

#[tauri::command]
pub fn save_attachment(
    state: State<AppState>,
    invoice_local_id: String,
    name: String,
    data_b64: String,
    mime: Option<String>,
) -> CmdResult<attachments::AttachmentInfo> {
    authorize(&state, "document.write")?;
    let conn = state.db.conn.lock().unwrap();
    attachments::save_attachment(&state.paths, &conn, &invoice_local_id, &name, &data_b64, mime.as_deref())
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn list_attachments(state: State<AppState>, invoice_local_id: String) -> CmdResult<Vec<attachments::AttachmentInfo>> {
    let conn = state.db.conn.lock().unwrap();
    attachments::list_attachments(&conn, &invoice_local_id).map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn delete_attachment(state: State<AppState>, invoice_local_id: String, file_name: String) -> CmdResult<()> {
    authorize(&state, "document.write")?;
    let conn = state.db.conn.lock().unwrap();
    attachments::delete_attachment(&conn, &state.paths, &invoice_local_id, &file_name)
        .map_err(ErrorPayload::from)
}

/* ---------------- Diagnostic / intégrité (§49, §63) ---------------- */

#[derive(Serialize)]
pub struct IntegrityReport {
    pub sqlite: String,
    pub orphan_invoices: i64,
    pub duplicate_numbers: i64,
}

#[tauri::command]
pub fn integrity_check(state: State<AppState>) -> CmdResult<IntegrityReport> {
    let sqlite = state.db.integrity().map_err(|e| ErrorPayload::from(e))?;
    let conn = state.db.conn.lock().unwrap();
    let orphan_invoices: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = i.customer_id)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let duplicate_numbers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM (SELECT number FROM invoices WHERE number IS NOT NULL GROUP BY number HAVING COUNT(*) > 1)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(IntegrityReport { sqlite, orphan_invoices, duplicate_numbers })
}

/* ---------------- Validation (§20, §69) ---------------- */

#[tauri::command]
pub fn validate_document(state: State<AppState>, invoice_id: i64) -> CmdResult<String> {
    authorize(&state, "document.validate")?;
    let conn = state.db.conn.lock().unwrap();
    invoices::validate_document(&conn, invoice_id).map_err(ErrorPayload::from)
}

/* ---------------- Annulation (§21) ---------------- */

#[tauri::command]
pub fn cancel_document(state: State<AppState>, invoice_id: i64, motif: String) -> CmdResult<()> {
    authorize(&state, "document.cancel")?;
    let conn = state.db.conn.lock().unwrap();
    invoices::cancel_document(&conn, invoice_id, current_user(&state), &motif)
        .map_err(ErrorPayload::from)
}

/* ---------------- Paiements (§19) ---------------- */

#[derive(Deserialize)]
pub struct PaymentInput {
    pub invoice_id: i64,
    pub mode: String,
    pub date: String,
    pub amount_cents: i64,
    pub reference: Option<String>,
    pub banque: Option<String>,
    pub numero_cheque: Option<String>,
    pub commentaire: Option<String>,
}

#[tauri::command]
pub fn add_payment(state: State<AppState>, input: PaymentInput) -> CmdResult<()> {
    authorize(&state, "payment.write")?;
    let conn = state.db.conn.lock().unwrap();
    invoices::add_payment(
        &conn,
        input.invoice_id,
        &input.mode,
        &input.date,
        input.amount_cents,
        input.reference.as_deref(),
        input.banque.as_deref(),
        input.numero_cheque.as_deref(),
        input.commentaire.as_deref(),
        current_user(&state),
    )
    .map_err(ErrorPayload::from)
}

/* ---------------- Sauvegardes (§30, §31, §32, §33) ---------------- */

#[tauri::command]
pub fn backup_now(state: State<AppState>, label: String) -> CmdResult<backup::BackupInfo> {
    let conn = state.db.conn.lock().unwrap();
    let info = backup::backup_database(&conn, &state.paths, &label).map_err(ErrorPayload::from)?;
    let retention: usize = conn
        .query_row("SELECT value FROM settings WHERE key='auto_backup_retention'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    backup::apply_retention(&state.paths, retention);
    Ok(info)
}

#[tauri::command]
pub fn restore_backup(state: State<AppState>, source: String) -> CmdResult<String> {
    authorize(&state, "backup.restore")?;
    let src = std::path::Path::new(&source);
    if !src.exists() {
        return Err(ErrorPayload::from(AppError::User(
            "Fichier de sauvegarde introuvable.".into(),
        )));
    }
    // §32 : sauvegarde de sécurité AVANT l'opération.
    {
        let conn = state.db.conn.lock().unwrap();
        backup::create_safety_backup(&conn, &state.paths).map_err(ErrorPayload::from)?;
    }
    // Remplacement du fichier avec libération/réouverture du handle SQLite.
    state.db.restore_from(&state.paths, src).map_err(ErrorPayload::from)?;
    Ok("Restauration terminée. Une sauvegarde de sécurité de l'état précédent a été conservée (§32).".into())
}

#[tauri::command]
pub fn export_zip(state: State<AppState>, dest: String) -> CmdResult<()> {
    authorize(&state, "export.data")?;
    let conn = state.db.conn.lock().unwrap();
    backup::export_zip(&conn, &state.paths, std::path::Path::new(&dest))
        .map_err(ErrorPayload::from)
}

/* ---------------- PDF (§23, §26) ---------------- */

#[tauri::command]
pub fn render_pdf(
    state: State<AppState>,
    model: invoices_pdf::PdfModelInput,
    dest: String,
) -> CmdResult<()> {
    crate::pdf::render_invoice_pdf(&model.into(), std::path::Path::new(&dest), &state.fonts_dir)
        .map_err(ErrorPayload::from)
}

/// Génère le PDF natif dans le dossier Exports/ (§23, §26) et retourne le chemin.
#[tauri::command]
pub fn render_pdf_to_exports(
    state: State<AppState>,
    model: invoices_pdf::PdfModelInput,
    filename: String,
) -> CmdResult<String> {
    let safe: String = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    let dest = state.paths.exports.join(format!("{safe}.pdf"));
    crate::pdf::render_invoice_pdf(&model.into(), &dest, &state.fonts_dir)
        .map_err(ErrorPayload::from)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Namespace d'entrée PDF pour découpler IPC et moteur.
pub mod invoices_pdf {
    use serde::Deserialize;
    use crate::pdf::{PdfLine, PdfModel, PdfParty};

    #[derive(Deserialize)]
    pub struct PdfModelInput {
        pub doc_title: String,
        pub number: String,
        pub date: String,
        pub date_echeance: Option<String>,
        pub seller: PdfParty,
        pub buyer: PdfParty,
        pub lines: Vec<PdfLine>,
        pub total_ht_cents: i64,
        pub total_tva_cents: i64,
        #[serde(default)]
        pub total_other_taxes_cents: i64,
        pub total_ttc_cents: i64,
        pub vat_detail: Vec<(String, i64, i64)>,
        #[serde(default)]
        pub other_tax_detail: Vec<(String, i64, i64)>,
        pub conditions_paiement: Option<String>,
        pub banque: Option<String>,
        pub rib: Option<String>,
        pub observations: Option<String>,
        #[serde(default)]
        pub conditions_vente: Option<String>,
        pub annulee: bool,
        #[serde(default)]
        pub devise: Option<String>,
        /// Logo de l'entreprise (data URL PNG/JPEG), facultatif.
        #[serde(default)]
        pub logo_data_url: Option<String>,
    }

    impl From<PdfModelInput> for PdfModel {
        fn from(i: PdfModelInput) -> Self {
            PdfModel {
                doc_title: i.doc_title,
                number: i.number,
                date: i.date,
                date_echeance: i.date_echeance,
                seller: i.seller,
                buyer: i.buyer,
                lines: i.lines,
                total_ht_cents: i.total_ht_cents,
                total_tva_cents: i.total_tva_cents,
                total_other_taxes_cents: i.total_other_taxes_cents,
                total_ttc_cents: i.total_ttc_cents,
                vat_detail: i.vat_detail,
                other_tax_detail: i.other_tax_detail,
                conditions_paiement: i.conditions_paiement,
                banque: i.banque,
                rib: i.rib,
                observations: i.observations,
                conditions_vente: i.conditions_vente,
                annulee: i.annulee,
                devise: i.devise,
                logo_data_url: i.logo_data_url,
            }
        }
    }
}

//! Erreurs applicatives avec messages utilisateur en langage clair (§68).
//! Jamais d'erreur technique brute affichée à l'utilisateur.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    User(String),
    #[error("Erreur base de données : {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Erreur interne : {0}")]
    Other(String),
}

impl AppError {
    /// Reformule les erreurs techniques en messages compréhensibles (§68).
    pub fn user_message(&self) -> String {
        match self {
            AppError::User(m) => m.clone(),
            AppError::Db(e) => {
                let s = e.to_string();
                if s.contains("UNIQUE constraint failed: invoices.number")
                    || s.contains("UNIQUE constraint failed: invoice_sequences")
                {
                    "Impossible d'enregistrer ce document : son numéro existe déjà. Le compteur séquentiel a peut-être été modifié manuellement (§12).".into()
                } else if s.contains("prevent_validated_invoice_delete") {
                    "Suppression interdite : une facture validée ne peut jamais être supprimée (§47). Utilisez l'annulation ou un avoir.".into()
                } else if s.contains("prevent_validated_invoice_update") {
                    "Modification interdite : un document validé est juridiquement figé (§20). Utilisez l'annulation ou un avoir.".into()
                } else if s.contains("FOREIGN KEY constraint failed") {
                    "Impossible d'enregistrer : un élément référencé (client, produit…) est introuvable.".into()
                } else {
                    format!("Un problème d'enregistrement est survenu. Détails techniques journalisés : {s}")
                }
            }
            AppError::Other(m) => m.clone(),
        }
    }
}

/// Réponse d'erreur sérialisée vers le frontend.
#[derive(Serialize)]
pub struct ErrorPayload {
    pub message: String,
}

impl From<AppError> for ErrorPayload {
    fn from(e: AppError) -> Self {
        log::error!("{}", e);
        ErrorPayload { message: e.user_message() }
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

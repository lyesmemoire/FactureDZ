//! Contrôle des droits par rôle (§35, §36).
//!
//! La matrice vit dans `src/core/permissions.json` : une seule source, lue par
//! le Rust (ici) et par l'interface (`src/core/permissions.ts`). L'interface ne
//! fait que MASQUER les actions ; c'est ce module qui les REFUSE.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::error::{AppError, Result};

const MATRICE: &str = include_str!("../../src/core/permissions.json");

/// Le rôle figure-t-il dans la liste autorisée pour cette action ?
/// Action inconnue ou matrice illisible → refus (fail closed).
pub fn role_allows(role: &str, action: &str) -> bool {
    let Ok(m) = serde_json::from_str::<Value>(MATRICE) else {
        return false;
    };
    m["actions"]
        .get(action)
        .and_then(|v| v.as_array())
        .map(|roles| roles.iter().any(|r| r.as_str() == Some(role)))
        .unwrap_or(false)
}

/// Droit requis pour une écriture de synchronisation (`sync_upsert`).
///
/// Règle de répartition :
/// - configuration (entreprise, paramètres, taux, séquences, comptes…) → ADMIN ;
/// - clients et produits → catalogue ;
/// - document : annulation, validation (brouillon → numéroté), encaissement
///   (statut payé), sinon simple écriture de brouillon ou changement de statut.
///
/// Entité inconnue → droit le plus strict (`config.manage`).
pub fn sync_action(entity: &str, new_status: Option<&str>, existing_status: Option<&str>) -> &'static str {
    match entity {
        "customer" | "product" => "catalog.write",
        "payment" => "payment.write",
        "audit" => "audit.write",
        "backup_record" => "backup.create",
        "document" => match (new_status, existing_status) {
            (Some("ANNULEE"), _) => "document.cancel",
            // Encaissement : le statut est dérivé des paiements.
            (Some("PAYEE" | "PARTIELLEMENT_PAYEE"), Some(prev)) if prev != "BROUILLON" && prev != "ANNULEE" => {
                "payment.write"
            }
            // Validation : passage d'un brouillon à un statut numéroté.
            (Some(s), None | Some("BROUILLON")) if s != "BROUILLON" => "document.validate",
            _ => "document.write",
        },
        _ => "config.manage",
    }
}

/// Droit requis pour une suppression de synchronisation (`sync_delete`).
/// Les documents ne se suppriment que lorsqu'ils sont brouillons (contrôlé par le store).
pub fn sync_delete_action(entity: &str) -> &'static str {
    match entity {
        "customer" | "product" => "catalog.write",
        "document" => "document.write",
        _ => "config.manage",
    }
}

/// Vérifie qu'un utilisateur peut exécuter `action`.
///
/// - Aucun compte actif (premier lancement, assistant) : autorisé.
/// - Sinon : une session doit être ouverte, et le rôle de cet utilisateur doit
///   figurer dans la matrice. Erreur de lecture → refus (fail closed).
pub fn require_action(conn: &Connection, session_user: Option<i64>, action: &str) -> Result<()> {
    let actifs: i64 = conn
        .query_row("SELECT COUNT(*) FROM users WHERE actif = 1", [], |r| r.get(0))
        .unwrap_or(1);
    if actifs == 0 {
        return Ok(());
    }
    let connexion_requise = || AppError::User("Connexion requise pour cette opération (§36).".into());
    let uid = session_user.ok_or_else(connexion_requise)?;
    let role: String = conn
        .query_row(
            "SELECT role FROM users WHERE id = ?1 AND actif = 1",
            params![uid],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(connexion_requise)?;
    if role_allows(&role, action) {
        Ok(())
    } else {
        Err(AppError::User(format!(
            "Action non autorisée pour le rôle {role} (§35)."
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOUS: [&str; 5] = ["ADMIN", "GESTIONNAIRE", "COMPTABLE", "VENDEUR", "LECTEUR"];

    #[test]
    fn administrateur_a_tous_les_droits() {
        for action in ["config.manage", "users.manage", "backup.restore", "document.validate", "payment.write"] {
            assert!(role_allows("ADMIN", action), "ADMIN doit pouvoir {action}");
        }
    }

    #[test]
    fn lecteur_ne_peut_rien_modifier() {
        for action in [
            "config.manage", "users.manage", "backup.restore", "catalog.write",
            "document.write", "document.validate", "document.cancel", "payment.write",
        ] {
            assert!(!role_allows("LECTEUR", action), "LECTEUR ne doit pas {action}");
        }
        // Le journal reste alimenté par tous les rôles.
        assert!(role_allows("LECTEUR", "audit.write"));
    }

    #[test]
    fn separation_des_taches() {
        assert!(role_allows("VENDEUR", "document.validate"));
        assert!(!role_allows("VENDEUR", "payment.write"), "un vendeur n'encaisse pas");
        assert!(!role_allows("VENDEUR", "document.cancel"), "un vendeur n'annule pas");
        assert!(role_allows("COMPTABLE", "payment.write"));
        assert!(!role_allows("COMPTABLE", "document.validate"), "le comptable ne numérote pas");
        assert!(!role_allows("GESTIONNAIRE", "config.manage"));
    }

    #[test]
    fn action_ou_role_inconnu_refuse() {
        assert!(!role_allows("ADMIN", "action.inexistante"));
        assert!(!role_allows("ROOT", "config.manage"));
    }

    #[test]
    fn repartition_des_operations_de_synchronisation() {
        assert_eq!(sync_action("settings", None, None), "config.manage");
        assert_eq!(sync_action("user", None, None), "config.manage");
        assert_eq!(sync_action("entite_inconnue", None, None), "config.manage");
        assert_eq!(sync_action("customer", None, None), "catalog.write");
        assert_eq!(sync_action("document", Some("BROUILLON"), None), "document.write");
        assert_eq!(sync_action("document", Some("BROUILLON"), Some("BROUILLON")), "document.write");
        assert_eq!(sync_action("document", Some("VALIDEE"), Some("BROUILLON")), "document.validate");
        assert_eq!(sync_action("document", Some("ENVOYE"), None), "document.validate");
        assert_eq!(sync_action("document", Some("ANNULEE"), Some("VALIDEE")), "document.cancel");
        assert_eq!(sync_action("document", Some("PAYEE"), Some("VALIDEE")), "payment.write");
        assert_eq!(sync_action("document", Some("PARTIELLEMENT_PAYEE"), Some("ENVOYEE")), "payment.write");
        assert_eq!(sync_action("payment", None, None), "payment.write");
        assert_eq!(sync_action("audit", None, None), "audit.write");
    }

    #[test]
    fn suppressions_repartition() {
        assert_eq!(sync_delete_action("customer"), "catalog.write");
        assert_eq!(sync_delete_action("document"), "document.write");
        assert_eq!(sync_delete_action("settings"), "config.manage");
    }

    #[test]
    fn tous_les_roles_sont_dans_la_matrice() {
        for role in TOUS {
            assert!(
                role_allows(role, "audit.write"),
                "{role} absent de la matrice"
            );
        }
    }

    fn base_utilisateurs() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, actif INTEGER NOT NULL DEFAULT 1);
             INSERT INTO users (id, username, role, actif) VALUES
               (1, 'admin', 'ADMIN', 1),
               (2, 'lecteur', 'LECTEUR', 1),
               (3, 'ancien', 'ADMIN', 0);",
        )
        .unwrap();
        c
    }

    #[test]
    fn premier_lancement_sans_compte_actif_autorise() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, actif INTEGER NOT NULL DEFAULT 1);")
            .unwrap();
        assert!(require_action(&c, None, "config.manage").is_ok());
    }

    #[test]
    fn sans_session_refuse_quand_des_comptes_existent() {
        let c = base_utilisateurs();
        assert!(require_action(&c, None, "config.manage").is_err());
    }

    #[test]
    fn session_d_un_compte_desactive_refusee() {
        let c = base_utilisateurs();
        assert!(require_action(&c, Some(3), "config.manage").is_err());
    }

    #[test]
    fn lecteur_refuse_admin_accepte() {
        let c = base_utilisateurs();
        assert!(require_action(&c, Some(2), "config.manage").is_err());
        assert!(require_action(&c, Some(1), "config.manage").is_ok());
    }
}

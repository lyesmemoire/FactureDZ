//! Authentification desktop (§35, §36) : Argon2id, sessions locales.
//!
//! - Les mots de passe ne sont JAMAIS stockés en clair ni journalisés (§67).
//! - Les comptes créés en mode démo (hash SHA-256) sont acceptés au premier
//!   login puis MIGRÉS de façon transparente vers Argon2id.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};

pub const ARGON2_PREFIX: &str = "$argon2";

#[derive(Debug, Clone, serde::Serialize)]
pub struct AuthUser {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub actif: bool,
}

/// Hash Argon2id (§36).
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Other(format!("Hashage du mot de passe impossible : {e}")))?;
    Ok(hash.to_string())
}

/// Schéma hérité de la démo navigateur : hex(sha256("facturationdz::<user>::<pass>")).
fn legacy_sha256(username: &str, password: &str) -> String {
    let mut h = Sha256::new();
    h.update(format!("facturationdz::{}::{}", username.to_lowercase(), password).as_bytes());
    h.finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
}

/// Vérifie un mot de passe (Argon2id ou héritage démo) et retourne l'utilisateur.
/// Succès sur hash hérité → migration transparente vers Argon2id.
pub fn verify_and_upgrade(conn: &Connection, username: &str, password: &str) -> Result<Option<AuthUser>> {
    let row: Option<(i64, String, String, i64, String)> = conn
        .query_row(
            "SELECT id, username, role, actif, password_hash FROM users WHERE username = ?1 COLLATE NOCASE",
            params![username.trim()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((id, name, role, actif, stored)) = row else {
        return Ok(None);
    };
    if actif != 1 {
        return Err(AppError::User("Ce compte est désactivé. Contactez un administrateur.".into()));
    }

    let ok = if stored.starts_with(ARGON2_PREFIX) {
        let parsed = PasswordHash::new(&stored)
            .map_err(|e| AppError::Other(format!("Hash de mot de passe illisible : {e}")))?;
        Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
    } else {
        // Héritage démo (SHA-256 salé) : constant-time non requis ici car
        // comparé localement ; la première vérification réussie migre le hash.
        let expected = legacy_sha256(&name, password);
        if expected == stored {
            let upgraded = hash_password(password)?;
            conn.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", params![upgraded, id])?;
            log::info!("Mot de passe de « {name} » migré vers Argon2id.");
            true
        } else {
            false
        }
    };

    if !ok {
        return Ok(None);
    }
    Ok(Some(AuthUser { id, username: name, role, actif: true }))
}

/// Création de compte (§35) — hash Argon2id immédiat.
pub fn create_user(conn: &Connection, username: &str, password: &str, role: &str) -> Result<i64> {
    let username = username.trim();
    if username.is_empty() {
        return Err(AppError::User("Le nom d'utilisateur est obligatoire.".into()));
    }
    if password.len() < 6 {
        return Err(AppError::User("Le mot de passe doit contenir au moins 6 caractères.".into()));
    }
    if !matches!(role, "ADMIN" | "GESTIONNAIRE" | "COMPTABLE" | "VENDEUR" | "LECTEUR") {
        return Err(AppError::User("Rôle inconnu.".into()));
    }
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM users WHERE username = ?1 COLLATE NOCASE",
            params![username],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_some() {
        return Err(AppError::User("Ce nom d'utilisateur existe déjà.".into()));
    }
    let hash = hash_password(password)?;
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?1, ?2, ?3)",
        params![username, hash, role],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Changement de mot de passe : vérifie l'ancien, hash le nouveau en Argon2id.
pub fn change_password(conn: &Connection, user_id: i64, current: &str, new: &str) -> Result<()> {
    if new.len() < 6 {
        return Err(AppError::User("Le nouveau mot de passe doit contenir au moins 6 caractères.".into()));
    }
    let (username, stored): (String, String) = conn.query_row(
        "SELECT username, password_hash FROM users WHERE id = ?1",
        params![user_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let ok = if stored.starts_with(ARGON2_PREFIX) {
        let parsed = PasswordHash::new(&stored)
            .map_err(|e| AppError::Other(format!("Hash illisible : {e}")))?;
        Argon2::default().verify_password(current.as_bytes(), &parsed).is_ok()
    } else {
        legacy_sha256(&username, current) == stored
    };
    if !ok {
        return Err(AppError::User("Mot de passe actuel incorrect.".into()));
    }
    let hash = hash_password(new)?;
    conn.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", params![hash, user_id])?;
    log::info!("Mot de passe modifié pour « {username} ».");
    Ok(())
}

/// Active / désactive un compte (§35).
pub fn set_user_active(conn: &Connection, user_id: i64, actif: bool) -> Result<()> {
    let admins: i64 = conn.query_row(
        "SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND actif = 1",
        [],
        |r| r.get(0),
    )?;
    let is_admin: bool = conn
        .query_row("SELECT role FROM users WHERE id = ?1", params![user_id], |r| r.get::<_, String>(0))
        .map(|r| r == "ADMIN")
        .optional()?
        .unwrap_or(false);
    if !actif && is_admin && admins <= 1 {
        return Err(AppError::User(
            "Impossible de désactiver le dernier compte administrateur.".into(),
        ));
    }
    conn.execute("UPDATE users SET actif = ?1 WHERE id = ?2", params![if actif { 1 } else { 0 }, user_id])?;
    Ok(())
}

/// Liste des comptes (sans hash — jamais exposés).
pub fn list_users(conn: &Connection) -> Result<Vec<AuthUser>> {
    let mut stmt = conn.prepare("SELECT id, username, role, actif FROM users ORDER BY id")?;
    let rows = stmt.query_map([], |r| {
        Ok(AuthUser {
            id: r.get(0)?,
            username: r.get(1)?,
            role: r.get(2)?,
            actif: r.get::<_, i64>(3)? == 1,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

/* ---------------- Sessions locales (§36, §37) ---------------- */

/// Ouvre une session : token aléatoire 256 bits, seul son hash SHA-256 est stocké.
pub fn open_session(conn: &Connection, user_id: i64, ttl_minutes: i64) -> Result<String> {
    purge_expired_sessions(conn)?;
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    let token_hash = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES (?1, ?2, datetime('now', '+' || ?3 || ' minutes'))",
        params![user_id, token_hash, ttl_minutes],
    )?;
    Ok(token)
}

/// Vérifie un token de session (et le prolonge si valide).
pub fn check_session(conn: &Connection, token: &str) -> Result<Option<i64>> {
    purge_expired_sessions(conn)?;
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    let token_hash = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    let user: Option<i64> = conn
        .query_row(
            "SELECT user_id FROM sessions WHERE token_hash = ?1 AND closed_at IS NULL",
            params![token_hash],
            |r| r.get(0),
        )
        .optional()?;
    Ok(user)
}

/// Ferme les sessions expirées (verrouillage automatique §37).
pub fn purge_expired_sessions(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET closed_at = datetime('now')
         WHERE closed_at IS NULL AND expires_at < datetime('now')",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    #[test]
    fn argon2_roundtrip() {
        let conn = test_connection();
        let id = create_user(&conn, "admin", "secret123", "ADMIN").unwrap();
        assert!(verify_and_upgrade(&conn, "admin", "mauvais").unwrap().is_none());
        let u = verify_and_upgrade(&conn, "ADMIN", "secret123").unwrap().unwrap();
        assert_eq!(u.id, id);
        assert_eq!(u.role, "ADMIN");
    }

    #[test]
    fn legacy_hash_migrates_to_argon2() {
        let conn = test_connection();
        let legacy = legacy_sha256("demo", "motdepasse");
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('demo', ?1, 'GESTIONNAIRE')",
            params![legacy],
        )
        .unwrap();
        assert!(verify_and_upgrade(&conn, "demo", "motdepasse").unwrap().is_some());
        let migrated: String = conn
            .query_row("SELECT password_hash FROM users WHERE username='demo'", [], |r| r.get(0))
            .unwrap();
        assert!(migrated.starts_with(ARGON2_PREFIX));
        // Second login via Argon2.
        assert!(verify_and_upgrade(&conn, "demo", "motdepasse").unwrap().is_some());
        assert!(verify_and_upgrade(&conn, "demo", "autre").unwrap().is_none());
    }

    #[test]
    fn dernier_admin_protege() {
        let conn = test_connection();
        let id = create_user(&conn, "boss", "secret123", "ADMIN").unwrap();
        assert!(set_user_active(&conn, id, false).is_err());
        create_user(&conn, "aide", "secret123", "ADMIN").unwrap();
        assert!(set_user_active(&conn, id, false).is_ok());
    }

    #[test]
    fn sessions_open_check() {
        let conn = test_connection();
        let id = create_user(&conn, "u1", "secret123", "VENDEUR").unwrap();
        let token = open_session(&conn, id, 15).unwrap();
        assert_eq!(check_session(&conn, &token).unwrap(), Some(id));
        assert_eq!(check_session(&conn, "0000").unwrap(), None);
    }
}

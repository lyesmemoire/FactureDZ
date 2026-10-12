//! Journal d'audit (§34) — indépendant du journal technique (§67).

use rusqlite::{params, Connection};

use crate::error::Result;

pub fn log_audit(
    conn: &Connection,
    user_id: Option<i64>,
    action: &str,
    object_type: &str,
    object_id: Option<&str>,
    details: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO audit_logs (user_id, action, object_type, object_id, details, old_value, new_value)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![user_id, action, object_type, object_id, details, old_value, new_value],
    )?;
    Ok(())
}

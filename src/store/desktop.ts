/**
 * Passerelle IPC vers le backend Rust/Tauri (§70).
 *
 * - En mode DÉMO/navigateur : `isTauri()` est faux → toutes les fonctions
 *   retournent `null` et l'application utilise son adaptateur local.
 * - En mode DESKTOP : les commandes correspondent 1:1 aux handlers Rust de
 *   `src-tauri/src/commands.rs` (validate_document, cancel_document,
 *   add_payment, backup_now, restore_backup, export_zip, render_pdf,
 *   integrity_check).
 *
 * Les opérations sensibles (validation, annulation, paiement, restauration)
 * sont notifiées au backend par le store ; les commandes « autonomes »
 * (PDF natif, sauvegarde fichier, intégrité SQLite) sont appelées
 * directement depuis `src/ui/desktopActions.ts`.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Invoque une commande Tauri si disponible ; sinon retourne null (mode démo). */
export async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args ?? {});
}

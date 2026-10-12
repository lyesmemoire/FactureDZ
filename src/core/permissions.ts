/**
 * Droits par rôle (§35) — interface.
 *
 * La matrice est la MÊME que côté Rust (src/core/permissions.json). L'interface
 * ne fait que masquer ou désactiver les actions ; le backend refuse de toute
 * façon celles qui ne sont pas autorisées (src-tauri/src/permissions.rs).
 */
import matrice from "./permissions.json";

export type Role = (typeof matrice.roles)[number];
export type Action = keyof typeof matrice.actions;

export const ROLES = matrice.roles as readonly Role[];

/** Le rôle est-il autorisé pour cette action ? Inconnu ou absent → refus. */
export function roleAllows(role: string | undefined | null, action: Action): boolean {
  if (!role) return false;
  const autorises = (matrice.actions as Record<string, readonly string[]>)[action];
  return Array.isArray(autorises) && autorises.includes(role);
}

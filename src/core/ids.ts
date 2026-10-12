/** Identifiants locaux, générés hors ligne (aucun service externe). */
export function uid(prefix = "id"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
  return `${prefix}-${rnd}`;
}

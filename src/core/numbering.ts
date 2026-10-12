/**
 * FacturationDZ — Moteur de numérotation (§12, §55, §56).
 *
 * Garanties :
 *  - numéro UNIQUE et SÉQUENTIEL, attribué dans une transaction à la
 *    validation du document (côté SQLite : contrainte UNIQUE + compteur
 *    verrouillé par transaction — impossible à dupliquer, §12) ;
 *  - gabarit configurable par série : {YEAR}, {COUNTER} (§55) ;
 *  - un numéro attribué n'est JAMAIS réutilisé, même après annulation (§21) ;
 *  - plusieurs séries : FAC, AVOIR, PRO, DEV, BL (§56).
 */

import type { DocType, SequenceConfig } from "./types";

export const DEFAULT_SEQUENCE_CONFIGS: SequenceConfig[] = [
  { docType: "FAC", template: "FAC-{YEAR}-{COUNTER}", padding: 6 },
  { docType: "DEV", template: "DEV-{YEAR}-{COUNTER}", padding: 6 },
  { docType: "PRO", template: "PRO-{YEAR}-{COUNTER}", padding: 6 },
  { docType: "BL", template: "BL-{YEAR}-{COUNTER}", padding: 6 },
  { docType: "AVOIR", template: "AV-{YEAR}-{COUNTER}", padding: 6 },
];

/** Rend un numéro à partir du gabarit. Ex : FAC-{YEAR}-{COUNTER} → FAC-2026-000001 */
export function renderNumber(
  config: SequenceConfig,
  year: number,
  counter: number
): string {
  if (counter < 1 || !Number.isInteger(counter)) {
    throw new Error("Compteur de numérotation invalide (doit être un entier ≥ 1).");
  }
  const counterStr = String(counter).padStart(config.padding, "0");
  return config.template
    .replaceAll("{YEAR}", String(year))
    .replaceAll("{COUNTER}", counterStr);
}

/** Valide un gabarit de numérotation saisi par l'utilisateur (§55). */
export function validateTemplate(template: string): string[] {
  const errors: string[] = [];
  if (!template.trim()) errors.push("Le gabarit est vide.");
  if (!template.includes("{COUNTER}"))
    errors.push("Le gabarit doit contenir {COUNTER}.");
  if (!template.includes("{YEAR}"))
    errors.push("Le gabarit doit contenir {YEAR} (recommandé).");
  if (/[{}]/.test(template.replaceAll("{YEAR}", "").replaceAll("{COUNTER}", "")))
    errors.push("Balises inconnues dans le gabarit (seules {YEAR} et {COUNTER} sont admises).");
  return errors;
}

/**
 * Vérifie qu'un numéro n'est pas déjà utilisé.
 * Côté SQLite, cette contrainte est renforcée par un index UNIQUE —
 * la base refuse physiquement le doublon, même en concurrence (§12).
 */
export function assertNumberAvailable(
  number: string,
  existingNumbers: Array<string | null>
): void {
  if (existingNumbers.includes(number)) {
    throw new Error(
      `Impossible d'attribuer le numéro « ${number} » : il existe déjà. ` +
        "Le compteur séquentiel a peut-être été modifié manuellement."
    );
  }
}

/**
 * Déduit le compteur d'un numéro existant (import historique) quand il suit le modèle,
 * quel que soit le nombre de zéros de remplissage : « FAC-2024-0012 » → 12 pour « FAC-{YEAR}-{COUNTER} ».
 * Retourne null si le numéro ne suit pas le modèle de l'année donnée.
 */
export function counterFromNumber(config: SequenceConfig, year: number, number: string): number | null {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
  const parts = config.template.split("{COUNTER}").map((p) => p.replaceAll("{YEAR}", String(year)));
  if (parts.length !== 2) return null;
  const re = new RegExp(`^${escape(parts[0])}(\\d+)${escape(parts[1])}$`);
  const m = re.exec(number);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

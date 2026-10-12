/**
 * FacturationDZ — Conversion des montants en lettres, FRANÇAIS (§16).
 *
 * Moteur déterministe, sans dépendance externe. Gère :
 *  - zéro, nombres ronds ;
 *  - accords : « quatre-vingts » / « quatre-vingt mille »,
 *    « deux cents » / « deux cent mille », « deux millions » ;
 *  - « mille » invariable, « un million », « un milliard » ;
 *  - « et un », « et onze » ;
 *  - centimes.
 *
 * Le montant en lettres est TOUJOURS calculé à partir du TTC final ;
 * l'utilisateur ne peut jamais le modifier manuellement (§16).
 */

import type { Cents } from "./types";
import { currencyNames } from "./currency";

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
  "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "dix-sept", "dix-huit", "dix-neuf",
];

const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/**
 * 1..99 (n > 0 garanti).
 * `elideS` : vrai si un autre numéral suit (ex : « mille ») → pas de « s »
 * à « quatre-vingt ».
 */
function twoDigits(n: number, elideS: boolean): string {
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    if (u === 1) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) {
    if (n === 71) return "soixante et onze";
    return `soixante-${UNITS[n - 60]}`; // 70 → soixante-dix
  }
  if (n === 80) return elideS ? "quatre-vingt" : "quatre-vingts";
  return `quatre-vingt-${UNITS[n - 80]}`; // 81..99 (90 → quatre-vingt-dix)
}

/** 1..999. `elideS` : un numéral suit (mille) → « deux cent mille ». */
function chunk(n: number, elideS: boolean): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = "";
  if (h === 1) out = "cent";
  else if (h > 1) out = `${UNITS[h]} cent${r === 0 && !elideS ? "s" : ""}`;
  if (r > 0) out = out ? `${out} ${twoDigits(r, elideS)}` : twoDigits(r, elideS);
  return out;
}

/** Entier ≥ 0 en toutes lettres (français). */
export function intToWordsFr(n: number): string {
  if (!Number.isInteger(n)) throw new Error("intToWordsFr exige un entier");
  if (n === 0) return "zéro";
  if (n < 0) return `moins ${intToWordsFr(-n)}`;

  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;

  const parts: string[] = [];
  if (milliards) {
    parts.push(milliards === 1 ? "un milliard" : `${chunk(milliards, false)} milliards`);
  }
  if (millions) {
    parts.push(millions === 1 ? "un million" : `${chunk(millions, false)} millions`);
  }
  if (milliers) {
    parts.push(milliers === 1 ? "mille" : `${chunk(milliers, true)} mille`);
  }
  if (reste) parts.push(chunk(reste, false));
  return parts.join(" ");
}

/**
 * Montant TTC en lettres pour une facture algérienne (§16) :
 * 119000.00 DA → « CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME. »
 */
export function amountInWordsDZD(cents: Cents, devise?: string | null): string {
  if (!Number.isInteger(cents)) throw new Error("Le montant doit être en centimes entiers");
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const unites = Math.floor(abs / 100);
  const cts = abs % 100;

  const { unite, sousUnite } = currencyNames(devise);
  const uniteLabel = unites <= 1 ? unite[0] : unite[1];
  let out = `${neg ? "moins " : ""}${intToWordsFr(unites)} ${uniteLabel}`;
  if (cts === 0) out += ` et zéro ${sousUnite[0]}`;
  else if (cts === 1) out += ` et un ${sousUnite[0]}`;
  else out += ` et ${intToWordsFr(cts)} ${sousUnite[1]}`;
  return out.toUpperCase() + ".";
}

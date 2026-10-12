/**
 * FacturationDZ — Arithmétique monétaire (§14).
 *
 * RÈGLE ABSOLUE : jamais de flottants pour les montants.
 * Tous les montants sont des ENTIERS de centimes (type Cents).
 * Politique d'arrondi centralisée : arrondi au centime supérieur à partir
 * de 0,5 (HALF UP), appliquée à 2 décimales pour chaque ligne.
 */

import type { Cents } from "./types";
import { currencySymbol } from "./currency";
export type { Cents } from "./types";

/** Arrondi « half up » (0,5 → 1). Gère les négatifs par symétrie. */
export function roundHalfUp(x: number): number {
  const sign = x < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(x) + 0.5);
}

/**
 * Convertit un nombre décimal saisi (ex : 1250.5) en centimes entiers.
 * Passe par une normalisation string pour neutraliser la dérive flottante
 * (ex : 0.1 + 0.2).
 */
export function fromNumber(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new Error("Montant invalide (valeur non finie).");
  }
  return roundHalfUp(Number((value * 100).toFixed(4)));
}

/**
 * Analyse une saisie utilisateur au format français :
 * "1 250 000,00" → 125000000 centimes.
 */
export function parseAmountFr(input: string): Cents {
  const cleaned = input
    .replace(/[\s\u202f\u00a0]/g, "")
    .replace(",", ".")
    .replace(/DA$/i, "")
    .trim();
  if (cleaned === "") return 0;
  const v = Number(cleaned);
  if (!Number.isFinite(v)) {
    throw new Error(`Montant illisible : « ${input} »`);
  }
  return fromNumber(v);
}

/** Addition / soustraction exactes (entiers). */
export const addCents = (a: Cents, b: Cents): Cents => a + b;
export const subCents = (a: Cents, b: Cents): Cents => a - b;

/**
 * Formate un montant en centimes au format local algérien FR (§43) :
 * séparateur de milliers = espace, décimales = virgule, 2 décimales.
 * 125000000 → "1 250 000,00"
 */
export function formatMoney(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const intPart = Math.floor(abs / 100).toString();
  const decPart = (abs % 100).toString().padStart(2, "0");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${grouped},${decPart}`;
}

/** Montant suivi du symbole de la monnaie du document (DA par défaut). */
export function formatDA(cents: Cents, devise?: string | null): string {
  return `${formatMoney(cents)} ${currencySymbol(devise)}`;
}

/** Pourcentage d'un montant en centimes, arrondi au centime (half up). */
/**
 * Convertit un décimal saisi en entier mis à l'échelle (10^digits).
 * Ex : scaleDecimal(12.5, 4) → 125000n ; scaleDecimal(1.005, 3) → 1005n.
 * L'arrondi de Math.round porte sur un résidu flottant ≪ 0,5 : exact pour
 * toute saisie réaliste (quantité 3 décimales, taux/remise 4 décimales max).
 */
export function scaleDecimal(x: number, digits: number): bigint {
  if (!Number.isFinite(x)) throw new Error("Valeur décimale invalide.");
  return BigInt(Math.round(x * 10 ** digits));
}

/**
 * (a × b ÷ d) arrondi HALF UP (0,5 → au plus loin de zéro), en arithmétique
 * entière exacte (BigInt). C'est LE point d'arrondi du moteur (§14) : aucun
 * produit décimal n'est calculé en flottant.
 */
export function mulDivRound(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("Diviseur invalide.");
  const prod = a * b;
  const sign = prod < 0n ? -1n : 1n;
  const n = prod < 0n ? -prod : prod;
  return sign * ((2n * n + d) / (2n * d));
}

/** Quantité × prix unitaire (en centimes) → centimes, quantité à 3 décimales. */
export function lineBrutCents(qty: number, puHtCents: number): Cents {
  const q = scaleDecimal(qty, 3);
  const pu = BigInt(Math.round(puHtCents));
  return Number(mulDivRound(q, pu, 1000n));
}

/** Pourcentage appliqué à un montant en centimes : pct a au plus 4 décimales. */
export function pctOf(cents: Cents, pct: number): Cents {
  // cents × (pct/10^4) ÷ 100  ⇒  cents × pctScaled ÷ 10^6
  return Number(mulDivRound(BigInt(Math.round(cents)), scaleDecimal(pct, 4), 1_000_000n));
}

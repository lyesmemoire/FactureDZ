/**
 * FacturationDZ — Moteur fiscal (§10, §73).
 *
 * RÈGLE CRITIQUE (§73) : AUCUN taux n'est codé en dur dans l'application.
 * Toutes les règles fiscales vivent ici + dans le référentiel `tax_rates`
 * (table dédiée, modifiable par un administrateur — §74).
 *
 * RÈGLE §10 : le taux appliqué à un document est SNAPSHOTÉ dans le document ;
 * une modification ultérieure du référentiel ne modifie jamais l'historique.
 */

import { mulDivRound, scaleDecimal, type Cents } from "./money";
import type { TaxRate } from "./types";

/** Référentiel préconfiguré (§10) — inséré au premier démarrage. */
export function presetTaxRates(): TaxRate[] {
  const now = new Date().toISOString().slice(0, 10);
  return [
    {
      id: "tax-tva19",
      code: "TVA19",
      libelle: "TVA 19 %",
      ratePct: 19,
      dateDebut: "2000-01-01",
      actif: true,
      kind: "TVA",
      description: "Taux normal de la taxe sur la valeur ajoutée.",
      referenceReglementaire:
        "Code des taxes sur le chiffre d'affaires (taux normal) — valeur configurable",
    },
    {
      id: "tax-tva9",
      code: "TVA9",
      libelle: "TVA 9 %",
      ratePct: 9,
      dateDebut: "2000-01-01",
      actif: true,
      kind: "TVA",
      description: "Taux réduit de la taxe sur la valeur ajoutée.",
      referenceReglementaire:
        "Code des taxes sur le chiffre d'affaires (taux réduit) — valeur configurable",
    },
    {
      id: "tax-exo",
      code: "EXO",
      libelle: "Exonéré",
      ratePct: 0,
      dateDebut: now,
      actif: true,
      kind: "TVA",
      description: "Opération exonérée de TVA (joindre le motif d'exonération).",
      referenceReglementaire: "Selon dispositions légales applicables",
    },
  ];
}

/** Un taux est-il applicable à une date donnée ? */
export function isTaxApplicable(tax: TaxRate, isoDate: string): boolean {
  if (!tax.actif) return false;
  if (tax.dateDebut && isoDate < tax.dateDebut) return false;
  if (tax.dateFin && isoDate > tax.dateFin) return false;
  return true;
}

/**
 * Montant de TVA pour une ligne (§14) :
 * TVA ligne = arrondi au centime (half up) de HT ligne × taux / 100.
 */
export function vatForLine(htCents: Cents, ratePct: number): Cents {
  // TVA = HT × taux ÷ 100, taux à 4 décimales max, arrondi half-up exact.
  return Number(mulDivRound(BigInt(Math.round(htCents)), scaleDecimal(ratePct, 4), 1_000_000n));
}

/** Trouve un taux actif par code (sinon undefined). */
export function findTax(rates: TaxRate[], code: string): TaxRate | undefined {
  return rates.find((t) => t.code === code);
}

/** Trouve le taux applicable à une date (le plus spécifique). */
export function findApplicableTax(
  rates: TaxRate[],
  code: string,
  isoDate: string
): TaxRate | undefined {
  return rates.find((t) => t.code === code && isTaxApplicable(t, isoDate));
}

/**
 * Taux proposé par défaut sur une nouvelle ligne (§73) : le taux choisi dans les
 * paramètres de la société s'il est actif et applicable à la date ; sinon le premier
 * taux de TVA actif applicable. Aucun code n'est codé en dur ici.
 */
export function pickDefaultTax(
  rates: TaxRate[],
  codeSociete: string | undefined,
  isoDate?: string
): TaxRate | undefined {
  const applicable = (t: TaxRate) => (isoDate ? isTaxApplicable(t, isoDate) : t.actif);
  const choisi = codeSociete ? rates.find((t) => t.code === codeSociete) : undefined;
  if (choisi && applicable(choisi)) return choisi;
  return rates.find((t) => t.kind !== "AUTRE" && applicable(t)) ?? rates.find(applicable) ?? rates[0];
}

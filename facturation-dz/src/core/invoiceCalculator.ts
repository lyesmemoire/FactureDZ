/**
 * FacturationDZ — Moteur de calcul des documents (§13, §14, §15, §17).
 *
 * Politique d'arrondi centralisée (§14) :
 *   HT ligne  = arrondi 2 décimales (quantité × PU HT − remise)
 *   TVA ligne = arrondi 2 décimales (HT ligne × taux / 100)
 *   Total HT  = somme des HT lignes
 *   Total TVA = somme des TVA lignes
 *   TTC       = HT + TVA
 *
 * Remise globale (§17) : répartie proportionnellement sur les lignes
 * (au prorata du HT de chaque ligne, le reliquat d'arrondi sur la dernière)
 * afin que chaque ligne reste juridiquement lisible et cohérente.
 */

import { lineBrutCents, mulDivRound, pctOf, roundHalfUp, type Cents } from "./money";
import { vatForLine } from "./taxEngine";
import { amountInWordsDZD } from "./numberToWordsFr";
import type { ComputedLine, DocLine, GlobalDiscount, VatDetail } from "./types";

/* ------------------------------------------------------------------ */
/* Calcul d'une ligne                                                  */
/* ------------------------------------------------------------------ */

export function computeLine(line: DocLine): ComputedLine {
  if (!Number.isFinite(line.qty)) throw new Error("Quantité invalide.");
  if (!Number.isFinite(line.puHtCents)) throw new Error("Prix unitaire invalide.");

  // qty peut être décimale (kg, m²…) : le produit est arrondi au centime.
  const brutCents = lineBrutCents(line.qty, line.puHtCents);

  let remiseCents = 0;
  if (line.remisePct && line.remisePct > 0) {
    remiseCents = Math.min(pctOf(brutCents, line.remisePct), brutCents);
  }
  const htCents = brutCents - remiseCents;

  const tvaCents =
    line.taxRatePctSnapshot === 0 ? 0 : vatForLine(htCents, line.taxRatePctSnapshot);

  return {
    ...line,
    brutCents,
    remiseCents,
    htCents,
    tvaCents,
    ttcCents: htCents + tvaCents,
  };
}

/* ------------------------------------------------------------------ */
/* Répartition de la remise globale                                    */
/* ------------------------------------------------------------------ */

export function distributeGlobalDiscount(
  lines: ComputedLine[],
  gd: GlobalDiscount | undefined
): Cents[] {
  const subTotal = lines.reduce((s, l) => s + l.htCents, 0);
  if (!gd || gd.value <= 0 || subTotal === 0) return lines.map(() => 0);

  const totalDiscount =
    gd.kind === "PCT"
      ? Math.min(pctOf(subTotal, gd.value), subTotal)
      : Math.min(roundHalfUp(gd.value), subTotal);

  const shares: Cents[] = [];
  let allocated = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i === lines.length - 1) {
      shares.push(totalDiscount - allocated); // reliquat d'arrondi sur la dernière ligne
    } else {
      const share =
        subTotal === 0
          ? 0
          : Number(mulDivRound(BigInt(lines[i].htCents), BigInt(totalDiscount), BigInt(subTotal)));
      shares.push(share);
      allocated += share;
    }
  }
  return shares;
}

/* ------------------------------------------------------------------ */
/* Calcul complet du document                                          */
/* ------------------------------------------------------------------ */

export interface InvoiceComputation {
  lines: ComputedLine[];
  /** HT par ligne après remise globale. */
  finalLineHtCents: Cents[];
  tvaPerLine: Cents[];
  /** Autres taxes par ligne (§10) — nulles pour les lignes TVA. */
  otherTaxPerLine: Cents[];
  totalHtCents: Cents;
  totalTvaCents: Cents;
  totalOtherTaxesCents: Cents;
  totalTtcCents: Cents;
  vatDetail: VatDetail[];
  /** Détail des autres taxes par taux (§10). */
  otherTaxDetail: VatDetail[];
  globalDiscountCents: Cents;
  subtotalHtCents: Cents;
  amountInWords: string;
}

export function computeDocument(
  lines: DocLine[],
  globalDiscount?: GlobalDiscount,
  devise?: string | null
): InvoiceComputation {
  const computed = lines.map(computeLine);
  const subTotal = computed.reduce((s, l) => s + l.htCents, 0);
  const shares = distributeGlobalDiscount(computed, globalDiscount);
  const globalDiscountCents = shares.reduce((s, x) => s + x, 0);

  const finalLineHtCents = computed.map((l, i) => l.htCents - shares[i]);

  // §10 : chaque ligne applique SON snapshot de taxe — TVA ou autre taxe.
  const tvaPerLine: Cents[] = [];
  const otherTaxPerLine: Cents[] = [];
  finalLineHtCents.forEach((ht, i) => {
    const kind = computed[i].taxKindSnapshot ?? "TVA";
    const amount =
      computed[i].taxRatePctSnapshot === 0 ? 0 : vatForLine(ht, computed[i].taxRatePctSnapshot);
    if (kind === "AUTRE") {
      tvaPerLine.push(0);
      otherTaxPerLine.push(amount);
    } else {
      tvaPerLine.push(amount);
      otherTaxPerLine.push(0);
    }
  });

  const totalHtCents = finalLineHtCents.reduce((s, x) => s + x, 0);
  const totalTvaCents = tvaPerLine.reduce((s, x) => s + x, 0);
  const totalOtherTaxesCents = otherTaxPerLine.reduce((s, x) => s + x, 0);
  const totalTtcCents = totalHtCents + totalTvaCents + totalOtherTaxesCents;

  // Détail TVA par taux (§15) — le libellé du taux vient du snapshot ligne.
  const byRate = new Map<number, VatDetail>();
  const otherByRate = new Map<number, VatDetail>();
  computed.forEach((l, i) => {
    const kind = l.taxKindSnapshot ?? "TVA";
    const key = l.taxRatePctSnapshot;
    const target = kind === "AUTRE" ? otherByRate : byRate;
    const cur = target.get(key) ?? {
      ratePct: key,
      libelle: l.taxLibelleSnapshot,
      baseCents: 0,
      amountCents: 0,
    };
    cur.baseCents += finalLineHtCents[i];
    cur.amountCents += kind === "AUTRE" ? otherTaxPerLine[i] : tvaPerLine[i];
    target.set(key, cur);
  });
  const vatDetail = [...byRate.values()].sort((a, b) => a.ratePct - b.ratePct);
  const otherTaxDetail = [...otherByRate.values()].sort((a, b) => a.ratePct - b.ratePct);

  return {
    lines: computed,
    finalLineHtCents,
    tvaPerLine,
    otherTaxPerLine,
    totalHtCents,
    totalTvaCents,
    totalOtherTaxesCents,
    totalTtcCents,
    vatDetail,
    otherTaxDetail,
    globalDiscountCents,
    subtotalHtCents: subTotal,
    amountInWords: amountInWordsDZD(totalTtcCents, devise),
  };
}

/** Recalcule rapidement les totaux (utilisé par les rapports et l'intégrité). */
export function recomputeTotals(doc: {
  lines: DocLine[];
  globalDiscount?: GlobalDiscount;
  devise?: string;
}): {
  totalHtCents: Cents;
  totalTvaCents: Cents;
  totalOtherTaxesCents: Cents;
  totalTtcCents: Cents;
} {
  const r = computeDocument(doc.lines, doc.globalDiscount, doc.devise);
  return {
    totalHtCents: r.totalHtCents,
    totalTvaCents: r.totalTvaCents,
    totalOtherTaxesCents: r.totalOtherTaxesCents,
    totalTtcCents: r.totalTtcCents,
  };
}

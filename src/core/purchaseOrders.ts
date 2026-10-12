/**
 * Bons de commande fournisseurs (achats) — logique pure, sans effet de bord.
 * Totaux calculés avec le même moteur que les factures (§10, §16) pour une cohérence totale.
 */

import { computeDocument } from "./invoiceCalculator";
import type { Cents, DocLine, PoStatus, PurchaseOrder, PurchaseOrderLine, Supplier } from "./types";

/** Numéro d'un bon de commande : BC-AAAA-000001 (série annuelle, jamais réutilisée). */
export function renderPoNumber(year: number, counter: number): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new Error("Compteur de bon de commande invalide (entier ≥ 1 attendu).");
  }
  return `BC-${year}-${String(counter).padStart(6, "0")}`;
}

/** Totaux d'un BC à partir de ses lignes (remise par ligne, TVA par taux). */
export function computePurchaseTotals(lines: PurchaseOrderLine[], devise = "DZD") {
  const docLines: DocLine[] = lines.map((l) => ({
    id: l.id,
    nature: "VENTE",
    productRef: l.productRef,
    designation: l.designation,
    qty: l.qty,
    unite: l.unite,
    puHtCents: l.puHtCents,
    remisePct: l.remisePct ?? 0,
    taxCode: l.taxCode,
    taxRatePctSnapshot: l.taxRatePctSnapshot,
    taxLibelleSnapshot: "",
    taxKindSnapshot: "TVA",
  }));
  const comp = computeDocument(docLines, undefined, devise);
  return {
    totalHtCents: comp.totalHtCents,
    totalTvaCents: comp.totalTvaCents,
    totalTtcCents: comp.totalTtcCents,
    vatDetail: comp.vatDetail,
    amountInWords: comp.amountInWords,
    lineHtCents: comp.finalLineHtCents as Cents[],
  };
}

/** Statut déduit de la réception. Un BC annulé ou brouillon n'est pas recalculé. */
export function statusAfterReception(lines: PurchaseOrderLine[], current: PoStatus): PoStatus {
  if (current !== "ENVOYE" && current !== "RECU_PARTIEL" && current !== "RECU") return current;
  const total = lines.reduce((s, l) => s + l.qtyRecue, 0);
  if (total <= 0) return "ENVOYE";
  const complete = lines.every((l) => l.qtyRecue >= l.qty - 1e-9);
  return complete ? "RECU" : "RECU_PARTIEL";
}

/** Contrôle des quantités reçues saisies : entre le déjà reçu et la quantité commandée. */
export function validateReception(
  lines: PurchaseOrderLine[],
  nouvelles: Record<string, number>
): string[] {
  const errors: string[] = [];
  for (const l of lines) {
    const q = nouvelles[l.id];
    if (q === undefined) continue;
    if (!Number.isFinite(q) || q < 0) {
      errors.push(`« ${l.designation} » : quantité reçue invalide.`);
    } else if (q > l.qty + 1e-9) {
      errors.push(`« ${l.designation} » : quantité reçue (${q}) supérieure à la quantité commandée (${l.qty}).`);
    } else if (q + 1e-9 < l.qtyRecue) {
      errors.push(`« ${l.designation} » : une réception déjà enregistrée ne peut pas être diminuée.`);
    }
  }
  return errors;
}

/** Contrôles avant envoi : fournisseur, lignes complètes, quantités positives. */
export function validatePurchaseOrderBeforeSend(po: PurchaseOrder, supplier: Supplier | undefined): string[] {
  const errors: string[] = [];
  if (!supplier) errors.push("Choisissez un fournisseur.");
  if (po.lines.length === 0) errors.push("Ajoutez au moins une ligne.");
  for (const l of po.lines) {
    if (!l.designation.trim()) errors.push("Chaque ligne doit avoir une désignation.");
    if (!(l.qty > 0)) errors.push(`« ${l.designation || "ligne"} » : quantité à commander supérieure à zéro.`);
    if (l.puHtCents < 0) errors.push(`« ${l.designation || "ligne"} » : prix négatif.`);
  }
  return errors;
}

export function canEditPurchaseOrder(po: PurchaseOrder): boolean {
  return po.status === "BROUILLON";
}

export function canDeletePurchaseOrder(po: PurchaseOrder): boolean {
  return po.status === "BROUILLON";
}

/** Annulation possible seulement avant toute réception. */
export function canCancelPurchaseOrder(po: PurchaseOrder): boolean {
  return po.status === "ENVOYE" && po.lines.every((l) => l.qtyRecue === 0);
}

export function canReceivePurchaseOrder(po: PurchaseOrder): boolean {
  return po.status === "ENVOYE" || po.status === "RECU_PARTIEL";
}

/** Reste à recevoir sur une ligne. */
export function resteARecevoir(l: PurchaseOrderLine): number {
  return Math.max(0, l.qty - l.qtyRecue);
}

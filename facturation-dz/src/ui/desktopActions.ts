/**
 * Actions desktop (§23, §26, §49) : PDF natif genpdf, intégrité SQLite.
 * En mode démo/navigateur, ces fonctions retournent `{ ok: false }` et
 * l'interface retombe sur l'impression système (aperçu A4 + window.print).
 */

import { computeDocument } from "../core/invoiceCalculator";
import { formatDateFr } from "../core/format";
import type { Company, DocType, InvoiceDoc } from "../core/types";
import { invokeDesktop, isTauri } from "../store/desktop";

const TITLES: Record<DocType, string> = {
  FAC: "FACTURE",
  AVOIR: "AVOIR (NOTE DE CRÉDIT)",
  PRO: "FACTURE PROFORMA",
  DEV: "DEVIS",
  BL: "BON DE LIVRAISON",
};

/** Construit le modèle PDF attendu par le moteur Rust genpdf (§23). */
export function buildPdfModel(doc: InvoiceDoc, company: Company) {
  const comp = computeDocument(doc.lines, doc.globalDiscount, doc.devise);
  return {
    doc_title: TITLES[doc.docType],
    number: doc.number ?? "(brouillon)",
    date: formatDateFr(doc.date),
    date_echeance: doc.dateEcheance ? formatDateFr(doc.dateEcheance) : null,
    seller: {
      display_name: doc.sellerSnapshot.displayName,
      adresse: [doc.sellerSnapshot.adresse, doc.sellerSnapshot.commune, doc.sellerSnapshot.wilaya]
        .filter(Boolean)
        .join(", "),
      telephone: doc.sellerSnapshot.telephone ?? null,
      email: doc.sellerSnapshot.email ?? null,
      rc: doc.sellerSnapshot.rc ?? null,
      nif: doc.sellerSnapshot.nif ?? null,
      nis: doc.sellerSnapshot.nis ?? null,
      article_imposition: doc.sellerSnapshot.articleImposition ?? null,
    },
    buyer: {
      display_name: doc.buyerSnapshot.displayName,
      adresse: [doc.buyerSnapshot.adresse, doc.buyerSnapshot.commune, doc.buyerSnapshot.wilaya]
        .filter(Boolean)
        .join(", "),
      telephone: doc.buyerSnapshot.telephone ?? null,
      email: doc.buyerSnapshot.email ?? null,
      rc: doc.buyerSnapshot.rc ?? null,
      nif: doc.buyerSnapshot.nif ?? null,
      nis: doc.buyerSnapshot.nis ?? null,
      article_imposition: doc.buyerSnapshot.articleImposition ?? null,
    },
    lines: comp.lines.map((l, i) => ({
      designation: l.designation,
      qty: l.qty,
      unite: l.unite,
      pu_ht_cents: l.puHtCents,
      remise_pct: l.remisePct ?? 0,
      tax_rate_pct: l.taxRatePctSnapshot,
      ht_cents: comp.finalLineHtCents[i],
    })),
    total_ht_cents: comp.totalHtCents,
    total_tva_cents: comp.totalTvaCents,
    total_other_taxes_cents: comp.totalOtherTaxesCents,
    total_ttc_cents: comp.totalTtcCents,
    vat_detail: comp.vatDetail.map((v) => [
      v.ratePct === 0 ? "Exonéré (TVA 0 %)" : `TVA ${v.ratePct} %`,
      v.baseCents,
      v.amountCents,
    ]),
    other_tax_detail: comp.otherTaxDetail.map((v) => [
      `${v.libelle}${v.ratePct > 0 ? ` ${v.ratePct} %` : ""}`,
      v.baseCents,
      v.amountCents,
    ]),
    conditions_paiement: doc.conditionsPaiement ?? null,
    banque: company.afficherCoordonneesBancaires ? company.banque ?? null : null,
    rib: company.afficherCoordonneesBancaires ? company.rib ?? null : null,
    observations: doc.observations ?? null,
    conditions_vente: doc.conditionsVente ?? null,
    annulee: doc.status === "ANNULEE",
    devise: doc.devise || "DZD",
    logo_data_url: company.logoDataUrl ?? null,
  };
}

export type NativePdfResult = { ok: false } | { ok: true; path: string };

/**
 * Génère le PDF natif dans C:\ProgramData\FacturationDZ\Exports\.
 * Retourne `{ ok: false }` hors desktop → l'appelant utilise window.print.
 */
export async function tryNativePdf(doc: InvoiceDoc, company: Company): Promise<NativePdfResult> {
  if (!isTauri()) return { ok: false };
  try {
    const filename = doc.number ?? `brouillon-${doc.id.slice(0, 10)}`;
    const path = await invokeDesktop<string>("render_pdf_to_exports", {
      model: buildPdfModel(doc, company),
      filename,
    });
    return path ? { ok: true, path } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Intégrité SQLite native (§49) — null hors desktop. */
export async function tryNativeIntegrity(): Promise<{
  sqlite: string;
  orphan_invoices: number;
  duplicate_numbers: number;
} | null> {
  if (!isTauri()) return null;
  try {
    return await invokeDesktop("integrity_check");
  } catch {
    return null;
  }
}

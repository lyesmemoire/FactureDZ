/**
 * §10 — Autres taxes / droits / contributions : le moteur doit les
 * agréger SÉPARÉMENT de la TVA tout en conservant l'intégrité des totaux.
 */

import { describe, expect, it } from "vitest";
import { computeDocument } from "./invoiceCalculator";
import { presetTaxRates } from "./taxEngine";
import type { DocLine } from "./types";

function line(p: Partial<DocLine>): DocLine {
  return {
    id: p.id ?? "ln1",
    nature: "VENTE",
    designation: p.designation ?? "Article",
    qty: p.qty ?? 1,
    unite: "unité",
    puHtCents: p.puHtCents ?? 10000,
    taxCode: p.taxCode ?? "TVA19",
    taxRatePctSnapshot: p.taxRatePctSnapshot ?? 19,
    taxLibelleSnapshot: p.taxLibelleSnapshot ?? "TVA 19 %",
    taxKindSnapshot: p.taxKindSnapshot ?? "TVA",
    ...p,
  };
}

describe("Moteur fiscal — autres taxes (§10)", () => {
  it("le référentiel préconfiguré est composé de TVA uniquement", () => {
    expect(presetTaxRates().every((t) => t.kind === "TVA")).toBe(true);
  });

  it("une ligne TVA alimente vatDetail, pas otherTaxDetail", () => {
    const r = computeDocument([line({})]);
    expect(r.totalTvaCents).toBe(1900);
    expect(r.totalOtherTaxesCents).toBe(0);
    expect(r.otherTaxDetail).toHaveLength(0);
    expect(r.totalTtcCents).toBe(11900);
  });

  it("une autre taxe est calculée sur le HT et agrégée hors TVA", () => {
    const r = computeDocument([
      line({
        taxCode: "TIC",
        taxRatePctSnapshot: 3,
        taxLibelleSnapshot: "Taxe intérieure de consommation",
        taxKindSnapshot: "AUTRE",
      }),
    ]);
    expect(r.totalTvaCents).toBe(0);
    expect(r.totalOtherTaxesCents).toBe(300);
    expect(r.totalTtcCents).toBe(10300);
    expect(r.otherTaxDetail[0].libelle).toBe("Taxe intérieure de consommation");
    expect(r.otherTaxDetail[0].amountCents).toBe(300);
    // §16 : le montant en lettres porte sur le TTC (TVA + autres taxes) :
    // 10 300 centimes = 103,00 DA.
    expect(r.amountInWords).toMatch(/CENT TROIS DINARS/);
  });

  it("mélange TVA + autre taxe : TTC = HT + TVA + autres taxes, détail séparé", () => {
    const r = computeDocument([
      line({ id: "a", puHtCents: 10000 }), // TVA 19 % → 1900
      line({
        id: "b",
        puHtCents: 20000,
        taxCode: "TIC",
        taxRatePctSnapshot: 2,
        taxLibelleSnapshot: "Droit d'enregistrement",
        taxKindSnapshot: "AUTRE",
      }), // 400
    ]);
    expect(r.totalHtCents).toBe(30000);
    expect(r.totalTvaCents).toBe(1900);
    expect(r.totalOtherTaxesCents).toBe(400);
    expect(r.totalTtcCents).toBe(30000 + 1900 + 400);
    expect(r.vatDetail.map((v) => v.ratePct)).toEqual([19]);
    expect(r.otherTaxDetail.map((v) => v.ratePct)).toEqual([2]);
  });

  it("l'arrondi des autres taxes suit la politique centralisée (2 décimales)", () => {
    // 333 centimes × 2,5 % = 8,325 → 8 centimes (half up)
    const r = computeDocument([
      line({
        puHtCents: 333,
        taxCode: "A",
        taxRatePctSnapshot: 2.5,
        taxLibelleSnapshot: "Autre 2,5 %",
        taxKindSnapshot: "AUTRE",
      }),
    ]);
    expect(r.totalOtherTaxesCents).toBe(8);
  });
});
